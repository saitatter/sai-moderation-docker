import { describe, expect, it, vi } from "vitest";
import { createModerationProvider } from "../src/moderationProvider.js";

describe("moderation provider", () => {
  it("uses mock provider by default", async () => {
    const provider = createModerationProvider({
      logger: { info() {} },
      provider: "mock",
    });

    const result = await provider.moderate({ messageId: "m-1" });

    expect(result.messageId).toBe("m-1");
    expect(result.verdict).toBe("allow");
    expect(result.category).toBe("safe");
  });

  it("parses ollama response payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
          response: JSON.stringify({
            verdict: "block",
            confidence: 0.84,
            category: "toxicity",
            reason: "insult",
          }),
        };
      },
    });
    const provider = createModerationProvider({
      logger: { info() {} },
      provider: "ollama",
      fetchImpl,
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5:7b",
      timeoutMs: 1000,
    });

    const result = await provider.moderate({ messageId: "m-2", text: "bad words" });

    expect(result.messageId).toBe("m-2");
    expect(result.verdict).toBe("block");
    expect(result.category).toBe("toxicity");
    expect(result.reason).toBe("insult");
  });
});
