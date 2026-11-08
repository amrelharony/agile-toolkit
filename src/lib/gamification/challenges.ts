import { RESOLVED_OUTCOMES } from "./outcomes";
import type { ChallengeDef, ChallengeKind, ChallengeProgress } from "./types";

/**
 * Daily and weekly challenges: a deterministic pick of 3 per period from a
 * seed of the local date (the seed is the same as it always was).
 *
 * Challenges ask for finished work. Most listen to `outcome:<id>` events
 * from the XP ledger (lib/gamification/outcomes.ts), which fire for every
 * recorded outcome, including ones past a daily XP cap. The synthetic
 * `outcome` trigger fires once for every outcome that counts as work, with
 * its `outcomeId` and `toolId` on the meta. Raw input (clicks, hovers,
 * scrolling, combos, settings) no longer counts.
 *
 * Editing a pool needs no store version bump: the engine's
 * refreshChallengesIfStale() runs sanitizeChallenges() on the stored lists.
 */

/** Challenges picked per day and per week. */
export const CHALLENGES_PER_PERIOD = 3;

const toolOf = (m?: Record<string, unknown>) =>
  typeof m?.toolId === "string" && m.toolId ? m.toolId : undefined;

const isResolved = (m?: Record<string, unknown>) =>
  (RESOLVED_OUTCOMES as readonly string[]).includes(String(m?.outcomeId ?? ""));

export const DAILY_POOL: ChallengeDef[] = [
  {
    id: "d-tools-2",
    title: "Two-Tool Day",
    description: "Finish something in 2 different tools.",
    goal: 2,
    xp: 80,
    trigger: "outcome",
    distinctBy: toolOf,
  },
  {
    id: "d-poker",
    title: "Vote Of Confidence",
    description: "Commit a Planning Poker estimate.",
    goal: 1,
    xp: 60,
    trigger: "outcome:estimate-committed",
  },
  {
    id: "d-retro-card",
    title: "Say Something",
    description: "Add a retro card.",
    goal: 1,
    xp: 60,
    trigger: "tool:retro:card-add",
  },
  {
    id: "d-retro-finish",
    title: "Close the Loop",
    description: "Finish a retro, all the way to its actions.",
    goal: 1,
    xp: 100,
    trigger: "outcome:retro-finished",
  },
  {
    id: "d-kanban-move",
    title: "Done Is Done",
    description: "Move a Kanban card to done.",
    goal: 1,
    xp: 60,
    trigger: "outcome:card-done",
  },
  {
    id: "d-standup-entry",
    title: "Check-In",
    description: "Post your standup.",
    goal: 1,
    xp: 60,
    trigger: "outcome:daily-log",
    match: (m) => ["standup", "async-standup"].includes(String(m?.toolId ?? "")),
  },
  {
    id: "d-risk-add",
    title: "Name the Risk",
    description: "Register a risk.",
    goal: 1,
    xp: 70,
    trigger: "tool:risk-register:risk-added",
  },
  {
    id: "d-mood",
    title: "Temperature Check",
    description: "Log your mood.",
    goal: 1,
    xp: 50,
    trigger: "tool:mood-tracker:logged",
  },
  {
    id: "d-impediment",
    title: "See Something",
    description: "Raise an impediment.",
    goal: 1,
    xp: 60,
    trigger: "tool:impediments:impediment-raised",
  },
  {
    id: "d-resolve",
    title: "Clear the Path",
    description: "Close a risk, resolve an impediment or pay down debt.",
    goal: 1,
    xp: 100,
    trigger: "outcome",
    match: isResolved,
  },
  {
    id: "d-okr-update",
    title: "Check the KR",
    description: "Update a Key Result.",
    goal: 1,
    xp: 70,
    trigger: "tool:okrs:kr-updated",
  },
  {
    id: "d-ceremony-run",
    title: "Time Yourself",
    description: "Run a ceremony timer to the end.",
    goal: 1,
    xp: 80,
    trigger: "outcome:ceremony-finished",
  },
  {
    id: "d-export",
    title: "Ship the Data",
    description: "Export anything.",
    goal: 1,
    xp: 50,
    trigger: "export",
  },
  {
    id: "d-burndown",
    title: "Log It",
    description: "Update burndown data.",
    goal: 1,
    xp: 60,
    trigger: "tool:burndown:day-logged",
  },
  {
    id: "d-cause",
    title: "Worst-Case",
    description: "Add a premortem cause.",
    goal: 1,
    xp: 60,
    trigger: "tool:premortem:cause-added",
  },
  {
    id: "d-kudos",
    title: "Say Thanks",
    description: "Send a kudos.",
    goal: 1,
    xp: 80,
    trigger: "outcome:kudos-sent",
  },
  {
    id: "d-comic",
    title: "Story Time",
    description: "Read an Agile at Work story to the end.",
    goal: 1,
    xp: 60,
    trigger: "outcome:story-read",
  },
];

