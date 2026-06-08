# ai-engine/app.py
from flask import Flask, request, jsonify, g
from pathlib import Path
import os
import time
import threading
from datetime import datetime
from urllib.parse import urlparse, quote, unquote, urlunparse

from dotenv import load_dotenv, dotenv_values
from inference import predict, reload_model
import retrain
from pymongo import MongoClient

app = Flask(__name__)
START_TIME = time.time()


@app.route('/', methods=['GET'])
def root():
    return jsonify(
        {
            'ok': True,
            'service': 'ai-engine',
            'endpoints': {
                'health': '/health',
                'predict': '/predict',
            },
        }
    ), 200


@app.before_request
def _start_timer():
    g._t0 = time.perf_counter()


@app.after_request
def _log_slow_requests(response):
    try:
        t0 = getattr(g, '_t0', None)
        if t0 is None:
            return response
        dt_ms = (time.perf_counter() - t0) * 1000.0
        # Only log slow-ish requests to keep noise down.
        if dt_ms >= float(os.getenv('AI_SLOW_REQUEST_MS', '250')):
            print(f"[AI] SLOW {request.method} {request.path} {response.status_code} {dt_ms:.1f}ms")
        return response
    except Exception:
        return response

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", str(BASE_DIR / "model.pkl")))

# Load env vars for this service.
# IMPORTANT: do NOT blindly load server/.env, because it defines PORT=3001 for Express.
# If we import that into the AI process, it will try to bind to 3001 and conflict.
load_dotenv(BASE_DIR / '.env', override=False)

# Optionally reuse a few server env values (Mongo) without importing unrelated keys.
_server_env_path = BASE_DIR.parent / 'server' / '.env'
if _server_env_path.exists():
    try:
        _server_env = dotenv_values(_server_env_path)
        for _k in (
            'MONGO_URL',
            'MONGODB_URI',
            'MONGO_URI',
            'MONGO_DB_NAME',
            'TRACEL_LOG_LEVEL',
        ):
            _v = (_server_env.get(_k) or '').strip() if _server_env else ''
            if _v and not (os.getenv(_k) or '').strip():
                os.environ[_k] = _v
    except Exception:
        # Ignore malformed .env; AI engine can run without Mongo.
        pass


@app.route('/admin/reload-model', methods=['POST'])
def handle_reload_model():
    success, msg = reload_model()
    if success:
        return jsonify({"ok": True, "message": msg}), 200
    else:
        return jsonify({"ok": False, "error": msg}), 500

@app.route('/health', methods=['GET'])
def health():
    import inference
    import os
    
    uptime = int(time.time() - START_TIME)
    
    with inference._model_lock:
        loaded_model = inference._model
        loaded_error = inference._model_error
        explainer = inference._explainer
        
    model_status = 'ok'
    if loaded_error:
        model_status = 'error'
    elif not loaded_model:
        model_status = 'degraded'
        
    # Get retrain job status
    last_retrain_status = getattr(app, 'last_retrain_status', None)
    last_retrain_time = getattr(app, 'last_retrain_time', None)

    payload = {
        "status": "ok" if model_status == 'ok' else model_status,
        "service": "ai-engine",
        "version": "1.0.0",
        "uptime_s": uptime,
        "checks": {
            "model": {
                "status": model_status,
                "path": str(inference.MODEL_PATH),
                "explainer_initialized": explainer is not None,
                "error": str(loaded_error) if loaded_error else None,
                "last_retrain_status": last_retrain_status,
                "last_retrain_time": last_retrain_time
            }
        }
    }
    
    status_code = 200 if payload["status"] in ["ok", "degraded"] else 503
    return jsonify(payload), status_code

@app.route('/predict', methods=['POST'])
def handle_predict():
    try:
        data = request.json or {}
        result = predict(data)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/admin/model-status', methods=['GET'])
