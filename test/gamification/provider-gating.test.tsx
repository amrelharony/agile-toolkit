import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How GamificationProvider turns engine effects into celebrations. Since the
 * Activity inbox (PR H) they never toast: every level, badge, challenge and
 * prestige lands silently in the inbox and nothing is dropped: not on a
 * ceremony route, not while presenting, not in silent mode, not by a
 * throttle. The old `NEXT_PUBLIC_CELEBRATIONS=legacy` kill switch is gone.
 */

const h = vi.hoisted(() => ({
  pathname: "/" as string | null,
  // Several provider effects subscribe (the XP log, the celebrations).
  subscribers: new Set<(effect: { kind: string; payload: unknown }) => void>(),
  appendXpEvent: vi.fn(),
  trackPathVisit: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/gamification/supabase-sync", () => ({
  scheduleProfileSync: vi.fn(),
  cancelProfileSync: vi.fn(),
  fetchLeaderboard: vi.fn(async () => []),
}));
vi.mock("@/lib/gamification/engine", () => ({
  subscribe: (fn: (effect: { kind: string; payload: unknown }) => void) => {
    h.subscribers.add(fn);
    return () => {
      h.subscribers.delete(fn);
    };
  },
  installWindowBridge: () => {},
}));
vi.mock("@/lib/gamification/event-bridge", () => ({
  installEventBridge: () => () => {},
  trackPathVisit: h.trackPathVisit,
}));
vi.mock("@/lib/gamification/secrets", () => ({ installSecretDetector: () => () => {} }));
vi.mock("@/lib/gamification/opfs", () => ({ appendXpEvent: h.appendXpEvent }));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));

import { GamificationProvider } from "@/lib/gamification/provider";
import { __resetLegacySilentModeForTests, useVDnaStore } from "@/lib/stores/vdna-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { useInboxStore } from "@/lib/notify/inbox-store";
import { __resetCelebrationsForTests, flushCelebrations } from "@/lib/gamification/celebrations";

const LEVEL_UP = { kind: "level-up", payload: { level: 8 } };
const ACHIEVEMENT = {
  kind: "achievement",
  payload: { id: "retro-one", title: "Retro Regular", xp: 50 },
};
const CHALLENGE = {
  kind: "challenge-complete",
  payload: { id: "d-kudos", kind: "daily", xp: 30 },
};
const PRESTIGE = { kind: "prestige", payload: {} };
const XP = { kind: "xp", payload: { amount: 5, source: "tool:retro", at: "2026-11-08T09:00:00Z" } };

function emit(effect: { kind: string; payload: unknown }) {
  act(() => {
    h.subscribers.forEach((fn) => fn(effect));
  });
}

function shownCount() {
  return (
    h.toast.mock.calls.length + h.toast.success.mock.calls.length + h.toast.info.mock.calls.length
  );
}

function mount() {
  return render(<GamificationProvider>{null}</GamificationProvider>);
}

/** Close the 1.5 s same-action window now, then wait for the inbox write. */
async function settle(count: number) {
  act(() => flushCelebrations());
  await waitFor(() => expect(useInboxStore.getState().items).toHaveLength(count));
  return useInboxStore.getState().items;
}

