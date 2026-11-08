function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * A zustand `persist` migrate that keeps the stored state as it is.
 *
 * zustand only calls `migrate` when the stored version differs from the
 * store's `version`; without one it logs an error and starts from defaults,
 * silently discarding the user's data. Passing this keeps every stored field,
 * including fields this build doesn't know, so:
 *
 *   - a payload written by an OLDER build loads unchanged, and
 *   - a payload written by a NEWER build (a rollback) loads without losing any
 *     field and is written back with its extra fields intact.
 *
 * The version marker is NOT preserved: after a migrate zustand writes the
 * payload back stamped with this build's version (0). When a newer build
 * rolls forward again it sees version 0 and re-runs its migrations on data
 * that may already be in its shape, so every later migration must detect
 * shape rather than trust the version (fill fields only when absent, never
 * reset or recompute them in a way that loses data).
 *
 * Non-object payloads written by a different version are ignored (an empty
 * object is returned, which `mergePersisted` then merges as nothing).
 */
export function passThroughMigrate<T>(persisted: unknown): T {
  if (isPlainObject(persisted)) return persisted as T;
  return {} as T;
}

/**
 * A zustand `persist` merge that ignores a non-object persisted state.
 *
 * zustand's default merge spreads the persisted state over the current one,
 * so a corrupted same-version payload such as `{ state: "garbage" }` (which
 * never reaches `migrate`) would scatter keys "0", "1", ... over the store.
 * This keeps the current state instead.
 */
export function mergePersisted<T>(persisted: unknown, current: T): T {
  if (!isPlainObject(persisted)) return current;
  return { ...current, ...persisted };
}
