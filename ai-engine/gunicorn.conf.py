import os
import multiprocessing

# Worker Configuration
# Use (2 * CPU) + 1 as the default if GUNICORN_WORKERS is not set
default_workers = (multiprocessing.cpu_count() * 2) + 1
workers = int(os.environ.get("GUNICORN_WORKERS", default_workers))

# Set worker class (sync is required per instructions)
worker_class = "sync"

# Timeout Configuration
# Default to 30s, or read from AI_SLOW_REQUEST_MS
timeout_ms = int(os.environ.get("AI_SLOW_REQUEST_MS", 30000))
timeout = max(1, timeout_ms // 1000)

# Networking
port = os.environ.get("PORT", "5000")
bind = f"0.0.0.0:{port}"

# Logging Configuration
# Use JSON logging format to stdout
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Configure json logging
logconfig_dict = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "logging.Formatter",
            "format": '{"time": "%(asctime)s", "level": "%(levelname)s", "message": "%(message)s"}'
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "stream": "ext://sys.stdout"
        }
    },
    "loggers": {
        "gunicorn.access": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False
        },
        "gunicorn.error": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False
        }
    }
}
