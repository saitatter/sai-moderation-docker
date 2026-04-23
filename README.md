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

## Release Policy

- Conventional Commits are required.
- Semantic release runs on pushes to `main`.
- Patch releases are also triggered for `refactor`, `ci`, and `chore`.

See [Action Plan](docs/ACTION_PLAN.md) for implementation phases.
See [Integration Contract](docs/INTEGRATION_CONTRACT.md) for extension/backend schema.
