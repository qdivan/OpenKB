import { AuthError } from "@openkb/auth";
import { MilvusError } from "@openkb/milvus";
import { ModelClientError } from "@openkb/model-client";
import { PermissionError } from "@openkb/permissions";
import { RetrievalError } from "@openkb/retrieval";

import { ContentError } from "../content/errors";

export type JsonReply = {
  code: (statusCode: number) => JsonReply;
  header: (name: string, value: string) => JsonReply;
};

export function setCookie(reply: JsonReply, cookie: string) {
  reply.header("set-cookie", cookie);
}

export function sendJsonError(error: unknown, reply: JsonReply) {
  if (
    error instanceof AuthError ||
    error instanceof MilvusError ||
    error instanceof ModelClientError ||
    error instanceof PermissionError ||
    error instanceof RetrievalError ||
    error instanceof ContentError
  ) {
    reply.code(error.statusCode);
    const payload: { error: string; message: string; details?: unknown } = {
      error: error.code,
      message: error.message
    };
    const details = (error as { details?: unknown }).details;
    if (details !== undefined) {
      payload.details = details;
    }

    return payload;
  }

  throw error;
}
