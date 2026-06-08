import os
import threading
import time
import pytest
from inference import predict, reload_model, _model_lock

@pytest.fixture(autouse=True)
def ensure_model():
    # Force load once before tests
    reload_model()
    yield

def test_predict_output_keys():
    data = {
        "id": "test-packet-1",
        "bytes": 500,
        "protocol": "TCP",
        "dst_port": 80,
        "entropy": 0.4
    }
    result = predict(data)
    
    assert "anomaly_score" in result
    assert "is_anomaly" in result
    assert "raw_score" in result
    assert "id" in result
    assert result["id"] == "test-packet-1"
    assert isinstance(result["is_anomaly"], bool)
    assert isinstance(result["raw_score"], float)

def test_predict_score_clamping():
    data = {
        "bytes": 500,
        "protocol": "TCP",
        "dst_port": 80,
        "entropy": 0.4
    }
    result = predict(data)
    
    # Anomaly score must be clamped between 0 and 1
    assert 0.0 <= result["anomaly_score"] <= 1.0

def test_predict_multithreaded_reload():
    """
    Spawns multiple threads calling predict() repeatedly while
    one thread calls reload_model() repeatedly to ensure thread safety
    and no crashes.
    """
    stop_event = threading.Event()
    exceptions = []

    def predictor_thread():
        data = {"bytes": 500, "protocol": "TCP", "dst_port": 80}
        while not stop_event.is_set():
            try:
                predict(data)
                # Sleep briefly to yield thread and increase contention
                time.sleep(0.001)
            except Exception as e:
                exceptions.append(e)
                break

    def reloader_thread():
        for _ in range(5):
            try:
                reload_model()
                time.sleep(0.02)
            except Exception as e:
                exceptions.append(e)
                break

    threads = []
    # Spawn 5 predictor threads
    for _ in range(5):
        t = threading.Thread(target=predictor_thread)
        t.start()
        threads.append(t)

    # Spawn 1 reloader thread
    rt = threading.Thread(target=reloader_thread)
    rt.start()

    rt.join()
    stop_event.set()

    for t in threads:
        t.join(timeout=2.0)

    # If the lock failed, we'd likely see "Model not loaded" or similar exceptions
    assert len(exceptions) == 0, f"Exceptions occurred during concurrent access: {exceptions}"


def test_predict_shap_explanation():
    # A packet likely to be normal
    normal_data = {'bytes': 100, 'protocol': 'TCP', 'dst_port': 80}
    result = predict(normal_data)
    if not result['is_anomaly']:
        assert result.get('explanation') is None

    # A packet likely to be anomalous
    anomaly_data = {'bytes': 9999999, 'protocol': 'TCP', 'dst_port': 4444, 'entropy': 0.99}
    result = predict(anomaly_data)
    if result['is_anomaly']:
        assert 'explanation' in result
        # Either None (if SHAP failed/not init) or a list of dicts
        if result['explanation'] is not None:
            assert isinstance(result['explanation'], list)
            for item in result['explanation']:
                assert 'feature' in item
                assert 'shap_value' in item
                assert 'actual_value' in item

def test_predict_shap_failure_graceful(monkeypatch):
    import inference
    def mock_shap_values(*args, **kwargs):
        raise ValueError('Simulated SHAP error')
    
    if inference._explainer:
        monkeypatch.setattr(inference._explainer, 'shap_values', mock_shap_values)
        
    anomaly_data = {'bytes': 9999999, 'protocol': 'TCP', 'dst_port': 4444}
    result = predict(anomaly_data)
    if result['is_anomaly']:
        assert result.get('explanation') is None

