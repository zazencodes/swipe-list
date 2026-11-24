/** A failure the caller can act on. Rendered as {"error": {code, message, details}}. */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 502,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string | number) =>
  new AppError(404, "not_found", `${what} ${id} does not exist`);

export const invalid = (message: string, details?: unknown) => new AppError(422, "invalid", message, details);
