import type { RefObject, MutableRefObject } from "react";

/**
 * Atomic z-claim helpers for the canvas's `topZRef`.
 *
 * The bug they fix: object-creation paths that read `topZRef.current + 1`
 * without mutating the ref. When several creates fire synchronously (a
 * paste of N items, an AI brainstorm batch, two quick drag-to-creates in
 * the same tick) the topZRef useEffect updater hasn't run yet, so each
 * read returns the SAME `current + 1` value — every new object gets the
 * same z, producing unpredictable stacking order until the effect
 * eventually catches up.
 *
 * `claimNextZ` mutates the ref as it returns the value, so back-to-back
 * synchronous claims are guaranteed unique and monotonically increasing.
 * `claimZRange` reserves N contiguous z-values in one go for batch creates.
 */

type AnyRef<T> = RefObject<T> | MutableRefObject<T>;

export function claimNextZ(ref: AnyRef<number>): number {
  const next = (ref.current ?? 0) + 1;
  (ref as MutableRefObject<number>).current = next;
  return next;
}

export function claimZRange(ref: AnyRef<number>, count: number): number {
  if (count <= 0) return (ref.current ?? 0) + 1;
  const base = (ref.current ?? 0) + 1;
  (ref as MutableRefObject<number>).current = base + count - 1;
  return base;
}
