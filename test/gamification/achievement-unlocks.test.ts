import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "@/lib/gamification/engine";
import { recordOutcome } from "@/lib/gamification/ledger";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";

/**
 * Achievements unlock from finished work (outcomes), end to end through the
 * real engine and ledger. The clock is a Date subclass whose "now" each test
 * sets (local time), so day, week and time-of-day badges are deterministic.
 */

const RealDate = Date;
let NOW = new RealDate(2026, 9, 14, 13, 0, 0).getTime(); // Wed 14 Oct 2026, 13:00
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [number]));
  }
  static now() {
    return NOW;
  }
}
const at = (y: number, mo: number, d: number, h = 13, mi = 0) => {
  NOW = new RealDate(y, mo, d, h, mi, 0).getTime();
};

beforeAll(async () => {
  vi.stubGlobal("Date", ShiftedDate);
  // The engine and the ledger do nothing until the profile is read from storage.
  await useVDnaStore.persist.rehydrate();
});
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  at(2026, 9, 14);
  useVDnaStore.setState({
    unlocked: [],
    counters: {},
    xp: 0,
    lifetimeXp: 0,
    level: 1,
    prestige: 0,
    toolsVisited: [],
    dailyChallenges: [],
    weeklyChallenges: [],
    recentEvents: [],
    xpDay: { date: "", total: 0, byKey: {} },
    claims: {},
    onceKeys: [],
  });
  useNotificationPrefsStore.getState().endFocus();
});

const unlocked = () => useVDnaStore.getState().unlocked;
/** A finished Kanban card: an outcome with no key, so it can repeat. */
const cardDone = () => recordOutcome("card-done", { meta: { toolId: "kanban" } });

describe("raw input unlocks nothing", () => {
  it("ignores clicks, hovers, keys, scrolling, session minutes and settings", () => {
    for (let i = 0; i < 120; i++) {
      for (const name of [
        "click",
        "hover",
        "key",
        "scroll-floor",
        "session-minute",
        "theme-toggle",
        "sonification-on",
        "reduce-motion-on",
        "prompt-copied",
        "workspace-push",
        "drag-drop",
      ]) {
        dispatch({ name });
      }
    }
    expect(unlocked()).toEqual([]);
    expect(useVDnaStore.getState().counters).toEqual({});
  });

  it("gives no combo badge for a burst of tool actions", () => {
    for (let i = 0; i < 10; i++) dispatch({ name: "tool:kudos:sent" });
    for (let i = 0; i < 10; i++) dispatch({ name: "tool:retro:card-add" });
    expect(unlocked()).not.toContain("combo-3");
    expect(unlocked()).not.toContain("combo-5");
    expect(unlocked()).not.toContain("kudos-combo-5");
  });
});