async function tick() {
  await act(() => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(() => {
  localStorage.clear();
  h.pathname = "/";
  h.subscribers.clear();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetCelebrationsForTests();
  __resetLegacySilentModeForTests();
  delete document.documentElement.dataset.presenting;
  act(() => {
    useVDnaStore.setState({ visitorId: "v-1" });
    useInboxStore.setState({ items: [], seeded: true });
  });
});

afterEach(() => {
  delete document.documentElement.dataset.presenting;
  vi.unstubAllEnvs();
});

describe("GamificationProvider silent celebrations", () => {
  it("a level-up lands in the inbox, not in a toast", async () => {
    mount();
    emit(LEVEL_UP);
    const [row] = await settle(1);
    expect(row).toMatchObject({ kind: "level-up", title: "Level 8", read: false });
    expect(row.body).toMatch(/got you here\.$/);
    expect(shownCount()).toBe(0);
  });

  it("an achievement row carries its XP and description", async () => {
    mount();
    emit(ACHIEVEMENT);
    const [row] = await settle(1);
    expect(row).toMatchObject({ kind: "achievement", title: "Retro Regular", xp: 50 });
    expect(row.body).toBeTruthy();
    expect(shownCount()).toBe(0);
  });

  it("a challenge lands in the day's challenge row", async () => {
    mount();
    emit(CHALLENGE);
    const [row] = await settle(1);
    expect(row.kind).toBe("challenge");
    expect(row.title).toMatch(/^Challenge done/);
    expect(row.mergeKey).toMatch(/^challenge:\d{4}-\d{2}-\d{2}$/);
    expect(shownCount()).toBe(0);
  });

  it("records XP to the OPFS log with the visitor id; XP is neither a toast nor a row", async () => {
    mount();
    emit(XP);
    expect(h.appendXpEvent).toHaveBeenCalledWith(expect.objectContaining({ amount: 5 }));
    expect(h.appendXpEvent.mock.calls[0][0].visitorId).toBeTruthy();
    act(() => flushCelebrations());
    await tick();
    expect(useInboxStore.getState().items).toHaveLength(0);
    expect(shownCount()).toBe(0);
  });

  it("Quiet celebrations (the old silent mode) drop nothing: rows still land", async () => {
    mount();
    act(() => {
      useNotificationPrefsStore.setState({ celebrationLevel: "quiet" });
    });
    emit(PRESTIGE);
    emit(CHALLENGE);
    const rows = await settle(2);
    expect(rows.map((r) => r.kind).sort()).toEqual(["challenge", "prestige"]);
    expect(shownCount()).toBe(0);
  });

  it("on a ceremony route a celebration is held in the inbox, not dropped", async () => {
    h.pathname = "/retro";
    const view = mount();
    emit(LEVEL_UP);
    const [row] = await settle(1);
    expect(row.title).toBe("Level 8");
    h.pathname = "/";
    view.rerender(<GamificationProvider>{null}</GamificationProvider>);
    expect(shownCount()).toBe(0);
    expect(useInboxStore.getState().items).toHaveLength(1);
  });

  it("presenting mode keeps celebrations in the inbox", async () => {
    document.documentElement.dataset.presenting = "true";
    mount();
    emit(LEVEL_UP);
    emit(ACHIEVEMENT);
    const [row] = await settle(1);
    expect(row.children?.length).toBe(1);
    expect(shownCount()).toBe(0);
  });

  it("no throttle: one action's level and badge share a row, the challenge gets its own", async () => {
    mount();
    emit(LEVEL_UP);
    emit(ACHIEVEMENT);
    emit(CHALLENGE);
    const rows = await settle(2);
    const merged = rows.find((r) => r.kind !== "challenge")!;
    // The level-up (rare) leads; the 50 XP badge rides along.
    expect(merged.title).toBe("Level 8");
    expect(merged.children?.map((c) => c.title)).toEqual(["Retro Regular"]);
    expect(merged.xp).toBe(50);
    expect(rows.some((r) => r.kind === "challenge")).toBe(true);
  });

  it("prestige follows the same rules: a legendary row, no toast", async () => {
    h.pathname = "/retro";
    document.documentElement.dataset.presenting = "true";
    mount();
    emit(PRESTIGE);
    const [row] = await settle(1);
    expect(row).toMatchObject({ kind: "prestige", rarity: "legendary" });
    expect(shownCount()).toBe(0);
  });

  it("gives an existing profile one 'progress carried over' row, once", async () => {
    act(() => {
      useInboxStore.setState({ items: [], seeded: false });
      useVDnaStore.setState({ xp: 900, level: 4, unlocked: ["retro-one", "first-win"] });
    });
    try {
      const first = mount();
      await waitFor(() => expect(useInboxStore.getState().seeded).toBe(true));
      expect(useInboxStore.getState().items).toHaveLength(1);
      expect(useInboxStore.getState().items[0]).toMatchObject({
        kind: "carried-over",
        body: "Level 4, 2 badges",
      });
      first.unmount();
      mount();
      await tick();
      expect(useInboxStore.getState().items).toHaveLength(1);
    } finally {
      act(() => {
        useVDnaStore.setState({ xp: 0, level: 1, unlocked: [] });
      });
    }
  });

  it("a brand-new profile gets no carried-over row", async () => {
    act(() => {
      useInboxStore.setState({ items: [], seeded: false });
      useVDnaStore.setState({ xp: 0, level: 1, unlocked: [] });
    });
    mount();
    await waitFor(() => expect(useInboxStore.getState().seeded).toBe(true));
    expect(useInboxStore.getState().items).toHaveLength(0);
  });
});

describe("GamificationProvider without the legacy kill switch", () => {
  it("ignores NEXT_PUBLIC_CELEBRATIONS=legacy: rows still go to the inbox, no toasts", async () => {
    vi.stubEnv("NEXT_PUBLIC_CELEBRATIONS", "legacy");
    mount();
    emit(LEVEL_UP);
    emit(PRESTIGE);
    await settle(1);
    expect(shownCount()).toBe(0);
  });
});

describe("GamificationProvider silent-mode adoption", () => {
  beforeEach(() => {
    act(() => {
      useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
    });
    localStorage.removeItem("agile-toolkit:notification-prefs");
  });

  it("maps a stored silent mode to Quiet celebrations once both stores load", async () => {
    // A v1 profile with silent mode on: vdna v2 drops the field on load, but
    // the store notes it first so the level still becomes Quiet.
    localStorage.setItem(
      "agile-toolkit:vdna",
      JSON.stringify({ state: { visitorId: "v-1", xp: 0, silentMode: true }, version: 1 })
    );
    mount();
    await waitFor(() => expect(useNotificationPrefsStore.getState().silentModeAdopted).toBe(true));
    expect(useNotificationPrefsStore.getState().celebrationLevel).toBe("quiet");
  });

  it("keeps Balanced when silent mode was off", async () => {
    mount();
    await waitFor(() => expect(useNotificationPrefsStore.getState().silentModeAdopted).toBe(true));
    expect(useNotificationPrefsStore.getState().celebrationLevel).toBe("balanced");
  });

  it("does not map again after the first time", async () => {
    const adopt = useNotificationPrefsStore.getState().adoptSilentMode;
    const spy = vi.fn((silentMode: boolean) => adopt(silentMode));
    act(() => {
      useNotificationPrefsStore.setState({
        silentModeAdopted: true,
        celebrationLevel: "lively",
        adoptSilentMode: spy,
      });
    });
    localStorage.setItem(
      "agile-toolkit:vdna",
      JSON.stringify({ state: { visitorId: "v-1", xp: 0, silentMode: true }, version: 1 })
    );
    mount();
    // Wait until the provider has actually asked to adopt (after both
    // stores rehydrated), so the check below can't pass by running early.
    await waitFor(() => expect(spy).toHaveBeenCalledWith(true));
    await tick();
    expect(useNotificationPrefsStore.getState()).toMatchObject({
      silentModeAdopted: true,
      celebrationLevel: "lively",
    });
  });
});

describe("GamificationProvider tool visits", () => {
  it("tracks the pathname on mount and on every navigation", () => {
    h.pathname = "/retro";
    const view = mount();
    expect(h.trackPathVisit).toHaveBeenLastCalledWith("/retro");
    h.pathname = "/planning-poker";
    view.rerender(<GamificationProvider>{null}</GamificationProvider>);
    expect(h.trackPathVisit).toHaveBeenLastCalledWith("/planning-poker");
    expect(h.trackPathVisit).toHaveBeenCalledTimes(2);
  });
});
