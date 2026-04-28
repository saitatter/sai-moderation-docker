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

The overlay payload remains compatible with the original `overlay.message`
contract and also includes normalized `chat.message` fields for browser overlays
that consume moderation-service events directly.

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
  "createdAt": "2026-04-23T18:00:00Z",
  "receivedAt": "2026-04-23T18:00:00Z",
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
  },
  "display": {
    "priority": "normal"
  }
}
```

## 5) Moderation Queue

`GET /api/moderation/queue`

Returns recent in-memory moderation state for the OBS dock:

```json
{
  "latest": [],
  "pending": [],
  "approved": [],
  "rejected": []
}
```

Manual override approvals can replay a stored chat event to the overlay channel.

## 6) Versioning

- Contract version is tied to repository release tags.
- Breaking changes must increment major version and be documented in release notes.
