import os
import json
import time
import traceback
import redis
from inference import predict
from mitre_tagger import tag
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

START_TIME = time.time()
worker_redis = None

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            uptime = int(time.time() - START_TIME)
            redis_status = 'ok'
            queue_len = 0
            dlq_len = 0
            
            try:
                if worker_redis:
                    worker_redis.ping()
                    queue_len = worker_redis.llen('tracel:ai:queue')
                    dlq_len = worker_redis.llen('tracel:ai:deadletter')
                else:
                    redis_status = 'error'
            except Exception:
                redis_status = 'error'
                
            status = 'ok'
            if redis_status == 'error':
                status = 'error'
            elif dlq_len > 100:
                status = 'degraded'
                
            payload = {
                "status": status,
                "service": "ai-worker",
                "version": "1.0.0",
                "uptime_s": uptime,
                "checks": {
                    "redis": {
                        "status": redis_status,
                        "queue_depth": queue_len,
                        "deadletter_depth": dlq_len
                    }
                }
            }
            self.wfile.write(json.dumps(payload).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass # Suppress logs for health checks

def run_health_server():
    server = HTTPServer(('0.0.0.0', 9090), HealthHandler)
    server.serve_forever()

def main():
    global worker_redis
    redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
    print(f"Connecting to Redis at {redis_url}")
    try:
        r = redis.Redis.from_url(redis_url)
        r.ping()
        worker_redis = r
    except Exception as e:
        print(f"Failed to connect to Redis: {e}")
        # If running without Redis, just exit gracefully so docker doesn't crash loop
        return

    # We don't explicitly preload the model anymore, inference.predict() handles it lazy, 
    # but we can force a load by running an empty predict or just calling reload_model.
    # Let's let the first packet load it.
    
    health_thread = threading.Thread(target=run_health_server, daemon=True)
    health_thread.start()
    
    print("Worker started, waiting for tracel:ai:queue...")
    while True:
        try:
            item = r.brpop('tracel:ai:queue', timeout=5)
            if not item:
                continue
            
            _, data_json = item
            data = json.loads(data_json)
            
            result = predict(data)
            # Combine packet with prediction to pass to tagger
            tagged_packet = {**data, **result}
            mitre_tag = tag(tagged_packet)
                
            r.lpush('tracel:ai:results', json.dumps({
                "score": result["anomaly_score"],
                "id": result["id"],
                "explanation": result.get("explanation"),
                "mitre": mitre_tag,
            }))
            
        except Exception as e:
            print(f"Worker error: {e}")
            traceback.print_exc()
            time.sleep(1)

if __name__ == '__main__':
    main()
