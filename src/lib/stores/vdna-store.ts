import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { VDna, XpEvent, ChallengeProgress } from "@/lib/gamification/types";

function seedVisitorId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = localStorage.getItem("agile-toolkit:vdna-id");
    if (existing) return existing;
    const fresh = nanoid(12);
    localStorage.setItem("agile-toolkit:vdna-id", fresh);
    return fresh;
  } catch {
    return nanoid(12);
  }
}

const initial: VDna = {
  visitorId: "pending",
  displayName: undefined,
  lifetimeXp: 0,
  xp: 0,
  level: 1,
  prestige: 0,
  unlocked: [],
  toolsVisited: [],
  lastActiveDate: "",
  streak: 0,
  longestStreak: 0,
  dailyChallenges: [],
  weeklyChallenges: [],
  recentEvents: [],
  shareOnLeaderboard: false,
  silentMode: false,
  counters: {},
};

interface VDnaActions {
  /** Replace the entire state (used by engine on mutations). */
  apply: (patch: Partial<VDna>) => void;
  /** Push a new XP event, trims to last 50. */
  pushEvent: (e: XpEvent) => void;
  /** Replace tools visited. */
  setToolsVisited: (list: string[]) => void;
  /** Replace unlocked achievements. */
  setUnlocked: (list: string[]) => void;
  /** Replace daily challenges. */
  setDailyChallenges: (list: ChallengeProgress[]) => void;
  /** Replace weekly challenges. */
  setWeeklyChallenges: (list: ChallengeProgress[]) => void;
  /** Increment a named counter. */
  bumpCounter: (key: string, by?: number) => number;
  /** Reset for prestige (keeps visitorId, lifetimeXp, unlocked, streak). */
  prestigeReset: () => void;
  /** Settings toggles. */
  setDisplayName: (name: string | undefined) => void;
  setShareOnLeaderboard: (v: boolean) => void;
  setSilentMode: (v: boolean) => void;
}

export const useVDnaStore = create<VDna & VDnaActions>()(
  persist(
    (set, get) => ({
      ...initial,
      apply: (patch) => set(patch),
      pushEvent: (e) =>
        set((s) => ({ recentEvents: [e, ...s.recentEvents].slice(0, 50) })),
      setToolsVisited: (list) => set({ toolsVisited: list }),
      setUnlocked: (list) => set({ unlocked: list }),
      setDailyChallenges: (list) => set({ dailyChallenges: list }),
      setWeeklyChallenges: (list) => set({ weeklyChallenges: list }),
      bumpCounter: (key, by = 1) => {
        // R5: previously used sequential `get()` reads — two concurrent
        // `bumpCounter("xp")` calls each saw the SAME pre-state and the
        // second clobbered the first (lost increment). Compute INSIDE
        // the functional updater so both reads share one snapshot —
        // critical for the gamification path which fires bursts of XP
        // events synchronously after a tool action.
        let nextVal = 0;
        set((s) => {
          const cur = s.counters[key] ?? 0;
          nextVal = cur + by;
          return { counters: { ...s.counters, [key]: nextVal } };
        });
        return nextVal;
      },
      prestigeReset: () =>
        set((s) => ({
          xp: 0,
          level: 1,
          prestige: s.prestige + 1,
          dailyChallenges: [],
          weeklyChallenges: [],
          counters: {}, // reset per-run counters
        })),
      setDisplayName: (name) => set({ displayName: name }),
      setShareOnLeaderboard: (v) => set({ shareOnLeaderboard: v }),
      setSilentMode: (v) => set({ silentMode: v }),
    }),
    {
      name: "agile-toolkit:vdna",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") return localStorage;
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state && state.visitorId === "pending") {
          state.visitorId = seedVisitorId();
        }
      },
    }
  )
);

export function getVDnaSnapshot(): VDna {
  const s = useVDnaStore.getState();
  return {
    visitorId: s.visitorId,
    displayName: s.displayName,
    lifetimeXp: s.lifetimeXp,
    xp: s.xp,
    level: s.level,
    prestige: s.prestige,
    unlocked: s.unlocked,
    toolsVisited: s.toolsVisited,
    lastActiveDate: s.lastActiveDate,
    streak: s.streak,
    longestStreak: s.longestStreak,
    dailyChallenges: s.dailyChallenges,
    weeklyChallenges: s.weeklyChallenges,
    recentEvents: s.recentEvents,
    shareOnLeaderboard: s.shareOnLeaderboard,
    silentMode: s.silentMode,
    counters: s.counters,
  };
}
