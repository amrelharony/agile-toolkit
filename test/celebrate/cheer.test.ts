import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sound = vi.hoisted(() => ({ emitFeedback: vi.fn() }));
vi.mock("@/lib/sonification/emit", () => sound);

import { cheer, cheerMoment } from "@/lib/celebrate/cheer";
import {
  CHEER_MOMENTS,
  announceToolMoment,
  cheerPose,
  onToolMoment,
} from "@/lib/agent/mascot/tool-moments";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useHistoryStore } from "@/lib/history/history-store";
import { installToolReactions } from "@/lib/agent/mascot/use-tool-reactions";
import { __resetCelebrationReactionsForTests } from "@/lib/agent/mascot/use-celebration-reactions";
import { EMITTED } from "@/lib/agent/mascot/context/tool-scenes";
import { getEntry } from "@/lib/sonification/palette";

/**
 * A tool asks Amr to celebrate through the moment channel (lib/celebrate/
 * cheer.ts): he cheers, or dances for a milestone, and a short sound plays
 * only when the call asks for one. No visual layer, no XP.
 */

/** Reactions are chosen at the end of the tick. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const queue = () => useMascotStore.getState().reactionQueue;

beforeEach(() => {
  sound.emitFeedback.mockClear();
});

describe("cheer's moment", () => {
  it("is a cheer for a result and a dance for a milestone", () => {
    expect(cheerMoment("result")).toBe(CHEER_MOMENTS.cheer);
    expect(cheerMoment("agreed")).toBe(CHEER_MOMENTS.cheer);
    expect(cheerMoment("done")).toBe(CHEER_MOMENTS.cheer);
    expect(cheerMoment("milestone")).toBe(CHEER_MOMENTS.dance);
    expect(cheerPose(CHEER_MOMENTS.cheer)).toBe("cheer");
    expect(cheerPose(CHEER_MOMENTS.dance)).toBe("dance");
  });

  it("can't be set off by Amr's own reactions, which share the channel as sounds", () => {
    // The sprite plays a reaction's sound as emit("mascot", "cheer"), which announces it too.
    expect(cheerPose("cheer")).toBeNull();
    expect(cheerPose("dance")).toBeNull();
    expect(Object.values(CHEER_MOMENTS)).not.toContain("cheer");
  });

  it("is a moment Amr's tool table may give a scene", () => {
    for (const m of Object.values(CHEER_MOMENTS)) expect(EMITTED.has(m), m).toBe(true);
  });

  it("announces the tool and the moment", () => {
    const heard: [string, string][] = [];
    const off = onToolMoment((tool, moment) => heard.push([tool, moment]));
    cheer("picker", "result");
    cheer("product-goal", "milestone");
    off();
    expect(heard).toEqual([
      ["picker", CHEER_MOMENTS.cheer],
      ["product-goal", CHEER_MOMENTS.dance],
    ]);
  });
});

describe("cheer's sound", () => {
  it("plays nothing unless the call asks for it", async () => {
    cheer("picker", "result");
    await settle();
    expect(sound.emitFeedback).not.toHaveBeenCalled();
  });

  it("goes through the sound engine as feedback only, never the XP engine", async () => {
    cheer("picker", "result", { sound: true });
    cheer("product-goal", "milestone", { sound: true });
    await vi.waitFor(() => expect(sound.emitFeedback).toHaveBeenCalledTimes(2));
    expect(sound.emitFeedback).toHaveBeenNthCalledWith(1, "celebrate", "cheer", null, {
      haptics: false,
    });
    expect(sound.emitFeedback).toHaveBeenNthCalledWith(2, "celebrate", "dance", null, {
      haptics: false,
    });
  });

  it("has an entry in the sound palette for each", () => {
    expect(getEntry("celebrate", "cheer")).toBeDefined();
    expect(getEntry("celebrate", "dance")).toBeDefined();
  });
});

describe("Amr's answer", () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    useHistoryStore.setState({ events: [] });
    useMascotStore.getState().reset();
    useMascotStore.getState().setReady(true);
    __resetCelebrationReactionsForTests();
    // Every scene "shipped", so a tool-table scene would win if one were named.
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

  it("is his cheer for a result, when the tool has no scene for it", async () => {
    cheer("picker", "result");
    await Promise.resolve();
    expect(queue()).toEqual(["cheer"]);
  });

  it("is a dance for a milestone", async () => {
    cheer("product-goal", "milestone");
    await Promise.resolve();
    expect(queue()).toEqual(["dance"]);
  });

  it("ignores the mascot's own cheer coming back on the channel", async () => {
    announceToolMoment("mascot", "cheer");
    announceToolMoment("mascot", "dance");
    await Promise.resolve();
    expect(queue()).toEqual([]);
  });

  it("waits while he isn't on screen: nothing is queued for later", async () => {
    useMascotStore.getState().setReady(false);
    cheer("team-mixer", "done");
    await Promise.resolve();
    expect(queue()).toEqual([]);
  });
});
