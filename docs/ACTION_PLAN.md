# Action Plan

## Phase 0: Foundation

- Keep release standards aligned with `sai-stream-overlay`:
  - semantic-release
  - conventional commit PR-title enforcement
  - CODEOWNERS ownership gate
- Define integration contracts:
  - incoming chat event schema from Streamer.bot
  - moderation request payload to LLM server
  - outgoing verdict event schema to overlay + dock dashboard

## Phase 1: Ingestion and Routing

- Build Streamer.bot bridge adapter in service:
  - subscribe to required chat events
  - normalize event data
  - assign message IDs and timestamps
- Implement retry and timeout policy for LLM HTTP calls.

## Phase 2: Moderation Decision Pipeline

- Add verdict model:
  - `allow | flag | block`
  - confidence, category, reason, latency
- Add fallback policy when LLM is unavailable.
- Add audit logging storage (start with SQLite).

## Phase 3: Internal Dashboard (Dock-Compatible)

- Build queue model:
  - incoming pending messages
  - decided verdict list
  - manually overridden entries
- Add manual actions:
  - approve
  - block
  - mark false-positive
- Add filters:
  - platform
  - verdict
  - confidence range

## Phase 4: Overlay Delivery

- Publish allowed messages to overlay channel.
- Publish flagged/blocked stream to moderation dashboard channel.
- Add idempotency and reconnect recovery.

## Phase 5: Hardening

- Rate limiting and burst protection.
- Structured telemetry (ingest rate, LLM latency, timeout count, override rate).
- Security:
  - tokenized API access between bridge and LLM
  - sanitized logs
  - secret handling policy

## Phase 6: Release and Operations

- Container build and GHCR publish from release workflow.
- Tag-based rollout notes with semantic-release categories.
- Operational runbook for outages and rollback.