/** Weekly challenges — longer-form. Reset Monday 00:00 local. */
export const WEEKLY_POOL: ChallengeDef[] = [
  {
    id: "w-tools-5",
    title: "All Over the Toolkit",
    description: "Finish something in 5 different tools this week.",
    goal: 5,
    xp: 400,
    trigger: "outcome",
    distinctBy: toolOf,
  },
  {
    id: "w-xp-600",
    title: "Solid Week",
    description: "Earn 600 XP this week.",
    goal: 600,
    xp: 300,
    trigger: "xp-earned",
  },
  {
    id: "w-retro-finish-2",
    title: "Retrospection",
    description: "Finish 2 retros.",
    goal: 2,
    xp: 600,
    trigger: "outcome:retro-finished",
  },
  {
    id: "w-impediments-5",
    title: "Roadclearer",
    description: "Resolve 5 impediments.",
    goal: 5,
    xp: 700,
    trigger: "outcome:impediment-resolved",
  },
  {
    id: "w-streak-7",
    title: "Daily Devotion",
    description: "Use the toolkit every day this week.",
    goal: 7,
    xp: 800,
    trigger: "daily-active",
  },
  {
    id: "w-mood-5",
    title: "Pulse-Keeper",
    description: "Log mood 5 days this week.",
    goal: 5,
    xp: 400,
    trigger: "tool:mood-tracker:logged",
  },
  {
    id: "w-kanban-done",
    title: "Shipping Cadence",
    description: "Complete 10 Kanban cards.",
    goal: 10,
    xp: 700,
    trigger: "tool:kanban:card-done",
  },
  // engine.registerWeeklyToolVisit fires `tool-visit-week-unique` once per
  // tool per week, so this can be done again every week. The first-ever
  // `tool-visit-unique` it used left it undoable for anyone who had already
  // visited the three tools.
  {
    id: "w-sprint-cycle",
    title: "Full Cycle",
    description: "Use Sprint Goal, Burndown, and Retro this week.",
    goal: 3,
    xp: 900,
    trigger: "tool-visit-week-unique",
    match: (m) => ["sprint-goal", "burndown", "retro"].includes(String(m?.toolId ?? "")),
  },
  {
    id: "w-risks-3",
    title: "Risk Hunter",
    description: "Close 3 risks.",
    goal: 3,
    xp: 500,
    trigger: "outcome:risk-closed",
  },
  {
    id: "w-okr-kr",
    title: "Outcome Focus",
    description: "Update 5 KRs.",
    goal: 5,
    xp: 500,
    trigger: "tool:okrs:kr-updated",
  },
  {
    id: "w-achievements-5",
    title: "Achiever",
    description: "Unlock 5 achievements.",
    goal: 5,
    xp: 600,
    trigger: "achievement-unlocked",
  },
  {
    id: "w-ceremony-3",
    title: "Punctual",
    description: "Run 3 ceremony timers to the end.",
    goal: 3,
    xp: 400,
    trigger: "outcome:ceremony-finished",
  },
  {
    id: "w-debt-3",
    title: "Debt Fighter",
    description: "Resolve 3 tech debt items.",
    goal: 3,
    xp: 500,
    trigger: "outcome:debt-resolved",
  },
  {
    id: "w-kudos-5",
    title: "Gratitude Habit",
    description: "Send 5 kudos this week.",
    goal: 5,
    xp: 500,
    trigger: "outcome:kudos-sent",
  },
];