describe("outcome badges", () => {
  it("First Win: the first finished work, not a first tool visit or a secret", () => {
    recordOutcome("first-tool", { key: "tool:kanban", meta: { toolId: "kanban" } });
    recordOutcome("secret", { key: "secret:konami" });
    expect(unlocked()).not.toContain("first-win");
    cardDone();
    expect(unlocked()).toContain("first-win");
  });

  it("Busy Day at 5 outcomes in a day, Big Day at 10, also past the XP caps", () => {
    for (let i = 0; i < 4; i++) cardDone();
    expect(unlocked()).not.toContain("busy-day");
    cardDone(); // 5th: card-done's own cap is 5, still counts
    expect(unlocked()).toContain("busy-day");
    for (let i = 0; i < 4; i++) cardDone(); // capped: 0 XP, still outcomes
    expect(unlocked()).not.toContain("big-day");
    cardDone();
    expect(unlocked()).toContain("big-day");
  });

  it("Busy Day counts a single day: 4 yesterday and 1 today is not 5", () => {
    at(2026, 9, 13);
    for (let i = 0; i < 4; i++) cardDone();
    at(2026, 9, 14);
    cardDone();
    expect(unlocked()).not.toContain("busy-day");
  });

  it("Steady Week: outcomes on 3 days of one week", () => {
    at(2026, 9, 12); // Monday
    cardDone();
    cardDone();
    at(2026, 9, 14);
    cardDone();
    expect(unlocked()).not.toContain("steady-week");
    at(2026, 9, 18); // Sunday, same week
    cardDone();
    expect(unlocked()).toContain("steady-week");
  });

  it("Steady Week: 3 days across two weeks don't count", () => {
    at(2026, 9, 17); // Saturday
    cardDone();
    at(2026, 9, 18); // Sunday
    cardDone();
    at(2026, 9, 19); // next Monday
    cardDone();
    expect(unlocked()).not.toContain("steady-week");
  });

  it("Steady Month: outcomes in 4 weeks in a row; a gap starts over", () => {
    at(2026, 9, 1);
    cardDone();
    at(2026, 9, 8);
    cardDone();
    at(2026, 9, 22); // skipped the week of 12 Oct
    cardDone();
    at(2026, 9, 29);
    cardDone();
    expect(unlocked()).not.toContain("steady-month");
    at(2026, 10, 4); // third week in a row
    cardDone();
    expect(unlocked()).not.toContain("steady-month");
    at(2026, 10, 11); // fourth
    cardDone();
    expect(unlocked()).toContain("steady-month");
  });

  it("All-Rounder and Toolkit Native: outcomes in 5 and 10 different tools", () => {
    const tools = ["t1", "t2", "t3"];
    for (const toolId of tools) recordOutcome("card-done", { meta: { toolId } });
    cardDone();
    cardDone(); // kanban twice: one tool
    expect(unlocked()).not.toContain("five-tool-finisher");
    recordOutcome("okr-achieved", { meta: { toolId: "okrs" } });
    expect(unlocked()).toContain("five-tool-finisher");
    for (const toolId of ["t5", "t6", "t7", "t8"]) recordOutcome("card-done", { meta: { toolId } });
    expect(unlocked()).not.toContain("ten-tool-finisher");
    // A direct outcome carries its own tool (kudos).
    recordOutcome("kudos-sent", { key: "kudos:a" });
    expect(unlocked()).toContain("ten-tool-finisher");
  });

  it("Thankful Week: kudos sent or received on 3 days of one week", () => {
    at(2026, 9, 12);
    recordOutcome("kudos-sent", { key: "kudos:1" });
    at(2026, 9, 13);
    recordOutcome("kudos-received", { key: "kudos-in:2" });
    cardDone(); // other outcomes don't count toward it
    expect(unlocked()).not.toContain("kudos-week");
    at(2026, 9, 15);
    recordOutcome("kudos-sent", { key: "kudos:3" });
    expect(unlocked()).toContain("kudos-week");
  });

  it("Deep Focus: an outcome finished during Focus time", () => {
    cardDone();
    expect(unlocked()).not.toContain("deep-focus");
    useNotificationPrefsStore.getState().startFocus(30 * 60_000, Date.now());
    cardDone();
    expect(unlocked()).toContain("deep-focus");
  });

  it("Full Ceremony at 3 timers finished, Unblocker at 3 impediments resolved", () => {
    for (let i = 0; i < 2; i++) recordOutcome("ceremony-finished");
    expect(unlocked()).not.toContain("full-ceremony");
    recordOutcome("ceremony-finished");
    expect(unlocked()).toContain("full-ceremony");

    for (let i = 1; i <= 2; i++) recordOutcome("impediment-resolved", { key: `impediment:${i}` });
    expect(unlocked()).not.toContain("unblocker");
    recordOutcome("impediment-resolved", { key: "impediment:3" });
    expect(unlocked()).toContain("unblocker");
  });

  it("Safe Keeper: the first backup downloaded", () => {
    dispatch({ name: "backup-downloaded" });
    expect(unlocked()).toContain("safe-keeper");
  });
});

describe("time-of-day badges read finished work", () => {
  it("Night Owl for an outcome at 03:00, not for a page visit at 03:00", () => {
    at(2026, 9, 14, 3, 10);
    dispatch({ name: "tool-visit", meta: { toolId: "kanban" } });
    expect(unlocked()).not.toContain("night-owl");
    cardDone();
    expect(unlocked()).toContain("night-owl");
    expect(unlocked()).not.toContain("early-bird");
  });

  it("Early Bird for an outcome at 05:00–06:59 only", () => {
    at(2026, 9, 14, 4, 59);
    cardDone();
    expect(unlocked()).not.toContain("early-bird");
    at(2026, 9, 14, 6, 30);
    cardDone();
    expect(unlocked()).toContain("early-bird");
  });

  it("Midnight Commit for an outcome in the 00:00 minute", () => {
    at(2026, 9, 14, 0, 1);
    cardDone();
    expect(unlocked()).not.toContain("midnight-commit");
    at(2026, 9, 15, 0, 0);
    cardDone();
    expect(unlocked()).toContain("midnight-commit");
  });
});

