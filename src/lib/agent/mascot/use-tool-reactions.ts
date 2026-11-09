"use client";

/**
 * Bridges finished tool actions to Amr: every tool already logs its meaningful
 * actions to the history store (useHistoryLogger), for visitors and the owner
 * alike, so the mascot reacts to all of them without any per-tool wiring. Amr
 * says nothing here; the reaction is a pose only. Some actions have a scene of
 * their own: each tool's from its sheet (context/tool-scenes.ts, S65 on), and
 * the toolkit's shared ones (S54–S59): cards, votes, timers, kudos, a release.
 * He also marks a few moments nothing logs: those tools announce
 * (tool-moments.ts) and the docked timer running out (timer-watch.ts).
 */

import { useEffect } from "react";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import { RUN_LENGTH, RUN_WINDOW_MS, WORK_REACTIONS, pickFresh, remember } from "./brain/choose";
import { EMITTED, toolActionScenes } from "./context/tool-scenes";
import { feel } from "./mind";
import { useMascotStore, type MascotReaction } from "./store";
import { installTimerWatch } from "./timer-watch";
import { onToolMoment } from "./tool-moments";
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

/** One of these scenes whose sheet has shipped, at random. */
function pickShipped(
  scenes: readonly string[],
  shipped: (scene: string) => boolean,
  random: () => number
): string | null {
  const choices = scenes.filter(shipped);
  if (!choices.length) return null;
  return choices[Math.floor(random() * choices.length) % choices.length];
}

/** The scene for an action, when it has one whose sheet has shipped. */
export function sceneForAction(
  action: string,
  shipped: (scene: string) => boolean,
  random: () => number = Math.random
): string | null {
  return pickShipped(ACTION_SCENES[action] ?? [], shipped, random);
}

/**
 * The scene for a tool's action: the tool's own first (context/tool-scenes.ts),
 * then the toolkit's shared ones.
 */
export function sceneForEvent(
  toolId: string,
  action: string,
  shipped: (scene: string) => boolean,
  random: () => number = Math.random
): string | null {
  return (
    pickShipped(toolActionScenes(toolId, action), shipped, random) ??
    sceneForAction(action, shipped, random)
  );
}

/** A moment's name as the tool table spells it: emitted sounds use dashes. */
export const momentName = (name: string) => name.replace(/-/g, "_");

/**
 * The scene for a moment nothing logs (an emitted event, a revealed vote, a
 * timer running out), from the tool table only: no pose, since it may echo an
 * action the tool logged. A timer whose tool has no scene of its own gets the
 * Ceremony Timer's.
 */
export function sceneForMoment(
  toolId: string,
  name: string,
  shipped: (scene: string) => boolean,
  random: () => number = Math.random
): string | null {
  const moment = momentName(name);
  if (moment === "timer_finished") {
    return (
      pickShipped(toolActionScenes(toolId, moment), shipped, random) ??
      pickShipped(toolActionScenes("ceremony-timer", moment), shipped, random)
    );
  }
  if (!EMITTED.has(moment)) return null;
  return pickShipped(toolActionScenes(toolId, moment), shipped, random);
}

/** How telling a reaction is: in one tick, only the most telling plays. */
const RANK = { pose: 1, scene: 2, moment: 3 } as const;

/**
 * Start reacting to logged actions, announced moments and the docked timer
 * running out. Returns the unsubscribe. `shipped` says which scenes exist yet;
 * without it, actions get their poses only.
 */
export function installToolReactions(
  shipped: (scene: string) => boolean = () => false,
  random: () => number = Math.random
): () => void {
  let lastAt = -Infinity;
  let pending: { reaction: MascotReaction; rank: number } | null = null;
  let lately: MascotReaction[] = [];
  let finishes: number[] = [];

  /**
   * The same nod for every saved note gets old: ordinary work gets one of a few
   * small answers, never the same twice running, and a run of finishes close
   * together earns a dance instead of a third round of applause.
   */
  const vary = (pose: MascotReaction): MascotReaction => {
    if (pose === "nod") {
      const pick = pickFresh(WORK_REACTIONS, lately, random) ?? pose;
      lately = remember(lately, pick, 2);
      return pick;
    }
    if (pose === "clap") {
      const t = Date.now();
      finishes = [...finishes.filter((at) => t - at < RUN_WINDOW_MS), t];
      if (finishes.length >= RUN_LENGTH) {
        finishes = [];
        return "dance";
      }
    }
    return pose;
  };
  // Varied only once it's sure to play, so an answer lost in a burst isn't "used".

  const flush = () => {
    const p = pending;
    pending = null;
    if (!p) return;
    const now = Date.now();
    if (now - lastAt < MIN_GAP_MS) return;
    // He just cheered for a moment: one reaction per action is enough.
    if (isCheerRecent(now)) return;
    const mascot = useMascotStore.getState();
    // Nobody plays the queue while the figure isn't on screen.
    if (!mascot.ready) return;
    lastAt = now;
    noteToolReaction(now);
    mascot.queueReaction(p.rank === RANK.pose ? vary(p.reaction) : p.reaction);
  };
  // A check-in that also achieves its OKR logs and announces in the same tick:
  // wait for the tick to end and play the most telling of them.
  const offer = (reaction: MascotReaction, rank: number) => {
    if (pending) {
      if (rank > pending.rank) pending = { reaction, rank };
      return;
    }
    pending = { reaction, rank };
    queueMicrotask(flush);
  };

  const onAction = (toolId: string, action: string) => {
    const scene = sceneForEvent(toolId, action, shipped, random);
    if (scene) return offer(`scene:${scene}`, RANK.scene);
    const pose = reactionForAction(action);
    if (pose === "clap") feel("finished");
    if (pose) offer(pose, RANK.pose);
  };
  const onMoment = (toolId: string, name: string) => {
    const scene = sceneForMoment(toolId, name, shipped, random);
    if (scene) offer(`scene:${scene}`, RANK.moment);
  };

  let seen = lastId(useHistoryStore.getState().events);
  const offHistory = useHistoryStore.subscribe((s, prev) => {
    if (s.events === prev.events) return;
    const id = lastId(s.events);
    const isNew = id !== seen;
    seen = id;
    // The store keeps the newest 2,000, so a new event can leave the length as
    // it was; a shorter list is an undo or a clear, not something done.
    if (!isNew || s.events.length < prev.events.length) return;
    const event: HistoryEvent | undefined = s.events[s.events.length - 1];
    if (!event) return;
    if (Date.now() - new Date(event.occurredAt).getTime() > FRESH_MS) return;
    onAction(event.toolId, event.action);
  });
  const offMoments = onToolMoment(onMoment);
  const offTimer = installTimerWatch((toolId) => onMoment(toolId, "timer_finished"));

  return () => {
    offHistory();
    offMoments();
    offTimer();
    pending = null;
  };
}

const lastId = (events: readonly HistoryEvent[]) => events[events.length - 1]?.id ?? null;

/** Call once from the mascot assistant. */
export function useMascotToolReactions(shipped?: (scene: string) => boolean): void {
  useEffect(() => installToolReactions(shipped), [shipped]);
}
