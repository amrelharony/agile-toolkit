/**
 * Feature flags: how long a flag is expected to live, when one has gone
 * stale, the summary the tracker reports, and how the tracker's old stored
 * rows read today. Shared by the Feature Flag Tracker page, its agent
 * actions (tool.feature_flag_tracker), Release Readiness's "Feature flag
 * ready" gate and the next-step rules, so all of them call the same flag
 * stale on the same day. Pure.
 *
 * Staleness depends on why the flag exists. The four purposes follow the
 * toggle categories in Pete Hodgson's "Feature Toggles (aka Feature Flags)"
 * (martinfowler.com, 2017): release toggles (our rollouts) are meant to go
 * within days or weeks of the release, experiment toggles once the
 * experiment has its answer, while ops toggles (kill switches) and
 * permission toggles can stay for years by design. The old tracker called
 * every flag stale after 90 days, so a kill switch read as debt and a
 * rollout left on for two months didn't.
 */

import type {
  FeatureFlag,
  FeatureFlagEnv,
  FeatureFlagPurpose,
  FeatureFlagStatus,
  HandoffLink,
} from "@/lib/stores/workspace-types";
import { isIsoDate, isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { localDay } from "@/lib/sprints/series";

/** The tracker's old cloud-synced blob, kept untouched as the backup once its flags move. */
export const FLAGS_LEGACY_KEY = "agile-toolkit:feature-flag-tracker";
/** The legacy flag ids already moved into the workspace, so one deleted since isn't moved again. */
export const FLAGS_MOVED_KEY = "agile-toolkit:feature-flag-tracker:moved";

export const FLAG_PURPOSES: readonly FeatureFlagPurpose[] = [
  "rollout",
  "experiment",
  "kill_switch",
  "permission",
];
export const FLAG_ENVIRONMENTS: readonly FeatureFlagEnv[] = ["dev", "staging", "prod", "all"];

export const PURPOSE_LABEL: Record<FeatureFlagPurpose, string> = {
  rollout: "Rollout",
  experiment: "Experiment",
  kill_switch: "Kill switch",
  permission: "Permission",
};

export const ENV_LABEL: Record<FeatureFlagEnv, string> = {
  dev: "Dev",
  staging: "Staging",
  prod: "Prod",
  all: "All environments",
};

export const STATUS_LABEL: Record<FeatureFlagStatus, string> = {
  on: "On",
  off: "Off",
  retired: "Retired",
};

/**
 * How many days a flag of each purpose usually lives before it is removed;
 * null: no typical lifetime (it may stay by design). A permission flag is
 * only due when the team gives it a removal date; a kill switch never is.
 */
export const TYPICAL_LIFETIME_DAYS: Readonly<Record<FeatureFlagPurpose, number | null>> = {
  rollout: 30,
  experiment: 60,
  kill_switch: null,
  permission: null,
};

/** One line for the purpose picker and the removal-date hint. */
export const PURPOSE_HINT: Record<FeatureFlagPurpose, string> = {
  rollout: "Releases a change gradually. Rollouts usually go within 30 days.",
  experiment: "Runs an A/B test. Experiments usually go within 60 days.",
  kill_switch: "Turns a feature off in an incident. Kill switches can stay: never stale.",
  permission: "Gives some users a feature. Stale only once its removal date passes.",
};

/** Caps, as the agent actions enforce them. */
export const FLAG_NAME_MAX = 200;
export const FLAG_OWNER_MAX = 120;
export const FLAG_DESCRIPTION_MAX = 4000;

const isPurpose = (v: unknown): v is FeatureFlagPurpose =>
  typeof v === "string" && (FLAG_PURPOSES as readonly string[]).includes(v);
const isEnv = (v: unknown): v is FeatureFlagEnv =>
  typeof v === "string" && (FLAG_ENVIRONMENTS as readonly string[]).includes(v);

/** Whole days from `from` to `to` (0 on the same day), or null when either isn't a day. */
function daysFrom(from: string | undefined, to: string | undefined): number | null {
  const a = isoDayNumber(from && isIsoDate(from) ? from : null);
  const b = isoDayNumber(to && isIsoDate(to) ? to : null);
  return a === null || b === null ? null : b - a;
}

function plusDays(day: string, n: number): string | null {
  const d = isoDayNumber(isIsoDate(day) ? day : null);
  return d === null ? null : isoFromDayNumber(d + n);
}

/* ── Staleness ──────────────────────────────────────────────────────── */

export type StaleReason = "past-removal-date" | "over-typical-lifetime";

export interface FlagStaleness {
  stale: boolean;
  /** A kill switch, or a permission flag with no removal date: never stale. */
  exempt: boolean;
  reason: StaleReason | null;
  /** The day it should be gone by: its removal date, or its created day plus the purpose's lifetime. */
  dueOn: string | null;
  /** Whole days past `dueOn`; 0 unless stale. */
  daysOver: number;
  /** Whole days it has lived: to today while live, to its retired day once retired. */
  ageDays: number | null;
}

/** Days since the flag was created: to today while live, to its retired day once retired. */
export function flagAgeDays(
  flag: Pick<FeatureFlag, "createdAt" | "status" | "retiredAt">,
  today: string
): number | null {
  const end = flag.status === "retired" ? flag.retiredAt : today;
  const days = daysFrom(flag.createdAt, end);
  return days === null || days < 0 ? null : days;
}

/**
 * Whether a live flag has outstayed its purpose on `today` (YYYY-MM-DD):
 * past the removal date the team set, or, without one, older than its
 * purpose's typical lifetime. A retired flag is never stale, a kill switch
 * is always exempt, and a permission flag is exempt until it has a removal
 * date.
 */
export function flagStaleness(flag: FeatureFlag, today: string): FlagStaleness {
  const ageDays = flagAgeDays(flag, today);
  const base = { stale: false, exempt: false, reason: null, dueOn: null, daysOver: 0, ageDays };
  if (flag.status === "retired") return base;
  if (flag.purpose === "kill_switch") return { ...base, exempt: true };

  let dueOn: string | null = null;
  let reason: StaleReason;
  if (flag.removeBy && isIsoDate(flag.removeBy)) {
    dueOn = flag.removeBy;
    reason = "past-removal-date";
  } else {
    const lifetime = TYPICAL_LIFETIME_DAYS[flag.purpose];
    if (lifetime === null || lifetime === undefined) return { ...base, exempt: true };
    dueOn = plusDays(flag.createdAt, lifetime);
    reason = "over-typical-lifetime";
  }
  const over = dueOn === null ? null : daysFrom(dueOn, today);
  if (over === null || over <= 0) return { ...base, dueOn };
  return { ...base, stale: true, reason, dueOn, daysOver: over };
}

/** The first day of `today`'s calendar quarter. */
export function quarterStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const first = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(first).padStart(2, "0")}-01`;
}

export interface FlagSummary {
  total: number;
  /** On or off: still in the code. */
  live: number;
  on: number;
  off: number;
  retired: number;
  stale: number;
  /** Of the stale, past the removal date the team set. */
  pastRemoval: number;
  /** Of the stale, older than their purpose's typical lifetime (no removal date). */
  overLifetime: number;
  /** Live flags that are never stale: kill switches, and permission flags with no removal date. */
  exempt: number;
  /** Live flags with nobody named as owner. */
  noOwner: number;
  /** Retired on a day from the start of this quarter to today. */
  retiredThisQuarter: number;
  /** Live flags by purpose. */
  byPurpose: Record<FeatureFlagPurpose, number>;
}

/** The numbers the tracker, its export and its agent actions report. */
export function flagSummary(flags: readonly FeatureFlag[], today: string): FlagSummary {
  const s: FlagSummary = {
    total: flags.length,
    live: 0,
    on: 0,
    off: 0,
    retired: 0,
    stale: 0,
    pastRemoval: 0,
    overLifetime: 0,
    exempt: 0,
    noOwner: 0,
    retiredThisQuarter: 0,
    byPurpose: { rollout: 0, experiment: 0, kill_switch: 0, permission: 0 },
  };
  const from = quarterStart(today);
  for (const f of flags) {
    if (f.status === "retired") {
      s.retired++;
      if (f.retiredAt && f.retiredAt >= from && f.retiredAt <= today) s.retiredThisQuarter++;
      continue;
    }
    s.live++;
    if (f.status === "on") s.on++;
    else s.off++;
    s.byPurpose[f.purpose]++;
    if (!f.owner?.trim()) s.noOwner++;
    const st = flagStaleness(f, today);
    if (st.exempt) s.exempt++;
    if (!st.stale) continue;
    s.stale++;
    if (st.reason === "past-removal-date") s.pastRemoval++;
    else s.overLifetime++;
  }
  return s;
}

/**
 * The tracker's order: live flags first, the most overdue at the top, then
 * the ones due soonest, then the exempt; retired flags last, the latest
 * retired first. Name breaks ties, so the order is stable.
 */
export function compareFlags(a: FeatureFlag, b: FeatureFlag, today: string): number {
  const ra = a.status === "retired";
  const rb = b.status === "retired";
  if (ra !== rb) return ra ? 1 : -1;
  if (ra) {
    const byDay = (b.retiredAt ?? "").localeCompare(a.retiredAt ?? "");
    return byDay || a.name.localeCompare(b.name);
  }
  const sa = flagStaleness(a, today);
  const sb = flagStaleness(b, today);
  if (sa.stale !== sb.stale) return sa.stale ? -1 : 1;
  if (sa.stale) return sb.daysOver - sa.daysOver || a.name.localeCompare(b.name);
  if (sa.exempt !== sb.exempt) return sa.exempt ? 1 : -1;
  const due = (sa.dueOn ?? "9999").localeCompare(sb.dueOn ?? "9999");
  return due || a.name.localeCompare(b.name);
}

/* ── Dates a flag can have ──────────────────────────────────────────── */

export type FlagDateField = "createdAt" | "removeBy" | "retiredAt";

/**
 * What's wrong with a flag's dates on `today`, by field. Created: a real day,
 * not after today (backdating is the point). Planned removal: optional, not
 * before it was created (it may be in the past: an overdue flag logged
 * late). Retired (checked when given): not before created, not after today.
 */
export function flagDateErrors(
  d: { createdAt: string; removeBy?: string; retiredAt?: string },
  today: string,
  { retiring = false }: { retiring?: boolean } = {}
): Partial<Record<FlagDateField, string>> {
  const errors: Partial<Record<FlagDateField, string>> = {};
  const created = d.createdAt.trim();
  if (!created) errors.createdAt = "Enter the day the flag was created.";
  else if (!isIsoDate(created)) errors.createdAt = "Use a date like 2026-10-24.";
  else if (created > today) errors.createdAt = "It can't be created in the future.";
  const createdOk = !errors.createdAt;

  const removeBy = (d.removeBy ?? "").trim();
  if (removeBy) {
    if (!isIsoDate(removeBy)) errors.removeBy = "Use a date like 2026-11-30, or leave it empty.";
    else if (createdOk && removeBy < created)
      errors.removeBy = "It can't be removed before it was created.";
  }

  const retiredAt = (d.retiredAt ?? "").trim();
  if (retiring || retiredAt) {
    if (!retiredAt) errors.retiredAt = "Enter the day it was retired.";
    else if (!isIsoDate(retiredAt)) errors.retiredAt = "Use a date like 2026-10-24.";
    else if (retiredAt > today) errors.retiredAt = "It can't be retired in the future.";
    else if (createdOk && retiredAt < created)
      errors.retiredAt = "It can't be retired before it was created.";
  }
  return errors;
}

/* ── Status changes ─────────────────────────────────────────────────── */

/** On or off; a retired flag brought back loses its retired day. Unchanged: the same object. */
export function withLiveStatus(flag: FeatureFlag, status: "on" | "off"): FeatureFlag {
  if (flag.status === status) return flag;
  const { retiredAt, ...rest } = flag;
  void retiredAt;
  return { ...rest, status };
}

/** Retired on `day` (YYYY-MM-DD). */
export function withRetired(flag: FeatureFlag, day: string): FeatureFlag {
  return { ...flag, status: "retired", retiredAt: day };
}

/* ── Stored rows ────────────────────────────────────────────────────── */

const day = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const d = localDay(v);
  return d && isIsoDate(d) ? d : undefined;
};

const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * A stored flag in today's shape, or null when it can't be one (no id, no
 * purpose). Reads the tracker's old rows too: "active" was "on", and
 * "deprecated" was retired (its retired day kept; none is invented when it
 * had none). An old row's environment, owner and description carry over;
 * a created day that isn't a day reads as "" (age unknown) rather than
 * today, which would make an old flag look new.
 */
export function normalizeFlag(raw: unknown): FeatureFlag | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id : null;
  // Neither writer saves a flag without one of the four purposes.
  if (!id || !isPurpose(r.purpose)) return null;

  const status: FeatureFlagStatus =
    r.status === "retired" || r.status === "deprecated"
      ? "retired"
      : r.status === "off"
        ? "off"
        : "on"; // "on", and the old "active"
  const retiredAt = status === "retired" ? day(r.retiredAt) : undefined;
  const sentTo = Array.isArray(r.sentTo)
    ? (r.sentTo.filter(
        (l) => l && typeof l === "object" && typeof (l as HandoffLink).targetId === "string"
      ) as HandoffLink[])
    : undefined;
  const owner = text(r.owner);
  const description =
    typeof r.description === "string" && r.description.trim() ? r.description : undefined;
  const removeBy = day(r.removeBy);
  const releaseId = text(r.releaseId);
  return {
    id,
    name: typeof r.name === "string" ? r.name.trim() : "",
    status,
    purpose: r.purpose,
    createdAt: day(r.createdAt) ?? "",
    ...(isEnv(r.environment) ? { environment: r.environment } : {}),
    ...(owner ? { owner } : {}),
    ...(removeBy ? { removeBy } : {}),
    ...(retiredAt ? { retiredAt } : {}),
    ...(releaseId ? { releaseId } : {}),
    ...(description ? { description } : {}),
    ...(sentTo && sentTo.length > 0 ? { sentTo } : {}),
  };
}

/** Every usable flag in a stored list (anything that isn't a list reads as none). */
export function normalizeFlags(raw: unknown): FeatureFlag[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeFlag).filter((f): f is FeatureFlag => f !== null);
}

export interface LegacyFlagMove {
  /** Flags to add to the workspace: in the old blob, not in the workspace, never moved before. */
  toMove: FeatureFlag[];
  /** The moved-ids record after this move. */
  moved: string[];
  /** Whether `moved` grew. */
  changed: boolean;
}

/**
 * The one-time move of the tracker's old blob into workspace.featureFlags,
 * as a gap fill by id, so running it twice, or on two devices, adds nothing
 * the second time and never overwrites a workspace row. `moved` remembers
 * the ids already moved, so a flag deleted after the move stays deleted.
 * That record syncs on its own and can arrive after the blob does, so a
 * workspace already holding any of the blob's flags counts as moved too.
 */
export function planLegacyMove(
  raw: unknown,
  existing: readonly { id: string }[],
  moved: readonly string[]
): LegacyFlagMove {
  const legacy = normalizeFlags(raw);
  const known = Array.isArray(moved) ? moved.filter((id) => typeof id === "string") : [];
  if (legacy.length === 0) return { toMove: [], moved: known, changed: false };
  const have = new Set(existing.map((f) => f.id));
  const marked = new Set(known);
  const movedElsewhere = marked.size === 0 && legacy.some((f) => have.has(f.id));
  const toMove = movedElsewhere ? [] : legacy.filter((f) => !have.has(f.id) && !marked.has(f.id));
  const next = Array.from(new Set([...known, ...legacy.map((f) => f.id)]));
  return { toMove, moved: next, changed: next.length !== known.length };
}

/* ── Lifetimes, for the advanced analysis ───────────────────────────── */

export interface FlagLifetime {
  /** Days from created to retired, or to today for a live flag. */
  days: number;
  /** True when it was retired (an event); false while it is still live (censored). */
  retired: boolean;
}

/**
 * How long each flag lived, for a survival curve: retired flags with a
 * retired day are events, live flags are still at risk. A retirement with
 * no day is left out rather than dated today, which would shorten its life.
 */
export function flagLifetimes(flags: readonly FeatureFlag[], today: string): FlagLifetime[] {
  const out: FlagLifetime[] = [];
  for (const f of flags) {
    if (f.status === "retired" && !f.retiredAt) continue;
    const days = flagAgeDays(f, today);
    if (days === null) continue;
    out.push({ days, retired: f.status === "retired" });
  }
  return out;
}
