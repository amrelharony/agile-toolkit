/**
 * The one-time move of the old per-tool sprint data (Burndown, Burnup,
 * Velocity, Sprint Comparison) into the shared `sprints` and `sprintSeries`
 * slices of the workspace.
 *
 *   - `planMigration` is pure: old raw storage + the workspace in, the rows
 *     to upsert out. It only fills gaps (what the workspace already holds
 *     wins), and every sprint it creates has a deterministic id, so running
 *     it twice, in two tabs, or on two devices converges instead of
 *     duplicating.
 *   - `runLegacySprintMigration` is the I/O shell, the generic one in
 *     lib/data/migrate-legacy-key.ts. Per key, crash-safe: one workspace
 *     `setState`, then a `<key>:migrated` backup, then `removeItem(key)`. A
 *     removed key is the done-marker; a key that is still there (crash,
 *     full storage) is simply planned again next load, which is a no-op for
 *     whatever already landed.
 *
 * The old shapes, defaults and seed rows are copied here from the tool
 * clients as they were before shared sprints (git history), never imported:
 * those clients now read the shared sprints.
 *
 * Mounted through `<LegacySprintMigration/>`, which decides when it is safe
 * to run (workspace loaded, owner's cloud pull done, no merge question open).
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  migrateLegacyKeysNow,
  runExclusive,
  type LegacyKeyMigrationResult,
} from "@/lib/data/migrate-legacy-key";
import type { Sprint, SprintDay, SprintSeries } from "@/lib/stores/workspace-types";
import {
  LEGACY_SPRINT_KEYS,
  LEGACY_SPRINT_SOURCES,
  SPRINT_COMPARE_PINS_KEY,
  type LegacySprintSource,
} from "./legacy-keys";
import { endDateFor, scopeFromRise, statusFromDates, todayIso } from "./series";

export {
  LEGACY_SPRINT_KEYS,
  LEGACY_SPRINT_SOURCES,
  SPRINT_COMPARE_PINS_KEY,
  hasLegacySprintData,
} from "./legacy-keys";
export type { LegacySprintSource } from "./legacy-keys";

/** `navigator.locks` name, so two tabs never migrate at the same time. */
export const SPRINT_MIGRATION_LOCK = "agile-toolkit:sprint-migration";

/** Prefix of the ids of sprints the migration creates (Velocity rows keep their own). */
export const LEGACY_SPRINT_ID_PREFIX = "sprint_legacy_";

/** Sprint Comparison compares at most this many sprints. */
const MAX_PINS = 5;

export const LEGACY_SOURCE_LABELS: Record<LegacySprintSource, string> = {
  burndown: "Burndown",
  burnup: "Burnup",
  velocity: "Velocity",
  compare: "Sprint Comparison",
};

/* -------------------------------------------------------------------------- */
/*  The old shapes (copied from the tool clients before shared sprints)       */
/* -------------------------------------------------------------------------- */

interface LegacyBurndownEntry {
  id: string;
  day: number;
  remaining: number | null;
  scopeChange: boolean;
  description?: string;
}
interface LegacyBurndown {
  config: { totalPoints: number; sprintDays: number; sprintStartDate: string };
  entries: LegacyBurndownEntry[];
}

interface LegacyBurnupEntry {
  id: string;
  day: number;
  scope: number | null;
  completed: number | null;
  description?: string;
}
interface LegacyBurnup {
  config: { sprintDays: number; sprintStartDate: string };
  entries: LegacyBurnupEntry[];
}

interface LegacyVelocitySprint {
  id: string;
  name: string;
  description?: string;
  committed: number;
  completed: number;
}

interface LegacyCompareSprint {
  id: string;
  name: string;
  scores: Record<string, number>;
}

/** Ids of rows a tool's "Load an example" put there. */
const EXAMPLE_ID_PREFIX = "example-";

/** Burndown's first-visit config (its start date became "today" on first run). */
const BURNDOWN_DEFAULTS = { totalPoints: 40, sprintDays: 10 };
/** Burnup's first-visit config and day 0 (it kept the static start date). */
const BURNUP_DEFAULTS = { sprintDays: 10, sprintStartDate: "2026-01-01", scope: 40, completed: 0 };

