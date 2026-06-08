import pytest
from mitre_tagger import tag
import mitre_tagger

def test_tag_t1059():
    packet = {"dst_port": 4444, "is_anomaly": True}
    res = tag(packet)
    assert res is not None
    assert res["technique_id"] == "T1059"
    assert res["confidence"] == "high"

def test_tag_t1071_004():
    packet = {"dst_port": 53, "bytes": 2000, "is_anomaly": True}
    res = tag(packet)
    assert res is not None
    assert res["technique_id"] == "T1071.004"

def test_tag_t1110():
    packet = {"dst_port": 22, "is_anomaly": True}
    res = tag(packet)
    assert res is not None
    assert res["technique_id"] == "T1110"

def test_tag_t1030_unusual_hour(monkeypatch):
    packet = {"bytes": 2000000, "is_anomaly": True, "dst_port": 8080}
    
    # Mock unusual hour to True
    monkeypatch.setattr(mitre_tagger, "_is_unusual_hour", lambda: True)
    res = tag(packet)
    assert res is not None
    assert res["technique_id"] == "T1030"
    
    # Mock to False, should fall back to T1190
    monkeypatch.setattr(mitre_tagger, "_is_unusual_hour", lambda: False)
    res2 = tag(packet)
    assert res2 is not None
    assert res2["technique_id"] == "T1190"

def test_tag_t1046():
    packet = {"dst_port": 55000, "is_anomaly": True, "entropy": 0.9}
    res = tag(packet)
    assert res is not None
    assert res["technique_id"] == "T1046"

def test_tag_t1190_fallback():
    # Anomalous packet that doesn't match any specific rule
    packet = {"dst_port": 8080, "bytes": 100, "is_anomaly": True}
    res = tag(packet)
    assert res is not None
    assert res["technique_id"] == "T1190"
    assert res["confidence"] == "low"

def test_tag_normal_returns_none():
    packet = {"dst_port": 80, "is_anomaly": False}
    res = tag(packet)
    assert res is None

def test_tag_priority():
    # Packet matching T1059 (rank 100) and T1190 (rank 10)
    packet = {"dst_port": 4444, "is_anomaly": True}
    res = tag(packet)
    assert res["technique_id"] == "T1059"  # Higher priority should win
