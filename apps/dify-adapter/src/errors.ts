export type DifyErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_API_KEY"
  | "KNOWLEDGE_NOT_FOUND"
  | "KNOWLEDGE_SCOPE_FORBIDDEN"
  | "SEARCH_INDEX_NOT_READY"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

const difyErrorPayloadCodes: Record<DifyErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 1001,
  INVALID_API_KEY: 1002,
  KNOWLEDGE_NOT_FOUND: 2001,
  KNOWLEDGE_SCOPE_FORBIDDEN: 2002,
  SEARCH_INDEX_NOT_READY: 3001,
  INVALID_REQUEST: 4001,
  INTERNAL_ERROR: 5001
};

export class DifyAdapterError extends Error {
  constructor(
    public readonly code: DifyErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }

  toResponseBody() {
    return {
      error_code: difyErrorPayloadCodes[this.code],
      error_msg: this.message
    };
  }
}
