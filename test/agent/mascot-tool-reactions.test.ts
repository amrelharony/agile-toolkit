/**
 * Finished tool actions reach Amr through the history store, so visitors get
 * reactions from their work, not only from clicking him.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { installToolReactions, reactionForAction } from "@/lib/agent/mascot/use-tool-reactions";

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
    ["sprint_completed", "excited"],
    ["release_shipped", "excited"],
    ["impediment_resolved", "excited"],
    ["decision_decided", "excited"],
    ["card_added", "nod"],
    ["retro_saved", "nod"],
    ["impediment_raised", "confused"],
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
    expect(queue()).toEqual(["excited"]);
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
