# ai-engine/train_model.py
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib
from pathlib import Path
import math

print("🧠 Training Tracel AI Model (v2 features + calibrated threshold)...")


PROTOCOL_TO_INDEX = {
    'TCP': 0,
    'UDP': 1,
    'ICMP': 2,
    'HTTP': 3,
}

FEATURE_COLUMNS = ['bytes', 'protocol_index', 'entropy', 'dst_port']


COMMON_PORTS = {80, 443, 8080}
ATTACK_PORTS = {23, 53, 123, 445, 3389, 1900, 4444}


def build_features(raw: pd.DataFrame) -> pd.DataFrame:
    """Expand raw inputs into a more expressive feature set.

    We still accept the base vector [bytes, protocol_index, entropy, dst_port],
    but we create categorical/interaction-friendly columns so the model can learn
    patterns like "high entropy + UDP" or "weird port" without relying purely on size.
    """
    df = raw.copy()

    # Stabilize scales.
    df['bytes_log'] = df['bytes'].astype(float).map(lambda x: math.log1p(max(0.0, x)))
    df['entropy'] = df['entropy'].astype(float).clip(0.0, 1.0)
    df['dst_port'] = df['dst_port'].astype(int)

    # One-hot protocol.
    df['proto_tcp'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['TCP']).astype(int)
    df['proto_udp'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['UDP']).astype(int)
    df['proto_icmp'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['ICMP']).astype(int)
    df['proto_http'] = (df['protocol_index'] == PROTOCOL_TO_INDEX['HTTP']).astype(int)

    # Port signals.
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

# 1. GENERATE SYNTHETIC "NORMAL" TRAINING DATA
# We ONLY show normal traffic so the model learns what "safe" looks like.
# Features:
#   [bytes, protocol_index, entropy, dst_port]
# Normal profile:
#   - protocol: mostly HTTP/TCP
#   - entropy: low (structured payloads)
#   - dst_port: 80/443/8080
#   - bytes: ~150–950

n = 6000

normal_protocols = np.random.choice(
    [PROTOCOL_TO_INDEX['HTTP'], PROTOCOL_TO_INDEX['TCP'], PROTOCOL_TO_INDEX['UDP'], PROTOCOL_TO_INDEX['ICMP']],
    size=n,
    p=[0.55, 0.35, 0.07, 0.03],
)

normal_entropy = np.random.uniform(0.1, 0.5, size=n)
# Match the Node simulator: ports are chosen uniformly from [80, 443, 8080].
normal_ports = np.random.choice([80, 443, 8080], size=n, p=[1/3, 1/3, 1/3])
normal_bytes = np.random.randint(150, 951, size=n)

df = pd.DataFrame({
    'bytes': normal_bytes,
    'protocol_index': normal_protocols,
    'entropy': normal_entropy,
    'dst_port': normal_ports,
})

# Expand into engineered features before training.
X_train = build_features(df)

# 2. TRAIN THE MODEL (Isolation Forest)
# Use scaling so dst_port/bytes don't dominate entropy/protocol.
# contamination controls the expected outlier proportion *in normal training data*;
# set a small-but-not-tiny value to avoid the model being overly sensitive.
model = Pipeline(
    steps=[
        ('scaler', StandardScaler()),
        (
            'iforest',
            IsolationForest(
                n_estimators=250,
                # We will calibrate our own cutoff for a target false-positive rate,
                # so keep contamination small and stable.
                contamination=0.01,
                random_state=42,
                n_jobs=-1,
            ),
        ),
    ]
)
model.fit(X_train)

# 3. CALIBRATE THRESHOLD (balance FP on normal vs detection on attack-like)
# IsolationForest decision_function: lower = more anomalous.
# We calibrate a score cutoff using held-out synthetic NORMAL and ATTACK-like samples.
# Goal:
#   - Normal false positives: ~1–3%
#   - Attack detection: typically 30–70% when simulator mixes traffic

