import os
import math
import threading
import pandas as pd
import joblib
import shap
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", str(BASE_DIR / "model" / "model.pkl")))

_model = None
_model_error = None
_explainer = None
_model_lock = threading.Lock()

SHAP_TOP_N = int(os.getenv("SHAP_TOP_N", "3"))
SHAP_MIN_VALUE = float(os.getenv("SHAP_MIN_VALUE", "0.05"))

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

def _reload_model_unsafe():
    global _model, _model_error, _explainer
    try:
        if not MODEL_PATH.exists():
            _model = None
            _model_error = f"model file not found at {MODEL_PATH}"
            _explainer = None
        else:
            _model = joblib.load(MODEL_PATH)
            _model_error = None
            try:
                base_model = _model.get('model') if isinstance(_model, dict) else _model
                _explainer = shap.TreeExplainer(base_model)
            except Exception as e:
                logger.error(f"Failed to initialize SHAP TreeExplainer: {e}")
                _explainer = None
    except Exception as e:
        _model = None
        _model_error = f"failed to load model from {MODEL_PATH}: {e}"
        _explainer = None

def reload_model() -> tuple[bool, str]:
    """
    Hot-reloads the model in-place.
    Returns (success_bool, message).
    """
    with _model_lock:
        _reload_model_unsafe()
        if _model_error:
            return False, _model_error
        return True, "Model reloaded successfully"

def predict(data: dict) -> dict:
    packet_id = data.get('id', None)
    packet_bytes = int(data.get('bytes', 0) or 0)
    protocol = data.get('protocol')
    protocol_index = _protocol_index(protocol)
    
    entropy_raw = data.get('entropy', None)
    try:
        entropy = float(entropy_raw) if entropy_raw is not None else 0.3
    except Exception:
        entropy = 0.3
    entropy = max(0.0, min(1.0, entropy))
    
    port_raw = data.get('dst_port', None)
    if port_raw is None:
        port_raw = data.get('port', None)
    try:
        dst_port = int(port_raw) if port_raw is not None else 80
    except Exception:
        dst_port = 80
        
    features = pd.DataFrame([{
        'bytes': packet_bytes,
        'protocol_index': protocol_index,
        'entropy': entropy,
        'dst_port': dst_port,
    }])

    with _model_lock:
        # Retry loading if:
        # 1. Never loaded yet (_model is None and _model_error is None), OR
        # 2. Previously failed with "not found" but the file now exists (post-retrain recovery)
        should_load = _model is None and _model_error is None
        if not should_load and _model is None and _model_error and MODEL_PATH.exists():
            should_load = True  # model was retrained — clear stale error and reload
        if should_load:
            _reload_model_unsafe()
            
        m = _model
        err = _model_error
        explainer = _explainer

    if m is None:
        raise RuntimeError(f"Model not loaded: {err}")

    X = _build_features(features)
    if isinstance(m, dict):
        pipeline = m.get('model')
        cols = m.get('feature_columns') or list(X.columns)
        raw_score = float(pipeline.decision_function(X[cols])[0])
        X_eval = X[cols]
    else:
        raw_score = float(m.decision_function(X)[0])
        X_eval = X

    # Convert raw IsolationForest score to a 0-1 range
    # sigmoid mapping: 1 / (1 + exp(-raw_score * 5))
    try:
        clamped_score = 1.0 / (1.0 + math.exp(-raw_score * 5.0))
    except OverflowError:
        clamped_score = 1.0 if raw_score > 0 else 0.0
        
    is_anomaly = raw_score < 0
    explanation = None

    if is_anomaly and explainer is not None:
        try:
            shap_values = explainer.shap_values(X_eval)[0]
            feature_names = X_eval.columns.tolist()
            
            contributions = []
            for i, name in enumerate(feature_names):
                val = float(shap_values[i])
                if abs(val) >= SHAP_MIN_VALUE:
                    actual = float(X_eval.iloc[0, i])
                    contributions.append({
                        "feature": name,
                        "shap_value": round(val, 4),
                        "actual_value": round(actual, 4) if actual % 1 != 0 else int(actual)
                    })
            
            contributions.sort(key=lambda x: abs(x["shap_value"]), reverse=True)
            explanation = contributions[:SHAP_TOP_N]
        except Exception as e:
            logger.error(f"SHAP explanation failed: {e}")
            explanation = None

    return {
        "anomaly_score": clamped_score,
        "is_anomaly": is_anomaly,
        "raw_score": raw_score,
        "explanation": explanation,
        "id": packet_id,
    }