/** Velocity's seed rows (its example). Older saves carry `default:sprint-N`. */
const VELOCITY_SEED: readonly LegacyVelocitySprint[] = [
  { id: "example-sprint-1", name: "Sprint 1", committed: 34, completed: 28 },
  { id: "example-sprint-2", name: "Sprint 2", committed: 30, completed: 32 },
  { id: "example-sprint-3", name: "Sprint 3", committed: 36, completed: 35 },
];
const VELOCITY_LEGACY_SEED_PREFIX = "default:";
/** Velocity's bridge dated undated sprints 1 Jan 2020 + their row index. */
const VELOCITY_SYNTH_EPOCH_MS = Date.UTC(2020, 0, 1);

/** Sprint Comparison's two default rows. */
const COMPARE_DEFAULTS: readonly LegacyCompareSprint[] = [
  {
    id: "sp1",
    name: "Sprint 1",
    scores: {
      Velocity: 7,
      Quality: 6,
      "Scope Stability": 8,
      "Team Happiness": 7,
      "Goal Achievement": 8,
      Predictability: 6,
    },
  },
  {
    id: "sp2",
    name: "Sprint 2",
    scores: {
      Velocity: 8,
      Quality: 7,
      "Scope Stability": 6,
      "Team Happiness": 8,
      "Goal Achievement": 9,
      Predictability: 7,
    },
  },
];

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                    */
/* -------------------------------------------------------------------------- */

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function text(v: unknown): string | undefined {
  const t = str(v).trim();
  return t ? t : undefined;
}

function dayIndex(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** A zustand-persist blob (`{"state": {...}, "version": N}`) to its state, or null. */
function persistedState(raw: string): Obj | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObj(parsed)) return null;
    return isObj(parsed.state) ? parsed.state : parsed;
  } catch {
    return null;
  }
}

function readBurndown(state: Obj): LegacyBurndown {
  const c = isObj(state.config) ? state.config : {};
  const entries = Array.isArray(state.entries) ? state.entries : [];
  return {
    config: {
      totalPoints: num(c.totalPoints) ?? BURNDOWN_DEFAULTS.totalPoints,
      sprintDays: num(c.sprintDays) ?? BURNDOWN_DEFAULTS.sprintDays,
      sprintStartDate: str(c.sprintStartDate).trim(),
    },
    entries: entries.filter(isObj).flatMap((e): LegacyBurndownEntry[] => {
      const day = dayIndex(e.day);
      if (day === null) return [];
      return [
        {
          id: str(e.id),
          day,
          remaining: num(e.remaining),
          scopeChange: e.scopeChange === true,
          description: text(e.description),
        },
      ];
    }),
  };
}

function readBurnup(state: Obj): LegacyBurnup {
  const c = isObj(state.config) ? state.config : {};
  const entries = Array.isArray(state.entries) ? state.entries : [];
  return {
    config: {
      sprintDays: num(c.sprintDays) ?? BURNUP_DEFAULTS.sprintDays,
      sprintStartDate: str(c.sprintStartDate).trim(),
    },
    entries: entries.filter(isObj).flatMap((e): LegacyBurnupEntry[] => {
      const day = dayIndex(e.day);
      if (day === null) return [];
      return [
        {
          id: str(e.id),
          day,
          scope: num(e.scope),
          completed: num(e.completed),
          description: text(e.description),
        },
      ];
    }),
  };
}

function readVelocity(state: Obj): LegacyVelocitySprint[] {
  const rows = Array.isArray(state.sprints) ? state.sprints : [];
  return rows.filter(isObj).flatMap((r): LegacyVelocitySprint[] => {
    const id = str(r.id);
    if (!id) return [];
    return [
      {
        id,
        name: str(r.name),
        description: text(r.description),
        committed: num(r.committed) ?? 0,
        completed: num(r.completed) ?? 0,
      },
    ];
  });
}

function readCompare(state: Obj): LegacyCompareSprint[] {
  const rows = Array.isArray(state.sprints) ? state.sprints : [];
  return rows.filter(isObj).flatMap((r): LegacyCompareSprint[] => {
    const id = str(r.id);
    if (!id) return [];
    const scores: Record<string, number> = {};
    if (isObj(r.scores)) {
      for (const [k, v] of Object.entries(r.scores)) {
        const n = num(v);
        if (n !== null) scores[k] = n;
      }
    }
    return [{ id, name: str(r.name), scores }];
  });
}

