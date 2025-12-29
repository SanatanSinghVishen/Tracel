import math
import joblib
import pandas as pd

MODEL_PATH = 'ai-engine/model.pkl'

b = joblib.load(MODEL_PATH)
print('loaded', type(b))
if not isinstance(b, dict):
    raise SystemExit('Expected bundled model dict in model.pkl')

pipe = b['model']
thr = float(b['threshold'])
cols = b.get('feature_columns')

print('threshold', thr)
print('feature_columns', cols)

COMMON = {80, 443, 8080}
ATTACK = {23, 53, 123, 445, 3389, 1900, 4444}


def feats(bytes_, proto, entropy, dst_port):
    dst_port = int(dst_port)
    proto_map = {'TCP': 0, 'UDP': 1, 'ICMP': 2, 'HTTP': 3}
    proto_idx = proto_map[proto]
    return {
        'bytes_log': math.log1p(max(0, bytes_)),
        'entropy': max(0.0, min(1.0, float(entropy))),
        'dst_port': dst_port,
        'proto_tcp': 1 if proto_idx == 0 else 0,
        'proto_udp': 1 if proto_idx == 1 else 0,
        'proto_icmp': 1 if proto_idx == 2 else 0,
        'proto_http': 1 if proto_idx == 3 else 0,
        'port_is_common': 1 if dst_port in COMMON else 0,
        'port_is_attack': 1 if dst_port in ATTACK else 0,
        'port_is_weird': 0 if dst_port in COMMON else 1,
    }


X = pd.DataFrame(
    [
        feats(300, 'HTTP', 0.2, 443),
        feats(900, 'HTTP', 0.4, 80),
        feats(300, 'UDP', 0.9, 3389),
        feats(300, 'UDP', 0.95, 53),
        feats(120, 'ICMP', 0.85, 23),
        feats(50000, 'UDP', 0.95, 4444),
    ]
)

scores = pipe.decision_function(X[cols])
print('scores', [float(s) for s in scores])
print('is_anomaly', [bool(float(s) <= thr) for s in scores])
