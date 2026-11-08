/**
 * Notification copy, in one calm voice: say what happened, plainly. No
 * capitals for effect, no exclamation marks, no "Successfully".
 *
 *   Write "Level 8" + "Retros and closed risks got you here."
 *   Not   "LEVEL UP!!!"
 *
 * Pure strings (no "use client"), shared by the celebrations, the Activity
 * panel and (later) the moment chip.
 */

/** Short plural labels for what an outcome is, used in "… got you here". */
const OUTCOME_LABEL: Record<string, string> = {
  "retro-finished": "Retros",
  "ceremony-finished": "Ceremonies",
  "estimate-committed": "Estimates",
  "sprint-closed": "Closed sprints",
  "risk-closed": "Closed risks",
  "impediment-resolved": "Cleared impediments",
  "debt-resolved": "Paid-down debt",
  "other-resolved": "Resolved items",
  "okr-achieved": "OKRs",
  "hypothesis-decided": "Tested hypotheses",
  "premortem-completed": "Pre-mortems",
  "card-done": "Finished cards",
  "daily-log": "Daily check-ins",
  "kudos-sent": "Kudos",
  "kudos-received": "Kudos from your team",
  "story-read": "Stories",
};

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function levelTitle(level: number): string {
  return `Level ${level}`;
}

/**
 * "Retros and closed risks got you here." from the outcomes that earned the
 * most recent XP, most frequent first. Generic when none are known.
 */
export function levelBody(recentOutcomeIds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const id of recentOutcomeIds) {
    if (!OUTCOME_LABEL[id]) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => OUTCOME_LABEL[id]);
  if (top.length === 0) return "Finished work got you here.";
  if (top.length === 1) return `${top[0]} got you here.`;
  return `${top[0]} and ${lowerFirst(top[1])} got you here.`;
}

export function xpLine(xp: number): string {
  return `+${xp} XP`;
}

export function challengeTitle(title: string | undefined): string {
  return title ? `Challenge done: ${title}` : "Challenge done";
}

export function challengesGroupTitle(count: number): string {
  return count === 1 ? "Challenge done" : `${count} challenges done today`;
}

export function prestigeTitle(prestige: number): string {
  return prestige > 1 ? `Prestige ${prestige}` : "Prestige";
}

export const PRESTIGE_BODY = "Back to level 1, with a prestige badge to show for it.";

export const KUDOS_RECEIVED_TITLE = "You received kudos";

export const XP_CAP_TITLE = "Today's XP is full";
export const XP_CAP_BODY = "Badges and challenges still count. XP starts again tomorrow.";

export const CARRIED_OVER_TITLE = "Your progress carried over";

export function carriedOverBody(level: number, badges: number): string {
  return `Level ${level}, ${badges} ${badges === 1 ? "badge" : "badges"}`;
}

/** "120 XP to Level 8 · Today 60/300". */
export function progressLine(
  xpToNext: number,
  nextLevel: number,
  todayXp: number,
  dailyCap: number,
  atMax: boolean
): string {
  const head = atMax ? "Top level reached" : `${xpToNext} XP to Level ${nextLevel}`;
  return `${head} · Today ${Math.min(todayXp, dailyCap)}/${dailyCap}`;
}

// ---------------------------------------------------------------------------
// Moments and recaps (moment-scheduler.ts, moment-chip.tsx)
// ---------------------------------------------------------------------------

/** "Level 8 · tap to see": the chip beside Amr. */
export function momentChipText(title: string): string {
  return `${title} · tap to see`;
}

/** What a held item waited through, for the recap row's title. */
export interface RecapContext {
  reason: string;
  /** The tool's name, for a ceremony route ("Retro Board"). */
  label?: string;
}

export const SINCE_LAST_TIME_TITLE = "Since last time…";

/** "While you were in Retro Board", "While you were presenting", … */
export function recapTitle(context: RecapContext | null | undefined): string {
  switch (context?.reason) {
    case "ceremony":
      return context.label ? `While you were in ${context.label}` : "While you were in a ceremony";
    case "presenting":
      return "While you were presenting";
    case "focus":
      return "While you were in Focus";
    case "quiet-hours":
      return "During quiet hours";
    case "paused":
      return "While celebrations were paused";
    case "intro":
      return "While the intro played";
    default:
      return "While you were busy";
  }
}

/** One held item, as the recap body counts it. */
export interface RecapEntry {
  title: string;
  kind: string;
  /** How many items the row stands for (a grouped challenge row). */
  count?: number;
}

/**
 * "Retro Regular, +1 challenge": up to two named items, then challenges and
 * anything else as counts.
 */
export function recapBody(entries: readonly RecapEntry[]): string {
  const named: string[] = [];
  let challenges = 0;
  let more = 0;
  for (const e of entries) {
    if (e.kind === "challenge") {
      challenges += Math.max(1, e.count ?? 1);
    } else if (named.length < 2) {
      named.push(e.title);
    } else {
      more += 1;
    }
  }
  const parts = [...named];
  if (challenges > 0) parts.push(`+${challenges} ${challenges === 1 ? "challenge" : "challenges"}`);
  if (more > 0) parts.push(`+${more} more`);
  return parts.join(", ");
}
