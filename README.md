# sai-moderation-docker

Python FastAPI backend for chat moderation + OBS-ready web dashboard.

Companion extension repo:

- `sai-moderation-streamerbot-extension`:
  https://github.com/saitatter/sai-moderation-streamerbot-extension

## What It Does

- Receives chat events from Streamer.bot (or any HTTP client).
- Runs moderation using a provider (`mock` or local `ollama`).
- Publishes verdicts to WebSocket channels:
  - `dashboard`
  - `overlay`
- Serves a web dashboard for OBS dock (`/dashboard`) with manual override actions.

## Quick Start

```bash
python -m venv .venv
# Windows PowerShell
.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

Health check:

- `GET http://127.0.0.1:8787/healthz`

Dashboard:

- `http://127.0.0.1:8787/dashboard`

## Local LLM (Ollama)

By default the backend uses `mock` moderation.

To use Ollama:

```bash
ollama pull qwen2.5:7b
```

Set environment variables:

```bash
# PowerShell
$env:LLM_PROVIDER="ollama"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"
$env:OLLAMA_MODEL="qwen2.5:7b"
$env:LLM_TIMEOUT_MS="6000"

uvicorn app.main:app --host 0.0.0.0 --port 8787
```

## Minimal Streamer.bot Integration

Use one endpoint from your chat action:

- `POST /v1/chat-events`

This endpoint:

1. moderates message text
2. publishes `moderation.result` to dashboard channel
3. publishes `overlay.message` with normalized `chat.message` fields to overlay
   channel when verdict should pass through

Set `FORWARD_FLAGS_TO_OVERLAY=true` if you also want flagged messages in overlay.

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

## API Endpoints

- `GET /healthz`
- `GET /dashboard`
- `GET /api/moderation/queue`
- `POST /v1/moderate`
- `POST /v1/chat-events`
- `POST /v1/events/{channel}` (`dashboard` or `overlay`)
- `POST /v1/overrides`
- `WS /ws?channel=dashboard|overlay`

## OBS Dock Setup

1. Open OBS -> `View` -> `Docks` -> `Custom Browser Docks...`
2. Add:
   - Name: `SAI Moderation`
   - URL: `http://127.0.0.1:8787/dashboard`
3. If auth is enabled, include query params:
   - `http://127.0.0.1:8787/dashboard?token=YOUR_TOKEN&operator=your_mod_name`

Dashboard supports:

- filters/search
- live verdict feed
- initial queue restore from `/api/moderation/queue`
- manual actions: `Approve`, `Block`, `False Positive`

## Chat Overlay Setup

Use `sai-chat-overlay` in moderation mode so OBS renders only messages approved
by this backend:

```text
http://localhost:8080/?eventSource=moderation&overlayWsUrl=ws%3A%2F%2Flocalhost%3A8787%2Fws%3Fchannel%3Doverlay
```

## Security and Rate Limits

Optional environment variables:

- `API_TOKEN`:
  Require `Authorization: Bearer <token>` for:
  - `POST /v1/moderate`
  - `POST /v1/chat-events`
  - `POST /v1/events/*`
  - `POST /v1/overrides`
    For WebSocket dashboard, use `?token=` query param.
- `RATE_LIMIT_WINDOW_MS` (default: `10000`)
- `RATE_LIMIT_MAX` (default: `60`) for `/v1/moderate` and `/v1/chat-events` per client IP/window.
- `MANUAL_OVERRIDE_FORWARD_URL`:
  Optional callback target for forwarded override requests.

## Release Policy

- Conventional Commits are required.
- Semantic release runs on pushes to `main`.
- Patch releases are also triggered for `refactor`, `ci`, and `chore`.

See [Action Plan](docs/ACTION_PLAN.md) for implementation phases.
See [Integration Contract](docs/INTEGRATION_CONTRACT.md) for extension/backend schema.
