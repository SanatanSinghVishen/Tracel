# ai-engine/app.py
"""
Tracel AI Engine — FastAPI application.

Serves anomaly-detection predictions, threat-intelligence reports,
and model-management endpoints over HTTP.
"""
from __future__ import annotations

import asyncio
import math
import os
import time
import threading
import logging
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, quote, unquote, urlunparse

from fastapi import FastAPI, Request, Query, BackgroundTasks
from fastapi.responses import JSONResponse

from dotenv import load_dotenv, dotenv_values
from inference import predict, reload_model
import retrain
from pymongo import MongoClient
import motor.motor_asyncio

from schemas import (
    PredictRequest,
    PredictResponse,
    HealthResponse,
    HealthChecks,
    ModelCheck,
    ModelStatusResponse,
    ReloadModelResponse,
    RetrainResponse,
    ThreatIntelResponse,
    WindowInfo,
    HostileIp,
    AttackVectorEntry,
    GeoCountry,
    AiConfidenceDefinition,
    AiConfidenceThresholds,
    AiConfidenceBucket,
    ErrorResponse,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

START_TIME = time.time()

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", str(BASE_DIR / "model.pkl")))

# ──────────────────────────────────────────────
# Environment setup
# ──────────────────────────────────────────────

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


# ──────────────────────────────────────────────
# MongoDB helpers (shared by sync + async paths)
# ──────────────────────────────────────────────

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


# Sync pymongo helper — used by retrain.py (via import) and debug endpoint
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


# ──────────────────────────────────────────────
# Async Motor client (for /report/threat-intel)
# ──────────────────────────────────────────────

_motor_client: motor.motor_asyncio.AsyncIOMotorClient | None = None


def _get_motor_client() -> motor.motor_asyncio.AsyncIOMotorClient | None:
    global _motor_client
    if _motor_client is not None:
        return _motor_client
    mongo_url = _get_mongo_url()
    if not mongo_url:
        return None
    _motor_client = motor.motor_asyncio.AsyncIOMotorClient(
        mongo_url,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
        socketTimeoutMS=5000,
    )
    return _motor_client


async def _get_async_packets_collection():
    """Return (collection, error_string) using the async Motor driver."""
    client = _get_motor_client()
    if client is None:
        return None, 'MONGO_URL not set for ai-engine'

    # Prefer default DB from connection string
    db = None
    try:
        db = client.get_default_database()
    except Exception:
        db = None

    if db is None:
        explicit_name = _get_mongo_db_name() or None
        candidates = [n for n in [explicit_name, 'tracel', 'test'] if n]

        best_coll = None
        for name in candidates:
            try:
                candidate_db = client[name]
                candidate_coll = candidate_db['packets']
                count = await candidate_coll.estimated_document_count()
                if count > 0:
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


# ──────────────────────────────────────────────
# Lifespan (startup / shutdown)
# ──────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: preload model so the first /predict doesn't pay load cost.
    import inference
    inference.reload_model()
    logger.info("Model preloaded at startup.")
    yield
    # Shutdown: close Motor client cleanly.
    global _motor_client
    if _motor_client is not None:
        _motor_client.close()
        _motor_client = None


# ──────────────────────────────────────────────
# FastAPI application
# ──────────────────────────────────────────────

app = FastAPI(
    title="Tracel AI Engine",
    description="Anomaly detection and threat intelligence API for the Tracel network security platform.",
    version="1.0.0",
    lifespan=lifespan,
)

# Store retrain status on the app state object
app.state.last_retrain_status = None
app.state.last_retrain_time = None


# ──────────────────────────────────────────────
# Middleware: slow request logging
# ──────────────────────────────────────────────

@app.middleware("http")
async def log_slow_requests(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    dt_ms = (time.perf_counter() - t0) * 1000.0
    threshold = float(os.getenv('AI_SLOW_REQUEST_MS', '250'))
    if dt_ms >= threshold:
        logger.warning(f"[AI] SLOW {request.method} {request.url.path} {response.status_code} {dt_ms:.1f}ms")
    return response


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@app.get('/')
async def root():
    return {
        'ok': True,
        'service': 'ai-engine',
        'endpoints': {
            'health': '/health',
            'predict': '/predict',
            'docs': '/docs',
        },
    }


@app.get('/health', response_model=HealthResponse)
async def health():
    import inference as _inf

    uptime = int(time.time() - START_TIME)

    with _inf._model_lock:
        loaded_model = _inf._model
        loaded_error = _inf._model_error
        explainer = _inf._explainer

    model_status = 'ok'
    if loaded_error:
        model_status = 'error'
    elif not loaded_model:
        model_status = 'degraded'

    payload = HealthResponse(
        status="ok" if model_status == 'ok' else model_status,
        uptime_s=uptime,
        checks=HealthChecks(
            model=ModelCheck(
                status=model_status,
                path=str(_inf.MODEL_PATH),
                explainer_initialized=explainer is not None,
                error=str(loaded_error) if loaded_error else None,
                last_retrain_status=app.state.last_retrain_status,
                last_retrain_time=app.state.last_retrain_time,
            )
        ),
    )

    status_code = 200 if payload.status in ["ok", "degraded"] else 503
    return JSONResponse(content=payload.model_dump(), status_code=status_code)


@app.post('/predict', response_model=PredictResponse)
async def handle_predict(data: PredictRequest):
    try:
        # Convert Pydantic model to dict for the existing predict() function
        result = predict(data.model_dump())
        return result
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.post('/admin/reload-model', response_model=ReloadModelResponse)
async def handle_reload_model():
    success, msg = reload_model()
    if success:
        return ReloadModelResponse(ok=True, message=msg)
    else:
        return JSONResponse(
            content=ReloadModelResponse(ok=False, error=msg).model_dump(),
            status_code=500,
        )


@app.get('/admin/model-status', response_model=ModelStatusResponse)
async def model_status():
    import inference as _inf
    with _inf._model_lock:
        is_loaded = _inf._model is not None
        err = _inf._model_error

    return ModelStatusResponse(
        loaded=is_loaded,
        error=err,
        modelPath=str(_inf.MODEL_PATH),
        lastRetrainStatus=app.state.last_retrain_status,
        lastRetrainTime=app.state.last_retrain_time,
    )


@app.get('/debug/db')
async def debug_db():
    """Diagnostic endpoint: shows which MongoDB database/collection is visible to the AI engine."""
    try:
        mongo_url = _get_mongo_url()
        db_name_env = _get_mongo_db_name()

        # Sanitize URL for display (hide credentials)
        safe_url = "not set"
        if mongo_url:
            try:
                p = urlparse(mongo_url)
                safe_url = f"{p.scheme}://***@{p.hostname}{p.path}"
            except Exception:
                safe_url = mongo_url[:20] + "..."

        if not mongo_url:
            return JSONResponse(
                content={"error": "MONGO_URL not set", "safe_url": safe_url},
                status_code=503,
            )

        client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000,
                             connectTimeoutMS=5000, socketTimeoutMS=5000)

        result = {
            "safe_url": safe_url,
            "MONGO_DB_NAME_env": db_name_env or "(not set)",
            "databases": [],
        }

        try:
            dbs = client.list_database_names()
            result["databases"] = dbs
        except Exception as e:
            result["databases_error"] = str(e)

        # Check packets collection in each DB
        collections_info = {}
        for db_name in (result.get("databases") or []):
            try:
                db = client[db_name]
                colls = db.list_collection_names()
                pkt_count = 0
                if "packets" in colls:
                    pkt_count = db["packets"].estimated_document_count()
                collections_info[db_name] = {"collections": colls, "packets_count": pkt_count}
            except Exception as e:
                collections_info[db_name] = {"error": str(e)}

        result["collections_by_db"] = collections_info
        return result
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


# ──────────────────────────────────────────────
# Threat-intel helpers
# ──────────────────────────────────────────────

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


async def _run_aggregation(coll, pipeline: list, allow_disk_use: bool = False) -> list:
    """Run a Motor aggregation and collect results into a list."""
    cursor = coll.aggregate(pipeline, allowDiskUse=allow_disk_use)
    return await cursor.to_list(length=None)


# ──────────────────────────────────────────────
# /report/threat-intel  (async with Motor)
# ──────────────────────────────────────────────

@app.get('/report/threat-intel')
async def report_threat_intel(
    sinceHours: str = Query('24'),
    ownerUserId: str = Query(''),
):
    """Generate a simple SOC-facing threat intelligence summary.

    This reads packet data from MongoDB (same collection used by the Node server)
    and uses async Motor to compute aggregates concurrently.
    """
    try:
        coll, err = await _get_async_packets_collection()
        if coll is None:
            return JSONResponse(content={"ok": False, "error": err}, status_code=503)

        owner_user_id = (ownerUserId or '').strip()

        try:
            since_hours = max(1, min(int(sinceHours), 168))
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

        # Build all 5 aggregation pipelines
        total_pipeline = [
            {'$match': base_match},
            add_ts,
            window_match,
            {'$count': 'count'},
        ]

        ip_pipeline = [
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

        vector_pipeline = [
            {'$match': base_match},
            add_ts,
            window_match,
            {'$addFields': {'vector': vector_expr}},
            {'$group': {'_id': '$vector', 'value': {'$sum': 1}}},
        ]

        country_pipeline = [
            {'$match': base_match},
            add_ts,
            window_match,
            {'$addFields': {'country': country_expr}},
            {'$group': {'_id': '$country', 'count': {'$sum': 1}}},
            {'$sort': {'count': -1}},
            {'$limit': 5},
        ]

        score_pipeline = [
            {'$match': base_match},
            add_ts,
            window_match,
            {
                '$project': {
                    '_id': 0,
                    'anomaly_score': 1,
                }
            },
        ]

        # Run ALL 5 aggregations concurrently via asyncio.gather
        total_rows, ip_rows, vector_rows, country_rows, score_rows = await asyncio.gather(
            _run_aggregation(coll, total_pipeline),
            _run_aggregation(coll, ip_pipeline),
            _run_aggregation(coll, vector_pipeline),
            _run_aggregation(coll, country_pipeline),
            _run_aggregation(coll, score_pipeline, allow_disk_use=True),
        )

        total = int((total_rows[0]['count'] if total_rows else 0) or 0)

        if total <= 0:
            return ThreatIntelResponse(
                window=WindowInfo(
                    since=since.isoformat() + 'Z',
                    to=now.isoformat() + 'Z',
                    sinceHours=since_hours,
                ),
                totalThreats=0,
                topHostileIps=[],
                attackVectorDistribution=[
                    AttackVectorEntry(name='Volumetric', value=0),
                    AttackVectorEntry(name='Protocol', value=0),
                    AttackVectorEntry(name='Application', value=0),
                ],
                geoTopCountries=[],
                aiConfidenceDistribution=[
                    AiConfidenceBucket(bucket='Obvious', count=0),
                    AiConfidenceBucket(bucket='Subtle', count=0),
                    AiConfidenceBucket(bucket='Other', count=0),
                ],
            )

        # Top hostile IPs
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
            top_hostile.append(HostileIp(
                ip=ip,
                count=int(r.get('count') or 0),
                lastSeen=last_seen_iso,
            ))

        # Attack vector distribution
        vector_counts = {str(r.get('_id') or ''): int(r.get('value') or 0) for r in vector_rows}
        vector_dist = [
            AttackVectorEntry(name='Volumetric', value=int(vector_counts.get('Volumetric', 0))),
            AttackVectorEntry(name='Protocol', value=int(vector_counts.get('Protocol', 0))),
            AttackVectorEntry(name='Application', value=int(vector_counts.get('Application', 0))),
        ]

        # Geo breakdown
        geo_top = []
        for r in country_rows:
            name = str(r.get('_id') or '')
            c = int(r.get('count') or 0)
            pct = round((c / total) * 100) if total > 0 else 0
            geo_top.append(GeoCountry(name=name, count=c, pct=int(pct)))

        # AI confidence distribution (quantiles over full window)
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
        thresholds = AiConfidenceThresholds()

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
                thresholds = AiConfidenceThresholds(obviousLe=q_obvious, subtleLe=q_subtle)

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
                thresholds = AiConfidenceThresholds(
                    obviousLe=float(s_sorted[min(n_obvious - 1, n - 1)]),
                    subtleLe=float(s_sorted[min(n_obvious + n_subtle - 1, n - 1)]),
                )

        return ThreatIntelResponse(
            window=WindowInfo(
                since=since.isoformat() + 'Z',
                to=now.isoformat() + 'Z',
                sinceHours=since_hours,
            ),
            totalThreats=total,
            topHostileIps=top_hostile,
            attackVectorDistribution=vector_dist,
            geoTopCountries=geo_top,
            aiConfidenceThresholds=thresholds,
            aiConfidenceDistribution=[
                AiConfidenceBucket(bucket='Obvious', count=obvious),
                AiConfidenceBucket(bucket='Subtle', count=subtle),
                AiConfidenceBucket(bucket='Other', count=other),
            ],
        )
    except Exception as e:
        logger.error(f"report_threat_intel error: {e}")
        traceback.print_exc()
        return JSONResponse(content={"ok": False, "error": str(e)}, status_code=500)


# ──────────────────────────────────────────────
# /retrain
# ──────────────────────────────────────────────

@app.post('/retrain', response_model=RetrainResponse, status_code=202)
async def trigger_retrain(background_tasks: BackgroundTasks):
    try:
        hours = int(os.getenv('RETRAIN_INTERVAL_HOURS', '24'))
    except ValueError:
        hours = 24

    def _run():
        try:
            success, msg = retrain.run_retrain_job(since_hours=hours)
            app.state.last_retrain_status = msg
            app.state.last_retrain_time = datetime.now().isoformat() + "Z"
            logger.info(f"Retrain finished: success={success} msg={msg}")
        except ValueError as ve:
            # Not enough data in the requested window — widen to 7 days and retry
            logger.warning(f"Not enough data in last {hours}h, retrying with 168h window: {ve}")
            try:
                success, msg = retrain.run_retrain_job(since_hours=168)
                app.state.last_retrain_status = msg
                app.state.last_retrain_time = datetime.now().isoformat() + "Z"
                logger.info(f"Retrain (168h retry) finished: success={success} msg={msg}")
            except Exception as e2:
                app.state.last_retrain_status = str(e2)
                app.state.last_retrain_time = datetime.now().isoformat() + "Z"
                logger.error(f"Retrain (168h retry) failed: {e2}")
        except Exception as e:
            app.state.last_retrain_status = str(e)
            app.state.last_retrain_time = datetime.now().isoformat() + "Z"
            logger.error(f"Retrain thread error: {e}")

    # Use a thread for retrain since it uses sync pymongo and CPU-heavy sklearn
    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return RetrainResponse(
        msg="Retraining started in background",
        since_hours=hours,
    )


# ──────────────────────────────────────────────
# Dev server entrypoint
# ──────────────────────────────────────────────

if __name__ == '__main__':
    import uvicorn

    host = os.getenv('HOST', '0.0.0.0')
    try:
        port = int(os.getenv('PORT', '5000'))
    except Exception:
        port = 5000
    print(f"AI Service running on http://{host}:{port}")

    uvicorn.run("app:app", host=host, port=port, reload=True)