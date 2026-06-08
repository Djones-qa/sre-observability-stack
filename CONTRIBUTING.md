# Contributing

## Prerequisites

- Node.js 20
- Docker + Docker Compose
- A running Redis instance (or use `docker compose up redis -d`)

## Getting Started

```bash
# Install all workspace dependencies
npm install

# Run all tests
npm test

# Run a single service in dev mode
cd services/metrics-aggregator
npm run dev
```

## Project Structure

Each service lives under `services/` and is a self-contained TypeScript project with its own `package.json`, `tsconfig.json`, and Jest config.

## Running Tests

```bash
# All services
npm test

# Single service
cd services/log-pipeline
npm test

# With coverage
npm run test:coverage
```

## Docker

```bash
# Build and start everything
docker compose up -d

# With mock data senders
docker compose --profile testing up -d
```

## Code Style

- TypeScript strict mode enabled
- No `any` types
- All public functions documented with JSDoc
- Tests required for all business logic

## Pull Requests

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes
4. Push and open a PR against `main`

The CI pipeline will run automatically: typecheck, unit tests, Trivy security scan, and kubeconform validation.
