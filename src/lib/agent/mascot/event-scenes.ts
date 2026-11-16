"use client";

/**
 * Playing an expansion scene on a real event a page has just seen (EVENT_SCENES
 * in components/agent/mascot/engine/scenes.ts; docs/mascot/expansion-triggers.md
 * says which event in the code plays each one). The page calls it from its
 * event's success branch only, the way the story page plays Comic to Action.
 */

import { useCallback, useEffect } from "react";
import { sceneReaction } from "@/components/agent/mascot/engine/scenes";
import { shippedScene } from "@/components/agent/mascot/engine/sprite-poses";
import { useMascotStore, type MascotReaction } from "./store";

/**
 * Queue `scene` now: only once he's on screen (nobody plays the queue before),
 * and only once its pack ships; until then `fallback`, a plain pose, or nothing.
 * True when something was queued.
 */
export function playEventScene(scene: string, fallback?: MascotReaction): boolean {
  const mascot = useMascotStore.getState();
  if (!mascot.ready) return false;
  const reaction = shippedScene(scene) ? sceneReaction(scene) : fallback;
  if (!reaction) return false;
  mascot.queueReaction(reaction);
  return true;
}

/** The once a story's love and its Seen this at work answer share (EVENT_SCENES.feedback). */
export const storyFeedbackKey = (ep: number) => `story-feedback:${ep}`;

/** Each key in use on the page now: how many components share it, and whether it's spent. */
const visits = new Map<string, { users: number; spent: boolean }>();

/**
 * Once per visit to the page: `once(play)` runs `play` until it returns true,
 * then never again while a component using `key` stays mounted. Components on
 * one page that pass the same key share it (a story's love and its Seen this at
 * work answer); leaving the page unmounts them all, so the next visit starts
 * afresh. An event that lands after its page has gone (a share sheet closed
 * after the visitor moved on) plays nothing.
 */
export function useVisitOnce(key: string): (play: () => boolean) => boolean {
  useEffect(() => {
    const visit = visits.get(key) ?? { users: 0, spent: false };
    visit.users += 1;
    visits.set(key, visit);
    return () => {
      visit.users -= 1;
      if (visit.users <= 0 && visits.get(key) === visit) visits.delete(key);
    };
  }, [key]);
  return useCallback(
    (play: () => boolean) => {
      const visit = visits.get(key);
      if (!visit || visit.spent || !play()) return false;
      visit.spent = true;
      return true;
    },
    [key]
  );
}
