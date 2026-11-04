/**
 * Finished tool actions reach Amr through the history store, so visitors get
 * reactions from their work, not only from clicking him.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import { useMascotStore } from "@/lib/agent/mascot/store";
import {
  installToolReactions,
  reactionForAction,
  sceneForAction,
} from "@/lib/agent/mascot/use-tool-reactions";

let n = 0;
function event(action: string, occurredAt = new Date().toISOString()): HistoryEvent {
  n += 1;
  const id = `e${n}`;
  return {
    id,
    clientEventId: id,
    clientId: "c",
    toolRunId: "r",
    userId: null,
    toolId: "retro",
    action,
    payload: {},
    isMilestone: false,
    occurredAt,
    syncedAt: null,
  };
}

describe("reactionForAction", () => {
  it.each([
    ["sprint_completed", "clap"],
    ["release_shipped", "clap"],
    ["impediment_resolved", "clap"],
    ["decision_decided", "clap"],
    ["card_added", "nod"],
    ["retro_saved", "nod"],
    ["impediment_raised", "downcast"],
  ])("%s → %s", (action, reaction) => {
    expect(reactionForAction(action)).toBe(reaction);
  });

  it.each(["card_removed", "retro_reset", "format_changed", "action_toggled"])(
    "%s isn't worth a reaction",
    (action) => {
      expect(reactionForAction(action)).toBeNull();
    }
  );
});

describe("installToolReactions", () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    useHistoryStore.setState({ events: [] });
    useMascotStore.getState().reset();
    useMascotStore.getState().setReady(true);
    uninstall = installToolReactions();
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    useHistoryStore.setState({ events: [] });
    useMascotStore.getState().reset();
  });

  const queue = () => useMascotStore.getState().reactionQueue;

  it("reacts when a tool logs a finished action", () => {
    useHistoryStore.getState().addEvent(event("sprint_completed"));
    expect(queue()).toEqual(["clap"]);
  });

  it("stays quiet for a removal", () => {
    useHistoryStore.getState().addEvent(event("card_removed"));
    expect(queue()).toEqual([]);
  });

  it("reacts at most once in a burst, and again after a pause", () => {
    useHistoryStore.getState().addEvent(event("card_added"));
    useHistoryStore.getState().addEvent(event("card_added"));
    expect(queue()).toEqual(["nod"]);
    vi.advanceTimersByTime(4001);
    useHistoryStore.getState().addEvent(event("card_added"));
    expect(queue()).toEqual(["nod", "nod"]);
  });

  it("ignores old events arriving from the cloud or storage", () => {
    useHistoryStore.getState().addEvent(event("sprint_completed", "2026-10-01T12:00:00Z"));
    expect(queue()).toEqual([]);
  });

  it("doesn't queue while the figure isn't on screen", () => {
    useMascotStore.getState().setReady(false);
    useHistoryStore.getState().addEvent(event("sprint_completed"));
    expect(queue()).toEqual([]);
  });
});

describe("the toolkit's own scenes", () => {
  afterEach(() => {
    useHistoryStore.setState({ events: [] });
    useMascotStore.getState().reset();
  });

  it.each([
    ["vote_cast", "poker"],
    ["votes_revealed", "poker.reveal"],
    ["estimate_committed", "poker.agree"],
    ["timer_started", "timer"],
    ["entry_added", "timer.standup"],
    ["release_shipped", "ship"],
    ["sprint_started", "ship.rocket"],
    ["kudos_sent", "kudos"],
    ["kudos_received", "kudos.got"],
  ])("%s plays %s once its sheet has shipped", (action, scene) => {
    expect(
      sceneForAction(
        action,
        () => true,
        () => 0
      )
    ).toBe(scene);
    expect(sceneForAction(action, () => false)).toBeNull();
  });

  it("plays the scene instead of the pose when it exists", () => {
    useMascotStore.getState().setReady(true);
    const uninstall = installToolReactions((s) => s === "ship");
    useHistoryStore.getState().addEvent(event("release_shipped"));
    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:ship"]);
    uninstall();
  });
});
