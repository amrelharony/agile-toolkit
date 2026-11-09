/**
 * What has Amr's eye. On a desktop he follows the cursor; on a touch screen
 * there is no cursor, so until now he looked at nothing at all. Here the things
 * worth a look each say where they are, and the one that matters most right now
 * wins: a finger on the screen, then the field the visitor has just stepped
 * into, then the way the page is being scrolled. Each fades after a moment and
 * he faces the visitor again.
 *
 * (The cursor and the phone's tilt are read by the sprite itself and come first;
 * this is what he looks at when neither has his eye.)
 *
 * Pure apart from the clock, which is passed in.
 */

export type AttentionSource = "touch" | "focus" | "scroll";

/** Higher wins while it lasts. */
const PRIORITY: Record<AttentionSource, number> = { touch: 3, focus: 2, scroll: 1 };
/** How long each keeps his eye after it was last seen (ms). */
export const ATTENTION_MS: Record<AttentionSource, number> = {
  touch: 1800,
  focus: 2500,
  scroll: 900,
};

export interface Attention {
  /** Something worth a look, at this point of the viewport (css px). */
  see(source: AttentionSource, x: number, y: number, now: number): void;
  /** Where he's looking now, or null when nothing has his eye. */
  target(now: number): { x: number; y: number; source: AttentionSource } | null;
}

export function createAttention(): Attention {
  const seen = new Map<AttentionSource, { x: number; y: number; at: number }>();
  return {
    see(source, x, y, now) {
      seen.set(source, { x, y, at: now });
    },
    target(now) {
      let best: { x: number; y: number; source: AttentionSource } | null = null;
      for (const [source, s] of Array.from(seen)) {
        if (now - s.at > ATTENTION_MS[source]) {
          seen.delete(source);
          continue;
        }
        if (!best || PRIORITY[source] > PRIORITY[best.source]) best = { x: s.x, y: s.y, source };
      }
      return best;
    },
  };
}

/** How far below (or above) him a scroll makes him look, in px. */
const SCROLL_LOOK_PX = 220;

/**
 * Where a scroll draws his eye: the way the page is moving under the visitor's
 * finger, from where he stands.
 */
export function scrollLook(
  from: { x: number; y: number },
  deltaY: number
): { x: number; y: number } | null {
  if (Math.abs(deltaY) < 2) return null;
  return { x: from.x, y: from.y + Math.sign(deltaY) * SCROLL_LOOK_PX };
}
