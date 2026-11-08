/**
 * Finished tool actions reach Amr through the history store, so visitors get
 * reactions from their work, not only from clicking him; so do the moments
 * nothing logs (announced moments, the docked timer running out).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import { announceToolMoment } from "@/lib/agent/mascot/tool-moments";
import { installTimerWatch, LATE_MS, timerTool } from "@/lib/agent/mascot/timer-watch";
import {
  installToolReactions,
  reactionForAction,
  sceneForAction,
  sceneForEvent,
  sceneForMoment,
} from "@/lib/agent/mascot/use-tool-reactions";

/** Reactions are chosen at the end of the tick, so a burst plays its most telling one. */
const settle = () => Promise.resolve();

let n = 0;
function event(
  action: string,
  occurredAt = new Date().toISOString(),
  toolId = "retro"
): HistoryEvent {
  n += 1;
  const id = `e${n}`;
  return {
    id,
    clientEventId: id,
    clientId: "c",
    toolRunId: "r",
    userId: null,
    toolId,
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

  it("reacts when a tool logs a finished action", async () => {
    useHistoryStore.getState().addEvent(event("sprint_completed"));
    await settle();
    expect(queue()).toEqual(["clap"]);
  });

  it("stays quiet for a removal", async () => {
    useHistoryStore.getState().addEvent(event("card_removed"));
    await settle();
    expect(queue()).toEqual([]);
  });

  it("reacts at most once in a burst, and again after a pause", async () => {
    useHistoryStore.getState().addEvent(event("card_added"));
    await settle();
    useHistoryStore.getState().addEvent(event("card_added"));
    await settle();
    expect(queue()).toEqual(["nod"]);
    vi.advanceTimersByTime(4001);
    useHistoryStore.getState().addEvent(event("card_added"));
    await settle();
    expect(queue()).toEqual(["nod", "nod"]);
  });

  it("ignores old events arriving from the cloud or storage", async () => {
    useHistoryStore.getState().addEvent(event("sprint_completed", "2026-10-01T12:00:00Z"));
    await settle();
    expect(queue()).toEqual([]);
  });

  it("doesn't queue while the figure isn't on screen", async () => {
    useMascotStore.getState().setReady(false);
    useHistoryStore.getState().addEvent(event("sprint_completed"));
    await settle();
    expect(queue()).toEqual([]);
  });

  it("keeps reacting once the history is full", async () => {
    const old = new Date("2026-10-01T12:00:00Z").toISOString();
    useHistoryStore.setState({
      events: Array.from({ length: 2000 }, () => event("card_added", old)),
    });
    await settle();
    useHistoryStore.getState().addEvent(event("sprint_completed"));
    expect(useHistoryStore.getState().events).toHaveLength(2000);
    await settle();
    expect(queue()).toEqual(["clap"]);
  });

  it("doesn't react again when an undo takes the newest event away", async () => {
    const first = event("sprint_completed");
    useHistoryStore.getState().addEvent(first);
    await settle();
    vi.advanceTimersByTime(4001);
    useHistoryStore.getState().addEvent(event("card_added"));
    await settle();
    vi.advanceTimersByTime(4001);
    useHistoryStore.setState({ events: [first] });
    await settle();
    expect(queue()).toEqual(["clap", "nod"]);
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

  it("plays the scene instead of the pose when it exists", async () => {
    useMascotStore.getState().setReady(true);
    const uninstall = installToolReactions((s) => s === "ship");
    useHistoryStore.getState().addEvent(event("release_shipped"));
    await settle();
    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:ship"]);
    uninstall();
  });
});

describe("each tool's own scenes", () => {
  const all = () => true;
  const first = () => 0;

  it("look the tool up first, then the toolkit's shared scenes", () => {
    expect(sceneForEvent("impediments", "impediment_raised", all, first)).toBe("blocker.raised");
    expect(sceneForEvent("impediments", "impediment_resolved", all, first)).toBe("blocker.cleared");
    // Any tool's new card is a sticky note.
    expect(sceneForEvent("story-mapper", "card_added", all, first)).toBe("sticky");
    expect(sceneForEvent("planning-poker", "vote_cast", all, first)).toBe("poker");
  });

  it("play nothing until their sheet has shipped", () => {
    const toolkitOnly = (s: string) => !s.startsWith("blocker");
    expect(sceneForEvent("impediments", "impediment_raised", toolkitOnly, first)).toBeNull();
  });

  it("answer only the moments the table names, with dashes read as underscores", () => {
    expect(sceneForMoment("okrs", "okr-achieved", all, first)).toBe("okr.achieved");
    expect(sceneForMoment("hypothesis-tracker", "validated", all, first)).toBe("lab.yes");
    expect(sceneForMoment("health-check", "round_revealed", all, first)).toBe("health.reveal");
    // A sound that echoes a logged action isn't a moment of its own.
    expect(sceneForMoment("okrs", "kr-updated", all, first)).toBeNull();
    expect(sceneForMoment("retro", "completed", all, first)).toBeNull();
  });

  it("mark a timer running out with its tool's scene, or the Ceremony Timer's", () => {
    expect(sceneForMoment("six-hats", "timer_finished", all, first)).toBe("hats.done");
    expect(sceneForMoment("squad-session", "timer_finished", all, first)).toBe("timer.done");
  });
});

describe("moments nothing logs", () => {
  let uninstall: () => void;
  const queue = () => useMascotStore.getState().reactionQueue;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    useHistoryStore.setState({ events: [] });
    useMascotStore.getState().reset();
    useMascotStore.getState().setReady(true);
    uninstall = installToolReactions(
      () => true,
      () => 0
    );
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    useHistoryStore.setState({ events: [] });
    useMascotStore.getState().reset();
  });

  it("plays a revealed vote round's scene", async () => {
    announceToolMoment("health-check", "round_revealed");
    await settle();
    expect(queue()).toEqual(["scene:health.reveal"]);
  });

  it("plays the moment, not the action logged with it in the same tick", async () => {
    useHistoryStore.getState().addEvent(event("check_in_recorded", undefined, "okrs"));
    announceToolMoment("okrs", "okr-achieved");
    await settle();
    expect(queue()).toEqual(["scene:okr.achieved"]);
  });

  it("ignores a sound that isn't one of his moments", async () => {
    announceToolMoment("okrs", "kr-updated");
    await settle();
    expect(queue()).toEqual([]);
  });

  it("stops listening once uninstalled", async () => {
    uninstall();
    uninstall = () => {};
    announceToolMoment("health-check", "round_revealed");
    await settle();
    expect(queue()).toEqual([]);
  });
});

