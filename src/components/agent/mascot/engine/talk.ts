/**
 * Lip-sync while a reply streams: the mouth follows the rhythm of the streamed
 * chunks (store.speechPulse), the hands move to a new gesture every couple of
 * seconds. Every frame has the same S01 head, so the face never jumps between
 * drawings (the S02 gestures carry S01 mouths; see scripts/build-mascot-packs.py).
 */

import type { FrameId } from "../mascot-packs";

export type Mouth = "default" | "closed" | "small" | "wide";

/** No chunk for this long: he's between words and smiles. */
const PAUSE_MS = 280;
const MOUTH_MS = [80, 170] as const;
const GESTURE_MS = [1500, 3100] as const;
/** Gesture 0 is the stance (hands in pockets); 1–6 are S02 slots 2–7. */
const GESTURES = 6;

const FACE: Record<Mouth, FrameId> = {
  default: "face.default",
  closed: "face.talk-closed",
  small: "face.talk-small",
  wide: "face.talk-wide",
};

const NEXT_MOUTH: Record<Mouth, readonly Mouth[]> = {
  default: ["small", "wide", "closed"],
  closed: ["small", "wide", "small"],
  small: ["wide", "closed", "closed"],
  wide: ["small", "closed", "small"],
};

export interface Talker {
  /** The frame to show now. `pulse` is the store's speechPulse. */
  frame(now: number, pulse: number): FrameId;
  reset(): void;
}

export function createTalker(random: () => number = Math.random): Talker {
  let lastPulse: number | null = null;
  let lastPulseAt = -Infinity;
  let mouth: Mouth = "default";
  let mouthUntil = 0;
  let gesture = 0;
  let gestureUntil = 0;

  const between = ([lo, hi]: readonly [number, number]) => lo + random() * (hi - lo);

  function nextGesture(): number {
    // The stance twice as often as any one gesture, never the same one twice.
    const pick = Math.floor(random() * (GESTURES + 2));
    const g = pick > GESTURES ? 0 : pick;
    return g === gesture ? (g + 1) % (GESTURES + 1) : g;
  }

  return {
    frame(now, pulse) {
      if (pulse !== lastPulse) {
        lastPulse = pulse;
        lastPulseAt = now;
      }
      if (now - lastPulseAt > PAUSE_MS) {
        mouth = "default";
        mouthUntil = 0;
      } else if (now >= mouthUntil) {
        const options = NEXT_MOUTH[mouth];
        mouth = options[Math.floor(random() * options.length)];
        mouthUntil = now + between(MOUTH_MS);
      }
      if (now >= gestureUntil) {
        gesture = gestureUntil === 0 ? 0 : nextGesture();
        gestureUntil = now + between(GESTURE_MS);
      }
      return gesture === 0 ? FACE[mouth] : (`talk.${gesture}-${mouth}` as FrameId);
    },
    reset() {
      lastPulse = null;
      lastPulseAt = -Infinity;
      mouth = "default";
      mouthUntil = 0;
      gesture = 0;
      gestureUntil = 0;
    },
  };
}
