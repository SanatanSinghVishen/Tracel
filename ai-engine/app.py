# ai-engine/app.py
from flask import Flask, request, jsonify, g
import joblib
import pandas as pd
from pathlib import Path
import os
from datetime import datetime, timedelta, timezone
import traceback
import math
import time

from pymongo import MongoClient
from dotenv import load_dotenv, dotenv_values

app = Flask(__name__)


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


def load_model():
    model_path = Path(str(MODEL_PATH))
    if not model_path.exists():
        return None, f"model file not found at {model_path}"
    try:
        return joblib.load(model_path), None
    except Exception as e:
        return None, f"failed to load model from {model_path}: {e}"


model = None
model_error = None


PROTOCOL_TO_INDEX = {
    'TCP': 0,
    'UDP': 1,
    'ICMP': 2,
    'HTTP': 3,
}

COMMON_PORTS = {80, 443, 8080}
ATTACK_PORTS = {23, 53, 123, 445, 3389, 1900, 4444}


def _protocol_index(protocol: str) -> int:
    p = (protocol or '').strip().upper()
    return int(PROTOCOL_TO_INDEX.get(p, 0))


def _build_features(raw_df: pd.DataFrame) -> pd.DataFrame:
    df = raw_df.copy()

    df['bytes_log'] = df['bytes'].astype(float).map(lambda x: math.log1p(max(0.0, x)))
    df['entropy'] = pd.to_numeric(df['entropy'], errors='coerce').fillna(0.3).astype(float).clip(0.0, 1.0)
    df['dst_port'] = pd.to_numeric(df['dst_port'], errors='coerce').fillna(80).astype(int)

    df['proto_tcp'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['TCP']).astype(int)
    df['proto_udp'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['UDP']).astype(int)
    df['proto_icmp'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['ICMP']).astype(int)
    df['proto_http'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['HTTP']).astype(int)

    df['port_is_common'] = df['dst_port'].isin(COMMON_PORTS).astype(int)
    df['port_is_attack'] = df['dst_port'].isin(ATTACK_PORTS).astype(int)
    df['port_is_weird'] = (~df['dst_port'].isin(COMMON_PORTS)).astype(int)

    cols = [
        'bytes_log',
        'entropy',
        'dst_port',
        'proto_tcp',
        'proto_udp',
        'proto_icmp',
        'proto_http',
        'port_is_common',
        'port_is_attack',
        'port_is_weird',
    ]
    return df[cols]


def ensure_model_loaded():
    global model, model_error
    if model is not None:
        return model, None
    if model_error is not None:
        return None, model_error

    print("Loading AI Model...")
    try:
        m, err = load_model()
        model = m
        model_error = err
        if model is None:
            print(f"AI model unavailable: {model_error}")
        else:
            print(f"AI model loaded from {MODEL_PATH}")
        return model, model_error
    except BaseException as e:
        # Catch even non-Exception failures (e.g., KeyboardInterrupt during slow imports)
        model = None
        model_error = f"failed to load model: {e}"
        print(f"AI model unavailable: {model_error}")
        return None, model_error


@app.route('/health', methods=['GET'])
def health():
    # Lightweight health endpoint for cold-start wake pings.
    # - GET /health -> fast response, does NOT force model load.
    # - GET /health?load=1 -> detailed health, forces model load (used by backend diagnostics).
    force_load = request.args.get('load') == '1'

    if not force_load:
        return jsonify({"status": "running"}), 200

    loaded_model, loaded_error = ensure_model_loaded()

    threshold = None
    model_type = None
    if isinstance(loaded_model, dict):
        model_type = 'bundle'
        threshold = loaded_model.get('threshold')
    elif loaded_model is not None:
        model_type = 'sklearn'

    payload = {
        "ok": True,
        "modelLoaded": loaded_model is not None,
        "modelError": loaded_error,
        "modelType": model_type,
        "modelPath": str(MODEL_PATH),
        "threshold": threshold,
    }

    # If the caller asked for a forced load and it failed, surface that via status.
    if loaded_model is None:
        return jsonify(payload), 503
    return jsonify(payload), 200

@app.route('/predict', methods=['POST'])
def predict():
    try:
        m, err = ensure_model_loaded()
        if m is None:
            return jsonify({"error": "model not loaded", "details": err}), 503

        data = request.json or {}

        # Optional correlation id for callers (echoed back).
        packet_id = data.get('id', None)

        # 1. PREPARE DATA (v2 feature vector)
        # Model expects: [bytes, protocol_index, entropy, dst_port]
        # Keep this endpoint tolerant to partial payloads.
        packet_bytes = int(data.get('bytes', 0) or 0)

        protocol = data.get('protocol')
        protocol_index = _protocol_index(protocol)

        entropy_raw = data.get('entropy', None)
        try:
            entropy = float(entropy_raw) if entropy_raw is not None else 0.3
        except Exception:
            entropy = 0.3
        entropy = max(0.0, min(1.0, entropy))

        # Accept both dst_port and port for compatibility.
        port_raw = data.get('dst_port', None)
        if port_raw is None:
            port_raw = data.get('port', None)
        try:
            dst_port = int(port_raw) if port_raw is not None else 80
        except Exception:
            dst_port = 80

        features = pd.DataFrame([
            {
                'bytes': packet_bytes,
                'protocol_index': protocol_index,
                'entropy': entropy,
                'dst_port': dst_port,
            }
        ])

        # 2. ASK THE BRAIN (score only)
        # IsolationForest decision_function: lower => more anomalous.
        # CRITICAL: do NOT return a binary label from this service; thresholding happens in Node.
        X = _build_features(features)
        if isinstance(m, dict):
            pipeline = m.get('model')
            cols = m.get('feature_columns') or list(X.columns)
            score = float(pipeline.decision_function(X[cols])[0])
        else:
            score = float(m.decision_function(X)[0])

        return jsonify({
            "score": float(score),
            "id": packet_id,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _get_mongo_url() -> str:
    return (
        os.getenv('MONGO_URL')
        or os.getenv('MONGODB_URI')
        or os.getenv('MONGO_URI')
        or ''
    ).strip()


def _get_mongo_db_name() -> str:
    return (os.getenv('MONGO_DB_NAME') or '').strip()


def _get_packets_collection():
    mongo_url = _get_mongo_url()
    if not mongo_url:
        return None, 'MONGO_URL not set for ai-engine'

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=1500)

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

if __name__ == '__main__':
    host = os.getenv('HOST', '0.0.0.0')
    try:
        port = int(os.getenv('PORT', '5000'))
    except Exception:
        port = 5000
    print(f"AI Service running on http://{host}:{port}")
    # Preload model so the first /predict doesn't pay load cost.
    ensure_model_loaded()
    # Enable concurrency: the default dev server is single-threaded, which can
    # backlog under bursty traffic (Attack mode) and cause client-side timeouts.
    app.run(host=host, port=port, threaded=True)