#!/bin/bash

# Start the Redis worker in the background
echo "Starting AI Engine Queue Worker..."
python worker.py &

# Start the Web API (Gunicorn) in the foreground
echo "Starting Gunicorn Web Server..."
gunicorn app:app --config gunicorn.conf.py