/* -------------------------------------------------------------------------- */
/*  What counts as untouched                                                   */
/* -------------------------------------------------------------------------- */

const isExampleRow = (id: string) => id.startsWith(EXAMPLE_ID_PREFIX);

/**
 * Nothing the user typed: the first-visit sprint, or the example with its
 * own days only. Rows "Reset" or a length change minted new ids for are
 * judged by content, not id.
 */
function isUntouchedBurndown(b: LegacyBurndown): boolean {
  const own = b.entries.filter((e) => !isExampleRow(e.id));
  // The example alone: its config is the example's too.
  if (own.length === 0 && b.entries.length > 0) return true;
  if (
    b.config.totalPoints !== BURNDOWN_DEFAULTS.totalPoints ||
    b.config.sprintDays !== BURNDOWN_DEFAULTS.sprintDays
  ) {
    return false;
  }
  return own.every(
    (e) =>
      !e.scopeChange &&
      !e.description &&
      (e.day === 0
        ? e.remaining === null || e.remaining === b.config.totalPoints
        : e.remaining === null)
  );
}

function isUntouchedBurnup(b: LegacyBurnup): boolean {
  if (
    b.config.sprintDays !== BURNUP_DEFAULTS.sprintDays ||
    b.config.sprintStartDate !== BURNUP_DEFAULTS.sprintStartDate
  ) {
    return false;
  }
  return b.entries
    .filter((e) => !isExampleRow(e.id))
    .every(
      (e) =>
        !e.description &&
        (e.day === 0
          ? (e.scope === null || e.scope === BURNUP_DEFAULTS.scope) &&
            (e.completed === null || e.completed === BURNUP_DEFAULTS.completed)
          : e.scope === null && e.completed === null)
    );
}

/** Velocity's `isUntouchedSeedSprint`: still the exact seed values, no description. */
function isUntouchedSeedSprint(s: LegacyVelocitySprint): boolean {
  const id = s.id.startsWith(VELOCITY_LEGACY_SEED_PREFIX)
    ? EXAMPLE_ID_PREFIX + s.id.slice(VELOCITY_LEGACY_SEED_PREFIX.length)
    : s.id;
  return VELOCITY_SEED.some(
    (d) =>
      d.id === id &&
      d.name === s.name &&
      d.committed === s.committed &&
      d.completed === s.completed &&
      !s.description
  );
}

function isUntouchedCompareDefault(s: LegacyCompareSprint): boolean {
  const d = COMPARE_DEFAULTS.find((x) => x.id === s.id);
  if (!d || d.name !== s.name) return false;
  const keys = Object.keys(s.scores);
  return (
    keys.length === Object.keys(d.scores).length && keys.every((k) => s.scores[k] === d.scores[k])
  );
}

/* -------------------------------------------------------------------------- */
/*  Ids, names, dates                                                          */
/* -------------------------------------------------------------------------- */

/** 32-bit FNV-1a as 8 hex digits. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The deterministic id of a sprint the migration creates from `key`. */
export function legacySprintId(key: string): string {
  return `${LEGACY_SPRINT_ID_PREFIX}${fnv1a(key)}`;
}

/** "YYYY-MM-DD" when it is a real calendar date, else null. */
function isoDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === value ? value : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sprint of 5 Oct 2026". */
function sprintNameFor(start: string): string {
  const [y, m, d] = start.split("-").map(Number);
  return `Sprint of ${d} ${MONTHS[m - 1]} ${y}`;
}

/** Name key for matching: trimmed, case- and space-insensitive. */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The YYYY-MM-DD part of a stored date ("" when missing). */
function datePart(value: string | undefined): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

/** Comparable start date: undated sprints sort first. */
function startKey(s: Sprint): string {
  return isoDate(datePart(s.startDate)) ?? "";
}

/* -------------------------------------------------------------------------- */
/*  The plan                                                                   */
/* -------------------------------------------------------------------------- */

export type LegacyRaw = Partial<Record<LegacySprintSource, string | null>>;

export interface LegacyWorkspace {
  sprints: readonly Sprint[];
  sprintSeries?: readonly SprintSeries[];
}

