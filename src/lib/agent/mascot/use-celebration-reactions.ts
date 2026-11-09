"use client";

/**
 * Amr's half of a moment: when the moment scheduler (lib/notify/moment-
 * scheduler.ts) plays a rare item at a calm time, he cheers once. He is the
 * only celebration surface; the chip beside him just names what happened.
 *
 * Coordinates with the tool reactions (use-tool-reactions.ts), which answer
 * the history log, so he doesn't react twice to one action:
 * - he skips the cheer when he answered a finished action moments ago (the
 *   clap for "retro finished" already covered the level it earned);
 * - the tool reactions skip an action that lands just after a cheer.
 *
 * If he isn't on screen (data saver, packs still loading) the chip shows
 * alone; nothing is queued for later.
 */

import { useEffect } from "react";
import type { Rarity } from "@/lib/notify/inbox";
import { subscribeMoments, type MomentShown } from "@/lib/notify/moment-scheduler";
import { useMascotStore, type MascotReaction } from "./store";

/** He answered an action this recently: the moment doesn't add a cheer. */
export const RECENT_TOOL_REACTION_MS = 6000;
/** After a cheer, tool reactions wait this long. */
export const AFTER_CHEER_QUIET_MS = 4000;

let lastToolReactionAt = Number.NEGATIVE_INFINITY;
let lastCheerAt = Number.NEGATIVE_INFINITY;

/** The tool reactions call this when Amr answers a logged action. */
export function noteToolReaction(now: number = Date.now()): void {
  lastToolReactionAt = now;
}

/** Whether a tool reaction should wait because Amr just cheered. */
export function isCheerRecent(now: number = Date.now()): boolean {
  return now - lastCheerAt < AFTER_CHEER_QUIET_MS;
}

/** How Amr celebrates each rarity: a cheer, a dance for the rarest. */
export function reactionForRarity(rarity: Rarity): MascotReaction | null {
  switch (rarity) {
    case "legendary":
      return "dance";
    case "epic":
    case "rare":
      return "cheer";
    default:
      // Lively mode plays common unlocks too: a smaller thumbs-up.
      return "thumbsUp";
  }
}

/**
 * Answer one moment. Returns the reaction queued, or null when he stays put
 * (not on screen, or he just answered the action that earned it).
 */
export function reactToMoment(moment: Pick<MomentShown, "rarity" | "preview">, now = Date.now()) {
  const mascot = useMascotStore.getState();
  if (!mascot.ready) return null;
  if (!moment.preview && now - lastToolReactionAt < RECENT_TOOL_REACTION_MS) return null;
  const reaction = reactionForRarity(moment.rarity);
  if (!reaction) return null;
  lastCheerAt = now;
  mascot.queueReaction(reaction);
  return reaction;
}

/** Start answering moments. Returns the unsubscribe. */
export function installCelebrationReactions(): () => void {
  return subscribeMoments((moment) => {
    reactToMoment(moment);
  });
}

/** Call once from the mascot assistant. */
export function useMascotCelebrationReactions(): void {
  useEffect(() => installCelebrationReactions(), []);
}

/** Test-only. */
export function __resetCelebrationReactionsForTests(): void {
  lastToolReactionAt = Number.NEGATIVE_INFINITY;
  lastCheerAt = Number.NEGATIVE_INFINITY;
}
