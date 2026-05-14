export type ContentErrorCode =
  | "ASSET_NOT_FOUND"
  | "CONVERTER_UNAVAILABLE"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "IMPORT_JOB_NOT_FOUND"
  | "INVITATION_NOT_FOUND"
  | "MARKDOWN_DIALECT_ERROR"
  | "MODEL_NOT_CONFIGURED"
  | "MODEL_REQUEST_FAILED"
  | "MODEL_RESPONSE_INVALID"
  | "MODEL_SECRET_UNAVAILABLE"
  | "EMBEDDING_DIM_MISMATCH"
  | "OBJECT_NOT_FOUND"
  | "REPROCESS_REQUIRED"
  | "SHARE_PASSWORD_REQUIRED"
  | "SHARE_LINK_NOT_FOUND"
  | "STORAGE_ERROR"
  | "VERSION_CONFLICT";

export type ContentErrorDetails = Record<string, unknown>;

export class ContentError extends Error {
  constructor(
    public readonly code: ContentErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: ContentErrorDetails
  ) {
    super(message);
  }
}
