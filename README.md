<div align="center">

# Tracel

**Real-time SOC dashboard simulator with AI-powered anomaly detection**

[![Tests](https://img.shields.io/github/actions/workflow/status/yourname/tracel/test.yml?label=tests&style=flat-square)](https://github.com/yourname/tracel/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-18+-green?style=flat-square)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-3.11-blue?style=flat-square)](https://python.org)

Tracel simulates network packet traffic, scores each packet in real time using a trained Isolation Forest model, and streams the results — with SHAP feature explanations and MITRE ATT&CK technique tags — to a live React dashboard.

[Live Demo](https://tracel-frontend.vercel.app) · [Architecture](#architecture) · [Quick Start](#quick-start) · [API Reference](#api-reference)

</div>

---

## What it does

A Security Operations Center analyst watching Tracel sees:

- A **live packet feed** streaming simulated network events as they are generated
- An **anomaly score** (0–1) for each packet, produced by an Isolation Forest model
- A **SHAP explanation** on flagged packets — the top 3 features that drove the anomaly score (e.g. `dst_port +0.43 · bytes +0.29`)
- A **MITRE ATT&CK badge** classifying the attack technique (e.g. `T1046 · Discovery · high`)
- A **globe visualization** plotting source and destination IPs geographically
- A **forensic view** for querying historical threat logs

The system is designed to survive partial outages — if the AI engine goes down, packets continue flowing with safe default scores. If MongoDB drops, the system falls back to an in-memory store. If Redis is unavailable, the queue falls back to direct HTTP.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     React Frontend                          │
│         Vite · Tailwind · socket.io-client · recharts       │
│              react-globe.gl · ConnectionStatusBanner        │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket (socket.io)
                         │ REST (auth, config, forensics)
┌────────────────────────▼────────────────────────────────────┐
│                  Node.js Backend                            │
│     Express · Socket.IO · Zod · Pino · @clerk/backend       │
│     traffic_simulator.js → Redis queue → result worker      │
│     MongoDB (optional) │ memory_store.js fallback           │
└──────────┬─────────────────────────┬───────────────────────┘
           │ tracel:ai:queue         │ tracel:ai:results
           │ (Redis pub/sub)         │ (Redis pub/sub)
┌──────────▼──────────┐   ┌─────────▼────────────────────────┐
│   Python AI Engine  │   │       Python AI Worker            │
│  FastAPI · Uvicorn  │   │  worker.py · inference.py         │
│  Pydantic · Motor   │   │  mitre_tagger.py · retrain.py     │
│  /health · /predict │   │  Health server :9090              │
│  /docs (Swagger UI) │   │                                   │
└──────────┬──────────┘   └──────────────────────────────────┘
           │
┌──────────▼──────────┐
│   inference.py      │  ← single source of truth for the model
│   IsolationForest   │     shared by FastAPI + worker
│   TreeExplainer     │     hot-reloadable via reload_model()
│   reload_model()    │
└─────────────────────┘
```

### Data flow — one packet, start to finish

```
1. traffic_simulator.js  →  generates mock packet
2. Node                  →  enqueues to tracel:ai:queue (Redis)
3. worker.py             →  dequeues, calls predict() from inference.py
4. inference.py          →  IsolationForest score + SHAP explanation
5. mitre_tagger.py       →  maps features to MITRE ATT&CK technique
6. worker.py             →  pushes result to tracel:ai:results (Redis)
7. Node result worker    →  Zod-validates result, dead-letters if invalid
8. Node                  →  persists to MongoDB (or memory_store.js)
9. Node                  →  broadcasts via Socket.IO to all React clients
10. React dashboard      →  renders packet, ExplanationBadge, MitreBadge
```

### Graceful degradation

| Dependency | Fallback |
|---|---|
| Redis unavailable | Node falls back to synchronous `POST /predict` HTTP call |
| AI engine down | Node assigns safe default anomaly score, stream continues |
| MongoDB unreachable | Falls back to `memory_store.js` (LRU, max 1000 entries, 30 min TTL) |
| SHAP computation fails | `explanation: null` returned, prediction still completes |
| Socket.IO Redis adapter fails | Falls back to single-instance in-memory adapter |
| WebSocket disconnects | Client applies exponential backoff (1s base, 30s cap, ±50% jitter) |

---

## Quick start

### Prerequisites

- Node.js 18+
- Python 3.11+
- Docker + Docker Compose
- A [Clerk](https://clerk.com) account (free tier is fine)

### 1. Clone and configure

```bash
git clone https://github.com/yourname/tracel.git
cd tracel
cp server/.env.example server/.env
cp ai-engine/.env.example ai-engine/.env
cp dashboard/.env.example dashboard/.env
```

Fill in the required values in each `.env`:

```bash
# server/.env — required
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
FRONTEND_URL=http://localhost:5173

# Optional — omit to run without persistence
MONGO_URL=mongodb://localhost:27017/tracel

# Optional — omit to run without async queue (falls back to HTTP)
REDIS_URL=redis://localhost:6379
```

### 2. Run with Docker Compose (recommended)

```bash
docker compose up
```

This starts four services: `server`, `ai-engine`, `ai-worker`, and `redis`.
MongoDB is not included — set `MONGO_URL` to an Atlas connection string or omit it to use the in-memory store.

### 3. Run without Docker

```bash
# Terminal 1 — Node backend
cd server && npm install && npm run dev

# Terminal 2 — Python AI engine
cd ai-engine && pip install -r requirements-dev.txt
python app.py

# Terminal 3 — Python AI worker
cd ai-engine && python worker.py

# Terminal 4 — React frontend
cd dashboard && npm install && npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Tech stack

### Frontend
| | |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS |
| Routing | react-router-dom |
| Real-time | socket.io-client |
| Visualisation | recharts, react-globe.gl, three.js |
| Auth | Clerk (JWT, client-side) |

### Backend (Node.js)
| | |
|---|---|
| Server | Express + Socket.IO |
| Auth | Clerk JWTs via jwks-rsa |
| Validation | Zod |
| Logging | Pino (JSON) + pino-pretty (dev) |
| Queue | ioredis (producer + result worker) |
| Database | Mongoose (MongoDB) + memory_store.js fallback |
| Rate limiting | express-rate-limit + custom io.use() socket throttle |
| Scaling | @socket.io/redis-adapter |

### AI Engine (Python)
| | |
|---|---|
| Server | FastAPI + Uvicorn (ASGI, async) |
| Validation | Pydantic v2 (request/response models) |
| API Docs | Auto-generated Swagger UI (`/docs`) + ReDoc (`/redoc`) |
| Async DB | Motor (async MongoDB driver) |
| Model | scikit-learn IsolationForest |
| Explainability | SHAP TreeExplainer |
| Attack tagging | Custom MITRE ATT&CK rule engine |
| Queue consumer | redis-py |
| Scheduling | APScheduler (periodic model retraining) |
| Serialisation | joblib, pandas |

---

## Key design decisions

### Why Node.js + Python instead of one language?

Node.js has the best real-time WebSocket ecosystem. Python has the best ML ecosystem. Running them as separate services means each can use its ideal runtime. The cost is network latency between them and two deployment environments to maintain.

The original implementation made a synchronous `POST /predict` HTTP call per packet — a hard throughput ceiling. This was replaced with a Redis async queue: Node enqueues packets and immediately moves on, the Python worker processes them independently. Both services now scale horizontally without coupling.

### Why is MongoDB optional?

New contributors should be able to run the full system with a single command and no external dependencies. If `MONGO_URL` is not set, all packet and threat data is stored in `memory_store.js` — an LRU-evicting, TTL-aware in-memory store. The cost is that data disappears on server restart. For development this is acceptable; for production, set `MONGO_URL`.

### Why Clerk instead of rolling auth?

Writing correct authentication means correctly implementing JWT signing, refresh token rotation, JWKS endpoint verification, and session invalidation. Clerk solves all of these. The backend receives a JWT, verifies it against Clerk's JWKS endpoint, and extracts the role from the token claims — zero passwords stored, zero custom crypto.

### Why SHAP + MITRE instead of just an anomaly score?

An anomaly score is a black box. A SOC analyst seeing `anomaly_score: 0.87` with no context cannot decide whether to escalate or dismiss. SHAP TreeExplainer adds feature attribution ("flagged because dst_port contributed +0.43") and the MITRE tagger adds attack context ("this pattern matches T1046 Network Service Discovery, confidence: high"). Together they make the anomaly actionable.

---

## API reference

### Node backend (`/api`)

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Service health — Redis, MongoDB, AI engine status |
| `GET` | `/health/socket` | None | Socket.IO adapter type, connected client count |
| `GET` | `/api/status` | JWT | Current simulator status |
| `POST` | `/api/settings` | JWT | Update simulator configuration |
| `GET` | `/api/forensics` | JWT | Query historical threat logs (paginated) |
| `POST` | `/api/admin/reset` | JWT + Admin | Reset the packet stream |

### AI engine (`/`)

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Model status, SHAP explainer state, uptime |
| `POST` | `/predict` | Internal | Score a packet (used as HTTP fallback only) |
| `GET` | `/admin/model-status` | Internal | Last retrain time, next scheduled retrain |
| `POST` | `/admin/reload-model` | Internal | Hot-reload model without restart |

### AI worker (`:9090`)

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Redis connectivity, queue depth, dead-letter count |

---

## Environment variables

### server/.env

```bash
# Auth (required)
VITE_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# CORS (required in production)
FRONTEND_URL=https://your-frontend.vercel.app

# Database (optional — falls back to memory store)
MONGO_URL=
MONGO_POOL_SIZE=10

# Redis (optional — falls back to synchronous HTTP)
REDIS_URL=

# Socket.IO scaling
SOCKET_IO_REDIS_PREFIX=tracel:sio

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_HTTP=200
RATE_LIMIT_MAX_ADMIN=20
SOCKET_MAX_CONNECTIONS_PER_WINDOW=10
SOCKET_WINDOW_MS=60000

# Memory store fallback
MEMORY_STORE_MAX_SIZE=1000
MEMORY_STORE_TTL_MINUTES=30

# Logging
TRACEL_LOG_LEVEL=info          # debug | info | warn | error
NODE_ENV=production
```

### ai-engine/.env

```bash
# Model paths
MODEL_PATH=model/isolation_forest_latest.pkl
SCALER_PATH=model/scaler.pkl

# SHAP
SHAP_TOP_N=3
SHAP_MIN_VALUE=0.05

# Retraining
RETRAIN_INTERVAL_HOURS=24
RETRAIN_MIN_SAMPLES=500

# Redis
REDIS_URL=

# MongoDB (for retraining data source)
MONGO_URL=

# Performance
UVICORN_WORKERS=1                # async handles concurrency; increase for CPU-bound
AI_SLOW_REQUEST_MS=500
```

---

## Running tests

```bash
# Node — Jest
cd server && npm test

# Python — Pytest
cd ai-engine && pip install -r requirements-dev.txt && pytest

# Both via CI
# See .github/workflows/test.yml — runs on every push to main
```

Test coverage includes: packet validation, auth middleware, socket throttle (including IPv4/IPv6 x-forwarded-for parsing), SHAP failure fallback, MITRE rule priority ordering, model hot-reload under concurrent load, memory store LRU eviction, and database graceful degradation.

---

## Deployment

### Frontend → Vercel

```bash
cd dashboard && vercel --prod
```

Set `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_BACKEND_URL` in the Vercel dashboard.

### Backend + AI → Fly.io

```bash
# Node backend
cd server && fly launch && fly deploy

# AI engine + worker (same image, different process)
cd ai-engine && fly launch && fly deploy
```

Set all environment variables via `fly secrets set KEY=value`.

Health checks are configured in `docker-compose.yml` and will be picked up automatically by Fly.io.

---

## Project structure

```
tracel/
├── dashboard/                  # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── ConnectionStatusBanner.jsx
│   │   │   ├── ExplanationBadge.jsx     # SHAP feature breakdown
│   │   │   ├── FreshnessGuard.jsx       # Stale data overlay
│   │   │   └── MitreBadge.jsx           # ATT&CK technique badge
│   │   ├── context/
│   │   │   └── SocketContext.jsx
│   │   └── hooks/
│   │       ├── useConnectionStatus.js
│   │       └── useDataFreshness.js
│
├── server/                     # Node.js backend
│   ├── config/
│   │   ├── cors.js
│   │   ├── database.js
│   │   └── logger.js           # Pino JSON logger
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   ├── rateLimiter.js
│   │   ├── requireAdmin.js
│   │   ├── socketThrottle.js
│   │   └── validate.js
│   ├── routes/
│   │   └── health.js
│   ├── schemas/
│   │   ├── packetSchema.js     # includes explanation + mitre fields
│   │   ├── settingsSchema.js
│   │   └── adminSchema.js
│   ├── memory_store.js         # LRU + TTL fallback store
│   ├── traffic_simulator.js    # Packet generator + Redis queue
│   └── index.js
│
├── ai-engine/                  # Python microservices
│   ├── inference.py            # Model singleton — shared by app + worker
│   ├── retrain.py              # APScheduler retraining job
│   ├── mitre_tagger.py         # Declarative ATT&CK rule engine
│   ├── mitre_techniques.py     # Technique catalog
│   ├── app.py                  # FastAPI REST server (Uvicorn)
│   ├── schemas.py              # Pydantic request/response models
│   ├── worker.py               # Redis queue consumer
│   ├── requirements.txt        # Production deps
│   ├── requirements-dev.txt    # + pytest, freezegun, httpx
│   └── Dockerfile              # Multi-stage, non-root appuser
│
├── docker-compose.yml          # server + ai-engine + ai-worker + redis
└── .github/
    └── workflows/
        └── test.yml            # Jest + Pytest on every push to main
```

---

## License

MIT — see [LICENSE](LICENSE).
