# Integration Contract

This document defines the contract between:
- `sai-moderation-streamerbot-extension` (producer/bridge)
- `sai-moderation-docker` (moderation backend)

## 1) Request: Extension -> Backend

`POST /v1/moderate`

```json
{
  "messageId": "msg-123",
  "platform": "Twitch",
  "channelId": "chan-1",
  "userId": "user-7",
  "username": "viewer_name",
  "text": "message body",
  "receivedAt": "2026-04-23T18:00:00Z"
}
```

## 2) Response: Backend -> Extension

```json
{
  "messageId": "msg-123",
  "verdict": "allow",
  "confidence": 0.97,
  "category": "safe",
  "reason": "no policy violation",
  "latencyMs": 41
}
```

Allowed `verdict` values:
- `allow`
- `flag`
- `block`

## 3) Dashboard Event: Extension -> Dashboard Channel

```json
{
  "eventType": "moderation.result",
  "messageId": "msg-123",
  "platform": "Twitch",
  "username": "viewer_name",
  "text": "message body",
  "verdict": "flag",
  "confidence": 0.74,
  "category": "toxicity",
  "reason": "insult target",
  "receivedAt": "2026-04-23T18:00:00Z"
}
```

## 4) Overlay Event: Extension -> Overlay Channel

Overlay receives:
- all `allow`
- optional `flag` based on extension config
- never `block`

```json
{
  "eventType": "overlay.message",
  "messageId": "msg-123",
  "platform": "Twitch",
  "username": "viewer_name",
  "text": "message body",
  "verdict": "allow"
}
```

## 5) Versioning

- Contract version is tied to repository release tags.
- Breaking changes must increment major version and be documented in release notes.

