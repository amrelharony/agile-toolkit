import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sonification/emit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sonification/emit")>()),
  emitFeedback: vi.fn(),
}));

import {
  CHIP_MS,
  INPUT_QUIET_MS,
  MOMENT_FRESH_MS,
  MOMENTS_STORAGE_KEY,
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  __armSinceLastTimeForTests,
  __resetMomentsForTests,
  __setMomentEnvForTests,
  calmBlocker,
  installMomentScheduler,
  isMomentTimerArmed,
  isMomentWorthy,
  kickMoments,
  migrateMoments,
  msUntilQuietHoursEnd,
  onCelebration,
  previewMoment,
  runMomentCheck,
  setMomentPathname,
  subscribeMoments,
  useMomentStore,
  type CalmInputs,
  type MomentShown,
  type PendingMoment,
} from "@/lib/notify/moment-scheduler";
import {
  __resetCelebrationsForTests,
  flushCelebrations,
  handleEffect,
} from "@/lib/gamification/celebrations";
import { useInboxStore } from "@/lib/notify/inbox-store";
import type { InboxItem } from "@/lib/notify/inbox";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { useHapticsStore } from "@/lib/stores/haptics-store";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { __resetDragFlagForTests, markDragEnd, markDragStart } from "@/lib/sonification/drag-flag";
import { emitFeedback } from "@/lib/sonification/emit";
import {
  __resetCelebrationReactionsForTests,
  installCelebrationReactions,
  isCheerRecent,
  noteToolReaction,
} from "@/lib/agent/mascot/use-celebration-reactions";

/**
 * The moment scheduler: a rare celebration plays a moment (chip + Amr) only
 * at a calm time; otherwise it's held, never dropped. The clock is injected
 * through the scheduler's environment (a settable "now"); only the
 * scheduler's setTimeout loop uses fake timers.
 */

const T0 = new Date(2026, 10, 9, 10, 0, 0).getTime(); // Mon 9 Nov 2026, 10:00 local
let clock = T0;
let typing = false;
let sinceInput = Number.POSITIVE_INFINITY;
let visible = true;
let detach: (() => void) | null = null;

function advance(ms: number): void {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

function rows(): InboxItem[] {
  return useInboxStore.getState().items;
}

function levelUp(level: number): void {
  handleEffect({ kind: "level-up", payload: { level } });
  flushCelebrations();
}

function badge(id: string, title: string, xp: number): void {
  handleEffect({ kind: "achievement", payload: { id, title, xp } });
  flushCelebrations();
}

function challenge(): void {
  handleEffect({ kind: "challenge-complete", payload: { id: "d-kudos", kind: "daily", xp: 20 } });
}

function current(): MomentShown | null {
  return useMomentStore.getState().current;
}

function pending(): PendingMoment[] {
  return useMomentStore.getState().pending;
}

function calm(over: Partial<CalmInputs> = {}): CalmInputs {
  return {
    now: T0,
    level: "balanced",
    quiet: { quiet: false, reason: null },
    paused: false,
    visible: true,
    typing: false,
    msSinceInput: Number.POSITIVE_INFINITY,
    dialogOpen: false,
    toastShowing: false,
    amrBusy: false,
    dragging: false,
    lastMomentAt: null,
    momentsToday: 0,
    ...over,
  };
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.presenting;
  delete document.documentElement.dataset.intro;
  clock = T0;
  typing = false;
  sinceInput = Number.POSITIVE_INFINITY;
  visible = true;
  __resetMomentsForTests();
  __resetCelebrationsForTests();
  __resetCelebrationReactionsForTests();
  __resetDragFlagForTests();
  __setMomentEnvForTests({
    now: () => clock,
    typing: () => typing,
    msSinceInput: () => sinceInput,
    visible: () => visible,
  });
  useNotificationPrefsStore.getState().resetToDefaults();
  useHapticsStore.setState({ enabled: true, mode: "essential" });
  useMascotStore.getState().reset();
  useMascotStore.getState().setReady(true);
  useInboxStore.setState({ items: [], seeded: true });
  await useInboxStore.persist.rehydrate();
  vi.mocked(emitFeedback).mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  detach = installMomentScheduler();
  // Let the moments store finish rehydrating.
  await Promise.resolve();
  await Promise.resolve();
  setMomentPathname("/");
});

