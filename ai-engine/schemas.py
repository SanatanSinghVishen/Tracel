# ai-engine/schemas.py
"""Pydantic models for request/response validation and auto-generated OpenAPI docs."""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


# ──────────────────────────────────────────────
# /predict
# ──────────────────────────────────────────────

class PredictRequest(BaseModel):
    """Incoming packet data for anomaly scoring."""
    id: Optional[str] = Field(None, description="Unique packet identifier")
    bytes: int = Field(0, description="Packet size in bytes")
    protocol: Optional[str] = Field(None, description="Network protocol (TCP, UDP, ICMP, HTTP)")
    dst_port: Optional[int] = Field(None, description="Destination port")
    port: Optional[int] = Field(None, description="Fallback destination port field")
    entropy: Optional[float] = Field(None, description="Entropy value (0.0 – 1.0)")

    model_config = {"extra": "allow"}  # allow extra fields silently


class ShapContribution(BaseModel):
    feature: str
    shap_value: float
    actual_value: float | int


class MitreTag(BaseModel):
    technique_id: str
    technique_name: str
    tactic: str
    confidence: str


class PredictResponse(BaseModel):
    anomaly_score: float = Field(..., description="Clamped anomaly score (0.0 – 1.0)")
    is_anomaly: bool
    raw_score: float = Field(..., description="Raw IsolationForest decision function output")
    explanation: Optional[list[ShapContribution]] = None
    mitre: Optional[MitreTag] = None
    id: Optional[str] = None


# ──────────────────────────────────────────────
# /health
# ──────────────────────────────────────────────

class ModelCheck(BaseModel):
    status: str
    path: str
    explainer_initialized: bool
    error: Optional[str] = None
    last_retrain_status: Optional[str] = None
    last_retrain_time: Optional[str] = None


class HealthChecks(BaseModel):
    model: ModelCheck


class HealthResponse(BaseModel):
    status: str
    service: str = "ai-engine"
    version: str = "1.0.0"
    uptime_s: int
    checks: HealthChecks
    ok: bool = True
    modelLoaded: Optional[bool] = None
    threshold: Optional[float] = None


# ──────────────────────────────────────────────
# /admin/model-status
# ──────────────────────────────────────────────

class ModelStatusResponse(BaseModel):
    ok: bool = True
    loaded: bool
    error: Optional[str] = None
    modelPath: str
    lastRetrainStatus: Optional[str] = None
    lastRetrainTime: Optional[str] = None


# ──────────────────────────────────────────────
# /admin/reload-model
# ──────────────────────────────────────────────

class ReloadModelResponse(BaseModel):
    ok: bool
    message: Optional[str] = None
    error: Optional[str] = None


# ──────────────────────────────────────────────
# /retrain
# ──────────────────────────────────────────────

class RetrainResponse(BaseModel):
    ok: bool = True
    msg: str
    since_hours: int


# ──────────────────────────────────────────────
# /report/threat-intel
# ──────────────────────────────────────────────

class WindowInfo(BaseModel):
    since: str
    to: str
    sinceHours: int


class HostileIp(BaseModel):
    ip: str
    count: int
    lastSeen: Optional[str] = None


class AttackVectorEntry(BaseModel):
    name: str
    value: int


class GeoCountry(BaseModel):
    name: str
    count: int
    pct: int


class AiConfidenceDefinition(BaseModel):
    method: str = "quantiles"
    obvious: str = "lowest ~20% anomaly scores (most suspicious)"
    subtle: str = "next ~40% anomaly scores"
    other: str = "remaining scores"
    note: str = "Buckets are relative to the selected time window."


class AiConfidenceBucket(BaseModel):
    bucket: str
    count: int


class AiConfidenceThresholds(BaseModel):
    obviousLe: Optional[float] = None
    subtleLe: Optional[float] = None


class ThreatIntelResponse(BaseModel):
    ok: bool = True
    window: WindowInfo
    totalThreats: int
    topHostileIps: list[HostileIp]
    attackVectorDistribution: list[AttackVectorEntry]
    geoTopCountries: list[GeoCountry]
    aiConfidenceDefinition: AiConfidenceDefinition = AiConfidenceDefinition()
    aiConfidenceThresholds: Optional[AiConfidenceThresholds] = None
    aiConfidenceDistribution: list[AiConfidenceBucket]
    generatedBy: str = "ai-engine (mongo aggregation)"


# ──────────────────────────────────────────────
# /debug/db
# ──────────────────────────────────────────────

class DebugDbResponse(BaseModel):
    """Flexible response — structure varies based on what's found."""
    safe_url: Optional[str] = None
    MONGO_DB_NAME_env: Optional[str] = None
    databases: Optional[list[str]] = None
    databases_error: Optional[str] = None
    collections_by_db: Optional[dict[str, Any]] = None
    error: Optional[str] = None


# ──────────────────────────────────────────────
# Generic error
# ──────────────────────────────────────────────

class ErrorResponse(BaseModel):
    ok: bool = False
    error: str
