import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { getDifyAdapterHealth } from "./health";
import { DifyAdapterError } from "./errors";
import { DifyAdapterService } from "./service";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
} as const;

export function createDifyAdapterHttpServer(
  service: DifyAdapterService = new DifyAdapterService()
) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        writeJson(response, 200, getDifyAdapterHealth());
        return;
      }

      if (request.method === "POST" && request.url === "/retrieval") {
        const body = await readJsonBody(request, getRequestMaxBytes());
        const result = await service.retrieve(request.headers.authorization, body, {
          ip: request.socket.remoteAddress,
          userAgent: request.headers["user-agent"] ?? null
        });
        writeJson(response, 200, result);
        return;
      }

      writeJson(response, 404, { error_code: 404, error_msg: "Not found." });
    } catch (error) {
      if (!(error instanceof DifyAdapterError)) {
        console.error("[openkb:dify-adapter] request failed", error);
      }
      const adapterError =
        error instanceof DifyAdapterError
          ? error
          : new DifyAdapterError("INTERNAL_ERROR", "Dify adapter request failed.", 500);
      writeJson(response, adapterError.statusCode, adapterError.toResponseBody());
    }
  });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json", ...SECURITY_HEADERS });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new DifyAdapterError("INVALID_REQUEST", "Request body is too large.", 413);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new DifyAdapterError("INVALID_REQUEST", "Request body is too large.", 413);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    throw new DifyAdapterError("INVALID_REQUEST", "Request body is required.", 400);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new DifyAdapterError("INVALID_REQUEST", "Request body must be valid JSON.", 400);
  }
}

function getRequestMaxBytes(): number {
  const parsed = Number.parseInt(process.env.DIFY_REQUEST_MAX_BYTES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024 * 1024;
}