afterEach(() => {
  detach?.();
  detach = null;
  vi.useRealTimers();
  __resetMomentsForTests();
  __resetCelebrationsForTests();
});

describe("which items get a moment", () => {
  it.each([
    ["quiet", "level-up", "legendary", false],
    ["balanced", "level-up", "rare", true],
    ["balanced", "achievement", "common", false],
    ["balanced", "achievement", "epic", true],
    ["balanced", "challenge", "rare", true],
    ["balanced", "kudos", "epic", false],
    ["balanced", "recap", "rare", false],
    ["lively", "achievement", "common", true],
    ["lively", "challenge", "common", true],
    ["lively", "xp-cap", "common", false],
  ] as const)("%s: %s (%s) → %s", (level, kind, rarity, worthy) => {
    expect(isMomentWorthy(level, { kind, rarity })).toBe(worthy);
  });
});

describe("calm", () => {
  it.each([
    [{ level: "quiet" as const }, "off"],
    [{ quiet: { quiet: true as const, reason: "ceremony" as const } }, "ceremony"],
    [{ quiet: { quiet: true as const, reason: "presenting" as const } }, "presenting"],
    [{ quiet: { quiet: true as const, reason: "focus" as const } }, "focus"],
    [{ paused: true }, "paused"],
    [{ visible: false }, "hidden"],
    [{ typing: true }, "typing"],
    [{ msSinceInput: INPUT_QUIET_MS - 1 }, "input"],
    [{ dialogOpen: true }, "dialog"],
    [{ toastShowing: true }, "toast"],
    [{ amrBusy: true }, "amr"],
    [{ dragging: true }, "drag"],
    [{ momentsToday: 3 }, "daily"],
    [{ lastMomentAt: T0 - 9 * 60_000 }, "gap"],
  ])("%o blocks with %s", (over, reason) => {
    expect(calmBlocker(calm(over))).toBe(reason);
  });

  it("is calm otherwise; Lively's gap is 2 min and its day holds 10", () => {
    expect(calmBlocker(calm())).toBeNull();
    expect(calmBlocker(calm({ msSinceInput: INPUT_QUIET_MS }))).toBeNull();
    expect(calmBlocker(calm({ lastMomentAt: T0 - 10 * 60_000 }))).toBeNull();
    expect(calmBlocker(calm({ level: "lively", lastMomentAt: T0 - 3 * 60_000 }))).toBeNull();
    expect(calmBlocker(calm({ level: "lively", lastMomentAt: T0 - 60_000 }))).toBe("gap");
    expect(calmBlocker(calm({ level: "lively", momentsToday: 3 }))).toBeNull();
    expect(calmBlocker(calm({ level: "lively", momentsToday: 10 }))).toBe("daily");
  });

  it("knows when overnight quiet hours end", () => {
    const qh = { quietHours: { enabled: true, start: "22:00", end: "08:00" } };
    expect(msUntilQuietHoursEnd(qh, new Date(2026, 10, 9, 23, 0))).toBe(9 * 60 * 60_000);
    expect(msUntilQuietHoursEnd(qh, new Date(2026, 10, 9, 7, 30))).toBe(30 * 60_000);
  });
});