export interface SourceReport {
  /** The key existed. */
  present: boolean;
  /** The key held something that couldn't be read (kept in the backup). */
  unreadable: boolean;
  /** Sprints this source put data into (created or filled in). */
  moved: number;
  /** Rows (or, for Burndown/Burnup, the whole sprint) left out as untouched defaults or examples. */
  skipped: number;
}

export interface MigrationReport {
  /** Sprints the migration created. */
  created: string[];
  /** Sprints that already existed and gained data. */
  updated: string[];
  /** Per old key. */
  sources: Record<LegacySprintSource, SourceReport>;
  /** Values the workspace already had differently; the workspace's were kept. */
  conflicts: number;
}

export interface MigrationPlan {
  /** Sprints to upsert (created or gap-filled), workspace order then new ones. */
  sprints: Sprint[];
  /** Series to upsert. */
  series: SprintSeries[];
  /** Sprint Comparison's initial pins: the old rows' sprints, in row order (max 5). */
  compareRatingPins: string[];
  report: MigrationReport;
}

interface Ctx {
  now: string;
  today: string;
  sprints: Map<string, Sprint>;
  series: Map<string, SprintSeries>;
  created: Set<string>;
  changedSprints: Set<string>;
  changedSeries: Set<string>;
  moved: Record<LegacySprintSource, Set<string>>;
  /** Sprints that received Burndown days (for the scope-rise pass). */
  burndownSprints: Set<string>;
  conflicts: number;
}

function emptySourceReport(): SourceReport {
  return { present: false, unreadable: false, moved: 0, skipped: 0 };
}

function createSprint(ctx: Ctx, sprint: Sprint): Sprint {
  ctx.sprints.set(sprint.id, sprint);
  ctx.created.add(sprint.id);
  ctx.changedSprints.add(sprint.id);
  return sprint;
}

/** Fill a matched sprint's blanks (no end date, no planned points). */
function fillSprint(
  ctx: Ctx,
  source: LegacySprintSource,
  id: string,
  legacy: { endDate?: string; pointsPlanned?: number }
): void {
  const current = ctx.sprints.get(id);
  if (!current) return;
  const next: Sprint = { ...current };
  let changed = false;
  if (legacy.endDate) {
    const mine = isoDate(datePart(current.endDate));
    if (!mine) {
      next.endDate = legacy.endDate;
      changed = true;
    } else if (mine !== legacy.endDate) {
      ctx.conflicts++;
    }
  }
  if (legacy.pointsPlanned !== undefined && legacy.pointsPlanned > 0) {
    if (!current.pointsPlanned) {
      next.pointsPlanned = legacy.pointsPlanned;
      changed = true;
    } else if (current.pointsPlanned !== legacy.pointsPlanned) {
      ctx.conflicts++;
    }
  }
  if (!changed) return;
  ctx.sprints.set(id, next);
  ctx.changedSprints.add(id);
  ctx.moved[source].add(id);
}

const DAY_NUMBERS = ["remaining", "completed", "scope"] as const;

/** Gap-fill one day: what's there wins, a legacy note is appended. */
function mergeDay(ctx: Ctx, existing: SprintDay, legacy: SprintDay): SprintDay | null {
  const next: SprintDay = { ...existing };
  let changed = false;
  for (const f of DAY_NUMBERS) {
    const mine = existing[f];
    const theirs = legacy[f];
    if (theirs == null) continue;
    if (mine == null) {
      next[f] = theirs;
      changed = true;
    } else if (mine !== theirs) {
      ctx.conflicts++;
    }
  }
  if (legacy.scopeChange && !existing.scopeChange) {
    next.scopeChange = true;
    changed = true;
  }
  const note = legacy.note?.trim();
  if (note) {
    const mine = existing.note?.trim();
    if (!mine) {
      next.note = note;
      changed = true;
    } else if (!mine.includes(note)) {
      next.note = `${mine} · ${note}`;
      changed = true;
    }
  }
  return changed ? next : null;
}

