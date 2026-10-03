export type IngestErrorCode =
  | "unsupported_file" // wrong extension → HTTP 400
  | "unreadable_file" // corrupt CSV/XLSX → HTTP 400
  | "unknown_source" // explicit sourceId has no parser → HTTP 400
  | "bad_input" // e.g. malformed period → HTTP 400
  | "unrecognized_file"; // no parser accepts the file → HTTP 422

/** Errors the caller can show to the user as-is. */
export class IngestError extends Error {
  constructor(
    public readonly code: IngestErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IngestError";
  }

  get httpStatus(): number {
    return this.code === "unrecognized_file" ? 422 : 400;
  }
}
