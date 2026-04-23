import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { URL, fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createEventHub } from "./eventHub.js";
import { createModerationProvider } from "./moderationProvider.js";
import { createRequestLimiter } from "./requestLimiter.js";

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function html(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createModerationServer({ logger = console, moderationProvider = null } = {}) {
  const eventHub = createEventHub();
  const wss = new WebSocketServer({ noServer: true });
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const dashboardPath = path.join(currentDir, "dashboard.html");
  const provider = moderationProvider || createModerationProvider({ logger });
  const apiToken = process.env.API_TOKEN || "";
  const overrideForwardUrl = process.env.MANUAL_OVERRIDE_FORWARD_URL || "";
  const requestLimiter = createRequestLimiter({
    windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "10000", 10),
    maxRequests: Number.parseInt(process.env.RATE_LIMIT_MAX || "60", 10),
  });
  const metrics = {
    moderationRequests: 0,
    moderationFailures: 0,
    eventPublishes: 0,
    overrideRequests: 0,
    overrideForwardFailures: 0,
    unauthorizedRequests: 0,
    rateLimitedRequests: 0,
  };

  function getClientKey(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor) return forwardedFor.split(",")[0].trim();
    return req.socket.remoteAddress || "unknown";
  }

  function isAuthorized(req) {
    if (!apiToken) return true;
    const auth = req.headers.authorization || "";
    return auth === `Bearer ${apiToken}`;
  }

  function denyUnauthorized(res) {
    metrics.unauthorizedRequests += 1;
    json(res, 401, { error: "Unauthorized" });
  }

  function denyRateLimited(res) {
    metrics.rateLimitedRequests += 1;
    json(res, 429, { error: "Too many requests" });
  }

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url || "/", "http://localhost");

    if (req.method === "GET" && parsed.pathname === "/") {
      res.writeHead(302, { Location: "/dashboard" });
      res.end();
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/dashboard") {
      try {
        const dashboardHtml = await readFile(dashboardPath, "utf8");
        html(res, 200, dashboardHtml);
      } catch (error) {
        logger.error("Failed to load dashboard HTML", error);
        json(res, 500, { error: "Dashboard unavailable" });
      }
      return;
    }

    if (req.method === "GET" && parsed.pathname === "/healthz") {
      json(res, 200, { status: "ok", ...eventHub.getStats(), metrics });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/v1/moderate") {
      if (!isAuthorized(req)) {
        denyUnauthorized(res);
        return;
      }
      if (!requestLimiter.isAllowed(getClientKey(req))) {
        denyRateLimited(res);
        return;
      }

      try {
        metrics.moderationRequests += 1;
        const body = await readJsonBody(req);
        const moderationResponse = await provider.moderate(body);
        json(res, 200, moderationResponse);
      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.error("Invalid moderation request body", error);
          json(res, 400, { error: "Invalid JSON body" });
        } else {
          metrics.moderationFailures += 1;
          logger.error("Moderation request failed", error);
          json(res, 500, { error: "Moderation failed" });
        }
      }
      return;
    }

    if (req.method === "POST" && parsed.pathname.startsWith("/v1/events/")) {
      if (!isAuthorized(req)) {
        denyUnauthorized(res);
        return;
      }
      const channel = parsed.pathname.replace("/v1/events/", "");
      if (!eventHub.isSupportedChannel(channel)) {
        json(res, 404, { error: "Unsupported channel" });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const delivered = eventHub.publish(channel, body);
        metrics.eventPublishes += 1;
        json(res, 202, { accepted: true, channel, delivered });
      } catch (error) {
        logger.error("Invalid event body", error);
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/v1/overrides") {
      if (!isAuthorized(req)) {
        denyUnauthorized(res);
        return;
      }

      try {
        metrics.overrideRequests += 1;
        const body = await readJsonBody(req);
        const messageId = typeof body?.messageId === "string" ? body.messageId : "";
        const action = typeof body?.action === "string" ? body.action : "";
        const operatorId = typeof body?.operatorId === "string" ? body.operatorId : "";
        const reason = typeof body?.reason === "string" ? body.reason : "";

        if (!messageId || !action || !operatorId || !reason) {
          json(res, 400, { error: "Invalid override payload" });
          return;
        }

        eventHub.publish("dashboard", {
          eventType: "moderation.override.requested",
          messageId,
          action,
          operatorId,
          reason,
          requestedAt: new Date().toISOString(),
        });

        if (overrideForwardUrl) {
          try {
            await fetch(overrideForwardUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
              },
              body: JSON.stringify({ messageId, action, operatorId, reason }),
            });
          } catch (error) {
            metrics.overrideForwardFailures += 1;
            logger.error("Failed to forward override callback", error);
          }
        }

        json(res, 202, { accepted: true });
      } catch (error) {
        logger.error("Invalid override body", error);
        json(res, 400, { error: "Invalid JSON body" });
      }
      return;
    }

    json(res, 404, { error: "Not found" });
  });

  server.on("upgrade", (req, socket, head) => {
    const parsed = new URL(req.url || "/", "http://localhost");
    if (parsed.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    if (apiToken) {
      const token = parsed.searchParams.get("token") || "";
      if (token !== apiToken) {
        socket.destroy();
        return;
      }
    }

    const channel = parsed.searchParams.get("channel") || "";
    if (!eventHub.isSupportedChannel(channel)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!eventHub.subscribe(channel, ws)) {
        ws.close();
      }
    });
  });

  async function start(port = 8787) {
    await new Promise((resolve) => server.listen(port, resolve));
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    logger.info(`sai-moderation-docker listening on :${actualPort}`);
    return actualPort;
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    start,
    stop,
    server,
    eventHub,
  };
}