/** Merge days and ratings into a sprint's series, and record where they came from. */
function fillSeries(
  ctx: Ctx,
  source: LegacySprintSource,
  sprintId: string,
  legacy: { days?: SprintDay[]; ratings?: Record<string, number> }
): void {
  const before = ctx.series.get(sprintId);
  const next: SprintSeries = before ? { ...before } : { id: sprintId };
  let changed = !before;

  if (legacy.days && legacy.days.length > 0) {
    const days = [...(next.days ?? [])];
    let daysChanged = false;
    for (const d of legacy.days) {
      const i = days.findIndex((x) => x.day === d.day);
      if (i < 0) {
        days.push(d);
        daysChanged = true;
        continue;
      }
      const merged = mergeDay(ctx, days[i], d);
      if (merged) {
        days[i] = merged;
        daysChanged = true;
      }
    }
    if (daysChanged) {
      days.sort((a, b) => a.day - b.day);
      next.days = days;
      changed = true;
    }
  }

  if (legacy.ratings) {
    const ratings: Record<string, number> = { ...(next.ratings ?? {}) };
    let ratingsChanged = false;
    for (const [k, v] of Object.entries(legacy.ratings)) {
      const mine = ratings[k];
      if (mine === undefined || !Number.isFinite(mine)) {
        ratings[k] = v;
        ratingsChanged = true;
      } else if (mine !== v) {
        ctx.conflicts++;
      }
    }
    if (ratingsChanged) {
      next.ratings = ratings;
      changed = true;
    }
  }

  const key = LEGACY_SPRINT_KEYS[source];
  if (!(next.migratedFrom ?? []).includes(key)) {
    next.migratedFrom = [...(next.migratedFrom ?? []), key];
    changed = true;
  }

  if (!changed) return;
  ctx.series.set(sprintId, { ...next, updatedAt: ctx.now });
  ctx.changedSeries.add(sprintId);
  ctx.moved[source].add(sprintId);
}

/** The sprint starting on `start`: the active one, else the one ending last. */
function matchByStart(ctx: Ctx, start: string): Sprint | undefined {
  let best: Sprint | undefined;
  for (const s of Array.from(ctx.sprints.values())) {
    if (datePart(s.startDate) !== start) continue;
    if (!best) {
      best = s;
      continue;
    }
    const sActive = s.status === "active";
    const bestActive = best.status === "active";
    if (sActive !== bestActive) {
      if (sActive) best = s;
      continue;
    }
    if (datePart(s.endDate) >= datePart(best.endDate)) best = s;
  }
  return best;
}

/** The sprint a Burndown/Burnup config belongs to, created when there is none. */
function sprintForStart(
  ctx: Ctx,
  rawStart: string,
  sprintDays: number,
  pointsPlanned: number
): Sprint {
  const start = isoDate(rawStart);
  const days = Math.max(1, Math.round(sprintDays));
  const id = legacySprintId(`start:${start ?? rawStart}`);
  const matched = (start && matchByStart(ctx, start)) || ctx.sprints.get(id);
  if (matched) return matched;
  const endDate = start ? endDateFor(start, days) : "";
  const dates = { startDate: start ?? "", endDate };
  const status = start ? statusFromDates(dates, ctx.today) : "planned";
  return createSprint(ctx, {
    id,
    name: start ? sprintNameFor(start) : "Imported sprint",
    ...dates,
    pointsPlanned: Math.max(0, pointsPlanned),
    status,
  });
}

function planVelocity(ctx: Ctx, rows: LegacyVelocitySprint[], report: SourceReport): void {
  rows.forEach((row, index) => {
    if ((row.committed === 0 && row.completed === 0) || isUntouchedSeedSprint(row)) {
      report.skipped++;
      return;
    }
    // Already shared (the old Velocity bridge wrote it): leave it.
    if (ctx.sprints.has(row.id)) return;
    // An edited example row is real data, but its `example-` id would read
    // as an example preview now: give it a stable id of its own.
    const id = isExampleRow(row.id) ? legacySprintId(`velocity:${row.id}`) : row.id;
    if (!ctx.sprints.has(id)) {
      const completed = row.completed > 0;
      createSprint(ctx, {
        id,
        name: row.name.trim() || `Sprint ${index + 1}`,
        startDate: new Date(VELOCITY_SYNTH_EPOCH_MS + index * 86_400_000)
          .toISOString()
          .slice(0, 10),
        endDate: "",
        ...(row.description ? { goal: row.description } : {}),
        pointsPlanned: row.committed,
        ...(completed ? { pointsCompleted: row.completed } : {}),
        status: completed ? "completed" : "planned",
      });
      ctx.moved.velocity.add(id);
    }
    fillSeries(ctx, "velocity", id, {});
  });
}

