from __future__ import annotations

import asyncio
from collections.abc import Iterable

from fastapi import WebSocket


class EventHub:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[WebSocket]] = {
            "dashboard": set(),
            "overlay": set(),
        }
        self._lock = asyncio.Lock()

    def is_supported_channel(self, channel: str) -> bool:
        return channel in self._subscribers

    async def subscribe(self, channel: str, websocket: WebSocket) -> bool:
        if not self.is_supported_channel(channel):
            return False
        async with self._lock:
            self._subscribers[channel].add(websocket)
        return True

    async def unsubscribe(self, channel: str, websocket: WebSocket) -> None:
        async with self._lock:
            if channel in self._subscribers:
                self._subscribers[channel].discard(websocket)

    async def publish(self, channel: str, payload: dict) -> int:
        if not self.is_supported_channel(channel):
            return 0

        async with self._lock:
            recipients: Iterable[WebSocket] = list(self._subscribers[channel])

        delivered = 0
        stale: list[WebSocket] = []

        for websocket in recipients:
            try:
                await websocket.send_json(payload)
                delivered += 1
            except Exception:
                stale.append(websocket)

        if stale:
            async with self._lock:
                for websocket in stale:
                    self._subscribers[channel].discard(websocket)

        return delivered

    async def get_stats(self) -> dict[str, int]:
        async with self._lock:
            return {
                "dashboardSubscribers": len(self._subscribers["dashboard"]),
                "overlaySubscribers": len(self._subscribers["overlay"]),
            }