describe("playing a moment", () => {
  it("plays a rare item at a calm time: chip, one cheer, chime, marked shown", () => {
    const heard: MomentShown[] = [];
    subscribeMoments((m) => heard.push(m));
    const offAmr = installCelebrationReactions();
    levelUp(8);
    expect(current()).toBeNull();
    expect(isMomentTimerArmed()).toBe(true);
    advance(RETRY_MIN_MS);
    expect(current()).toMatchObject({ title: "Level 8", kind: "level-up", rarity: "rare" });
    expect(heard).toHaveLength(1);
    expect(useMascotStore.getState().reactionQueue).toEqual(["cheer"]);
    expect(rows()[0].momentShown).toBe(true);
    expect(useMomentStore.getState()).toMatchObject({
      pending: [],
      lastMomentAt: clock,
      day: { count: 1 },
    });
    // Essential haptics: the chime only, no buzz.
    expect(emitFeedback).toHaveBeenCalledWith("gamification", "level-up", null, {
      haptics: false,
    });
    expect(isMomentTimerArmed()).toBe(false);
    offAmr();
  });

  it("buzzes (the gamification palette) only in Full haptics", () => {
    useHapticsStore.setState({ enabled: true, mode: "full" });
    badge("big-day", "Big Day", 300);
    advance(RETRY_MIN_MS);
    expect(emitFeedback).toHaveBeenCalledWith("gamification", "trophy-unlock", null, {
      haptics: true,
    });
  });

  it("a common item at a calm time stays an inbox row only", () => {
    badge("retro-one", "Retro Regular", 50);
    expect(rows()).toHaveLength(1);
    expect(pending()).toEqual([]);
    expect(isMomentTimerArmed()).toBe(false);
  });

  it("Quiet never plays or holds; Gamification off neither", () => {
    useNotificationPrefsStore.getState().setCelebrationLevel("quiet");
    levelUp(10);
    expect(pending()).toEqual([]);
    expect(isMomentTimerArmed()).toBe(false);
    useNotificationPrefsStore.getState().setCelebrationLevel("balanced");
    useNotificationPrefsStore.getState().setGamificationEnabled(false);
    levelUp(11);
    expect(pending()).toEqual([]);
  });

  it("the chip shows alone when Amr isn't on screen", () => {
    installCelebrationReactions();
    useMascotStore.getState().setReady(false);
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()?.title).toBe("Level 8");
    expect(useMascotStore.getState().reactionQueue).toEqual([]);
  });

  it("Amr doesn't react twice: no cheer right after he answered the action, and tool reactions wait after a cheer", () => {
    const off = installCelebrationReactions();
    noteToolReaction(Date.now());
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()?.title).toBe("Level 8");
    expect(useMascotStore.getState().reactionQueue).toEqual([]);

    off();
    __resetCelebrationReactionsForTests();
    installCelebrationReactions();
    previewMoment();
    expect(useMascotStore.getState().reactionQueue).toEqual(["cheer"]);
    expect(isCheerRecent()).toBe(true);
  });

  it("Preview a moment shows the chip without counting it", () => {
    previewMoment();
    expect(current()).toMatchObject({ title: "Level 8", preview: true });
    expect(useMomentStore.getState().day.count).toBe(0);
    expect(useMomentStore.getState().lastMomentAt).toBeNull();
  });
});

describe("held, never dropped", () => {
  it("holds on a ceremony route, then plays back on the cockpit with a recap of the rest", () => {
    setMomentPathname("/retro");
    badge("retro-one", "Retro Regular", 50);
    challenge();
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    // Waiting on the route: no timer until the route changes.
    expect(isMomentTimerArmed()).toBe(false);
    expect(pending()).toHaveLength(3);
    expect(pending()[0].context).toEqual({ reason: "ceremony", label: "Retro Board" });

    setMomentPathname("/");
    advance(RETRY_MIN_MS);
    expect(current()?.title).toBe("Level 8");
    const recap = rows().find((r) => r.kind === "recap");
    expect(recap).toMatchObject({
      title: "While you were in Retro Board",
      body: "Retro Regular, +1 challenge",
      rarity: "common",
      read: false,
    });
    expect(recap?.children).toHaveLength(2);
    expect(pending()).toEqual([]);
    // Every original row is still in the inbox.
    expect(rows().filter((r) => r.kind !== "recap")).toHaveLength(3);
  });

  it("holds while presenting and plays when presenting ends", async () => {
    document.documentElement.dataset.presenting = "true";
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    expect(pending()[0].context?.reason).toBe("presenting");
    delete document.documentElement.dataset.presenting;
    await Promise.resolve(); // the MutationObserver kicks
    advance(RETRY_MIN_MS);
    expect(current()?.title).toBe("Level 8");
  });

  it("waits out typing with a 2 s → 15 s back-off", () => {
    typing = true;
    levelUp(8);
    advance(RETRY_MIN_MS); // first check: typing
    for (const step of [2_000, 4_000, 8_000, RETRY_MAX_MS, RETRY_MAX_MS]) {
      expect(isMomentTimerArmed()).toBe(true);
      advance(step - 1);
      expect(current()).toBeNull();
      advance(1);
    }
    typing = false;
    advance(RETRY_MAX_MS);
    expect(current()?.title).toBe("Level 8");
  });

  it("waits 1.5 s after the last input", () => {
    sinceInput = 500;
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    sinceInput = INPUT_QUIET_MS;
    advance(RETRY_MIN_MS);
    expect(current()?.title).toBe("Level 8");
  });

  it.each([
    [
      "an open dialog",
      () => {
        const d = document.createElement("div");
        d.setAttribute("role", "dialog");
        d.setAttribute("aria-modal", "true");
        document.body.appendChild(d);
        return () => d.remove();
      },
    ],
    [
      "a toast on screen",
      () => {
        const t = document.createElement("li");
        t.setAttribute("data-sonner-toast", "");
        document.body.appendChild(t);
        return () => t.remove();
      },
    ],
    [
      "Amr's busy queue",
      () => {
        useMascotStore.getState().queueReaction("nod");
        return () => useMascotStore.getState().dequeueReaction();
      },
    ],
    [
      "a drag in progress",
      () => {
        markDragStart();
        return () => markDragEnd();
      },
    ],
    [
      "a hidden tab",
      () => {
        visible = false;
        return () => {
          visible = true;
          document.dispatchEvent(new Event("visibilitychange"));
        };
      },
    ],
  ])("holds for %s, then plays", (_name, block) => {
    const unblock = block();
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    expect(pending()).toHaveLength(1);
    unblock();
    advance(RETRY_MAX_MS);
    expect(current()?.title).toBe("Level 8");
  });

  it("holds while celebrations are paused, until the pause ends", () => {
    useNotificationPrefsStore.getState().pauseCelebrations(60 * 60_000, clock);
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    expect(pending()[0].context?.reason).toBe("paused");
    expect(isMomentTimerArmed()).toBe(true);
    advance(30 * 60_000);
    expect(current()).toBeNull();
    advance(30 * 60_000 + 100);
    expect(current()?.title).toBe("Level 8");
  });

  it("what waits survives a reload (persisted)", () => {
    setMomentPathname("/planning-poker");
    levelUp(8);
    const stored = JSON.parse(localStorage.getItem(MOMENTS_STORAGE_KEY) ?? "{}");
    expect(stored.state.pending).toHaveLength(1);
    expect(stored.state.pending[0]).toMatchObject({ title: "Level 8", rarity: "rare" });
  });
});