function planBurndown(ctx: Ctx, b: LegacyBurndown, report: SourceReport): void {
  if (isUntouchedBurndown(b)) {
    report.skipped++;
    return;
  }
  const own = b.entries.filter((e) => !isExampleRow(e.id));
  report.skipped += b.entries.length - own.length;
  const sprint = sprintForStart(
    ctx,
    b.config.sprintStartDate,
    b.config.sprintDays,
    b.config.totalPoints
  );
  if (ctx.created.has(sprint.id)) ctx.moved.burndown.add(sprint.id);
  const start = isoDate(b.config.sprintStartDate);
  fillSprint(ctx, "burndown", sprint.id, {
    endDate: start ? endDateFor(start, Math.max(1, Math.round(b.config.sprintDays))) : undefined,
    pointsPlanned: b.config.totalPoints,
  });
  const days: SprintDay[] = [];
  for (const e of own) {
    const day: SprintDay = { day: e.day };
    if (e.remaining !== null) day.remaining = e.remaining;
    if (e.scopeChange) day.scopeChange = true;
    if (e.description) day.note = e.description;
    if (Object.keys(day).length > 1) days.push(day);
  }
  fillSeries(ctx, "burndown", sprint.id, { days: collapseDays(days) });
  ctx.burndownSprints.add(sprint.id);
}

/**
 * The old Burndown recorded a scope rise only as a flag on the day. Today's
 * Burndown also stores that day's scope (the scope before it plus the rise),
 * so Burnup's scope line and the hub's "Scope now" include the added work.
 * Give migrated flagged days the same scope, unless the day already has one
 * (a scope typed in Burnup wins). Runs after every source, in day order.
 */
function applyScopeRises(ctx: Ctx): void {
  for (const id of Array.from(ctx.burndownSprints)) {
    const sprint = ctx.sprints.get(id);
    let series = ctx.series.get(id);
    if (!sprint || !series?.days) continue;
    let changed = false;
    for (const d of [...series.days].sort((a, b) => a.day - b.day)) {
      if (!d.scopeChange || d.scope != null) continue;
      const scope = scopeFromRise(sprint, series, d.day);
      if (scope === null) continue;
      const days: SprintDay[] = (series.days ?? []).map((x) =>
        x.day === d.day ? { ...x, scope } : x
      );
      series = { ...series, days, updatedAt: ctx.now };
      changed = true;
    }
    if (changed && series) {
      ctx.series.set(id, series);
      ctx.changedSeries.add(id);
    }
  }
}

function planBurnup(ctx: Ctx, b: LegacyBurnup, report: SourceReport): void {
  if (isUntouchedBurnup(b)) {
    report.skipped++;
    return;
  }
  const own = b.entries.filter((e) => !isExampleRow(e.id));
  report.skipped += b.entries.length - own.length;
  const dayZeroScope =
    own.find((e) => e.day === 0)?.scope ??
    [...own].sort((a, c) => a.day - c.day).find((e) => e.scope !== null)?.scope ??
    0;
  const sprint = sprintForStart(ctx, b.config.sprintStartDate, b.config.sprintDays, dayZeroScope);
  if (ctx.created.has(sprint.id)) ctx.moved.burnup.add(sprint.id);
  const start = isoDate(b.config.sprintStartDate);
  fillSprint(ctx, "burnup", sprint.id, {
    endDate: start ? endDateFor(start, Math.max(1, Math.round(b.config.sprintDays))) : undefined,
    pointsPlanned: dayZeroScope,
  });
  const days: SprintDay[] = [];
  for (const e of own) {
    const day: SprintDay = { day: e.day };
    if (e.scope !== null) day.scope = e.scope;
    if (e.completed !== null) day.completed = e.completed;
    if (e.description) day.note = e.description;
    if (Object.keys(day).length > 1) days.push(day);
  }
  fillSeries(ctx, "burnup", sprint.id, { days: collapseDays(days) });
}

