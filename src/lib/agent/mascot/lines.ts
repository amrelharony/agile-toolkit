/**
 * Everything Amr says beside himself, outside the chat (lib/agent/mascot/bubble.ts
 * shows it; say.ts decides whether he may). Kept in one file so his voice stays
 * one voice: short, plain, warm, a handful of words at most, and never a demand.
 */

import type { CelebrationLevel } from "@/lib/notify/prefs";

/** The kinds of thing he says, for the setting that decides how much he speaks. */
export type LineKind =
  | "ask" // a question the visitor answers (may he feel the phone?)
  | "help" // an offer when someone seems stuck
  | "welcome" // a greeting for someone he knows
  | "streak" // a run of days
  | "stretch"; // a nudge after a long stretch of work

/**
 * How much he speaks at each celebration level (Settings › Notifications).
 * Quiet: nothing at all. Balanced: only what's useful. Lively: the friendly
 * extras too.
 */
export const LINES_AT: Record<CelebrationLevel, readonly LineKind[]> = {
  quiet: [],
  balanced: ["ask", "help", "welcome"],
  lively: ["ask", "help", "welcome", "streak", "stretch"],
};

/** His offer to feel the phone, where the browser asks before it sends motion. */
export const MOTION_INVITE = {
  text: "Tilt your phone, I'll feel it",
  allow: "Allow",
  decline: "No thanks",
} as const;

/** To someone back after a day or more away. */
export const WELCOME_BACK = "Welcome back";

/** On the third and seventh day running. */
export const streakLine = (days: number): string => `${days} days running`;

/** When someone seems stuck: tapping it opens his panel. */
export const HELP_OFFER = "Need a hand?";

/** After a long stretch of work without a break. */
export const STRETCH_OFFER = "Time to stretch?";
