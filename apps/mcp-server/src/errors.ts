export type McpErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "MCP_OAUTH_NOT_CONFIGURED"
  | "OBJECT_NOT_FOUND";

export class OpenKBMcpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function toJsonError(error: unknown): {
  statusCode: number;
  payload: Record<string, unknown>;
} {
  if (error instanceof OpenKBMcpError) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    };
  }

  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return {
      statusCode: error.statusCode,
      payload: {
        error: error.code,
        message: error.message
      }
    };
  }

  throw error;
}
