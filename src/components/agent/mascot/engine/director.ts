/**
 * Restraint for the reactions nobody asked for: a fast scroll, typing, the end of
 * the page, a yawn. Touching, dragging and tilting him always get an answer;
 * these don't. At most one every 20 s, never the same one twice running (unless
 * a minute has passed), and each has its own cooldown on top. Urgent ones (gone
 * offline) skip the shared gap but keep their own cooldown.
 *
 * The 20 s is his usual pace: `gap` lets it follow his temperament and what the
 * visitor is doing (lib/agent/mascot/brain/state.ts), sooner when he's playful,
 * much later while they type.
 */

export interface Director {
  /** May this unprompted reaction play now? Records it when it may. */
  allow(name: string, cooldownMs?: number, urgent?: boolean): boolean;
}

const GAP_MS = 20_000;
const SAME_AGAIN_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;

export function createDirector(
  now: () => number = () => Date.now(),
  gap: () => number = () => GAP_MS
): Director {
  let lastAt = -Infinity;
  let lastName = "";
  const lastBy = new Map<string, number>();

  return {
    allow(name, cooldownMs = DEFAULT_COOLDOWN_MS, urgent = false) {
      const t = now();
      const prev = lastBy.get(name);
      if (prev !== undefined && t - prev < cooldownMs) return false;
      if (!urgent) {
        if (t - lastAt < gap()) return false;
        if (name === lastName && t - lastAt < SAME_AGAIN_MS) return false;
      }
      lastAt = t;
      lastName = name;
      lastBy.set(name, t);
      return true;
    },
  };
}
