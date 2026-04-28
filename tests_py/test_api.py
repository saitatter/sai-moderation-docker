from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


class FakeProvider:
    name = "fake"

    async def moderate(self, payload: dict) -> dict:
        return {
            "messageId": payload.get("messageId", "m-1"),
            "verdict": payload.get("verdict", "allow"),
            "confidence": 0.9,
            "category": "safe",
            "reason": "ok",
            "latencyMs": 2,
        }


@pytest.fixture(autouse=True)
def clear_env() -> Generator[None, None, None]:
    keys = [
        "API_TOKEN",
        "RATE_LIMIT_WINDOW_MS",
        "RATE_LIMIT_MAX",
        "FORWARD_FLAGS_TO_OVERLAY",
        "MANUAL_OVERRIDE_FORWARD_URL",
        "LLM_PROVIDER",
    ]
    before = {key: os.getenv(key) for key in keys}
    for key in keys:
        if key in os.environ:
            del os.environ[key]

    yield

    for key, value in before.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def test_healthz_and_dashboard() -> None:
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    health = client.get("/healthz")
    assert health.status_code == 200
    data = health.json()
    assert data["status"] == "ok"
    assert data["provider"] == "fake"

    dashboard = client.get("/dashboard")
    assert dashboard.status_code == 200
    assert "SAI Moderation Dashboard" in dashboard.text


def test_auth_required_when_token_configured() -> None:
    os.environ["API_TOKEN"] = "secret"
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    response = client.post("/v1/moderate", json={"messageId": "m-1", "text": "hello"})
    assert response.status_code == 401

    authed = client.post(
        "/v1/moderate",
        json={"messageId": "m-1", "text": "hello"},
        headers={"Authorization": "Bearer secret"},
    )
    assert authed.status_code == 200


def test_rate_limit_on_moderate() -> None:
    os.environ["RATE_LIMIT_MAX"] = "1"
    os.environ["RATE_LIMIT_WINDOW_MS"] = "60000"
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    first = client.post("/v1/moderate", json={"messageId": "m-1", "text": "first"})
    second = client.post("/v1/moderate", json={"messageId": "m-2", "text": "second"})
    assert first.status_code == 200
    assert second.status_code == 429


def test_chat_events_publish_dashboard_and_overlay() -> None:
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    with client.websocket_connect("/ws?channel=dashboard") as dashboard_ws:
        with client.websocket_connect("/ws?channel=overlay") as overlay_ws:
            response = client.post(
                "/v1/chat-events",
                json={
                    "messageId": "m-42",
                    "platform": "Twitch",
                    "username": "alice",
                    "text": "hello",
                },
            )
            assert response.status_code == 202
            dashboard_payload = dashboard_ws.receive_json()
            overlay_payload = overlay_ws.receive_json()

    assert dashboard_payload["eventType"] == "moderation.result"
    assert dashboard_payload["messageId"] == "m-42"
    assert overlay_payload["eventType"] == "overlay.message"
    assert overlay_payload["type"] == "chat.message"
    assert overlay_payload["status"] == "approved"
    assert overlay_payload["actor"]["displayName"] == "alice"
    assert overlay_payload["payload"]["message"] == "hello"
    assert overlay_payload["messageId"] == "m-42"


def test_chat_events_do_not_publish_blocked_messages_to_overlay() -> None:
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    with client.websocket_connect("/ws?channel=dashboard") as dashboard_ws:
        response = client.post(
            "/v1/chat-events",
            json={
                "messageId": "m-block",
                "platform": "Twitch",
                "username": "alice",
                "text": "blocked",
                "verdict": "block",
            },
        )
        dashboard_payload = dashboard_ws.receive_json()

    assert response.status_code == 202
    assert response.json()["delivered"]["overlay"] == 0
    assert dashboard_payload["eventType"] == "moderation.result"
    assert dashboard_payload["verdict"] == "block"


def test_flagged_messages_publish_to_overlay_when_enabled() -> None:
    os.environ["FORWARD_FLAGS_TO_OVERLAY"] = "true"
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    with client.websocket_connect("/ws?channel=overlay") as overlay_ws:
        response = client.post(
            "/v1/chat-events",
            json={
                "messageId": "m-flag",
                "platform": "YouTube",
                "username": "bob",
                "text": "needs review",
                "verdict": "flag",
            },
        )
        overlay_payload = overlay_ws.receive_json()

    assert response.status_code == 202
    assert overlay_payload["eventType"] == "overlay.message"
    assert overlay_payload["type"] == "chat.message"
    assert overlay_payload["source"] == "youtube"
    assert overlay_payload["payload"]["message"] == "needs review"


def test_override_approve_replays_message_to_overlay() -> None:
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    client.post(
        "/v1/chat-events",
        json={
            "messageId": "m-review",
            "platform": "Twitch",
            "username": "carol",
            "text": "manual approval",
            "verdict": "flag",
        },
    )

    with client.websocket_connect("/ws?channel=overlay") as overlay_ws:
        response = client.post(
            "/v1/overrides",
            json={
                "messageId": "m-review",
                "action": "approve",
                "operatorId": "mod-1",
                "reason": "safe after review",
            },
        )
        overlay_payload = overlay_ws.receive_json()

    assert response.status_code == 202
    assert overlay_payload["type"] == "chat.message"
    assert overlay_payload["verdict"] == "allow"
    assert overlay_payload["manualOverride"]["action"] == "approve"


def test_moderation_queue_and_health_include_state() -> None:
    app = create_app(moderation_provider=FakeProvider())
    client = TestClient(app)

    client.post(
        "/v1/chat-events",
        json={
            "messageId": "m-queue",
            "platform": "Twitch",
            "username": "dave",
            "text": "queue me",
            "verdict": "flag",
        },
    )

    queue = client.get("/api/moderation/queue")
    health = client.get("/healthz")

    assert queue.status_code == 200
    assert queue.json()["pending"][0]["messageId"] == "m-queue"
    assert health.status_code == 200
    assert health.json()["queues"]["pending"] == 1
    assert health.json()["metrics"]["flaggedMessages"] == 1
