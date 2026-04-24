from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx


def _extract_first_json_object(text: str) -> dict[str, Any] | None:
    if not isinstance(text, str) or not text.strip():
        return None

    trimmed = text.strip()
    try:
        parsed = json.loads(trimmed)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    start = trimmed.find("{")
    end = trimmed.rfind("}")
    if start < 0 or end <= start:
        return None

    candidate = trimmed[start : end + 1]
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _normalize_verdict(value: Any) -> str:
    normalized = str(value or "").lower()
    if normalized in {"allow", "flag", "block"}:
        return normalized
    return "flag"


@dataclass(slots=True)
class ModerationProvider:
    name: str

    async def moderate(self, payload: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class MockModerationProvider(ModerationProvider):
    def __init__(self) -> None:
        super().__init__(name="mock")

    async def moderate(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "messageId": payload.get("messageId") or str(uuid.uuid4()),
            "verdict": "allow",
            "confidence": 1.0,
            "category": "safe",
            "reason": "placeholder-verdict",
            "latencyMs": 1,
        }


class OllamaModerationProvider(ModerationProvider):
    def __init__(self, base_url: str, model: str, timeout_ms: int) -> None:
        super().__init__(name="ollama")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_ms = timeout_ms

    async def moderate(self, payload: dict[str, Any]) -> dict[str, Any]:
        started = time.perf_counter()
        prompt_payload = {
            "platform": payload.get("platform", "unknown"),
            "username": payload.get("username", "unknown"),
            "text": payload.get("text", ""),
        }
        system_prompt = (
            "You are a strict chat moderation classifier. "
            "Return only valid JSON with keys: verdict, confidence, category, reason."
        )

        async with httpx.AsyncClient(timeout=self.timeout_ms / 1000) as client:
            response = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "stream": False,
                    "format": "json",
                    "prompt": f"{system_prompt}\n\nInput:\n{json.dumps(prompt_payload, ensure_ascii=False)}",
                },
            )
            response.raise_for_status()
            body = response.json()

        parsed = _extract_first_json_object(body.get("response", ""))
        if parsed is None:
            raise ValueError("Ollama response did not contain a valid JSON object.")

        latency_ms = int((time.perf_counter() - started) * 1000)
        confidence_raw = parsed.get("confidence")
        confidence = float(confidence_raw) if isinstance(confidence_raw, (int, float)) else 0.5

        return {
            "messageId": payload.get("messageId") or str(uuid.uuid4()),
            "verdict": _normalize_verdict(parsed.get("verdict")),
            "confidence": confidence,
            "category": str(parsed.get("category") or "unknown"),
            "reason": str(parsed.get("reason") or "model-response"),
            "latencyMs": latency_ms,
        }


def create_moderation_provider() -> ModerationProvider:
    provider_name = os.getenv("LLM_PROVIDER", "mock").lower()
    if provider_name == "ollama":
        return OllamaModerationProvider(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            model=os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
            timeout_ms=int(os.getenv("LLM_TIMEOUT_MS", "6000")),
        )

    return MockModerationProvider()
