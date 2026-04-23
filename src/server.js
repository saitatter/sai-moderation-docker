import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { URL, fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createEventHub } from "./eventHub.js";
import { createModerationProvider } from "./moderationProvider.js";

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
      json(res, 200, { status: "ok", ...eventHub.getStats() });
      return;
    }

    if (req.method === "POST" && parsed.pathname === "/v1/moderate") {
      try {
        const body = await readJsonBody(req);
        const moderationResponse = await provider.moderate(body);
        json(res, 200, moderationResponse);
      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.error("Invalid moderation request body", error);
          json(res, 400, { error: "Invalid JSON body" });
        } else {
          logger.error("Moderation request failed", error);
          json(res, 500, { error: "Moderation failed" });
        }
      }
      return;
    }

    if (req.method === "POST" && parsed.pathname.startsWith("/v1/events/")) {
      const channel = parsed.pathname.replace("/v1/events/", "");
      if (!eventHub.isSupportedChannel(channel)) {
        json(res, 404, { error: "Unsupported channel" });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const delivered = eventHub.publish(channel, body);
        json(res, 202, { accepted: true, channel, delivered });
      } catch (error) {
        logger.error("Invalid event body", error);
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