def model_status():
    import inference
    with inference._model_lock:
        is_loaded = inference._model is not None
        err = inference._model_error
    
    return jsonify({
        "ok": True,
        "loaded": is_loaded,
        "error": err,
        "modelPath": str(inference.MODEL_PATH),
        "lastRetrainStatus": getattr(app, 'last_retrain_status', None),
        "lastRetrainTime": getattr(app, 'last_retrain_time', None),
    }), 200


def _get_mongo_url() -> str:
    url = (
        os.getenv('MONGO_URL')
        or os.getenv('MONGODB_URI')
        or os.getenv('MONGO_URI')
        or ''
    ).strip()
    
    if url:
        try:
            parsed = urlparse(url)
            if parsed.password or parsed.username:
                username = quote(unquote(parsed.username)) if parsed.username else ""
                password = quote(unquote(parsed.password)) if parsed.password else ""
                auth = f"{username}:{password}@" if username or password else ""
                netloc = f"{auth}{parsed.hostname}" if parsed.hostname else auth
                if parsed.port:
                    netloc += f":{parsed.port}"
                parsed = parsed._replace(netloc=netloc)
                url = urlunparse(parsed)
        except Exception as e:
            logger.warning(f"Failed to parse or escape MONGO_URL: {e}")
            
    return url


def _get_mongo_db_name() -> str:
    return (os.getenv('MONGO_DB_NAME') or '').strip()


def _get_packets_collection():
    mongo_url = _get_mongo_url()
    if not mongo_url:
        return None, 'MONGO_URL not set for ai-engine'

    client = MongoClient(
        mongo_url, 
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
        socketTimeoutMS=5000
    )

    # Prefer default DB from connection string, else explicit env var, else fallback.
    db = None
    try:
        db = client.get_default_database()
    except Exception:
        db = None

    if db is None:
        # If the connection string doesn't specify a default DB, different drivers may
        # pick different defaults (often "test"). We try a small set of candidates and
        # pick the first one that appears to contain packet data.
        explicit_name = _get_mongo_db_name() or None
        candidates = [n for n in [explicit_name, 'tracel', 'test'] if n]

        best_coll = None
        for name in candidates:
            try:
                candidate_db = client[name]
                candidate_coll = candidate_db['packets']
                # estimated_document_count is fast and avoids full scans.
                if candidate_coll.estimated_document_count() > 0:
                    best_coll = candidate_coll
                    break
                if best_coll is None:
                    best_coll = candidate_coll
            except Exception:
                continue

        if best_coll is None:
            return None, 'MongoDB connection established, but no usable database found'
        return best_coll, None

    return db['packets'], None


def _ip_to_country_name(ip: str) -> str:
    # Must stay in sync with dashboard/src/utils/geoData.js ordering.
    countries = [
        'United States',
        'Canada',
        'Brazil',
        'United Kingdom',
        'Germany',
        'Russia',
        'China',
        'Japan',
        'Australia',
        'South Africa',
    ]

    s = (ip or '').strip()
    try:
        first = int(s.split('.')[0])
        if first < 0:
            return countries[0]
        return countries[abs(first) % len(countries)]
    except Exception:
        return countries[0]


def _classify_attack_vector(method: str, bytes_count: int) -> str:
    # Simple heuristic classification based on stored telemetry.
    m = (method or '').strip().upper()
    b = int(bytes_count or 0)

    if b >= 7000:
        return 'Volumetric'
    if m in {'POST', 'PUT', 'PATCH', 'DELETE'}:
        return 'Application'
    return 'Protocol'