// ── Deterministic selection ────────────────────────────────────────────

/** Seeded PRNG: mulberry32. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function pick<T>(pool: T[], count: number, seed: number): T[] {
  const rng = mulberry32(seed);
  const copy = pool.slice();
  const picked: T[] = [];
  for (let i = 0; i < count && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

export function todaySeedKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function weekSeedKey(now: Date = new Date()): string {
  // ISO week number (rough — Monday-based).
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function poolOf(kind: ChallengeKind): ChallengeDef[] {
  return kind === "daily" ? DAILY_POOL : WEEKLY_POOL;
}

/** The seed for a period, e.g. `daily:2026-11-08` / `weekly:2026-W45`. */
function seedOf(kind: ChallengeKind, seedDate: string): number {
  return hashString(`${kind}:${seedDate}`);
}

function toProgress(def: ChallengeDef, kind: ChallengeKind, seedDate: string): ChallengeProgress {
  return {
    id: def.id,
    kind,
    progress: 0,
    goal: def.goal,
    xp: def.xp,
    completed: false,
    seedDate,
  };
}

export function pickDailies(
  now: Date = new Date(),
  count = CHALLENGES_PER_PERIOD
): ChallengeProgress[] {
  const seedKey = todaySeedKey(now);
  return pick(DAILY_POOL, count, seedOf("daily", seedKey)).map((c) =>
    toProgress(c, "daily", seedKey)
  );
}

export function pickWeeklies(
  now: Date = new Date(),
  count = CHALLENGES_PER_PERIOD
): ChallengeProgress[] {
  const seedKey = weekSeedKey(now);
  return pick(WEEKLY_POOL, count, seedOf("weekly", seedKey)).map((c) =>
    toProgress(c, "weekly", seedKey)
  );
}

/**
 * Bring a stored list in line with the current pool, with no store version
 * bump:
 *   - a challenge that left the pool is dropped, unless it was completed
 *     (it stays, so "complete all 3" still counts it);
 *   - an unfinished challenge whose goal or reward changed takes the new
 *     values, with its progress kept short of the new goal, so it finishes
 *     (and pays) through the usual path;
 *   - when something was dropped, the list is topped up to 3 from the same
 *     seed, skipping challenges already on it.
 * Returns the same array when nothing changes.
 */
export function sanitizeChallenges(
  list: ChallengeProgress[],
  kind: ChallengeKind
): ChallengeProgress[] {
  if (list.length === 0) return list;
  const find = kind === "daily" ? findDaily : findWeekly;
  let changed = false;
  let dropped = false;
  const kept: ChallengeProgress[] = [];
  for (const c of list) {
    const def = find(c.id);
    if (!def) {
      if (c.completed) kept.push(c);
      else {
        dropped = true;
        changed = true;
      }
      continue;
    }
    if (!c.completed && (c.goal !== def.goal || c.xp !== def.xp)) {
      kept.push({
        ...c,
        goal: def.goal,
        xp: def.xp,
        progress: Math.max(0, Math.min(c.progress, def.goal - 1)),
      });
      changed = true;
      continue;
    }
    kept.push(c);
  }
  if (dropped) {
    const seedDate = list[0].seedDate;
    const have = new Set(kept.map((c) => c.id));
    const pool = poolOf(kind);
    for (const def of pick(pool, pool.length, seedOf(kind, seedDate))) {
      if (kept.length >= CHALLENGES_PER_PERIOD) break;
      if (have.has(def.id)) continue;
      kept.push(toProgress(def, kind, seedDate));
      have.add(def.id);
    }
  }
  return changed ? kept : list;
}

export function findDaily(id: string): ChallengeDef | undefined {
  return DAILY_POOL.find((c) => c.id === id);
}

export function findWeekly(id: string): ChallengeDef | undefined {
  return WEEKLY_POOL.find((c) => c.id === id);
}