describe("retargeted badges", () => {
  it("Fibonacci Believer: 10 committed estimates, not votes", () => {
    for (let i = 0; i < 30; i++) dispatch({ name: "tool:planning-poker:vote" });
    expect(unlocked()).not.toContain("poker-voter");
    for (let i = 1; i <= 10; i++) {
      recordOutcome("estimate-committed", { key: `estimate:s${i}` });
    }
    expect(unlocked()).toContain("poker-voter");
  });

  it("Reflective Practitioner on a finished retro, Retro Veteran on the tenth", () => {
    dispatch({ name: "tool:retro:card-add" });
    expect(unlocked()).not.toContain("retro-one");
    recordOutcome("retro-finished", { key: "retro:1" });
    expect(unlocked()).toContain("retro-one");
    for (let i = 2; i <= 9; i++) recordOutcome("retro-finished", { key: `retro:${i}` });
    expect(unlocked()).not.toContain("retro-fifty");
    recordOutcome("retro-finished", { key: "retro:10" });
    expect(unlocked()).toContain("retro-fifty");
  });

  it("Flow State on the first card done, not on card moves", () => {
    for (let i = 0; i < 20; i++) dispatch({ name: "tool:kanban:card-move" });
    expect(unlocked()).not.toContain("kanban-ten");
    cardDone();
    expect(unlocked()).toContain("kanban-ten");
  });

  it("Sprint Delivered on a closed sprint", () => {
    recordOutcome("sprint-closed", { key: "sprint:s1" });
    expect(unlocked()).toContain("sprint-complete");
  });

  it("Risk Manager at 5 closed risks, Debt Free at 5 resolved debt items", () => {
    for (let i = 1; i <= 5; i++) {
      recordOutcome("risk-closed", { key: `risk:${i}` });
      recordOutcome("debt-resolved", { key: `debt:${i}` });
    }
    expect(unlocked()).toContain("risk-closer");
    expect(unlocked()).toContain("debt-paydown");
  });

  it("In Sync on the bare sync-remote event (rt events lose their prefix)", () => {
    dispatch({ name: "rt:sync-remote" });
    expect(unlocked()).not.toContain("sync-first");
    dispatch({ name: "sync-remote" });
    expect(unlocked()).toContain("sync-first");
  });

  it("room badges come from the room and invite signals", () => {
    dispatch({ name: "room-joined", meta: { toolId: "planning-poker" } });
    dispatch({ name: "invite-created" });
    expect(unlocked()).toEqual(expect.arrayContaining(["room-join", "room-host"]));
    dispatch({ name: "room-members", meta: { memberCount: 3 } });
    expect(unlocked()).not.toContain("party-of-four");
    dispatch({ name: "room-members", meta: { memberCount: 4 } });
    expect(unlocked()).toContain("party-of-four");
  });

  it("Data Migrator on a workspace import", () => {
    dispatch({ name: "workspace-import", meta: { source: "risks" } });
    expect(unlocked()).toContain("workspace-import");
  });
});

describe("kept badges", () => {
  it("unlocks logo-whisperer on the logo-whispered event", () => {
    dispatch({ name: "logo-whispered" });
    expect(unlocked()).toContain("logo-whisperer");
  });

  it("does not unlock logo-whisperer for an unrelated event", () => {
    dispatch({ name: "logo-hover", meta: { count: 3 } });
    expect(unlocked()).not.toContain("logo-whisperer");
  });

  describe("reading the comic", () => {
    const read = (ep: number, weekStreak = 1) =>
      dispatch({ name: "tool:comics:completed", meta: { ep, total: ep, weekStreak } });

    it("unlocks First Story on the first story read, and Regular Reader on the tenth", () => {
      read(1);
      expect(unlocked()).toContain("first-story");
      expect(unlocked()).not.toContain("ten-stories");
      for (let ep = 2; ep <= 10; ep++) read(ep);
      expect(unlocked()).toContain("ten-stories");
    });

    it("still gives Regular Reader at ten stories after a prestige reset cleared the counter", () => {
      useVDnaStore.setState({ counters: {} });
      read(10);
      expect(unlocked()).toContain("ten-stories");
    });

    it("unlocks Weekly Reader at four weeks in a row, not before", () => {
      read(1, 3);
      expect(unlocked()).not.toContain("weekly-reader");
      read(2, 4);
      expect(unlocked()).toContain("weekly-reader");
    });

    it("unlocks Over to the Team when a story's question goes to the retro", () => {
      dispatch({ name: "tool:comics:retro-question", meta: { ep: 1 } });
      expect(unlocked()).toContain("squad-question");
    });
  });
});
