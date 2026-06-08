#!/bin/bash

# Ensure model directory exists (Railway volume may be empty on first mount)
mkdir -p /app/model

# Start the Redis worker in the background
echo "Starting AI Engine Queue Worker..."
python worker.py &

# Start the Web API (Gunicorn) in the foreground
echo "Starting Gunicorn Web Server..."
gunicorn app:app --config gunicorn.conf.py
