/**
 * A zustand `persist` migrate that keeps the stored state as it is.
 *
 * zustand only calls `migrate` when the stored version differs from the
 * store's `version`; without one it logs an error and starts from defaults,
 * silently discarding the user's data. Passing this keeps every stored field,
 * including fields this build doesn't know, so:
 *
 *   - a payload written by an OLDER build loads unchanged, and
 *   - a payload written by a NEWER build (a rollback) loads without loss and
 *     is written back with its extra fields intact.
 *
 * Non-object payloads (corrupted storage) fall back to the store's defaults.
 */
export function passThroughMigrate<T>(persisted: unknown): T {
  if (persisted && typeof persisted === "object" && !Array.isArray(persisted)) {
    return persisted as T;
  }
  return {} as T;
}