fp_target = 0.02
fp_max = 0.025
desired_attack_tpr = 0.45

cal_n = 2500

# Normal calibration samples (similar to training distribution)
cal_normal = pd.DataFrame({
    'bytes': np.random.randint(150, 951, cal_n),
    'protocol_index': np.random.choice(
        [PROTOCOL_TO_INDEX['HTTP'], PROTOCOL_TO_INDEX['TCP'], PROTOCOL_TO_INDEX['UDP'], PROTOCOL_TO_INDEX['ICMP']],
        size=cal_n,
        p=[0.55, 0.35, 0.07, 0.03],
    ),
    'entropy': np.random.uniform(0.1, 0.5, size=cal_n),
    # Match the Node simulator: ports are chosen uniformly from [80, 443, 8080].
    'dst_port': np.random.choice([80, 443, 8080], size=cal_n, p=[1/3, 1/3, 1/3]),
})

# Attack-like calibration samples (not used for fitting)
# Key idea: high entropy + UDP/ICMP and/or attack ports, bytes can be small or large.
cal_attack = pd.DataFrame({
    'bytes': np.where(
        np.random.rand(cal_n) < 0.55,
        np.random.randint(80, 1201, cal_n),
        np.random.randint(1000, 50001, cal_n),
    ),
    'protocol_index': np.random.choice(
        [PROTOCOL_TO_INDEX['UDP'], PROTOCOL_TO_INDEX['ICMP'], PROTOCOL_TO_INDEX['TCP'], PROTOCOL_TO_INDEX['HTTP']],
        size=cal_n,
        p=[0.45, 0.25, 0.20, 0.10],
    ),
    'entropy': np.random.uniform(0.8, 1.0, size=cal_n),
    'dst_port': np.where(
        np.random.rand(cal_n) < 0.85,
        np.random.choice(list(ATTACK_PORTS), size=cal_n),
        np.random.randint(1, 65536, cal_n),
    ),
})

scores_normal = model.decision_function(build_features(cal_normal))
scores_attack = model.decision_function(build_features(cal_attack))

# Start from a threshold that hits fp_target on normal.
threshold = float(np.quantile(scores_normal, fp_target))

def rate(scores, thr):
    return float(np.mean(scores <= thr))

fp = rate(scores_normal, threshold)
tpr = rate(scores_attack, threshold)

# If attack detection is too low, relax threshold upward but keep FP <= fp_max.
# This helps keep attack(on) anomaly rates in the desired 30–70% range when the
# simulator mixes malicious+normal traffic.
if tpr < desired_attack_tpr:
    # Candidate thresholds between fp_target..fp_max on normal.
    cand = [float(np.quantile(scores_normal, q)) for q in np.linspace(fp_target, fp_max, 9)]
    best = threshold
    best_tpr = tpr
    best_fp = fp
    for thr in cand:
        cand_fp = rate(scores_normal, thr)
        cand_tpr = rate(scores_attack, thr)
        if cand_fp <= fp_max and cand_tpr >= best_tpr:
            best = thr
            best_tpr = cand_tpr
            best_fp = cand_fp
    threshold = float(best)
    fp = best_fp
    tpr = best_tpr

# 4. SAVE THE BRAIN
# Save a small bundle so inference can use the calibrated cutoff.
bundle = {
    'version': 2,
    'model': model,
    'features': FEATURE_COLUMNS,
    'feature_columns': list(X_train.columns),
    'protocol_to_index': PROTOCOL_TO_INDEX,
    'threshold': threshold,
    'calibration': {
        'fp_target': fp_target,
        'fp_max': fp_max,
        'fp_est': float(fp),
        'attack_tpr_est': float(tpr),
        'cal_n': int(cal_n),
    },
}

out_path = Path(__file__).resolve().parent / 'model.pkl'
joblib.dump(bundle, str(out_path))

print(f"✅ Model trained and saved as '{out_path}' (threshold={threshold:.6f})")