@app.route('/report/threat-intel', methods=['GET'])
def report_threat_intel():
    """Generate a simple SOC-facing threat intelligence summary.

    This reads packet data from MongoDB (same collection used by the Node server)
    and uses pandas to compute aggregates.
    """
    try:
        coll, err = _get_packets_collection()
        if coll is None:
            return jsonify({"ok": False, "error": err}), 503

        since_hours = request.args.get('sinceHours', '24')
        owner_user_id = (request.args.get('ownerUserId') or '').strip()

        try:
            since_hours = max(1, min(int(since_hours), 168))
        except Exception:
            since_hours = 24

        # Use UTC datetimes for windowing; convert to naive for Mongo queries
        # (pymongo default is tz_aware=False).
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        since = now - timedelta(hours=since_hours)

        # Base filter: only anomalies.
        base_match = {
            'is_anomaly': {'$in': [True, 1, 'true', 'True']},
        }
        if owner_user_id:
            base_match['owner_user_id'] = owner_user_id

        # Robust timestamp parsing: supports BSON Date and ISO-like strings.
        # If conversion fails, ts becomes null and we drop it in the window match.
        add_ts = {
            '$addFields': {
                'ts': {
                    '$convert': {
                        'input': '$timestamp',
                        'to': 'date',
                        'onError': None,
                        'onNull': None,
                    }
                }
            }
        }
        window_match = {
            '$match': {
                'ts': {
                    '$gte': since,
                    '$lt': now,
                }
            }
        }

        # Country derivation (matches the legacy deterministic mapping when explicit country is missing)
        countries = [
            'United States',
            'Canada',
            'Brazil',
            'United Kingdom',
            'Germany',
            'Russia',
            'China',
            'Japan',
            'Australia',
            'South Africa',
        ]

        country_expr = {
            '$let': {
                'vars': {
                    'explicit': {
                        '$trim': {
                            'input': {
                                '$ifNull': ['$source_country', '']
                            }
                        }
                    },
                    'ipStr': {
                        '$ifNull': ['$source_ip', '']
                    },
                },
                'in': {
                    '$cond': [
                        {'$gt': [{'$strLenCP': '$$explicit'}, 0]},
                        '$$explicit',
                        {
                            '$let': {
                                'vars': {
                                    'firstOctetStr': {
                                        '$arrayElemAt': [
                                            {'$split': ['$$ipStr', '.']},
                                            0,
                                        ]
                                    }
                                },
                                'in': {
                                    '$let': {
                                        'vars': {
                                            'firstInt': {
                                                '$convert': {
                                                    'input': '$$firstOctetStr',
                                                    'to': 'int',
                                                    'onError': 0,
                                                    'onNull': 0,
                                                }
                                            }
                                        },
                                        'in': {
                                            '$arrayElemAt': [
                                                countries,
                                                {
                                                    '$mod': [
                                                        {'$abs': '$$firstInt'},
                                                        len(countries),
                                                    ]
                                                },
                                            ]
                                        },
                                    }
                                },
                            }
                        },
                    ]
                },
            }
        }

        # Attack vector derivation (matches the legacy heuristic + respects explicit values)
        vector_expr = {
            '$let': {
                'vars': {
                    'explicit': {
                        '$toLower': {
                            '$trim': {
                                'input': {
                                    '$ifNull': ['$attack_vector', '']
                                }
                            }
                        }
                    },
                    'm': {
                        '$toUpper': {
                            '$ifNull': ['$method', '']
                        }
                    },
                    'b': {
                        '$convert': {
                            'input': '$bytes',
                            'to': 'int',
                            'onError': 0,
                            'onNull': 0,
                        }
                    },
                },
                'in': {
                    '$switch': {
                        'branches': [
                            {
                                'case': {
                                    '$regexMatch': {'input': '$$explicit', 'regex': r'^vol'}
                                },
                                'then': 'Volumetric',
                            },
                            {
                                'case': {
                                    '$regexMatch': {'input': '$$explicit', 'regex': r'^prot'}
                                },
                                'then': 'Protocol',
                            },
                            {
                                'case': {
                                    '$regexMatch': {'input': '$$explicit', 'regex': r'^app'}
                                },
                                'then': 'Application',
                            },
                        ],
                        'default': {
                            '$cond': [
                                {'$gte': ['$$b', 7000]},
                                'Volumetric',
                                {
                                    '$cond': [
                                        {'$in': ['$$m', ['POST', 'PUT', 'PATCH', 'DELETE']]},
                                        'Application',
                                        'Protocol',
                                    ]
                                },
                            ]
                        },
                    }
                },
            }
        }

        # Total threats (exact)
        total_rows = list(
            coll.aggregate(
                [
                    {'$match': base_match},
                    add_ts,
                    window_match,
                    {'$count': 'count'},
                ]
            )
        )
        total = int((total_rows[0]['count'] if total_rows else 0) or 0)

        if total <= 0:
            return jsonify(
                {
                    'ok': True,
                    'window': {
                        'since': since.isoformat() + 'Z',
                        'to': now.isoformat() + 'Z',
                        'sinceHours': since_hours,
                    },
                    'totalThreats': 0,
                    'topHostileIps': [],
                    'attackVectorDistribution': [
                        {'name': 'Volumetric', 'value': 0},
                        {'name': 'Protocol', 'value': 0},
                        {'name': 'Application', 'value': 0},
                    ],
                    'geoTopCountries': [],
                    'aiConfidenceDefinition': {
                        'method': 'quantiles',
                        'obvious': 'lowest ~20% anomaly scores (most suspicious)',
                        'subtle': 'next ~40% anomaly scores',
                        'other': 'remaining scores',
                        'note': 'Buckets are relative to the selected time window.',
                    },
                    'aiConfidenceDistribution': [
                        {'bucket': 'Obvious', 'count': 0},
                        {'bucket': 'Subtle', 'count': 0},
                        {'bucket': 'Other', 'count': 0},
                    ],
                    'generatedBy': 'ai-engine (mongo aggregation)',
                }
            )

        # Top hostile IPs (exact)
        ip_rows = list(
            coll.aggregate(
                [
                    {'$match': base_match},
                    add_ts,
                    window_match,
                    {
                        '$group': {
                            '_id': {'$ifNull': ['$source_ip', '']},
                            'count': {'$sum': 1},
                            'lastSeen': {'$max': '$ts'},
                        }
                    },
                    {'$sort': {'count': -1, 'lastSeen': -1}},
                    {'$limit': 5},
                ]
            )
        )
        top_hostile = []
        for r in ip_rows:
            ip = str(r.get('_id') or '')
            dt = r.get('lastSeen')
            last_seen_iso = None
            try:
                if isinstance(dt, datetime):
                    last_seen_iso = dt.isoformat() + 'Z'
            except Exception:
                last_seen_iso = None
            top_hostile.append(
                {
                    'ip': ip,
                    'count': int(r.get('count') or 0),
                    'lastSeen': last_seen_iso,
                }
            )

        # Attack vector distribution (exact)
        vector_rows = list(
            coll.aggregate(
                [
                    {'$match': base_match},
                    add_ts,
                    window_match,
                    {'$addFields': {'vector': vector_expr}},
                    {'$group': {'_id': '$vector', 'value': {'$sum': 1}}},
                ]
            )
        )
        vector_counts = {str(r.get('_id') or ''): int(r.get('value') or 0) for r in vector_rows}
        vector_dist = [
            {'name': 'Volumetric', 'value': int(vector_counts.get('Volumetric', 0))},
            {'name': 'Protocol', 'value': int(vector_counts.get('Protocol', 0))},
            {'name': 'Application', 'value': int(vector_counts.get('Application', 0))},
        ]

        # Geo breakdown (exact)
        country_rows = list(
            coll.aggregate(
                [
                    {'$match': base_match},
                    add_ts,
                    window_match,
                    {'$addFields': {'country': country_expr}},
                    {'$group': {'_id': '$country', 'count': {'$sum': 1}}},
                    {'$sort': {'count': -1}},
                    {'$limit': 5},
                ]
            )
        )
        geo_top = []
        for r in country_rows:
            name = str(r.get('_id') or '')
            c = int(r.get('count') or 0)
            pct = round((c / total) * 100) if total > 0 else 0
            geo_top.append({'name': name, 'count': c, 'pct': int(pct)})

        # AI confidence distribution (exact quantiles over full window)
        score_rows = coll.aggregate(
            [
                {'$match': base_match},
                add_ts,
                window_match,
                {
                    '$project': {
                        '_id': 0,
                        'anomaly_score': 1,
                    }
                },
            ],
            allowDiskUse=True,
        )
        scores = []
        for r in score_rows:
            s = r.get('anomaly_score')
            try:
                if s is None:
                    continue
                sf = float(s)
                if math.isfinite(sf):
                    scores.append(sf)
            except Exception:
                continue

        obvious = 0
        subtle = 0
        other = int(total)
        thresholds = {'obviousLe': None, 'subtleLe': None}

        if scores:
            s_sorted = sorted(scores)
            if len(s_sorted) >= 2 and (s_sorted[-1] - s_sorted[0]) >= 1e-9:
                # Match pandas' default quantile interpolation ('linear').
                def _quantile(sorted_values, q: float) -> float:
                    n = len(sorted_values)
                    if n == 1:
                        return float(sorted_values[0])
                    pos = (n - 1) * q
                    lo = int(math.floor(pos))
                    hi = int(math.ceil(pos))
                    if lo == hi:
                        return float(sorted_values[lo])
                    w = pos - lo
                    return float(sorted_values[lo] * (1.0 - w) + sorted_values[hi] * w)

                q_obvious = _quantile(s_sorted, 0.20)
                q_subtle = _quantile(s_sorted, 0.60)
                thresholds = {'obviousLe': q_obvious, 'subtleLe': q_subtle}

                for s in scores:
                    if s <= q_obvious:
                        obvious += 1
                    elif s <= q_subtle:
                        subtle += 1
                other = int(total - obvious - subtle)
            else:
                # If all scores are identical (or nearly identical), value-based
                # thresholds collapse. Fall back to rank-based buckets.
                n = len(s_sorted)
                n_obvious = int(math.ceil(n * 0.20))
                n_subtle = int(math.ceil(n * 0.40))
                obvious = n_obvious
                subtle = n_subtle
                other = int(total - obvious - subtle)
                thresholds = {'obviousLe': float(s_sorted[min(n_obvious - 1, n - 1)]), 'subtleLe': float(s_sorted[min(n_obvious + n_subtle - 1, n - 1)])}

        return jsonify(
            {
                'ok': True,
                'window': {
                    'since': since.isoformat() + 'Z',
                    'to': now.isoformat() + 'Z',
                    'sinceHours': since_hours,
                },
                'totalThreats': total,
                'topHostileIps': top_hostile,
                'attackVectorDistribution': vector_dist,
                'geoTopCountries': geo_top,
                'aiConfidenceDefinition': {
                    'method': 'quantiles',
                    'obvious': 'lowest ~20% anomaly scores (most suspicious)',
                    'subtle': 'next ~40% anomaly scores',
                    'other': 'remaining scores',
                    'note': 'Buckets are relative to the selected time window.',
                },
                'aiConfidenceThresholds': thresholds,
                'aiConfidenceDistribution': [
                    {'bucket': 'Obvious', 'count': obvious},
                    {'bucket': 'Subtle', 'count': subtle},
                    {'bucket': 'Other', 'count': other},
                ],
                'generatedBy': 'ai-engine (mongo aggregation)',
            }
        )
    except Exception as e:
        print(f"report_threat_intel error: {e}")
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/retrain', methods=['POST'])
def trigger_retrain():
    try:
        hours = int(os.getenv('RETRAIN_INTERVAL_HOURS', '24'))
    except ValueError:
        hours = 24
        
    success, msg = retrain.run_retrain_job(since_hours=hours)
    app.last_retrain_status = msg
    app.last_retrain_time = datetime.now().isoformat() + "Z"
    
    return jsonify({
        "ok": success,
        "msg": msg,
        "since_hours": hours
    }), 200 if success else 500

if __name__ == '__main__':
    host = os.getenv('HOST', '0.0.0.0')
    try:
        port = int(os.getenv('PORT', '5000'))
    except Exception:
        port = 5000
    print(f"AI Service running on http://{host}:{port}")
    
    # Preload model so the first /predict doesn't pay load cost.
    import inference
    inference.reload_model()
    
    # Enable concurrency: the default dev server is single-threaded, which can
    # backlog under bursty traffic (Attack mode) and cause client-side timeouts.
    app.run(host=host, port=port, threaded=True)