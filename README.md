# SRE Observability Stack

[![CI](https://github.com/Djones-qa/sre-observability-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/Djones-qa/sre-observability-stack/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis)](https://redis.io/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28-blue?logo=kubernetes)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/Docker-multi--stage-blue?logo=docker)](https://www.docker.com/)
[![Prometheus](https://img.shields.io/badge/Prometheus-compatible-orange?logo=prometheus)](https://prometheus.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade SRE observability platform — SLO tracking, error budget burn rates, and structured log pipeline. Three TypeScript/Node.js microservices backed by Redis Streams and deployed on Kubernetes.

---

## Overview

| Service | Port | Responsibility |
|---|---|---|
| `metrics-aggregator` | 4000 | Scrapes Prometheus `/metrics` endpoints, computes SLO burn rates, stores rollups in Redis |
| `log-pipeline` | 4001 | Ingests structured JSON logs, enriches entries, routes ERROR/FATAL to alert streams |
| `slo-dashboard-api` | 4002 | Reads SLO rollups and log streams from Redis, serves dashboard REST API |

---

## Quick Start

### Docker Compose (recommended)

```bash
# Copy and configure environment
cp .env.example .env

# Start all services + Redis
docker compose up -d

# With mock data senders (for testing)
docker compose --profile testing up -d
```

Services will be available at:
- metrics-aggregator: http://localhost:4000
- log-pipeline: http://localhost:4001
- slo-dashboard-api: http://localhost:4002

### Local Development

Prerequisites: Node.js 20, Redis running on localhost:6379

```bash
# Install all workspace dependencies
npm install

# Run a service in dev mode
cd services/metrics-aggregator
npm run dev

# Run tests across all services
npm test
```

---

## Services

### metrics-aggregator (port 4000)

Scrapes registered Prometheus-format `/metrics` endpoints on a configurable interval. Parses counters, gauges, and histograms. Computes SLO burn rates across 1h, 6h, 24h, and 72h rolling windows and stores rollups in Redis sorted sets.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/targets` | Register a scrape target |
| `GET` | `/targets` | List all registered targets |
| `DELETE` | `/targets/:id` | Deregister a target by ID |
| `GET` | `/metrics/query` | Query latest rollup (`?serviceName=&window=1h\|6h\|24h\|72h`) |
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness probe (checks Redis) |

#### Register a target

```bash
curl -X POST http://localhost:4000/targets \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-service",
    "url": "http://my-service:9090/metrics",
    "serviceName": "my-service",
    "scrapeIntervalSeconds": 15
  }'
```

#### Query SLO rollup

```bash
curl "http://localhost:4000/metrics/query?serviceName=my-service&window=1h"
```

---

### log-pipeline (port 4001)

Accepts structured JSON log entries via HTTP. Enriches each entry with a normalised timestamp, trace ID (generated if absent), canonical severity, and service name tagging. Routes ERROR and FATAL entries to a dedicated Redis Stream for alerting. All entries go to `logs:all`; malformed entries go to a dead-letter queue.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest` | Ingest a single log entry |
| `POST` | `/ingest/batch` | Ingest an array of log entries |
| `GET` | `/health` | Liveness probe |

#### Ingest a log entry

```bash
curl -X POST http://localhost:4001/ingest \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Payment processed successfully",
    "level": "info",
    "serviceName": "payment-service",
    "orderId": "ord-123"
  }'
```

#### Batch ingest

```bash
curl -X POST http://localhost:4001/ingest/batch \
  -H 'Content-Type: application/json' \
  -d '[
    {"message": "Request timeout", "level": "error", "serviceName": "api-gateway"},
    {"message": "Cache miss", "level": "warn", "serviceName": "checkout-service"}
  ]'
```

#### Severity normalisation

| Input | Normalised |
|---|---|
| `DEBUG`, `TRACE`, `verbose` | `debug` |
| `INFO`, `information` | `info` |
| `WARN`, `WARNING` | `warn` |
| `ERROR`, `ERR` | `error` |
| `FATAL`, `CRITICAL`, `crit` | `fatal` |
| unknown / missing | `info` |

---

### slo-dashboard-api (port 4002)

Reads SLO rollup data and error logs from Redis. All responses include a `calculatedAt` timestamp and `dataFreshness` (seconds since the underlying rollup was computed).

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/slo/summary` | Fleet-wide SLO health snapshot |
| `GET` | `/slo/:service` | Current SLO status for one service |
| `GET` | `/slo/:service/budget` | Error budget remaining per window |
| `GET` | `/slo/:service/trend` | 7-day burn rate trend data points |
| `GET` | `/logs/:service/errors` | Recent ERROR/FATAL logs (`?limit=50`) |
| `GET` | `/health` | Liveness probe |

#### Example: Get SLO status

```bash
curl http://localhost:4002/slo/payment-service
```

```json
{
  "data": {
    "serviceName": "payment-service",
    "sloTarget": 0.999,
    "currentErrorRate": 0.0005,
    "uptimePct": 99.95,
    "burnRate": 0.5,
    "status": "healthy"
  },
  "calculatedAt": "2024-01-15T14:30:00.000Z",
  "dataFreshness": 12
}
```

#### Example: Get error budget

```bash
curl http://localhost:4002/slo/payment-service/budget
```

#### SLO status labels

| Burn Rate | Status |
|---|---|
| < 1 | `healthy` |
| 1 – 14.39 | `at-risk` |
| ≥ 14.4 | `breached` |

---

## Infrastructure

### Redis Data Model

| Key Pattern | Type | Contents |
|---|---|---|
| `targets:registry` | Hash | Registered scrape targets (id → JSON) |
| `rollup:{service}:{window}` | Sorted Set | Burn rate rollups scored by timestamp |
| `slo:config:{service}` | Hash | SLO target configuration per service |
| `logs:all` | Stream | All ingested log entries (7-day cap ~1M entries) |
| `logs:errors` | Stream | ERROR/FATAL entries only (~100K entries) |
| `logs:dlq` | List | Dead-letter queue for malformed entries |

### Rollup Windows

| Window | TTL |
|---|---|
| `1h` | 2 hours |
| `6h` | 12 hours |
| `24h` | 48 hours |
| `72h` | 144 hours |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL |
| `METRICS_PORT` | `4000` | metrics-aggregator port |
| `SCRAPE_DEFAULT_INTERVAL_S` | `15` | Default scrape interval (seconds) |
| `SCRAPE_TIMEOUT_MS` | `10000` | Scrape HTTP timeout (ms) |
| `DEFAULT_SLO_TARGET` | `0.999` | Default SLO target (0.0–1.0) |
| `LOG_PORT` | `4001` | log-pipeline port |
| `LOG_MAX_STREAM_LENGTH` | `1000000` | Max entries in `logs:all` stream |
| `LOG_ERROR_MAX_STREAM_LENGTH` | `100000` | Max entries in `logs:errors` stream |
| `DASHBOARD_PORT` | `4002` | slo-dashboard-api port |
| `LOG_QUERY_DEFAULT_LIMIT` | `50` | Default log query result limit |
| `LOG_QUERY_MAX_LIMIT` | `500` | Maximum log query result limit |

Copy `.env.example` to `.env` and adjust before running.

---

## Kubernetes

All manifests live in `k8s/` and target Kubernetes 1.28 in the `sre-observability` namespace.

| File | Contents |
|---|---|
| `namespace.yaml` | Namespace with PodSecurity `restricted` enforcement |
| `rbac.yaml` | ServiceAccounts (no API access) |
| `network-policy.yaml` | Default deny-all + selective allow per service |
| `resource-quota.yaml` | CPU/memory quotas + LimitRange |
| `pod-disruption-budget.yaml` | minAvailable: 1 for metrics-aggregator + slo-dashboard-api |
| `redis-deployment.yaml` | Single-instance Redis with PVC |
| `metrics-aggregator-deployment.yaml` | Non-root, readOnlyRootFilesystem, liveness/readiness |
| `log-pipeline-deployment.yaml` | Non-root, readOnlyRootFilesystem, liveness |
| `slo-dashboard-api-deployment.yaml` | Non-root, Redis read-only annotation |

```bash
kubectl apply -f k8s/
```

---

## CI/CD

GitHub Actions pipeline with 4 jobs:

| Job | What it does |
|---|---|
| `typecheck-build` | Matrix across all 3 services — `tsc --noEmit` + `npm run build` |
| `unit-tests` | Jest tests per service with coverage upload |
| `trivy-scan` | Scans all Dockerfiles + `k8s/` manifests, fails on HIGH/CRITICAL |
| `kubeconform` | Validates all K8s manifests against 1.28 schemas |

---

## Unit Test Coverage

| Service | What's tested |
|---|---|
| `metrics-aggregator` | Prometheus parser, burn rate math, rollup logic, target registry |
| `log-pipeline` | Log enrichment, severity normalisation, trace ID injection, routing |
| `slo-dashboard-api` | Budget calculation, SLO status derivation, uptime computation |

All test suites include property-based tests using [fast-check](https://github.com/dubzzz/fast-check).

---

## Project Structure

```
sre-observability-stack/
├── services/
│   ├── metrics-aggregator/     # Port 4000
│   │   ├── src/
│   │   │   ├── __tests__/
│   │   │   ├── burnRateCalculator.ts
│   │   │   ├── prometheusParser.ts
│   │   │   ├── rollupStore.ts
│   │   │   ├── scraper.ts
│   │   │   ├── seedService.ts
│   │   │   ├── targetRegistry.ts
│   │   │   ├── routes.ts
│   │   │   ├── redis.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── log-pipeline/           # Port 4001
│   │   ├── src/
│   │   │   ├── __tests__/
│   │   │   ├── logEnricher.ts
│   │   │   ├── severityNormaliser.ts
│   │   │   ├── streamWriter.ts
│   │   │   ├── consumerGroupInit.ts
│   │   │   ├── routes.ts
│   │   │   ├── redis.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   └── slo-dashboard-api/      # Port 4002
│       ├── src/
│       │   ├── __tests__/
│       │   ├── budgetCalculator.ts
│       │   ├── rollupReader.ts
│       │   ├── trendAnalyser.ts
│       │   ├── logStreamReader.ts
│       │   ├── responseBuilder.ts
│       │   ├── routes.ts
│       │   ├── redis.ts
│       │   ├── types.ts
│       │   └── index.ts
│       ├── Dockerfile
│       └── package.json
├── k8s/                        # Kubernetes manifests
├── .github/workflows/ci.yml    # GitHub Actions CI
├── docker-compose.yml
├── .env.example
└── package.json                # Workspaces root
```

---

## Author

**Darrius Jones**
- GitHub: [@Djones-qa](https://github.com/Djones-qa)
- LinkedIn: [darrius-jones-28226b350](https://www.linkedin.com/in/darrius-jones-28226b350)

---

## License

[MIT](LICENSE) © 2024 Darrius Jones
