from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from .event_hub import EventHub
from .moderation_provider import ModerationProvider, create_moderation_provider
from .rate_limiter import RequestLimiter

MAX_MODERATION_STATE_ITEMS = 100
MAX_MESSAGE_LOOKUP_ITEMS = 500


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _should_forward_to_overlay(verdict: str, forward_flags: bool) -> bool:
    if verdict == "allow":
        return True
    if verdict == "flag":
        return forward_flags
    return False


def _platform_source(platform: Any) -> str:
    normalized = str(platform or "").strip().lower()
    return normalized or "unknown"


def _build_overlay_chat_event(payload: dict[str, Any], moderation: dict[str, Any]) -> dict[str, Any]:
    message_id = str(moderation.get("messageId") or payload.get("messageId") or "")
    username = str(payload.get("username") or "unknown")
    text = str(payload.get("text") or "")
    platform = str(payload.get("platform") or "unknown")
    received_at = str(payload.get("receivedAt") or _utc_now_iso())

    return {
        "eventType": "overlay.message",
        "messageId": message_id,
        "platform": platform,
        "username": username,
        "text": text,
        "verdict": moderation.get("verdict", "allow"),
        "version": 1,
        "id": message_id,
        "type": "chat.message",
        "source": _platform_source(platform),
        "status": "approved",
        "createdAt": received_at,
        "receivedAt": received_at,
        "actor": {
            "id": str(payload.get("userId") or ""),
            "name": username,
            "displayName": username,
            "badges": payload.get("badges") if isinstance(payload.get("badges"), list) else [],
        },
        "payload": {
            "message": text,
            "emotes": payload.get("emotes") if isinstance(payload.get("emotes"), list) else [],
            "isAction": bool(payload.get("isAction", False)),
            "isFirstMessage": bool(payload.get("isFirstMessage", False)),
        },
        "display": {
            "priority": "normal",
        },
    }


