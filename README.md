# sai-moderation-docker

Bridge service and internal moderation dashboard foundation for Streamer.bot workflows.

Companion extension repo:

- `sai-moderation-streamerbot-extension`:
  https://github.com/saitatter/sai-moderation-streamerbot-extension

## Goals

- Receive chat events from Streamer.bot.
- Forward messages to external moderation/LLM service.
- Publish moderation verdicts to overlay and moderator dashboard.
- Keep release and collaboration standards aligned with `sai-chat-overlay`.

## Development

```bash
npm install
npm run check
```

## Local LLM (Ollama)

`sai-moderation-docker` can call a local Ollama model for `/v1/moderate`.

Environment variables:

- `LLM_PROVIDER=ollama`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `OLLAMA_MODEL=qwen2.5:7b`
- `LLM_TIMEOUT_MS=6000`

Example:

```bash
export LLM_PROVIDER=ollama
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export OLLAMA_MODEL=qwen2.5:7b
export LLM_TIMEOUT_MS=6000
npm run check
```

If `LLM_PROVIDER` is not set, the service uses the `mock` provider.

## Single-Call Chat Ingestion

For minimal Streamer.bot wiring, use one endpoint:

- `POST /v1/chat-events`

It performs:

1. moderation (LLM provider)
2. publish to dashboard channel (`moderation.result`)
3. publish to overlay channel (`overlay.message`) when verdict is allowed (and optionally flagged)

Set `FORWARD_FLAGS_TO_OVERLAY=true` to also forward flagged messages.

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

## OBS Dock Setup

1. Start the service (default `:8787`).
2. Open OBS -> `View` -> `Docks` -> `Custom Browser Docks...`.
3. Add a new dock:
   - Name: `SAI Moderation`
   - URL: `http://127.0.0.1:8787/dashboard`
   - If `API_TOKEN` is enabled: `http://127.0.0.1:8787/dashboard?token=YOUR_TOKEN&operator=your_mod_name`
4. Keep this dock open while streaming; it receives live moderation events from `ws?channel=dashboard`.

The dashboard supports manual actions (`Approve`, `Block`, `False Positive`) and sends them to:

- `POST /v1/overrides`
- optional forward callback to extension if `MANUAL_OVERRIDE_FORWARD_URL` is set.

## Security and Rate Limits

Optional environment variables:

- `API_TOKEN`: require `Authorization: Bearer <token>` for `POST /v1/moderate`, `POST /v1/events/*`, `POST /v1/overrides`.
- `RATE_LIMIT_WINDOW_MS` (default: `10000`)
- `RATE_LIMIT_MAX` (default: `60`) for `/v1/moderate` requests per client IP and window.

## Release Policy

- Conventional Commits are required.
- Semantic release runs on pushes to `main`.
- Patch releases are also triggered for `refactor`, `ci`, and `chore`.

See [Action Plan](docs/ACTION_PLAN.md) for implementation phases.
See [Integration Contract](docs/INTEGRATION_CONTRACT.md) for extension/backend schema.
