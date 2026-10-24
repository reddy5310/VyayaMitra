/** Validation failures from `@/db/actions` carry a message written for the user. */
export function isValidationError(e: unknown): e is Error {
  return e instanceof Error && e.name === 'ValidationError';
}

/** A human message for any thrown value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Nothing was changed.';
}
