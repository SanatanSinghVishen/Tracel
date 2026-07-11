"""
API endpoint tests using FastAPI's TestClient.

These tests verify that all HTTP endpoints return the expected shapes
and status codes, independent of the underlying ML model or MongoDB.
"""
import os
import pytest
from unittest.mock import patch, MagicMock

# Set MODEL_PATH to a non-existent path before importing app,
# so we don't accidentally load a real model during tests.
os.environ.setdefault("MODEL_PATH", "/tmp/nonexistent_model.pkl")

from fastapi.testclient import TestClient
from app import app


@pytest.fixture
def client():
    """Create a FastAPI TestClient that skips the lifespan (model preload)."""
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


class TestRootEndpoint:
    def test_returns_service_info(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["service"] == "ai-engine"
        assert "predict" in data["endpoints"]
        assert "health" in data["endpoints"]
        assert "docs" in data["endpoints"]


class TestHealthEndpoint:
    def test_returns_health_structure(self, client):
        resp = client.get("/health")
        # May be 200 or 503 depending on model state, but structure is the same
        data = resp.json()
        assert "status" in data
        assert data["service"] == "ai-engine"
        assert data["version"] == "1.0.0"
        assert "uptime_s" in data
        assert "checks" in data
        assert "model" in data["checks"]


class TestPredictEndpoint:
    @patch("app.predict")
    def test_valid_prediction(self, mock_predict, client):
        mock_predict.return_value = {
            "anomaly_score": 0.85,
            "is_anomaly": True,
            "raw_score": -0.3,
            "explanation": None,
            "mitre": None,
            "id": "pkt-123",
        }

        resp = client.post("/predict", json={
            "id": "pkt-123",
            "bytes": 5000,
            "protocol": "TCP",
            "dst_port": 4444,
            "entropy": 0.9,
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["anomaly_score"] == 0.85
        assert data["is_anomaly"] is True
        assert data["id"] == "pkt-123"

    @patch("app.predict")
    def test_predict_with_minimal_payload(self, mock_predict, client):
        """Predict should work even with an empty JSON body (all fields optional)."""
        mock_predict.return_value = {
            "anomaly_score": 0.5,
            "is_anomaly": False,
            "raw_score": 0.1,
            "explanation": None,
            "mitre": None,
            "id": None,
        }

        resp = client.post("/predict", json={})
        assert resp.status_code == 200

    @patch("app.predict")
    def test_predict_error_returns_500(self, mock_predict, client):
        mock_predict.side_effect = RuntimeError("Model not loaded: file not found")
        resp = client.post("/predict", json={"bytes": 100})
        assert resp.status_code == 500
        assert "error" in resp.json()


class TestModelStatusEndpoint:
    def test_returns_model_status(self, client):
        resp = client.get("/admin/model-status")
        assert resp.status_code == 200
        data = resp.json()
        assert "ok" in data
        assert "loaded" in data
        assert "modelPath" in data


class TestReloadModelEndpoint:
    @patch("app.reload_model")
    def test_reload_success(self, mock_reload, client):
        mock_reload.return_value = (True, "Model reloaded successfully")
        resp = client.post("/admin/reload-model")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True

    @patch("app.reload_model")
    def test_reload_failure(self, mock_reload, client):
        mock_reload.return_value = (False, "File not found")
        resp = client.post("/admin/reload-model")
        assert resp.status_code == 500
        data = resp.json()
        assert data["ok"] is False


class TestRetrainEndpoint:
    @patch("threading.Thread")
    def test_retrain_returns_202(self, mock_thread, client):
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance
        resp = client.post("/retrain")
        assert resp.status_code == 202
        data = resp.json()
        assert data["ok"] is True
        assert "Retraining" in data["msg"]


class TestDocsEndpoint:
    def test_swagger_ui_accessible(self, client):
        resp = client.get("/docs")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")

    def test_openapi_json_accessible(self, client):
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["info"]["title"] == "Tracel AI Engine"
        assert "/predict" in data["paths"]
        assert "/health" in data["paths"]
