export type AchievementCategory =
  | "exploration"
  | "tool-mastery"
  | "collaboration"
  | "flow"
  | "delivery"
  | "discovery"
  | "streak"
  | "meta"
  | "secret";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  xp: number;
  icon: string; // lucide icon name
  hidden?: boolean; // show as ??? until unlocked
  /** When unlocked: the event name that triggered it (for provenance). */
  unlocks?: string[];
}

export type XpSource =
  | "click"
  | "hover"
  | "scroll"
  | "focus"
  | "key"
  | "tool-visit"
  | "tool-completed"
  | "entity-added"
  | "entity-resolved"
  | "combo-bonus"
  | "achievement"
  | "daily-challenge"
  | "weekly-challenge"
  | "level-up"
  | "prestige"
  | "secret"
  | "sonification-toggle"
  | "theme-toggle";

export interface XpEvent {
  amount: number;
  source: XpSource;
  multiplier: number;
  comboDepth: number;
  total: number; // total XP after award
  at: string; // ISO timestamp
  meta?: Record<string, string | number | boolean>;
}

export interface ChallengeDef {
  id: string;
  title: string;
  description: string;
  goal: number;
  xp: number;
  /** Event name this challenge listens to. */
  trigger: string;
  /** Optional meta predicate (e.g., only count for a specific toolId). */
  match?: (meta?: Record<string, unknown>) => boolean;
}

export type ChallengeKind = "daily" | "weekly";

export interface ChallengeProgress {
  id: string;
  kind: ChallengeKind;
  progress: number;
  goal: number;
  xp: number;
  completed: boolean;
  completedAt?: string;
  seedDate: string; // YYYY-MM-DD for dailies, YYYY-WW for weeklies
}

export interface VDna {
  /** Opaque visitor id (localStorage-persisted nanoid). */
  visitorId: string;
  /** Optional display name for leaderboard. */
  displayName?: string;
  /** Lifetime XP earned (includes prestige runs). */
  lifetimeXp: number;
  /** XP within the current prestige run. */
  xp: number;
  /** Current level, 1..20. */
  level: number;
  /** Number of prestige resets completed. */
  prestige: number;
  /** Unlocked achievement ids. */
  unlocked: string[];
  /** Tools visited (set-semantics as array for JSON persist). */
  toolsVisited: string[];
  /** Date of last activity (for streak). */
  lastActiveDate: string; // YYYY-MM-DD
  /** Current consecutive-day streak. */
  streak: number;
  /** Longest streak ever. */
  longestStreak: number;
  /** Active daily challenges. */
  dailyChallenges: ChallengeProgress[];
  /** Active weekly challenges. */
  weeklyChallenges: ChallengeProgress[];
  /** Last 50 XP events (rolling window). */
  recentEvents: XpEvent[];
  /** Opt-in for leaderboard sync. */
  shareOnLeaderboard: boolean;
  /** Muted UI (disable level-up toasts etc.). */
  silentMode: boolean;
  /** Counters (generic, used by achievement rules). */
  counters: Record<string, number>;
}

export interface LevelInfo {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress01: number;
  xpIntoLevel: number;
  xpNeededForLevel: number;
  atMax: boolean;
}

export interface GamificationEvent {
  /** Canonical name, e.g. `click:button`, `tool:visit`, `workspace:upsert:decision`. */
  name: string;
  meta?: Record<string, unknown>;
}
