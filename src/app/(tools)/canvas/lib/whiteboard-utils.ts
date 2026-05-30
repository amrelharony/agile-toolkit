/**
 * Canvas whiteboard — pure helpers extracted from whiteboard-canvas.tsx so they
 * can be unit-tested independently of the (very large) viewport component.
 * `makeActivityId` is pure aside from its use of `crypto` — see
 * test/canvas/whiteboard-utils.test.ts.
 */

/**
 * Collision-resistant id for activity-log entries.
 *
 * The previous `act_${Date.now()}_${Math.random().slice(2,6)}` recipe
 * combined two coarse sources of entropy and could collide under rapid
 * bursts — a multi-paste operation that fires four `appendActivity`s
 * inside the same animation frame has the same Date.now() and only 16⁴
 * = 65 536 random suffixes, so duplicate ids did appear in stress
 * testing. `crypto.randomUUID` is available in every browser we target
 * and in modern Node test environments; we fall back to the wider
 * random suffix only for older runtimes / non-secure contexts.
 */
export function makeActivityId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    // Strip dashes first — `crypto.randomUUID()` returns
    // `xxxxxxxx-xxxx-...` with a guaranteed dash at offset 8, so
    // `.slice(0, 12)` always produced ids like `act_xxxxxxxx-xxx` with
    // an interior dash. Stripping first yields a clean 12-char hex
    // suffix that round-trips through URL params / log filters.
    return `act_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