describe("limits", () => {
  it("keeps 10 minutes between moments", () => {
    levelUp(8);
    advance(RETRY_MIN_MS);
    useMomentStore.getState().dismiss();
    advance(60_000);
    levelUp(9);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    expect(isMomentTimerArmed()).toBe(true);
    advance(9 * 60_000 - RETRY_MIN_MS - 1_000);
    expect(current()).toBeNull();
    advance(2_000);
    expect(current()?.title).toBe("Level 9");
  });

  it("Lively keeps 2 minutes and plays common unlocks", () => {
    useNotificationPrefsStore.getState().setCelebrationLevel("lively");
    badge("retro-one", "Retro Regular", 50);
    advance(RETRY_MIN_MS);
    expect(current()?.title).toBe("Retro Regular");
    useMomentStore.getState().dismiss();
    badge("kanban-ten", "First Card Done", 25);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    advance(2 * 60_000);
    expect(current()?.title).toBe("First Card Done");
  });

  it("plays at most 3 moments a day, and picks up again the next day", () => {
    clock = new Date(2026, 10, 9, 23, 50).getTime();
    useMomentStore.setState({ day: { date: "2026-11-09", count: 3 } });
    levelUp(8);
    advance(RETRY_MIN_MS);
    expect(current()).toBeNull();
    // A full day doesn't keep a timer running; the next kick re-checks.
    expect(isMomentTimerArmed()).toBe(false);
    clock += 20 * 60_000; // past midnight
    kickMoments();
    advance(RETRY_MIN_MS);
    expect(current()?.title).toBe("Level 8");
    expect(useMomentStore.getState().day).toEqual({ date: "2026-11-10", count: 1 });
  });

  it("the rarest plays; items older than 12 h only go to the recap", () => {
    setMomentPathname("/retro");
    levelUp(8);
    clock += MOMENT_FRESH_MS + 1;
    levelUp(9);
    badge("big-day", "Big Day", 300);
    setMomentPathname("/");
    advance(RETRY_MIN_MS);
    expect(current()).toMatchObject({ title: "Big Day", rarity: "epic" });
    const recap = rows().find((r) => r.kind === "recap");
    expect(recap?.body).toBe("Level 8, Level 9");
  });

  it("nothing runs while idle", () => {
    expect(isMomentTimerArmed()).toBe(false);
    runMomentCheck();
    expect(isMomentTimerArmed()).toBe(false);
  });
});

