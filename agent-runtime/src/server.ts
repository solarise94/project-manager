import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRuntimeConfig } from "./config.js";
import { compactConversation, streamChat } from "./pi-runtime.js";
import type { RuntimeChatStreamRequest, RuntimeCompactRequest } from "./types.js";

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function openNdjson(res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    throw new Error("Request body is required");
  }
  return JSON.parse(raw) as T;
}

function isAuthorized(req: IncomingMessage, token: string) {
  return req.headers["x-agent-runtime-token"] === token;
}

const config = getRuntimeConfig();
const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true, service: "scimanage-agent-runtime" });
    }

    if (!isAuthorized(req, config.token)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    if (req.method === "POST" && req.url === "/chat-stream") {
      const payload = await readJson<RuntimeChatStreamRequest>(req);
      openNdjson(res);
      await streamChat(payload, (event) => {
        res.write(`${JSON.stringify(event)}\n`);
      });
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/chat-compact") {
      const payload = await readJson<RuntimeCompactRequest>(req);
      return sendJson(res, 200, { ok: true, ...await compactConversation(payload) });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runtime error";
    if (!res.headersSent) {
      return sendJson(res, 500, { error: message });
    }
    res.end(JSON.stringify({ type: "error", error: message }));
  }
});

server.listen(config.port, config.host, () => {
  console.log(`scimanage-agent-runtime listening on http://${config.host}:${config.port}`);
});
