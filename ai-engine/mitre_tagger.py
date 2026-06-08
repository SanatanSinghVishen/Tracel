from datetime import datetime, timezone
from mitre_techniques import MITRE_CATALOG

# Rules are evaluated from highest rank to lowest rank.
# T1046 is scoped to a single packet (ephemeral port range + anomaly) 
# Note: True port scan detection requires flow aggregation (counting unique dst_ports 
# from the same src_ip over a time window). This is a placeholder heuristic.

RULES = [
    {
        "rank": 100,
        "technique_id": "T1059",
        "confidence": "high",
        "match": lambda p: p.get('dst_port') in [4444, 1337, 31337]
    },
    {
        "rank": 90,
        "technique_id": "T1071.004",
        "confidence": "medium",
        "match": lambda p: p.get('dst_port') == 53 and p.get('bytes', 0) > 1500 and p.get('is_anomaly')
    },
    {
        "rank": 80,
        "technique_id": "T1110",
        "confidence": "medium",
        "match": lambda p: p.get('dst_port') == 22 and p.get('is_anomaly')
    },
    {
        "rank": 70,
        "technique_id": "T1021.002",
        "confidence": "high",
        "match": lambda p: p.get('dst_port') in [445, 139] and p.get('is_anomaly')
    },
    {
        "rank": 70,
        "technique_id": "T1021.001",
        "confidence": "high",
        "match": lambda p: p.get('dst_port') == 3389 and p.get('is_anomaly')
    },
    {
        "rank": 60,
        "technique_id": "T1071.001",
        "confidence": "medium",
        "match": lambda p: p.get('dst_port') in [80, 443] and p.get('bytes', 0) > 500000 and p.get('is_anomaly')
    },
    {
        "rank": 50,
        "technique_id": "T1030",
        "confidence": "medium",
        "match": lambda p: p.get('bytes', 0) > 1000000 and p.get('is_anomaly') and _is_unusual_hour()
    },
    {
        "rank": 40,
        "technique_id": "T1095",
        "confidence": "low",
        "match": lambda p: str(p.get('protocol')).upper() == 'ICMP' and p.get('is_anomaly')
    },
    {
        "rank": 30,
        "technique_id": "T1046",
        "confidence": "low",
        "match": lambda p: p.get('dst_port', 0) > 10000 and p.get('is_anomaly') and p.get('entropy', 0) > 0.8
    },
    {
        "rank": 10,
        "technique_id": "T1190",
        "confidence": "low",
        "match": lambda p: p.get('is_anomaly')
    }
]

def _is_unusual_hour():
    now = datetime.now(timezone.utc)
    return 2 <= now.hour <= 5

def tag(packet: dict) -> dict | None:
    # We sort rules by rank descending
    sorted_rules = sorted(RULES, key=lambda r: r['rank'], reverse=True)
    
    for rule in sorted_rules:
        if rule['match'](packet):
            t_id = rule['technique_id']
            technique_info = MITRE_CATALOG.get(t_id)
            if not technique_info:
                continue
            
            return {
                "technique_id": t_id,
                "technique_name": technique_info["name"],
                "tactic": technique_info["tactic"],
                "confidence": rule["confidence"]
            }
            
    return None
