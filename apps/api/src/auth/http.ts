import { AuthError } from "@openkb/auth";
import { PermissionError } from "@openkb/permissions";

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
    error instanceof PermissionError ||
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
