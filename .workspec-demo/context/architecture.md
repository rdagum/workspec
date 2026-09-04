# Architecture

The demo product is a small SaaS with three services:

- **web** — the customer-facing single-page app
- **api** — a stateless REST API
- **worker** — async jobs (email, webhooks, billing reconciliation)

## Principles

- Stateless services behind a load balancer
- Postgres as the single source of truth
- Idempotent message handlers in the worker
- All config via environment variables

## Boundaries

The `api` never talks to third-party billing directly during a request; it
enqueues a job for the `worker`. This keeps request latency predictable.
