import crypto from "node:crypto";

function createMockProvider() {
  return {
    name: "mock",
    async moderate(payload) {
      return {
        messageId: payload?.messageId || crypto.randomUUID(),
        verdict: "allow",
        confidence: 1,
        category: "safe",
        reason: "placeholder-verdict",
        latencyMs: 1,
      };
    },
  };
}

function extractFirstJsonObject(input) {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  const candidate = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeVerdict(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "allow" || normalized === "flag" || normalized === "block") return normalized;
  return "flag";
}

function createOllamaProvider({
  baseUrl,
  model,
  timeoutMs = 6000,
  fetchImpl = fetch,
  logger = console,
}) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/generate`;

  return {
    name: "ollama",
    async moderate(payload) {
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const systemPrompt =
        "You are a strict chat moderation classifier. Return only valid JSON with keys: verdict, confidence, category, reason.";
      const userPrompt = JSON.stringify(
        {
          platform: payload?.platform || "unknown",
          username: payload?.username || "unknown",
          text: payload?.text || "",
        },
        null,
        2,
      );

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            stream: false,
            format: "json",
            prompt: `${systemPrompt}\n\nInput:\n${userPrompt}`,
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama request failed with ${response.status}`);
        }

        const body = await response.json();
        const parsed = extractFirstJsonObject(body?.response);
        if (!parsed) {
          throw new Error("Ollama response did not contain valid JSON result");
        }

        return {
          messageId: payload?.messageId || crypto.randomUUID(),
          verdict: normalizeVerdict(parsed.verdict),
          confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.5,
          category: String(parsed.category || "unknown"),
          reason: String(parsed.reason || "model-response"),
          latencyMs: Date.now() - start,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createModerationProvider({
  provider = process.env.LLM_PROVIDER || "mock",
  logger = console,
  fetchImpl = fetch,
  baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  model = process.env.OLLAMA_MODEL || "qwen2.5:7b",
  timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS || "6000", 10),
} = {}) {
  if (provider.toLowerCase() === "ollama") {
    logger.info(
      `Using ollama moderation provider (${model}) at ${baseUrl}, timeout ${timeoutMs}ms`,
    );
    return createOllamaProvider({ baseUrl, model, timeoutMs, fetchImpl, logger });
  }

  logger.info("Using mock moderation provider.");
  return createMockProvider();
}
