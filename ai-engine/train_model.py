# ai-engine/train_model.py
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
import joblib

print("🧠 Training Tracel AI Model...")

# 1. GENERATE SYNTHETIC "NORMAL" TRAINING DATA
# We simulate 1000 normal packets to teach the AI what "Safe" looks like.
# Normal traffic: Small size (100-1000 bytes), GET requests (encoded as 0)
# We purposely don't show it any attacks. It learns "Normal" so it can flag "Abnormal".
data = {
    'bytes': np.random.randint(100, 1000, 1000),
    'is_post': np.zeros(1000) # 0 = GET (Normal users mostly read)
}
df = pd.DataFrame(data)

# 2. TRAIN THE MODEL (Isolation Forest)
# contamination=0.01 means we expect roughly 1% of data to be anomalies
model = IsolationForest(n_estimators=100, contamination=0.01, random_state=42)
model.fit(df)

# 3. SAVE THE BRAIN
# We dump the trained model to a file so we can load it in our API later.
joblib.dump(model, 'model.pkl')

print("✅ Model trained and saved as 'model.pkl'")