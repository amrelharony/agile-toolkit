/**
 * Everything Amr says beside himself, outside the chat (lib/agent/mascot/bubble.ts
 * shows it). Kept in one file so his voice stays one voice: short, plain, warm,
 * a handful of words at most, and never a demand.
 */

/** His offer to feel the phone, where the browser asks before it sends motion. */
export const MOTION_INVITE = {
  text: "Tilt your phone, I'll feel it",
  allow: "Allow",
  decline: "No thanks",
} as const;
