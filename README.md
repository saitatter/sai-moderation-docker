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

## OBS Dock Setup

1. Start the service (default `:8787`).
2. Open OBS -> `View` -> `Docks` -> `Custom Browser Docks...`.
3. Add a new dock:
   - Name: `SAI Moderation`
   - URL: `http://127.0.0.1:8787/dashboard`
4. Keep this dock open while streaming; it receives live moderation events from `ws?channel=dashboard`.

## Release Policy

- Conventional Commits are required.
- Semantic release runs on pushes to `main`.
- Patch releases are also triggered for `refactor`, `ci`, and `chore`.

See [Action Plan](docs/ACTION_PLAN.md) for implementation phases.
See [Integration Contract](docs/INTEGRATION_CONTRACT.md) for extension/backend schema.
