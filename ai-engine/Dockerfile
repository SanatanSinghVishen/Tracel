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

# Create a non-root user
RUN useradd -m -u 1000 tracel

# Create model directory and assign ownership
RUN mkdir -p /app/model && chown -R tracel:tracel /app/model

# Copy application source code
COPY inference.py app.py worker.py retrain.py mitre_tagger.py mitre_techniques.py gunicorn.conf.py ./
COPY model.pkl ./model/model.pkl
RUN chown -R tracel:tracel /app/model

USER tracel

EXPOSE 5000

# Serve Flask app via gunicorn using our config
CMD ["gunicorn", "app:app", "--config", "gunicorn.conf.py"]
