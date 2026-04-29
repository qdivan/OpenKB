export type ContentErrorCode =
  | "INVALID_INPUT"
  | "INVITATION_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "SHARE_LINK_NOT_FOUND"
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
