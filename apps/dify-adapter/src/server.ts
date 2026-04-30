import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { getDifyAdapterHealth } from "./health";
import { DifyAdapterError } from "./errors";
import { DifyAdapterService } from "./service";

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
        const body = await readJsonBody(request);
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
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
