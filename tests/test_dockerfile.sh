#!/bin/bash
set -e

echo "Building Tracel AI Engine Docker image locally..."
cd ai-engine
docker build -t tracel-ai-test .

echo "Verifying runtime process UID..."
RUNTIME_UID=$(docker run --rm tracel-ai-test id -u)
if [ "$RUNTIME_UID" != "1000" ]; then
    echo "ERROR: Container is not running as UID 1000. Current UID: $RUNTIME_UID"
    exit 1
fi
echo "✅ Container runs as UID 1000 (appuser)"

echo "Verifying /app/model directory ownership..."
DIR_OWNER=$(docker run --rm tracel-ai-test stat -c '%u:%g' /app/model)
if [ "$DIR_OWNER" != "1000:1000" ]; then
    echo "ERROR: /app/model is not owned by 1000:1000. Current owner: $DIR_OWNER"
    exit 1
fi
echo "✅ /app/model is writable by appuser"

echo "All tests passed!"
