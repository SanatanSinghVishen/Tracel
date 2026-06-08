import os
import time
import math
import logging
import shutil
from datetime import datetime, timezone, timedelta
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib
from pathlib import Path
from pymongo import MongoClient
import threading

import inference

BASE_DIR = Path(__file__).resolve().parent

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# This lock ensures only one retrain process runs at a time if triggered manually
_retrain_lock = threading.Lock()

def _get_packets_collection():
    from app import _get_packets_collection as get_coll
    return get_coll()

def fetch_training_data(since_hours: int, min_samples: int = 1000):
    coll, err = _get_packets_collection()
    if coll is None:
        raise RuntimeError(f"MongoDB not available: {err}")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(hours=since_hours)

    logger.info(f"Fetching packets from {since} to {now}...")
    
    # We want regular packets (or both, but Isolation Forest works best on majority-normal traffic)
    # Exclude packets with high_entropy=true since they are simulated attacks or anomalies
    cursor = coll.find({
        "timestamp": {"$gte": since, "$lt": now},
        "high_entropy": {"$ne": True}
    }, {"_id": 0, "bytes": 1, "protocol": 1, "entropy": 1, "dst_port": 1, "port": 1})
    
    df = pd.DataFrame(list(cursor))
    if len(df) < min_samples:
        raise ValueError(f"Not enough data to retrain: found {len(df)} samples, need at least {min_samples}.")
        
    logger.info(f"Fetched {len(df)} samples.")
    return df

def process_and_train(df: pd.DataFrame):
    logger.info("Building features...")
    
    # Clean up fields as inference does
    df['entropy'] = pd.to_numeric(df.get('entropy'), errors='coerce').fillna(0.3)
    
    # Handle port or dst_port
    if 'dst_port' not in df.columns and 'port' in df.columns:
        df['dst_port'] = df['port']
    df['dst_port'] = pd.to_numeric(df.get('dst_port'), errors='coerce').fillna(80)
    
    df['protocol_index'] = df.get('protocol', '').apply(inference._protocol_index)
    df['bytes'] = pd.to_numeric(df.get('bytes'), errors='coerce').fillna(0)
    
    X = inference._build_features(df)
    
    logger.info("Training Isolation Forest...")
    # Standard contamination is around 1-5%
    clf = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
    clf.fit(X)
    
    return clf

def run_retrain_job(since_hours: int = 24):
    if not _retrain_lock.acquire(blocking=False):
        logger.warning("Retrain job already running, skipping.")
        return False, "Already running"
        
    try:
        logger.info(f"Starting model retraining (since_hours={since_hours})...")
        df = fetch_training_data(since_hours=since_hours, min_samples=500)
        
        clf = process_and_train(df)
        
        # Versioning
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        versioned_filename = f"model_{timestamp}.pkl"
        model_dir = BASE_DIR / "model"
        model_dir.mkdir(exist_ok=True)
        versioned_path = model_dir / versioned_filename
        
        logger.info(f"Saving model to {versioned_path}...")
        joblib.dump(clf, versioned_path)
        
        # Update symlink or overwrite model.pkl
        symlink_path = model_dir / "model.pkl"
        if os.name == 'nt':
            # Symlinks on Windows require admin privileges, so we'll just copy/overwrite
            shutil.copy2(versioned_path, symlink_path)
        else:
            if symlink_path.exists() or symlink_path.is_symlink():
                symlink_path.unlink()
            symlink_path.symlink_to(versioned_filename)
        
        logger.info("Hot-reloading inference module...")
        success, msg = inference.reload_model()
        
        if success:
            logger.info("Retraining completed successfully.")
            return True, f"Model version {versioned_filename} created and loaded."
        else:
            logger.error(f"Failed to reload model: {msg}")
            return False, f"Trained but failed to reload: {msg}"
            
    except Exception as e:
        logger.error(f"Retraining failed: {str(e)}", exc_info=True)
        return False, str(e)
    finally:
        _retrain_lock.release()

if __name__ == "__main__":
    run_retrain_job()
