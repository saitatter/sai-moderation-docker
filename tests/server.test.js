import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createModerationServer } from "../src/server.js";

let app = null;

afterEach(async () => {
  if (app) {
    await app.stop();
    app = null;
  }
});

describe("moderation server", () => {
  const previousApiToken = process.env.API_TOKEN;
  const previousRateLimitMax = process.env.RATE_LIMIT_MAX;
  const previousRateLimitWindowMs = process.env.RATE_LIMIT_WINDOW_MS;

  afterEach(() => {
    resetEnv("API_TOKEN", previousApiToken);
    resetEnv("RATE_LIMIT_MAX", previousRateLimitMax);
    resetEnv("RATE_LIMIT_WINDOW_MS", previousRateLimitWindowMs);
  });

  it("returns health payload", async () => {
    app = createModerationServer({ logger: { info() {}, error() {} } });
    const port = await app.start(0);

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.metrics).toBeTruthy();
  });

  it("serves dashboard page", async () => {
    app = createModerationServer({ logger: { info() {}, error() {} } });
    const port = await app.start(0);

    const response = await fetch(`http://127.0.0.1:${port}/dashboard`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("SAI Moderation Dashboard");
  });

  it("publishes dashboard events to websocket subscribers", async () => {
    app = createModerationServer({ logger: { info() {}, error() {} } });
    const port = await app.start(0);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?channel=dashboard`);
    await onceOpen(ws);

    const receivePromise = onceMessage(ws);

    const publishResponse = await fetch(`http://127.0.0.1:${port}/v1/events/dashboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "moderation.result",
        messageId: "m-1",
      }),
    });
    const publishBody = await publishResponse.json();
    const received = await receivePromise;

    expect(publishResponse.status).toBe(202);
    expect(publishBody.delivered).toBeGreaterThanOrEqual(1);
    expect(received).toEqual({
      eventType: "moderation.result",
      messageId: "m-1",
    });

    ws.close();
  });

  it("returns moderation response from configured provider", async () => {
    app = createModerationServer({
      logger: { info() {}, error() {} },
      moderationProvider: {
        async moderate(payload) {
          return {
            messageId: payload.messageId || "m-test",
            verdict: "block",
            confidence: 0.91,
            category: "toxicity",
            reason: "test-provider",
            latencyMs: 12,
          };
        },
      },
    });
    const port = await app.start(0);

    const response = await fetch(`http://127.0.0.1:${port}/v1/moderate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "m-42", text: "x" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      messageId: "m-42",
      verdict: "block",
      confidence: 0.91,
      category: "toxicity",
      reason: "test-provider",
      latencyMs: 12,
    });
  });

  it("rejects protected endpoints without token when API_TOKEN is set", async () => {
    process.env.API_TOKEN = "secret-token";
    app = createModerationServer({
      logger: { info() {}, error() {} },
    });
    const port = await app.start(0);

    const response = await fetch(`http://127.0.0.1:${port}/v1/moderate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "m-1", text: "hello" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("applies rate limit on /v1/moderate", async () => {
    process.env.RATE_LIMIT_MAX = "1";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    app = createModerationServer({
      logger: { info() {}, error() {} },
      moderationProvider: {
        async moderate(payload) {
          return {
            messageId: payload?.messageId || "m",
            verdict: "allow",
            confidence: 1,
            category: "safe",
            reason: "ok",
            latencyMs: 1,
          };
        },
      },
    });
    const port = await app.start(0);

    const first = await fetch(`http://127.0.0.1:${port}/v1/moderate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "m-1", text: "hello" }),
    });
    const second = await fetch(`http://127.0.0.1:${port}/v1/moderate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "m-2", text: "hello" }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 3_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function resetEnv(key, value) {
  if (value == null) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function onceMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket message timeout")), 3_000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
