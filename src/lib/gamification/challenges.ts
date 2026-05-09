import type { ChallengeDef, ChallengeKind, ChallengeProgress } from "./types";

/**
 * 30 daily challenges — deterministic random pick of 3 per day based on local
 * date seed.  Each challenge ties to a trigger event name.
 */
export const DAILY_POOL: ChallengeDef[] = [
  { id: "d-click-10", title: "Get Clicking", description: "Click 10 times.", goal: 10, xp: 50, trigger: "click" },
  { id: "d-hover-50", title: "Browse Around", description: "Hover 50 interactive elements.", goal: 50, xp: 50, trigger: "hover" },
  { id: "d-tool-3", title: "Three's a Crowd", description: "Visit 3 different tools.", goal: 3, xp: 80, trigger: "tool-visit" },
  { id: "d-combo-3", title: "Combo Chain", description: "Chain a x3 combo.", goal: 1, xp: 120, trigger: "combo-reached-3" },
  { id: "d-theme-flip", title: "Mood Light", description: "Toggle your theme.", goal: 1, xp: 40, trigger: "theme-toggle" },
  { id: "d-audio", title: "Turn It Up", description: "Enable sonification.", goal: 1, xp: 40, trigger: "sonification-on" },
  { id: "d-poker", title: "Vote Of Confidence", description: "Cast a Planning Poker vote.", goal: 1, xp: 60, trigger: "tool:planning-poker:vote" },
  { id: "d-retro-card", title: "Say Something", description: "Add a retro card.", goal: 1, xp: 60, trigger: "tool:retro:card-add" },
  { id: "d-kanban-move", title: "Move It Along", description: "Move a Kanban card.", goal: 1, xp: 60, trigger: "tool:kanban:card-move" },
  { id: "d-standup-entry", title: "Check-In", description: "Add a standup entry.", goal: 1, xp: 60, trigger: "tool:standup:entry-added" },
  { id: "d-risk-add", title: "Name the Risk", description: "Register a risk.", goal: 1, xp: 70, trigger: "tool:risk-register:risk-added" },
  { id: "d-mood", title: "Temperature Check", description: "Log your mood.", goal: 1, xp: 50, trigger: "tool:mood-tracker:logged" },
  { id: "d-impediment", title: "See Something", description: "Raise an impediment.", goal: 1, xp: 60, trigger: "tool:impediments:impediment-raised" },
  { id: "d-resolve", title: "Clear the Path", description: "Resolve an impediment.", goal: 1, xp: 100, trigger: "tool:impediments:impediment-resolved" },
  { id: "d-okr-update", title: "Check the KR", description: "Update a Key Result.", goal: 1, xp: 70, trigger: "tool:okrs:kr-updated" },
  { id: "d-ceremony-run", title: "Time Yourself", description: "Run a ceremony timer.", goal: 1, xp: 80, trigger: "tool:ceremony-timer:start" },
  { id: "d-export", title: "Ship the Data", description: "Export anything.", goal: 1, xp: 50, trigger: "export" },
  { id: "d-prompt", title: "Ask the AI", description: "Copy an AI prompt.", goal: 1, xp: 60, trigger: "prompt-copied" },
  { id: "d-decision", title: "Lock It In", description: "Write an ADR.", goal: 1, xp: 100, trigger: "tool:decision-log:adr-new" },
  { id: "d-debt", title: "Take Inventory", description: "Log a tech debt item.", goal: 1, xp: 60, trigger: "tool:tech-debt:debt-added" },
  { id: "d-hypothesis", title: "Make a Bet", description: "Add a hypothesis.", goal: 1, xp: 70, trigger: "tool:hypothesis-tracker:hypothesis-added" },
  { id: "d-burndown", title: "Log It", description: "Update burndown data.", goal: 1, xp: 60, trigger: "tool:burndown:day-logged" },
  { id: "d-velocity", title: "Track Velocity", description: "Record a sprint's velocity.", goal: 1, xp: 60, trigger: "tool:velocity:sprint-added" },
  { id: "d-story", title: "Map a Journey", description: "Drag a story card.", goal: 1, xp: 50, trigger: "drag-drop" },
  { id: "d-pi-team", title: "Gather the Team", description: "Add a team to PI Planning.", goal: 1, xp: 80, trigger: "tool:pi-planning:team-added" },
  { id: "d-interview", title: "Listen Up", description: "Log a user interview.", goal: 1, xp: 80, trigger: "tool:user-interviews:interview-new" },
  { id: "d-opp-node", title: "Root Cause", description: "Add an opportunity node.", goal: 1, xp: 60, trigger: "tool:opportunity-tree:node-added" },
  { id: "d-cause", title: "Worst-Case", description: "Add a premortem cause.", goal: 1, xp: 60, trigger: "tool:premortem:cause-added" },
  { id: "d-scroll", title: "All The Way Down", description: "Scroll to the bottom of a page.", goal: 1, xp: 40, trigger: "scroll-floor" },
  { id: "d-secret", title: "?", description: "Find a secret.", goal: 1, xp: 200, trigger: "secret-found" },
];