def create_app(moderation_provider: ModerationProvider | None = None) -> FastAPI:
    app = FastAPI(title="SAI Moderation Docker", version="0.1.0")

    event_hub = EventHub()
    provider = moderation_provider or create_moderation_provider()
    api_token = os.getenv("API_TOKEN", "")
    override_forward_url = os.getenv("MANUAL_OVERRIDE_FORWARD_URL", "")
    forward_flags_to_overlay = os.getenv("FORWARD_FLAGS_TO_OVERLAY", "false").lower() == "true"
    limiter = RequestLimiter(
        window_ms=int(os.getenv("RATE_LIMIT_WINDOW_MS", "10000")),
        max_requests=int(os.getenv("RATE_LIMIT_MAX", "60")),
    )

    metrics: dict[str, int] = {
        "moderationRequests": 0,
        "moderationFailures": 0,
        "chatEventsProcessed": 0,
        "eventPublishes": 0,
        "overrideRequests": 0,
        "overrideForwardFailures": 0,
        "unauthorizedRequests": 0,
        "rateLimitedRequests": 0,
        "approvedMessages": 0,
        "blockedMessages": 0,
        "flaggedMessages": 0,
        "manualOverlayPublishes": 0,
    }
    moderation_state: dict[str, Any] = {
        "latest": [],
        "pending": [],
        "approved": [],
        "rejected": [],
        "messagesById": {},
    }

    dashboard_path = Path(__file__).with_name("dashboard.html")

    def _client_key(request: Request) -> str:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    def _ensure_authorized(request: Request) -> None:
        if not api_token:
            return
        auth_header = request.headers.get("authorization", "")
        if auth_header != f"Bearer {api_token}":
            metrics["unauthorizedRequests"] += 1
            raise HTTPException(status_code=401, detail="Unauthorized")

    def _ensure_rate_limit(request: Request) -> None:
        if limiter.is_allowed(_client_key(request)):
            return
        metrics["rateLimitedRequests"] += 1
        raise HTTPException(status_code=429, detail="Too many requests")

    def _remember_capped(target: list[dict[str, Any]], event: dict[str, Any]) -> None:
        target.insert(0, event)
        if len(target) > MAX_MODERATION_STATE_ITEMS:
            target.pop()

    def _remove_message_from_queue(target: list[dict[str, Any]], message_id: Any) -> None:
        target[:] = [event for event in target if event.get("messageId") != message_id]

    def _move_message_to_approved(message_id: Any) -> dict[str, Any] | None:
        entry = moderation_state["messagesById"].get(message_id)
        if not entry:
            return None

        dashboard_event = entry["dashboard"]
        dashboard_event["verdict"] = "allow"
        for queue_name in ["pending", "rejected", "approved"]:
            _remove_message_from_queue(moderation_state[queue_name], message_id)
        _remember_capped(moderation_state["approved"], dashboard_event)
        return dashboard_event

    def _remember_message_lookup(
        message_id: Any,
        dashboard_event: dict[str, Any],
        overlay_event: dict[str, Any],
    ) -> None:
        if not message_id:
            return
        messages_by_id = moderation_state["messagesById"]
        messages_by_id[message_id] = {
            "dashboard": dashboard_event,
            "overlay": overlay_event,
        }
        while len(messages_by_id) > MAX_MESSAGE_LOOKUP_ITEMS:
            oldest_key = next(iter(messages_by_id))
            messages_by_id.pop(oldest_key, None)

    def _remember_event(dashboard_event: dict[str, Any], overlay_event: dict[str, Any]) -> None:
        message_id = dashboard_event.get("messageId")
        verdict = str(dashboard_event.get("verdict", "")).lower()

        _remember_capped(moderation_state["latest"], dashboard_event)
        _remember_message_lookup(message_id, dashboard_event, overlay_event)

        if verdict == "allow":
            _remember_capped(moderation_state["approved"], dashboard_event)
            metrics["approvedMessages"] += 1
        elif verdict == "block":
            _remember_capped(moderation_state["rejected"], dashboard_event)
            metrics["blockedMessages"] += 1
        elif verdict == "flag":
            _remember_capped(moderation_state["pending"], dashboard_event)
            metrics["flaggedMessages"] += 1

    @app.get("/")
    async def root() -> RedirectResponse:
        return RedirectResponse(url="/dashboard", status_code=302)

    @app.get("/dashboard")
    async def dashboard() -> HTMLResponse:
        if not dashboard_path.exists():
            return HTMLResponse("Dashboard unavailable", status_code=500)
        return HTMLResponse(dashboard_path.read_text(encoding="utf8"))

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        return JSONResponse(
            {
                "status": "ok",
                **(await event_hub.get_stats()),
                "metrics": metrics,
                "provider": provider.name,
                "queues": {
                    "latest": len(moderation_state["latest"]),
                    "pending": len(moderation_state["pending"]),
                    "approved": len(moderation_state["approved"]),
                    "rejected": len(moderation_state["rejected"]),
                    "messageLookups": len(moderation_state["messagesById"]),
                },
            }
        )

    @app.get("/api/moderation/queue")
    async def moderation_queue(request: Request) -> JSONResponse:
        _ensure_authorized(request)
        return JSONResponse(
            {
                "latest": moderation_state["latest"],
                "pending": moderation_state["pending"],
                "approved": moderation_state["approved"],
                "rejected": moderation_state["rejected"],
            }
        )

    @app.post("/v1/moderate")
    async def moderate(request: Request) -> JSONResponse:
        _ensure_authorized(request)
        _ensure_rate_limit(request)

        try:
            payload = await request.json()
            metrics["moderationRequests"] += 1
            result = await provider.moderate(payload)
            return JSONResponse(result)
        except HTTPException:
            raise
        except Exception as exc:
            metrics["moderationFailures"] += 1
            return JSONResponse({"error": str(exc) or "Moderation failed"}, status_code=500)

    @app.post("/v1/chat-events")
    async def chat_events(request: Request) -> JSONResponse:
        _ensure_authorized(request)
        _ensure_rate_limit(request)

        try:
            payload: dict[str, Any] = await request.json()
            metrics["chatEventsProcessed"] += 1

            moderation = await provider.moderate(payload)
            dashboard_event = {
                "eventType": "moderation.result",
                "messageId": moderation["messageId"],
                "platform": payload.get("platform", "unknown"),
                "username": payload.get("username", "unknown"),
                "text": payload.get("text", ""),
                "verdict": moderation["verdict"],
                "confidence": moderation.get("confidence", 0.5),
                "category": moderation.get("category", "unknown"),
                "reason": moderation.get("reason", "model-response"),
                "receivedAt": payload.get("receivedAt") or _utc_now_iso(),
            }
            overlay_event = _build_overlay_chat_event(
                {**payload, "receivedAt": dashboard_event["receivedAt"]},
                moderation,
            )
            _remember_event(dashboard_event, overlay_event)
            dashboard_delivered = await event_hub.publish("dashboard", dashboard_event)
            metrics["eventPublishes"] += 1

            overlay_delivered = 0
            if _should_forward_to_overlay(moderation["verdict"], forward_flags_to_overlay):
                overlay_delivered = await event_hub.publish("overlay", overlay_event)
                metrics["eventPublishes"] += 1

            return JSONResponse(
                {
                    "accepted": True,
                    "moderation": moderation,
                    "delivered": {
                        "dashboard": dashboard_delivered,
                        "overlay": overlay_delivered,
                    },
                },
                status_code=202,
            )
        except HTTPException:
            raise
        except Exception as exc:
            metrics["moderationFailures"] += 1
            return JSONResponse({"error": str(exc) or "Chat event processing failed"}, status_code=500)

    @app.post("/v1/events/{channel}")
    async def publish_event(channel: str, request: Request) -> JSONResponse:
        _ensure_authorized(request)
        if not event_hub.is_supported_channel(channel):
            raise HTTPException(status_code=404, detail="Unsupported channel")

        payload = await request.json()
        delivered = await event_hub.publish(channel, payload)
        metrics["eventPublishes"] += 1
        return JSONResponse({"accepted": True, "channel": channel, "delivered": delivered}, status_code=202)

    @app.post("/v1/overrides")
    async def overrides(request: Request) -> JSONResponse:
        _ensure_authorized(request)

        try:
            payload = await request.json()
            metrics["overrideRequests"] += 1

            message_id = payload.get("messageId", "")
            action = payload.get("action", "")
            operator_id = payload.get("operatorId", "")
            reason = payload.get("reason", "")

            if not all(isinstance(value, str) and value for value in [message_id, action, operator_id, reason]):
                return JSONResponse({"error": "Invalid override payload"}, status_code=400)

            await event_hub.publish(
                "dashboard",
                {
                    "eventType": "moderation.override.requested",
                    "messageId": message_id,
                    "action": action,
                    "operatorId": operator_id,
                    "reason": reason,
                    "requestedAt": _utc_now_iso(),
                },
            )
            metrics["eventPublishes"] += 1

            if action in {"approve", "falsePositive"} and message_id in moderation_state["messagesById"]:
                dashboard_event = _move_message_to_approved(message_id)
                if dashboard_event:
                    await event_hub.publish("dashboard", dashboard_event)
                    metrics["eventPublishes"] += 1

                overlay_event = dict(moderation_state["messagesById"][message_id]["overlay"])
                overlay_event["verdict"] = "allow"
                overlay_event["status"] = "approved"
                overlay_event["manualOverride"] = {
                    "action": action,
                    "operatorId": operator_id,
                    "reason": reason,
                    "requestedAt": _utc_now_iso(),
                }
                await event_hub.publish("overlay", overlay_event)
                metrics["eventPublishes"] += 1
                metrics["manualOverlayPublishes"] += 1

            if override_forward_url:
                headers = {"Content-Type": "application/json"}
                if api_token:
                    headers["Authorization"] = f"Bearer {api_token}"

                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        await client.post(override_forward_url, headers=headers, json=payload)
                except Exception:
                    metrics["overrideForwardFailures"] += 1

            return JSONResponse({"accepted": True}, status_code=202)
        except HTTPException:
            raise
        except Exception:
            return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    @app.websocket("/ws")
    async def websocket_events(websocket: WebSocket) -> None:
        channel = websocket.query_params.get("channel", "")
        token = websocket.query_params.get("token", "")

        if not event_hub.is_supported_channel(channel):
            await websocket.close(code=1008)
            return
        if api_token and token != api_token:
            await websocket.close(code=1008)
            return

        await websocket.accept()
        await event_hub.subscribe(channel, websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await event_hub.unsubscribe(channel, websocket)

    return app


app = create_app()
