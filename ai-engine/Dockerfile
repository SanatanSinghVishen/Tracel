# Stage 1: Builder
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /build

# Install build tools needed for scikit-learn/numpy/pandas
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libgomp1 g++ && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip

COPY requirements.txt .

# Install dependencies into /install
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# Stage 2: Runtime
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source code
COPY inference.py app.py worker.py retrain.py mitre_tagger.py mitre_techniques.py gunicorn.conf.py start.sh ./
RUN chmod +x start.sh

EXPOSE 5000

# Serve both Web API and Worker in one container for Railway
CMD ["./start.sh"]
