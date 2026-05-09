export type ContentErrorCode =
  | "ASSET_NOT_FOUND"
  | "CONVERTER_UNAVAILABLE"
  | "INVALID_INPUT"
  | "IMPORT_JOB_NOT_FOUND"
  | "INVITATION_NOT_FOUND"
  | "MARKDOWN_DIALECT_ERROR"
  | "OBJECT_NOT_FOUND"
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
