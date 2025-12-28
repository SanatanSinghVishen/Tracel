# ai-engine/app.py
from flask import Flask, request, jsonify
import joblib
import pandas as pd
from pathlib import Path
import os
from datetime import datetime, timedelta, timezone
import traceback

from pymongo import MongoClient
from dotenv import load_dotenv

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", str(BASE_DIR / "model.pkl")))

# Load shared env vars (so this service can reuse server's MONGO_URL, etc.)
load_dotenv(BASE_DIR / '.env', override=False)
load_dotenv(BASE_DIR.parent / 'server' / '.env', override=False)


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
    # Health here means the service is up; model may load later (lazy).
    return jsonify({"ok": True, "modelLoaded": model is not None, "modelError": model_error}), 200

@app.route('/predict', methods=['POST'])
def predict():
    try:
        m, err = ensure_model_loaded()
        if m is None:
            return jsonify({"error": "model not loaded", "details": err}), 503

        data = request.json
        
        # 1. PREPARE DATA
        # Convert JSON input to the format the model expects
        # "method": "POST" -> is_post: 1
        method = (data.get('method') or '').upper()
        is_post = 1 if method == 'POST' else 0
        packet_bytes = int(data.get('bytes', 0) or 0)
        
        features = pd.DataFrame([{
            'bytes': packet_bytes,
            'is_post': is_post
        }])

        # 2. ASK THE BRAIN
        # Prediction: 1 = Normal, -1 = Anomaly
        prediction = m.predict(features)[0]
        
        # 3. CALCULATE SCORE (How bad is it?)
        # Lower score = More anomalous
        score = m.decision_function(features)[0]

        result = {
            "is_anomaly": True if prediction == -1 else False,
            "anomaly_score": float(score)
        }
        
        # Print warning in terminal if attack detected
        if result['is_anomaly']:
            print(f"ANOMALY DETECTED! Size: {packet_bytes}B | Score: {score:.2f}")

        return jsonify(result)

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
        limit = request.args.get('limit', '10000')
        owner_user_id = (request.args.get('ownerUserId') or '').strip()

        try:
            since_hours = max(1, min(int(since_hours), 168))
        except Exception:
            since_hours = 24

        try:
            limit = max(1, min(int(limit), 50000))
        except Exception:
            limit = 10000

        # Use naive UTC datetimes for Mongo queries (pymongo default is tz_aware=False).
        now = datetime.utcnow()
        since = now - timedelta(hours=since_hours)

        # Query only threats/anomalies. We do time window filtering in pandas to be
        # resilient if timestamps are stored as strings instead of BSON Date.
        mongo_filter = {
            'is_anomaly': {'$in': [True, 1, 'true', 'True']},
        }
        if owner_user_id:
            mongo_filter['owner_user_id'] = owner_user_id

        cursor = (
            coll.find(
                mongo_filter,
                {
                    '_id': 0,
                    'owner_user_id': 1,
                    'source_ip': 1,
                    'method': 1,
                    'bytes': 1,
                    'timestamp': 1,
                    'anomaly_score': 1,
                    'attack_vector': 1,
                    'source_country': 1,
                },
            )
            .sort('timestamp', -1)
            .limit(limit)
        )

        docs = list(cursor)
        if not docs:
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
                }
            )

        df = pd.DataFrame(docs)

        # Normalize missing columns
        for col in ['source_ip', 'method', 'bytes', 'timestamp', 'anomaly_score', 'attack_vector', 'source_country']:
            if col not in df.columns:
                df[col] = None

        df['source_ip'] = df['source_ip'].fillna('').astype(str)
        df['method'] = df['method'].fillna('').astype(str)
        df['bytes'] = pd.to_numeric(df['bytes'], errors='coerce').fillna(0).astype(int)
        df['timestamp'] = pd.to_datetime(df['timestamp'], errors='coerce', utc=True)

        # Apply time window (keep only rows within sinceHours)
        since_utc = pd.Timestamp(since).tz_localize('UTC')
        df = df[df['timestamp'].notna() & (df['timestamp'] >= since_utc)]

        if df.empty:
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
                    'generatedBy': 'ai-engine (python/pandas)',
                }
            )

        # Attack vector: use explicit if present, else derived.
        def _vector_row(row):
            explicit = str(row.get('attack_vector') or '').strip()
            if explicit:
                v = explicit.lower()
                if v.startswith('vol'):
                    return 'Volumetric'
                if v.startswith('prot'):
                    return 'Protocol'
                if v.startswith('app'):
                    return 'Application'
            return _classify_attack_vector(row.get('method'), row.get('bytes'))

        df['vector'] = df.apply(_vector_row, axis=1)

        # Country: use explicit if present, else deterministic IP mapping.
        def _country_row(row):
            explicit = str(row.get('source_country') or '').strip()
            if explicit:
                return explicit
            return _ip_to_country_name(row.get('source_ip'))

        df['country'] = df.apply(_country_row, axis=1)

        # Top hostile IPs
        ip_group = (
            df.groupby('source_ip', dropna=False)
            .agg(count=('source_ip', 'size'), lastSeen=('timestamp', 'max'))
            .reset_index()
            .sort_values(['count', 'lastSeen'], ascending=[False, False])
            .head(5)
        )
        top_hostile = []
        for _, r in ip_group.iterrows():
            last_seen = r.get('lastSeen')
            try:
                # pandas Timestamp -> python datetime
                if pd.isna(last_seen):
                    last_seen_iso = None
                else:
                    dt = pd.to_datetime(last_seen, utc=True).to_pydatetime()
                    if getattr(dt, 'tzinfo', None) is not None:
                        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
                    last_seen_iso = dt.isoformat() + 'Z'
            except Exception:
                last_seen_iso = None
            top_hostile.append(
                {
                    'ip': str(r.get('source_ip') or ''),
                    'count': int(r.get('count') or 0),
                    'lastSeen': last_seen_iso,
                }
            )

        # Attack vector distribution
        vector_counts = df['vector'].value_counts().to_dict()
        vector_dist = [
            {'name': 'Volumetric', 'value': int(vector_counts.get('Volumetric', 0))},
            {'name': 'Protocol', 'value': int(vector_counts.get('Protocol', 0))},
            {'name': 'Application', 'value': int(vector_counts.get('Application', 0))},
        ]

        # Geo breakdown
        total = int(len(df.index))
        country_counts = df['country'].value_counts().reset_index().head(5)
        # value_counts().reset_index() yields two columns: [<value>, <count>]
        # Normalize to predictable names.
        country_counts.columns = ['name', 'count']
        geo_top = []
        for _, r in country_counts.iterrows():
            c = int(r.get('count') or 0)
            pct = round((c / total) * 100) if total > 0 else 0
            geo_top.append({'name': str(r.get('name') or ''), 'count': c, 'pct': int(pct)})

        # AI confidence distribution
        # Note: anomaly_score scale depends on the underlying model and can be close to zero.
        # Use relative (quantile-based) buckets to reflect the actual distribution in this window.
        scores = pd.to_numeric(df['anomaly_score'], errors='coerce')
        finite = scores.dropna()

        obvious = 0
        subtle = 0
        other = int(total)
        thresholds = {'obviousLe': None, 'subtleLe': None}

        if not finite.empty:
            s_min = float(finite.min())
            s_max = float(finite.max())
            if (s_max - s_min) >= 1e-9:
                q_obvious = float(finite.quantile(0.20))
                q_subtle = float(finite.quantile(0.60))
                thresholds = {'obviousLe': q_obvious, 'subtleLe': q_subtle}

                obvious = int((scores <= q_obvious).sum())
                subtle = int(((scores > q_obvious) & (scores <= q_subtle)).sum())
                other = int(total - obvious - subtle)

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
                'generatedBy': 'ai-engine (python/pandas)',
            }
        )
    except Exception as e:
        print(f"report_threat_intel error: {e}")
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == '__main__':
    host = "127.0.0.1"
    port = 5000
    print(f"AI Service running on http://{host}:{port}")
    app.run(host=host, port=port)