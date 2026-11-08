"use client";

/**
 * Bridges finished tool actions to Amr: every tool already logs its meaningful
 * actions to the history store (useHistoryLogger), for visitors and the owner
 * alike, so the mascot reacts to all of them without any per-tool wiring. Amr
 * says nothing here; the reaction is a pose only. Some actions have a scene of
 * their own (the toolkit sheets S54–S59): cards, votes, timers, kudos, a release.
 */

import { useEffect } from "react";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import { useMascotStore, type MascotReaction } from "./store";
import { isCheerRecent, noteToolReaction } from "./use-celebration-reactions";

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
 * `sprint_completed`): applause for a real finish, a downcast look when
 * something went wrong, a thumbs-up for ordinary work, nothing for a removal or
 * a reset. (Applause and the downcast look fall back to a jump and a worried
 * look until their pack has loaded.)
 */
export function reactionForAction(action: string): MascotReaction | null {
  const verb = action.slice(action.lastIndexOf("_") + 1);
  if (FINISHED.has(verb)) return "clap";
  if (WENT_WRONG.has(verb)) return "downcast";
  if (NOT_AN_ACHIEVEMENT.has(verb)) return null;
  return "nod";
}

/** Scenes some actions have of their own (engine/scenes.ts), by the catalog's action. */
const ACTION_SCENES: Record<string, readonly string[]> = {
  card_added: ["sticky", "sticky.think", "sticky.goofy"],
  vote_cast: ["poker"],
  votes_revealed: ["poker.reveal"],
  estimate_committed: ["poker.agree"],
  timer_started: ["timer"],
  step_timer_started: ["timer"],
  timer_paused: ["timer.done"],
  entry_added: ["timer.standup"],
  release_shipped: ["ship"],
  sprint_completed: ["ship"],
  sprint_closed: ["ship"],
  sprint_started: ["ship.rocket"],
  sprint_committed: ["ship.rocket"],
  kudos_sent: ["kudos"],
  kudos_added: ["kudos"],
  kudos_received: ["kudos.got"],
  kudos_reacted: ["kudos.clap"],
};

/** The scene for an action, when it has one whose sheet has shipped. */
export function sceneForAction(
  action: string,
  shipped: (scene: string) => boolean,
  random: () => number = Math.random
): string | null {
  const choices = (ACTION_SCENES[action] ?? []).filter(shipped);
  if (!choices.length) return null;
  return choices[Math.floor(random() * choices.length) % choices.length];
}

/**
 * Start reacting to logged actions. Returns the unsubscribe. `shipped` says
 * which scenes exist yet; without it, actions get their poses only.
 */
export function installToolReactions(
  shipped: (scene: string) => boolean = () => false
): () => void {
  let lastAt = -Infinity;
  return useHistoryStore.subscribe((s, prev) => {
    if (s.events === prev.events || s.events.length <= prev.events.length) return;
    const event: HistoryEvent | undefined = s.events[s.events.length - 1];
    if (!event) return;
    const now = Date.now();
    if (now - new Date(event.occurredAt).getTime() > FRESH_MS) return;
    if (now - lastAt < MIN_GAP_MS) return;
    // He just cheered for a moment: one reaction per action is enough.
    if (isCheerRecent(now)) return;
    const mascot = useMascotStore.getState();
    // Nobody plays the queue while the figure isn't on screen.
    if (!mascot.ready) return;
    const scene = sceneForAction(event.action, shipped);
    const reaction: MascotReaction | null = scene
      ? `scene:${scene}`
      : reactionForAction(event.action);
    if (!reaction) return;
    lastAt = now;
    noteToolReaction(now);
    mascot.queueReaction(reaction);
  });
}

/** Call once from the mascot assistant. */
export function useMascotToolReactions(shipped?: (scene: string) => boolean): void {
  useEffect(() => installToolReactions(shipped), [shipped]);
}