describe("since last time", () => {
  function previousSession(items: Partial<PendingMoment>[]): void {
    const now = clock - 20 * 60 * 60_000;
    localStorage.setItem(
      MOMENTS_STORAGE_KEY,
      JSON.stringify({
        state: {
          pending: items.map((p, i) => ({
            id: `old-${i}`,
            title: "Old",
            kind: "achievement",
            rarity: "rare",
            icon: "Award",
            at: now,
            count: 1,
            context: { reason: "ceremony", label: "Retro Board" },
            ...p,
          })),
          lastMomentAt: null,
          day: { date: "2026-11-08", count: 1 },
        },
        version: 1,
      })
    );
  }

  async function reload(newSession: boolean, items: Partial<PendingMoment>[]): Promise<void> {
    detach?.();
    __resetMomentsForTests();
    previousSession(items);
    __setMomentEnvForTests({
      now: () => clock,
      typing: () => typing,
      msSinceInput: () => sinceInput,
      visible: () => visible,
    });
    if (newSession) sessionStorage.clear();
    detach = installMomentScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    setMomentPathname("/");
  }

  it("a new session turns what's left into one 'Since last time…' row, once", async () => {
    await reload(true, [
      { title: "Retro Regular" },
      { title: "Challenge done", kind: "challenge" },
    ]);
    expect(pending()).toHaveLength(2);
    advance(RETRY_MIN_MS);
    const recaps = rows().filter((r) => r.kind === "recap");
    expect(recaps).toHaveLength(1);
    expect(recaps[0]).toMatchObject({
      title: "Since last time…",
      body: "Retro Regular, +1 challenge",
    });
    // Older than 12 h: recap only, no moment.
    expect(current()).toBeNull();

    // Same session, something held again: a normal recap, not a second "Since last time…".
    setMomentPathname("/retro");
    badge("retro-one", "Retro Regular", 50);
    levelUp(8);
    setMomentPathname("/");
    advance(RETRY_MIN_MS);
    expect(rows().filter((r) => r.title === "Since last time…")).toHaveLength(1);
    expect(rows().find((r) => r.title === "While you were in Retro Board")).toBeDefined();
  });

  it("a reload in the same session doesn't count as 'since last time'", async () => {
    sessionStorage.setItem("agile-toolkit:moments-session", "1");
    await reload(false, [{ title: "Retro Regular", rarity: "common" }]);
    advance(RETRY_MIN_MS);
    expect(rows().filter((r) => r.kind === "recap")).toHaveLength(0);
    __armSinceLastTimeForTests(false);
  });
});

describe("persisted payload", () => {
  it("migrate keeps unknown fields, drops unreadable entries and is idempotent", () => {
    const raw = {
      pending: [
        { id: "a", title: "Level 8", kind: "level-up", rarity: "rare", at: T0, future: 1 },
        { id: "a", title: "dup", at: T0 },
        { title: "no id", at: T0 },
        { id: "b", title: "bad rarity", rarity: "mythic", at: T0 },
        "junk",
      ],
      lastMomentAt: "x",
      day: { date: "2026-11-09", count: 2 },
      newerField: true,
    };
    const once = migrateMoments(raw);
    expect(once.pending.map((p) => p.id)).toEqual(["a", "b"]);
    expect(once.pending[0]).toMatchObject({ future: 1, count: 1, context: null });
    expect(once.pending[1].rarity).toBe("common");
    expect(once.lastMomentAt).toBeNull();
    expect((once as unknown as Record<string, unknown>).newerField).toBe(true);
    expect(migrateMoments(once)).toEqual(once);
    expect(migrateMoments("garbage")).toEqual({
      pending: [],
      lastMomentAt: null,
      day: { date: "", count: 0 },
    });
  });

  it("onCelebration ignores a row whose moment already played", () => {
    onCelebration({
      id: "x",
      kind: "level-up",
      title: "Level 8",
      icon: "TrendingUp",
      rarity: "rare",
      at: new Date(clock).toISOString(),
      read: false,
      momentShown: true,
    });
    expect(pending()).toEqual([]);
  });

  it("the chip lasts about 4 s", () => {
    expect(CHIP_MS).toBe(4_000);
  });
});
