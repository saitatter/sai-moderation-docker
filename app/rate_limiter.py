from __future__ import annotations

import time


class RequestLimiter:
    def __init__(self, window_ms: int = 10_000, max_requests: int = 60) -> None:
        self.window_ms = window_ms
        self.max_requests = max_requests
        self._buckets: dict[str, tuple[int, int]] = {}

    def is_allowed(self, key: str) -> bool:
        now_ms = int(time.time() * 1000)
        bucket = self._buckets.get(key)
        if bucket is None:
            self._buckets[key] = (now_ms, 1)
            return True

        window_start, count = bucket
        if now_ms - window_start >= self.window_ms:
            self._buckets[key] = (now_ms, 1)
            return True

        if count >= self.max_requests:
            return False

        self._buckets[key] = (window_start, count + 1)
        return True
