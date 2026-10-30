// Branded with a global symbol rather than checked with `instanceof`: in `next dev` the shared
// services (see context.ts) can outlive a module reload, so an error may come from an older
// copy of this class than the one the handler imported.
const BRAND = Symbol.for("opentake.ApiError");

export class ApiError extends Error {
  readonly [BRAND] = true;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(err: unknown): err is ApiError {
  return typeof err === "object" && err !== null && (err as Record<symbol, unknown>)[BRAND] === true;
}

/** zod's error, recognised structurally for the same reason. */
export function isZodError(err: unknown): err is { issues: Array<{ path: PropertyKey[]; message: string }> } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}