/** 20 weekly challenges — longer-form.  Reset Monday 00:00 local. */
export const WEEKLY_POOL: ChallengeDef[] = [
  { id: "w-explore-10", title: "Explorer", description: "Visit 10 different tools this week.", goal: 10, xp: 400, trigger: "tool-visit" },
  { id: "w-click-500", title: "Button Masher", description: "500 clicks this week.", goal: 500, xp: 300, trigger: "click" },
  { id: "w-xp-2000", title: "XP Grind", description: "Earn 2000 XP this week.", goal: 2000, xp: 500, trigger: "xp-earned" },
  { id: "w-retro-complete", title: "Retrospection", description: "Complete 2 retros.", goal: 2, xp: 600, trigger: "tool:retro:phase-advance" },
  { id: "w-impediments-5", title: "Roadclearer", description: "Resolve 5 impediments.", goal: 5, xp: 700, trigger: "tool:impediments:impediment-resolved" },
  { id: "w-streak-7", title: "Daily Devotion", description: "Use the toolkit every day this week.", goal: 7, xp: 800, trigger: "daily-active" },
  { id: "w-mood-5", title: "Pulse-Keeper", description: "Log mood 5 days this week.", goal: 5, xp: 400, trigger: "tool:mood-tracker:logged" },
  { id: "w-all-formats", title: "Retro Connoisseur", description: "Use 3 different retro formats.", goal: 3, xp: 500, trigger: "tool:retro:format-selected" },
  { id: "w-kanban-done", title: "Shipping Cadence", description: "Complete 10 Kanban cards.", goal: 10, xp: 700, trigger: "tool:kanban:card-done" },
  { id: "w-sprint-cycle", title: "Full Cycle", description: "Use Sprint Goal, Burndown, and Retro.", goal: 3, xp: 900, trigger: "tool-visit-unique", match: (m) => ["sprint-goal","burndown","retro"].includes(String(m?.toolId ?? "")) },
  { id: "w-combos-10", title: "Flow Maestro", description: "Trigger 10 x3+ combos.", goal: 10, xp: 600, trigger: "combo-reached-3" },
  { id: "w-adr-3", title: "Documentarian", description: "Write 3 ADRs.", goal: 3, xp: 500, trigger: "tool:decision-log:adr-new" },
  { id: "w-risk-close", title: "Risk Hunter", description: "Close 3 risks.", goal: 3, xp: 500, trigger: "tool:risk-register:close" },
  { id: "w-okr-kr", title: "Outcome Focus", description: "Update 5 KRs.", goal: 5, xp: 500, trigger: "tool:okrs:kr-updated" },
  { id: "w-workspace-push", title: "Data Unifier", description: "Push to workspace 5 times.", goal: 5, xp: 400, trigger: "workspace-push" },
  { id: "w-achievements-5", title: "Achiever", description: "Unlock 5 achievements.", goal: 5, xp: 600, trigger: "achievement-unlocked" },
  { id: "w-hypotheses-3", title: "Scientist", description: "Track 3 hypotheses.", goal: 3, xp: 500, trigger: "tool:hypothesis-tracker:hypothesis-added" },
  { id: "w-interview-5", title: "Ethnographer", description: "Log 5 user interviews.", goal: 5, xp: 700, trigger: "tool:user-interviews:interview-new" },
  { id: "w-ceremony-3", title: "Punctual", description: "Run 3 ceremony timers.", goal: 3, xp: 400, trigger: "tool:ceremony-timer:start" },
  { id: "w-debt-3", title: "Debt Fighter", description: "Resolve 3 tech debt items.", goal: 3, xp: 500, trigger: "tool:tech-debt:debt-resolved" },
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

export function pickDailies(now: Date = new Date(), count = 3): ChallengeProgress[] {
  const seedKey = todaySeedKey(now);
  const picked = pick(DAILY_POOL, count, hashString(`daily:${seedKey}`));
  return picked.map((c) => ({
    id: c.id,
    kind: "daily" as ChallengeKind,
    progress: 0,
    goal: c.goal,
    xp: c.xp,
    completed: false,
    seedDate: seedKey,
  }));
}

export function pickWeeklies(now: Date = new Date(), count = 3): ChallengeProgress[] {
  const seedKey = weekSeedKey(now);
  const picked = pick(WEEKLY_POOL, count, hashString(`weekly:${seedKey}`));
  return picked.map((c) => ({
    id: c.id,
    kind: "weekly" as ChallengeKind,
    progress: 0,
    goal: c.goal,
    xp: c.xp,
    completed: false,
    seedDate: seedKey,
  }));
}

export function findDaily(id: string): ChallengeDef | undefined {
  return DAILY_POOL.find((c) => c.id === id);
}

export function findWeekly(id: string): ChallengeDef | undefined {
  return WEEKLY_POOL.find((c) => c.id === id);
}
