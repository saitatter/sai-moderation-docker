# sai-moderation-docker

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![GitHub Release](https://img.shields.io/github/v/release/saitatter/sai-moderation-docker)
[![Issues](https://img.shields.io/github/issues/saitatter/sai-moderation-docker)](https://github.com/saitatter/sai-moderation-docker/issues)
![Made with Python](https://img.shields.io/badge/Made%20with-Python-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![OBS Studio](https://img.shields.io/badge/OBS%20Studio-302E31?logo=obsstudio&logoColor=white)
![Streamer.bot Ready](https://img.shields.io/badge/Streamer.bot-Ready-blue)
![WebSocket](https://img.shields.io/badge/WebSocket-Live%20Events-6A5ACD)

> FastAPI moderation bridge for Streamer.bot workflows, with an OBS-ready dashboard dock and normalized overlay events for `sai-stream-overlay`.

`sai-moderation-docker` receives chat events, runs moderation, keeps a lightweight dashboard queue, and publishes approved overlay events over WebSocket. It is designed to sit between Streamer.bot and stream overlays so chat rendering stays clean, auditable, and easy to replace later.

---

## Features

- FastAPI backend on port `8787`
- `POST /v1/chat-events` ingestion for Streamer.bot or any HTTP client
- Provider-based moderation with `mock` and local `ollama` support
- Live WebSocket channels:
  - `dashboard`
  - `overlay`
- Normalized overlay payloads with `type: "chat.message"`
- Backward-compatible `eventType: "overlay.message"` payloads
- OBS dock dashboard at `/dashboard`
- Queue/state for latest, pending, approved, and rejected messages
- Manual dashboard actions: `Approve`, `Block`, `False Positive`
- Optional manual override forwarding callback
- Health metrics for processed, approved, blocked, flagged, override, and subscriber counts
- API token protection and per-client rate limiting
- Docker image published to GHCR

---

## Quick Start

### Docker

```bash
docker pull ghcr.io/saitatter/sai-moderation-docker:latest
docker run --rm -p 8787:8787 ghcr.io/saitatter/sai-moderation-docker:latest
```

Health check:

```text
http://127.0.0.1:8787/healthz
```

Dashboard:

```text
http://127.0.0.1:8787/dashboard
```

### Local Development

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

---

## Streamer.bot Flow

Use one endpoint from your Streamer.bot chat action:

```text
POST /v1/chat-events
```

The backend will:

1. Receive the raw chat event.
2. Run the configured moderation provider.
3. Publish `moderation.result` to the `dashboard` channel.
4. Publish approved overlay events to the `overlay` channel.

Set `FORWARD_FLAGS_TO_OVERLAY=true` if flagged messages should also reach the overlay.

Example payload:

```json
{
  "messageId": "msg-123",
  "platform": "Twitch",
  "channelId": "chan-1",
  "userId": "user-7",
  "username": "viewer_name",
  "text": "message body",
  "receivedAt": "2026-04-24T18:00:00Z"
}
```

---

## Overlay Contract

Allowed messages are published on:

```text
WS /ws?channel=overlay
```

Payloads keep the legacy shape and include normalized fields:

```json
{
  "eventType": "overlay.message",
  "messageId": "msg-123",
  "platform": "Twitch",
  "username": "viewer_name",
  "text": "message body",
  "verdict": "allow",
  "version": 1,
  "id": "msg-123",
  "type": "chat.message",
  "source": "twitch",
  "status": "approved",
  "receivedAt": "2026-04-24T18:00:00Z",
  "actor": {
    "id": "user-7",
    "name": "viewer_name",
    "displayName": "viewer_name",
    "badges": []
  },
  "payload": {
    "message": "message body",
    "emotes": [],
    "isAction": false,
    "isFirstMessage": false
  }
}
```

Blocked messages are never published to `overlay`.

---

## OBS Dock Setup

1. Open OBS.
2. Go to `View` -> `Docks` -> `Custom Browser Docks...`
3. Add:
   - Name: `SAI Moderation`
   - URL: `http://127.0.0.1:8787/dashboard`

If `API_TOKEN` is enabled, include the token and operator query params:

```text
http://127.0.0.1:8787/dashboard?token=YOUR_TOKEN&operator=your_mod_name
```

The dashboard supports:

- live verdict feed
- initial queue restore from `/api/moderation/queue`
- verdict filtering
- user/text search
- manual override actions

---

## Stream Overlay Setup

Use `sai-stream-overlay` in moderation mode so OBS renders only messages approved by this backend:

```text
http://localhost:8080/?eventSource=moderation&overlayWsUrl=ws%3A%2F%2Flocalhost%3A8787%2Fws%3Fchannel%3Doverlay
```

Scene overlays can listen to the same moderation overlay channel:

```text
http://localhost:8080/overlay/scene.html?instance=main&overlayWsUrl=ws%3A%2F%2Flocalhost%3A8787%2Fws%3Fchannel%3Doverlay&sceneApiUrl=http%3A%2F%2Flocalhost%3A8787
```

---

## Local LLM

By default the backend uses mock moderation. To use Ollama:

```bash
ollama pull qwen2.5:7b
```

Windows PowerShell:

```powershell
$env:LLM_PROVIDER="ollama"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
$env:OLLAMA_MODEL="qwen2.5:7b"
$env:LLM_TIMEOUT_MS="6000"
uvicorn app.main:app --host 0.0.0.0 --port 8787
```

---

## API Endpoints

| Endpoint                    | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `GET /healthz`              | Health, metrics, queue sizes, subscriber counts |
| `GET /dashboard`            | OBS dock dashboard                              |
| `GET /api/moderation/queue` | Current dashboard queue state                   |
| `POST /v1/moderate`         | Run moderation provider only                    |
| `POST /v1/chat-events`      | Main chat event ingestion endpoint              |
| `POST /v1/events/{channel}` | Publish directly to `dashboard` or `overlay`    |
| `POST /v1/overrides`        | Request manual moderation action                |
| `WS /ws?channel=dashboard`  | Live dashboard events                           |
| `WS /ws?channel=overlay`    | Approved overlay events                         |

---

## Configuration

| Variable                      | Default                  | Notes                                                                               |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `API_TOKEN`                   | empty                    | Enables bearer auth for protected HTTP endpoints and dashboard WebSocket query auth |
| `FORWARD_FLAGS_TO_OVERLAY`    | `false`                  | Sends flagged messages to overlay when true                                         |
| `MANUAL_OVERRIDE_FORWARD_URL` | empty                    | Optional callback URL for override requests                                         |
| `RATE_LIMIT_WINDOW_MS`        | `10000`                  | Per-client rate limit window                                                        |
| `RATE_LIMIT_MAX`              | `60`                     | Max `/v1/moderate` and `/v1/chat-events` requests per window                        |
| `LLM_PROVIDER`                | `mock`                   | `mock` or `ollama`                                                                  |
| `OLLAMA_BASE_URL`             | `http://127.0.0.1:11434` | Ollama host                                                                         |
| `OLLAMA_MODEL`                | `qwen2.5:7b`             | Ollama model name                                                                   |
| `LLM_TIMEOUT_MS`              | `6000`                   | Provider timeout                                                                    |

Protected HTTP endpoints require:

```text
Authorization: Bearer <API_TOKEN>
```

For dashboard WebSocket auth, pass `?token=<API_TOKEN>`.

---

## Testing

```bash
pytest
```

For release tooling checks on branches that include the Node release policy:

```bash
npm run check
```

---

## Related Repositories

- `sai-stream-overlay`: https://github.com/saitatter/sai-stream-overlay
- `sai-moderation-streamerbot-extension`: https://github.com/saitatter/sai-moderation-streamerbot-extension

---

## Release Policy

Uses semantic release with Conventional Commits.

- Releases run only from `main`.
- Feature branches do not publish releases.
- Patch releases are triggered for `fix`, `perf`, `refactor`, `ci`, and `chore`.
- Squash merges are supported when the squash commit body keeps the branch's conventional commit list.

See [Action Plan](docs/ACTION_PLAN.md) for implementation phases.
See [Integration Contract](docs/INTEGRATION_CONTRACT.md) for extension/backend schema.

---

## License

MIT
