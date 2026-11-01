"use client";

/**
 * Bridges finished tool actions to Amr: every tool already logs its meaningful
 * actions to the history store (useHistoryLogger), for visitors and the owner
 * alike, so the mascot reacts to all of them without any per-tool wiring. Amr
 * says nothing here; the reaction is a pose only.
 */

import { useEffect } from "react";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import { useMascotStore, type MascotReaction } from "./store";

/** One reaction at most this often, so a burst of edits isn't a jumping fit. */
const MIN_GAP_MS = 4000;
/** Older events came from the cloud or storage, not from this moment. */
const FRESH_MS = 5000;

const FINISHED = new Set([
  "completed",
  "finished",
  "shipped",
  "published",
  "resolved",
  "closed",
  "decided",
  "committed",
  "released",
]);
const WENT_WRONG = new Set(["failed", "rejected", "blocked", "raised"]);
const NOT_AN_ACHIEVEMENT = new Set([
  "removed",
  "deleted",
  "reset",
  "cleared",
  "viewed",
  "toggled",
  "changed",
  "switched",
  "moved",
  "reopened",
  "uncompleted",
  "ungrouped",
  "unpinned",
  "favorited",
  "refreshed",
  "renamed",
  "back",
  "ping",
]);

/**
 * How Amr answers an action, from the catalog's verb (`card_added`,
 * `sprint_completed`): a jump for a real finish, a worried look when something
 * went wrong, a thumbs-up for ordinary work, nothing for a removal or a reset.
 */
export function reactionForAction(action: string): MascotReaction | null {
  const verb = action.slice(action.lastIndexOf("_") + 1);
  if (FINISHED.has(verb)) return "excited";
  if (WENT_WRONG.has(verb)) return "confused";
  if (NOT_AN_ACHIEVEMENT.has(verb)) return null;
  return "nod";
}

/** Start reacting to logged actions. Returns the unsubscribe. */
export function installToolReactions(): () => void {
  let lastAt = -Infinity;
  return useHistoryStore.subscribe((s, prev) => {
    if (s.events === prev.events || s.events.length <= prev.events.length) return;
    const event: HistoryEvent | undefined = s.events[s.events.length - 1];
    if (!event) return;
    const now = Date.now();
    if (now - new Date(event.occurredAt).getTime() > FRESH_MS) return;
    if (now - lastAt < MIN_GAP_MS) return;
    const mascot = useMascotStore.getState();
    // Nobody plays the queue while the figure isn't on screen.
    if (!mascot.ready) return;
    const reaction = reactionForAction(event.action);
    if (!reaction) return;
    lastAt = now;
    mascot.queueReaction(reaction);
  });
}

/** Call once from the mascot assistant. */
export function useMascotToolReactions(): void {
  useEffect(() => installToolReactions(), []);
}