describe("installTimerWatch", () => {
  let now: number;
  let pending: Array<{ at: number; fn: () => void; live: boolean }>;
  const clock = {
    now: () => now,
    later: (fn: () => void, ms: number) => {
      const h = { at: now + ms, fn, live: true };
      pending.push(h);
      return h;
    },
    cancel: (h: unknown) => {
      (h as { live: boolean }).live = false;
    },
  };
  /** Move the clock on, running what falls due. */
  const advance = (ms: number) => {
    now += ms;
    for (const h of pending.filter((p) => p.live && p.at <= now)) {
      h.live = false;
      h.fn();
    }
  };
  const running = (href: string, seconds: number): DockedTimer => ({
    label: "Round",
    href,
    totalSeconds: seconds,
    endsAt: now + seconds * 1000,
    pausedRemaining: seconds,
  });

  let finished: string[];
  let stop: () => void;
  beforeEach(() => {
    now = 1_000_000;
    pending = [];
    finished = [];
    useDockTimer.setState({ timer: null });
    stop = installTimerWatch((tool) => finished.push(tool), clock);
  });
  afterEach(() => {
    stop();
    useDockTimer.setState({ timer: null });
  });

  it("names the tool from the timer's page", () => {
    expect(timerTool({ href: "/six-hats" })).toBe("six-hats");
    expect(timerTool({ href: "/premortem?x=1" })).toBe("premortem");
    expect(timerTool({ href: "/" })).toBeNull();
  });

  it("marks the timer running out, once", () => {
    useDockTimer.getState().publish(running("/six-hats", 60));
    advance(59_000);
    expect(finished).toEqual([]);
    advance(1000);
    expect(finished).toEqual(["six-hats"]);
    // The docked pill then pauses it at zero: the same finish, not a second one.
    useDockTimer.getState().pause(now);
    expect(finished).toEqual(["six-hats"]);
  });

  it("counts a pause at zero that comes before the clock does", () => {
    useDockTimer.getState().publish(running("/premortem", 30));
    now += 30_000;
    useDockTimer.getState().pause(now);
    expect(finished).toEqual(["premortem"]);
    advance(0);
    expect(finished).toEqual(["premortem"]);
  });

  it("ignores a timer paused, stopped or replaced before it runs out", () => {
    useDockTimer.getState().publish(running("/six-hats", 60));
    advance(10_000);
    useDockTimer.getState().pause(now);
    advance(60_000);
    useDockTimer.getState().stop();
    useDockTimer.getState().publish(running("/icebreaker", 60));
    useDockTimer.getState().publish(running("/ceremony-timer", 120));
    advance(60_000);
    expect(finished).toEqual([]);
    advance(60_000);
    expect(finished).toEqual(["ceremony-timer"]);
  });

  it("lets a finish only noticed long after pass", () => {
    useDockTimer.getState().publish(running("/six-hats", 60));
    now += 60_000 + LATE_MS + 1;
    useDockTimer.getState().pause(now);
    expect(finished).toEqual([]);
  });
});
