# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2024-01-15

### Added

#### metrics-aggregator (port 4000)
- Prometheus text format parser (counter, gauge, histogram)
- SLO burn rate calculator with 1h, 6h, 24h, 72h rolling windows
- Redis sorted-set rollup store with configurable TTL per window
- Target registry backed by Redis hash (`targets:registry`)
- Scraper with per-target `setInterval` scheduling and 10s HTTP timeout
- Seed service that pre-registers api-gateway, checkout-service, payment-service on first boot
- REST endpoints: `POST/GET/DELETE /targets`, `GET /metrics/query`, `GET /health`, `GET /ready`

#### log-pipeline (port 4001)
- Structured JSON log ingestion via `POST /ingest` and `POST /ingest/batch`
- Log enricher: ISO-8601 timestamp normalisation, UUID v4 trace ID injection, service name tagging
- Severity normaliser: maps 15+ input variants to `debug|info|warn|error|fatal`
- Redis Stream writer (`logs:all` + `logs:errors`) with MAXLEN cap
- Dead-letter queue (`logs:dlq`) for malformed entries
- Consumer group initialisation (`alert-consumers` on `logs:errors`)
- `GET /health` probe

#### slo-dashboard-api (port 4002)
- `GET /slo/summary` — fleet-wide SLO health snapshot
- `GET /slo/:service` — current SLO status, error rate, uptime %
- `GET /slo/:service/budget` — error budget remaining per window
- `GET /slo/:service/trend` — 7-day burn rate trend data points
- `GET /logs/:service/errors` — recent ERROR/FATAL logs from Redis Stream
- Response envelope with `calculatedAt` and `dataFreshness` indicators
- `GET /health` probe

#### Infrastructure
- Docker Compose with health checks and `--profile testing` mock senders
- Multi-stage Dockerfiles (non-root user, production deps only)
- `.env.example` with all tuneable variables documented

#### Kubernetes (k8s/)
- Namespace with PodSecurity `restricted` enforcement (K8s 1.28)
- ServiceAccounts with `automountServiceAccountToken: false`
- Default deny-all NetworkPolicies with selective per-service allows
- ResourceQuota + LimitRange for the namespace
- PodDisruptionBudgets (`minAvailable: 1`) for metrics-aggregator and slo-dashboard-api
- All four Deployments + Services (non-root, readOnlyRootFilesystem, liveness/readiness probes)
- Redis Deployment with PVC

#### CI/CD
- GitHub Actions: `typecheck-build`, `unit-tests`, `trivy-scan`, `kubeconform` jobs

#### Tests
- Jest + fast-check property-based tests across all three services
- Properties: burn rate formula correctness, parser completeness, log enrichment completeness,
  severity normalisation totality, error/fatal routing invariant, budget non-negative