/** One entry per day (an old store could hold two rows for one day): first value wins. */
function collapseDays(days: SprintDay[]): SprintDay[] {
  const byDay = new Map<number, SprintDay>();
  for (const d of days) {
    const prev = byDay.get(d.day);
    if (!prev) {
      byDay.set(d.day, d);
      continue;
    }
    const merged: SprintDay = { ...prev };
    for (const f of DAY_NUMBERS) if (merged[f] == null && d[f] != null) merged[f] = d[f];
    if (d.scopeChange) merged.scopeChange = true;
    if (d.note && !(merged.note ?? "").includes(d.note)) {
      merged.note = merged.note ? `${merged.note} · ${d.note}` : d.note;
    }
    byDay.set(d.day, merged);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
}

/** Old comparison rows matched by name: one match, else the latest start, else a new sprint. */
function planCompare(ctx: Ctx, rows: LegacyCompareSprint[], report: SourceReport): string[] {
  const pins: string[] = [];
  for (const row of rows) {
    if (isExampleRow(row.id) || isUntouchedCompareDefault(row)) {
      report.skipped++;
      continue;
    }
    const key = nameKey(row.name);
    const id = legacySprintId(`name:${key}`);
    let target: Sprint | undefined;
    if (key) {
      for (const s of Array.from(ctx.sprints.values())) {
        if (nameKey(s.name) !== key) continue;
        if (!target || startKey(s) >= startKey(target)) target = s;
      }
    }
    target ??=
      ctx.sprints.get(id) ??
      createSprint(ctx, {
        id,
        name: row.name.trim() || "Untitled sprint",
        startDate: "",
        endDate: "",
        pointsPlanned: 0,
        status: "completed",
      });
    if (ctx.created.has(target.id)) ctx.moved.compare.add(target.id);
    fillSeries(ctx, "compare", target.id, { ratings: row.scores });
    if (!pins.includes(target.id) && pins.length < MAX_PINS) pins.push(target.id);
  }
  return pins;
}

/**
 * Plan the move. Pure: `legacyRaw` holds each old key's raw string (absent
 * or null when the key isn't there), `workspace` the current sprints and
 * series, `today` the local date (YYYY-MM-DD) that dates new sprints'
 * status. Returns only rows that change, so a second run plans nothing.
 */
export function planMigration(
  legacyRaw: LegacyRaw,
  workspace: LegacyWorkspace,
  today: string = todayIso(),
  options: { now?: string } = {}
): MigrationPlan {
  const ctx: Ctx = {
    now: options.now ?? new Date().toISOString(),
    today,
    sprints: new Map(workspace.sprints.map((s) => [s.id, s])),
    series: new Map((workspace.sprintSeries ?? []).map((s) => [s.id, s])),
    created: new Set(),
    changedSprints: new Set(),
    changedSeries: new Set(),
    moved: { burndown: new Set(), burnup: new Set(), velocity: new Set(), compare: new Set() },
    burndownSprints: new Set(),
    conflicts: 0,
  };
  const sources = {
    burndown: emptySourceReport(),
    burnup: emptySourceReport(),
    velocity: emptySourceReport(),
    compare: emptySourceReport(),
  } satisfies Record<LegacySprintSource, SourceReport>;

  let compareRatingPins: string[] = [];
  for (const source of LEGACY_SPRINT_SOURCES) {
    const raw = legacyRaw[source];
    if (raw === undefined || raw === null) continue;
    const report = sources[source];
    report.present = true;
    const state = persistedState(raw);
    if (!state) {
      report.unreadable = true;
      continue;
    }
    if (source === "velocity") planVelocity(ctx, readVelocity(state), report);
    else if (source === "burndown") planBurndown(ctx, readBurndown(state), report);
    else if (source === "burnup") planBurnup(ctx, readBurnup(state), report);
    else compareRatingPins = planCompare(ctx, readCompare(state), report);
  }
  applyScopeRises(ctx);
  for (const source of LEGACY_SPRINT_SOURCES) sources[source].moved = ctx.moved[source].size;

  const sprints = Array.from(ctx.sprints.values()).filter((s) => ctx.changedSprints.has(s.id));
  const series = Array.from(ctx.series.values()).filter((s) => ctx.changedSeries.has(s.id));
  const touched = new Set(Array.from(ctx.changedSprints).concat(Array.from(ctx.changedSeries)));
  return {
    sprints,
    series,
    compareRatingPins,
    report: {
      created: Array.from(ctx.created),
      updated: Array.from(touched).filter((id) => !ctx.created.has(id)),
      sources,
      conflicts: ctx.conflicts,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Summary                                                                    */
/* -------------------------------------------------------------------------- */

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The one toast line, or null when nothing moved. */
export function migrationSummary(report: MigrationReport | null): string | null {
  if (!report) return null;
  const count = report.created.length + report.updated.length;
  if (count === 0) return null;
  const from = (Object.keys(LEGACY_SOURCE_LABELS) as LegacySprintSource[])
    .filter((s) => report.sources[s].moved > 0)
    .map((s) => LEGACY_SOURCE_LABELS[s]);
  const what = `${count} sprint${count === 1 ? "" : "s"}`;
  return from.length > 0
    ? `Moved ${what} from ${listJoin(from)} into shared sprints`
    : `Moved ${what} into shared sprints`;
}

/* -------------------------------------------------------------------------- */
/*  The I/O shell                                                              */
/* -------------------------------------------------------------------------- */

export type MigrationRunResult = LegacyKeyMigrationResult<MigrationReport>;

export interface RunOptions {
  /** Defaults to `window.localStorage`. */
  storage?: Storage;
  /** Local date for new sprints' status. */
  today?: string;
  /** Clock for the backup-key suffix and `updatedAt`. */
  now?: () => number;
}

function upsertAll<T extends { id: string }>(list: readonly T[], rows: readonly T[]): T[] {
  if (rows.length === 0) return list as T[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const next = list.map((x) => byId.get(x.id) ?? x);
  const seen = new Set(list.map((x) => x.id));
  for (const r of rows) if (!seen.has(r.id)) next.push(r);
  return next;
}

/** Seed Sprint Comparison's pins, unless it already has its own. */
function seedPins(storage: Storage, pins: string[]): void {
  if (pins.length === 0) return;
  try {
    if (storage.getItem(SPRINT_COMPARE_PINS_KEY) !== null) return;
    storage.setItem(SPRINT_COMPARE_PINS_KEY, JSON.stringify(pins.slice(0, MAX_PINS)));
  } catch {
    /* the tool falls back to its own default pins */
  }
}

/**
 * The whole move, synchronously, against the workspace as it is right now:
 * the generic crash-safe shell (lib/data/migrate-legacy-key.ts) around
 * `planMigration`.
 */
export function migrateLegacySprintsNow(options: RunOptions = {}): MigrationRunResult {
  const now = options.now ?? Date.now;
  const result = migrateLegacyKeysNow<MigrationReport>({
    keys: LEGACY_SPRINT_SOURCES.map((source) => LEGACY_SPRINT_KEYS[source]),
    storage: options.storage,
    now,
    move: (rawByKey, storage) => {
      const raw: LegacyRaw = {};
      for (const source of LEGACY_SPRINT_SOURCES) {
        const value = rawByKey[LEGACY_SPRINT_KEYS[source]];
        if (value !== undefined) raw[source] = value;
      }
      const ws = useWorkspaceStore.getState();
      const plan = planMigration(
        raw,
        { sprints: ws.sprints, sprintSeries: ws.sprintSeries },
        options.today ?? todayIso(),
        { now: new Date(now()).toISOString() }
      );
      // Everything in one write.
      const wrote = plan.sprints.length > 0 || plan.series.length > 0;
      if (wrote) {
        useWorkspaceStore.setState((s) => ({
          sprints: upsertAll(s.sprints, plan.sprints),
          sprintSeries: upsertAll(s.sprintSeries ?? [], plan.series),
        }));
      }
      seedPins(storage, plan.compareRatingPins);
      return { wrote, report: plan.report };
    },
  });

  if (result.report) {
    // eslint-disable-next-line no-console
    console.info("[sprint-migration]", {
      created: result.report.created,
      updated: result.report.updated,
      sources: result.report.sources,
      conflicts: result.report.conflicts,
      removed: result.removed,
      kept: result.kept,
    });
  }
  return result;
}

/**
 * Run the move once, holding a cross-tab lock when the browser has
 * `navigator.locks`. The keys are re-read inside the lock, so a tab that
 * waited behind another finds them gone and does nothing.
 */
export function runLegacySprintMigration(options: RunOptions = {}): Promise<MigrationRunResult> {
  return runExclusive(SPRINT_MIGRATION_LOCK, () => migrateLegacySprintsNow(options));
}
