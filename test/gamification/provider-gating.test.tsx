import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of how GamificationProvider turns engine effects into
 * celebration toasts TODAY (before the notification redesign). The redesign
 * moves celebrations to the Activity inbox and Amr moments (PR H/I); when it
 * does, this file is updated deliberately. Rows marked "today:" pin current
 * behaviour the plan calls out as wrong, so a change to them is visible.
 */

const h = vi.hoisted(() => ({
  pathname: "/" as string | null,
  subscriber: null as ((effect: { kind: string; payload: unknown }) => void) | null,
  appendXpEvent: vi.fn(),
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
    h.subscriber = fn;
    return () => {
      if (h.subscriber === fn) h.subscriber = null;
    };
  },
  installWindowBridge: () => {},
}));
vi.mock("@/lib/gamification/event-bridge", () => ({ installEventBridge: () => () => {} }));
vi.mock("@/lib/gamification/secrets", () => ({ installSecretDetector: () => () => {} }));
vi.mock("@/lib/gamification/opfs", () => ({ appendXpEvent: h.appendXpEvent }));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));

import { GamificationProvider } from "@/lib/gamification/provider";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";

const LEVEL_UP = { kind: "level-up", payload: { level: 8 } };
const ACHIEVEMENT = {
  kind: "achievement",
  payload: { id: "retro-one", title: "Retro Regular", xp: 50 },
};
const CHALLENGE = { kind: "challenge-complete", payload: { xp: 30 } };
const PRESTIGE = { kind: "prestige", payload: {} };
const XP = { kind: "xp", payload: { amount: 5, source: "tool:retro", at: "2026-11-08T09:00:00Z" } };

function emit(effect: { kind: string; payload: unknown }) {
  act(() => {
    h.subscriber?.(effect);
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

beforeEach(() => {
  localStorage.clear();
  h.pathname = "/";
  h.subscriber = null;
  vi.clearAllMocks();
  delete document.documentElement.dataset.presenting;
  act(() => {
    useVDnaStore.setState({ silentMode: false, visitorId: "v-1" });
  });
});

afterEach(() => {
  delete document.documentElement.dataset.presenting;
});

describe("GamificationProvider celebration gating (characterization)", () => {
  it("shows a level-up toast on a normal route", () => {
    mount();
    emit(LEVEL_UP);
    expect(h.toast.success).toHaveBeenCalledWith("Level 8!", {
      description: "New milestone unlocked.",
    });
  });

  it("shows an achievement toast with its XP and description", () => {
    mount();
    emit(ACHIEVEMENT);
    expect(h.toast.success).toHaveBeenCalledTimes(1);
    const [title, opts] = h.toast.success.mock.calls[0];
    expect(title).toBe("Achievement: Retro Regular");
    expect(opts.description).toMatch(/^\+50 XP/);
  });

  it("shows a challenge toast through toast.info", () => {
    mount();
    emit(CHALLENGE);
    expect(h.toast.info).toHaveBeenCalledWith("Challenge complete!", { description: "+30 XP" });
  });

  it("records XP to the OPFS log with the visitor id and never toasts for it", () => {
    mount();
    emit(XP);
    expect(h.appendXpEvent).toHaveBeenCalledWith(expect.objectContaining({ amount: 5 }));
    expect(h.appendXpEvent.mock.calls[0][0].visitorId).toBeTruthy();
    expect(shownCount()).toBe(0);
  });

  it("silent mode suppresses every celebration, prestige included", () => {
    mount();
    act(() => {
      useVDnaStore.setState({ silentMode: true });
    });
    emit(LEVEL_UP);
    emit(ACHIEVEMENT);
    emit(CHALLENGE);
    emit(PRESTIGE);
    expect(shownCount()).toBe(0);
  });

  it("today: a celebration on a quiet (ceremony) route is dropped, not held", () => {
    h.pathname = "/retro";
    const view = mount();
    emit(LEVEL_UP);
    expect(shownCount()).toBe(0);

    // Leaving the ceremony does not bring it back.
    h.pathname = "/";
    view.rerender(<GamificationProvider>{null}</GamificationProvider>);
    expect(shownCount()).toBe(0);
  });

  it("today: presenting mode drops celebrations", () => {
    document.documentElement.dataset.presenting = "true";
    mount();
    emit(LEVEL_UP);
    emit(ACHIEVEMENT);
    expect(shownCount()).toBe(0);
  });

  it("today: celebrations share one throttle and the loser is dropped", () => {
    mount();
    emit(LEVEL_UP);
    emit(ACHIEVEMENT);
    emit(CHALLENGE);
    expect(h.toast.success).toHaveBeenCalledTimes(1);
    expect(h.toast.success.mock.calls[0][0]).toBe("Level 8!");
    expect(h.toast.info).not.toHaveBeenCalled();
  });

  it("today: prestige ignores quiet routes, presenting and the throttle", () => {
    h.pathname = "/retro";
    document.documentElement.dataset.presenting = "true";
    mount();
    emit(PRESTIGE);
    emit(PRESTIGE);
    expect(h.toast.success).toHaveBeenCalledTimes(2);
    expect(h.toast.success.mock.calls[0][0]).toBe("Prestige!");
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
    act(() => {
      useVDnaStore.setState({ silentMode: true });
    });
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
    act(() => {
      useNotificationPrefsStore.setState({ silentModeAdopted: true, celebrationLevel: "lively" });
      useVDnaStore.setState({ silentMode: true });
    });
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(useNotificationPrefsStore.getState().celebrationLevel).toBe("lively");
  });
});
