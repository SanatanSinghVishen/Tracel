#!/bin/bash

# Ensure model directory exists
mkdir -p /app/model

# Fix permissions on the Railway persistent volume
# (This runs as root because we haven't dropped privileges yet)
chown -R appuser:appgroup /app/model

# Start the Redis worker in the background as appuser
echo "Starting AI Engine Queue Worker..."
gosu appuser python worker.py &

# Start the Web API (Gunicorn) in the foreground as appuser
echo "Starting Gunicorn Web Server..."
exec gosu appuser gunicorn app:app --config gunicorn.conf.py
