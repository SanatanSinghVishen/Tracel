from unittest.mock import patch, MagicMock
import pandas as pd
import retrain

@patch('retrain.shutil.copy2')
@patch('retrain.joblib.dump')
@patch('retrain.inference.reload_model')
@patch('retrain._get_packets_collection')
def test_retrain_success(mock_get_coll, mock_reload, mock_dump, mock_copy2):
    # Mock DB cursor
    mock_coll = MagicMock()
    mock_get_coll.return_value = (mock_coll, None)
    
    # Mock data to return from DB
    mock_data = [{'bytes': 100, 'protocol': 'TCP', 'entropy': 0.1, 'dst_port': 80}] * 600
    mock_coll.find.return_value = mock_data
    
    # Mock reload success
    mock_reload.return_value = (True, "Success")
    
    # Run retrain
    success, msg = retrain.run_retrain_job(since_hours=24)
    
    assert success is True
    assert "created and loaded" in msg
    mock_dump.assert_called_once()
    mock_reload.assert_called_once()

@patch('retrain._get_packets_collection')
def test_retrain_insufficient_data(mock_get_coll):
    mock_coll = MagicMock()
    mock_get_coll.return_value = (mock_coll, None)
    
    # Only 10 samples, needs 500 (enforce via env var so the threshold is exercised)
    mock_data = [{'bytes': 100, 'protocol': 'TCP', 'entropy': 0.1, 'dst_port': 80}] * 10
    mock_coll.find.return_value = mock_data
    
    with patch.dict('os.environ', {'RETRAIN_MIN_SAMPLES': '500'}):
        success, msg = retrain.run_retrain_job(since_hours=24)
    
    assert success is False
    assert "Not enough data" in msg
