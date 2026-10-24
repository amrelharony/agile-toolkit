/**
 * The health dashboard's settings: which KPIs it shows, where each turns
 * amber and red, and the windows its numbers read. Stored in the workspace
 * singleton `healthDashboards` / HEALTH_DASHBOARD_ID, so the page and
 * tool.health_dashboard (its get_summary flags and set_thresholds) judge
 * the same numbers by the same limits. Pure, and safe for the agent's
 * server bundle.
 *
 * The defaults are the limits the dashboard always had (they were fixed in
 * its status-config); a team changes them on the page or through the agent,
 * and a KPI it never changed keeps the default.
 */

import type { HealthDashboardConfig, KpiThreshold } from "@/lib/stores/workspace-types";
import { HEALTH_DASHBOARD_ID } from "@/lib/stores/workspace-types";
import { DEFAULT_PREDICTABILITY_WINDOW } from "@/lib/sprints/metrics";
import { MAX_RANGE_DAYS } from "@/lib/flow/days";
import type { FormErrors, Validation } from "@/lib/utils/form";

export { HEALTH_DASHBOARD_ID };

export const HEALTH_KPI_IDS = [
  "predictability",
  "team-health",
  "open-impediments",
  "critical-impediments",
  "open-blockers",
  "cycle-time-p85",
] as const;

export type HealthKpiId = (typeof HEALTH_KPI_IDS)[number];

export const isHealthKpiId = (id: unknown): id is HealthKpiId =>
  typeof id === "string" && (HEALTH_KPI_IDS as readonly string[]).includes(id);

/** A KPI's traffic light. */
export type TrafficStatus = "green" | "amber" | "red";

/** What a KPI's number is: a percentage, a count of things, or days. */
export type KpiUnit = "percent" | "count" | "days";

export interface KpiDefinition {
  id: HealthKpiId;
  name: string;
  unit: KpiUnit;
  /** Predictability and team health are better higher; the rest lower. */
  higherIsBetter: boolean;
  /** The tool the number comes from. */
  source: { label: string; href: string };
}

export const KPI_DEFINITIONS: Record<HealthKpiId, KpiDefinition> = {
  predictability: {
    id: "predictability",
    name: "Predictability",
    unit: "percent",
    higherIsBetter: true,
    source: { label: "Velocity", href: "/velocity" },
  },
  "team-health": {
    id: "team-health",
    name: "Team health",
    unit: "percent",
    higherIsBetter: true,
    source: { label: "Health Check", href: "/health-check" },
  },
  "open-impediments": {
    id: "open-impediments",
    name: "Open impediments",
    unit: "count",
    higherIsBetter: false,
    source: { label: "Impediments", href: "/impediments" },
  },
  "critical-impediments": {
    id: "critical-impediments",
    name: "Critical impediments",
    unit: "count",
    higherIsBetter: false,
    source: { label: "Impediments", href: "/impediments" },
  },
  "open-blockers": {
    id: "open-blockers",
    name: "Open standup blockers",
    unit: "count",
    higherIsBetter: false,
    source: { label: "Standup", href: "/standup" },
  },
  "cycle-time-p85": {
    id: "cycle-time-p85",
    name: "Cycle time P85",
    unit: "days",
    higherIsBetter: false,
    source: { label: "Cycle Time", href: "/cycle-time" },
  },
};

/**
 * The limits the dashboard always used. Higher-is-better: green from
 * `green`, amber from `amber`, red below. Lower-is-better: green up to
 * `green`, amber up to `amber`, red above (one critical impediment is red).
 */
export const DEFAULT_THRESHOLDS: Record<HealthKpiId, KpiThreshold & { higherIsBetter: boolean }> = {
  predictability: { green: 80, amber: 60, higherIsBetter: true },
  "team-health": { green: 75, amber: 50, higherIsBetter: true },
  "open-impediments": { green: 0, amber: 3, higherIsBetter: false },
  "critical-impediments": { green: 0, amber: 0, higherIsBetter: false },
  "open-blockers": { green: 0, amber: 2, higherIsBetter: false },
  "cycle-time-p85": { green: 7, amber: 14, higherIsBetter: false },
};

export interface HealthWindows {
  /** Pointed sprints predictability looks at. */
  sprintWindow: number;
  /** Days a standup blocker stays recent. */
  blockerWindowDays: number;
  /** Days of finished work cycle time looks at. */
  cycleWindowDays: number;
}

export type HealthWindowKey = keyof HealthWindows;

export const WINDOW_KEYS: readonly HealthWindowKey[] = [
  "sprintWindow",
  "blockerWindowDays",
  "cycleWindowDays",
];

export const DEFAULT_WINDOWS: HealthWindows = {
  sprintWindow: DEFAULT_PREDICTABILITY_WINDOW,
  blockerWindowDays: 7,
  cycleWindowDays: 90,
};

/** The range each window may take: whole numbers, at least a sprint or a day. */
export const WINDOW_LIMITS: Record<HealthWindowKey, { min: number; max: number }> = {
  sprintWindow: { min: 1, max: 26 },
  blockerWindowDays: { min: 1, max: 90 },
  cycleWindowDays: { min: 1, max: MAX_RANGE_DAYS },
};

export interface HealthSettings {
  thresholds: Record<HealthKpiId, KpiThreshold>;
  windows: HealthWindows;
}

const isWhole = (n: number) => Number.isInteger(n);

/** Why `value` can't be a limit for a KPI of `unit`, or null when it can. */
function limitError(unit: KpiUnit, value: number | undefined): string | null {
  if (value === undefined) return "Enter a number.";
  if (!Number.isFinite(value)) return "Enter a number.";
  if (unit === "percent") {
    return value < 0 || value > 100 ? "Use a percentage from 0 to 100." : null;
  }
  if (unit === "count") {
    return value < 0 || !isWhole(value) ? "Use a whole number, 0 or more." : null;
  }
  return value < 1 || !isWhole(value) ? "Use a whole number of days, 1 or more." : null;
}

function windowError(key: HealthWindowKey, value: number | undefined): string | null {
  const { min, max } = WINDOW_LIMITS[key];
  if (value === undefined || !Number.isFinite(value)) return "Enter a number.";
  if (!isWhole(value) || value < min || value > max) {
    return `Use a whole number from ${min} to ${max}.`;
  }
  return null;
}

/** A field of the settings form: one KPI's green or amber limit, or a window. */
export type ThresholdField = `${HealthKpiId}.green` | `${HealthKpiId}.amber` | HealthWindowKey;

/** Settings as numbers that may be missing or wrong (a typed draft, an agent's patch). */
export interface SettingsInput {
  thresholds: Record<HealthKpiId, { green?: number; amber?: number }>;
  windows: Partial<Record<HealthWindowKey, number>>;
}

/**
 * Check settings: each limit fits its KPI (a percentage 0–100, a whole count,
 * whole days), green and amber are in the KPI's direction (higher-is-better:
 * green at or above amber; lower-is-better: green at or below it), and the
 * windows are whole numbers in range. The page's form and set_thresholds
 * both judge by this.
 */
export function checkSettings(input: SettingsInput): Validation<HealthSettings, ThresholdField> {
  const errors: FormErrors<ThresholdField> = {};
  const thresholds = {} as Record<HealthKpiId, KpiThreshold>;
  for (const id of HEALTH_KPI_IDS) {
    const { unit, higherIsBetter } = KPI_DEFINITIONS[id];
    const { green, amber } = input.thresholds[id] ?? {};
    const greenError = limitError(unit, green);
    const amberError = limitError(unit, amber);
    if (greenError) errors[`${id}.green`] = greenError;
    if (amberError) errors[`${id}.amber`] = amberError;
    if (greenError || amberError) continue;
    const g = green as number;
    const a = amber as number;
    if (higherIsBetter && a > g) {
      errors[`${id}.amber`] = `Amber starts at or below green (${g}).`;
    } else if (!higherIsBetter && a < g) {
      errors[`${id}.amber`] = `Amber ends at or above green (${g}).`;
    } else {
      thresholds[id] = { green: g, amber: a };
    }
  }
  const windows = {} as HealthWindows;
  for (const key of WINDOW_KEYS) {
    const value = input.windows[key];
    const error = windowError(key, value);
    if (error) errors[key] = error;
    else windows[key] = value as number;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { thresholds, windows } };
}

/**
 * The settings in force: each stored limit and window that still passes the
 * checks, the default for the rest. A hand-edited or half-written config
 * (amber above green on a lower-is-better KPI, a window of 0) can't turn
 * every light red; that KPI just keeps its default.
 */
export function settingsOf(config?: HealthDashboardConfig | null): HealthSettings {
  const stored = config?.thresholds ?? {};
  const thresholds = {} as Record<HealthKpiId, KpiThreshold>;
  for (const id of HEALTH_KPI_IDS) {
    const t = stored[id];
    const fallback = { green: DEFAULT_THRESHOLDS[id].green, amber: DEFAULT_THRESHOLDS[id].amber };
    if (!t || typeof t !== "object") {
      thresholds[id] = fallback;
      continue;
    }
    const one = checkSettings({
      thresholds: { ...defaultInput().thresholds, [id]: { green: t.green, amber: t.amber } },
      windows: DEFAULT_WINDOWS,
    });
    thresholds[id] = one.ok ? one.values.thresholds[id] : fallback;
  }
  const windows = { ...DEFAULT_WINDOWS };
  for (const key of WINDOW_KEYS) {
    const value = config?.[key];
    if (typeof value === "number" && windowError(key, value) === null) windows[key] = value;
  }
  return { thresholds, windows };
}

/** The defaults as a checkable input. */
function defaultInput(): SettingsInput {
  const thresholds = {} as SettingsInput["thresholds"];
  for (const id of HEALTH_KPI_IDS) {
    thresholds[id] = { green: DEFAULT_THRESHOLDS[id].green, amber: DEFAULT_THRESHOLDS[id].amber };
  }
  return { thresholds, windows: { ...DEFAULT_WINDOWS } };
}

/** The settings as an input, for merging a patch over them (set_thresholds). */
export function settingsInput(settings: HealthSettings): SettingsInput {
  const thresholds = {} as SettingsInput["thresholds"];
  for (const id of HEALTH_KPI_IDS) thresholds[id] = { ...settings.thresholds[id] };
  return { thresholds, windows: { ...settings.windows } };
}

/** Whether `settings` are the defaults throughout. */
export function isDefaultSettings(settings: HealthSettings): boolean {
  return (
    HEALTH_KPI_IDS.every(
      (id) =>
        settings.thresholds[id].green === DEFAULT_THRESHOLDS[id].green &&
        settings.thresholds[id].amber === DEFAULT_THRESHOLDS[id].amber
    ) && WINDOW_KEYS.every((key) => settings.windows[key] === DEFAULT_WINDOWS[key])
  );
}

/**
 * The config document for `settings`: only what differs from the defaults
 * is stored ("a KPI left out uses the default"), so a later change to a
 * default reaches every team that never touched that KPI.
 */
export function configFor(settings: HealthSettings, updatedAt: string): HealthDashboardConfig {
  const thresholds: Record<string, KpiThreshold> = {};
  for (const id of HEALTH_KPI_IDS) {
    const t = settings.thresholds[id];
    if (t.green !== DEFAULT_THRESHOLDS[id].green || t.amber !== DEFAULT_THRESHOLDS[id].amber) {
      thresholds[id] = { green: t.green, amber: t.amber };
    }
  }
  const config: HealthDashboardConfig = { id: HEALTH_DASHBOARD_ID, updatedAt };
  if (Object.keys(thresholds).length > 0) config.thresholds = thresholds;
  for (const key of WINDOW_KEYS) {
    if (settings.windows[key] !== DEFAULT_WINDOWS[key]) config[key] = settings.windows[key];
  }
  return config;
}

/**
 * The traffic light for `value` under `threshold` (the KPI's default when
 * none is given), or null when there is no value: "No data" is not red.
 */
export function kpiStatus(
  id: HealthKpiId,
  value: number | null | undefined,
  threshold: KpiThreshold = DEFAULT_THRESHOLDS[id]
): TrafficStatus | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (KPI_DEFINITIONS[id].higherIsBetter) {
    if (value >= threshold.green) return "green";
    if (value >= threshold.amber) return "amber";
    return "red";
  }
  if (value <= threshold.green) return "green";
  if (value <= threshold.amber) return "amber";
  return "red";
}

/* ── The page's form ───────────────────────────────────────────────── */

/** The settings form's draft: every field as typed. */
export type SettingsDraft = Record<ThresholdField, string>;

export function settingsDraft(settings: HealthSettings): SettingsDraft {
  const draft = {} as SettingsDraft;
  for (const id of HEALTH_KPI_IDS) {
    draft[`${id}.green`] = String(settings.thresholds[id].green);
    draft[`${id}.amber`] = String(settings.thresholds[id].amber);
  }
  for (const key of WINDOW_KEYS) draft[key] = String(settings.windows[key]);
  return draft;
}

/** A typed number: undefined when blank, NaN when it isn't one (never 0 for empty). */
function typed(raw: string): number | undefined {
  const t = raw.trim();
  return t === "" ? undefined : Number(t);
}

/** Check the settings form: the same rules as `checkSettings`, over typed text. */
export function validateThresholds(
  draft: SettingsDraft
): Validation<HealthSettings, ThresholdField> {
  const thresholds = {} as SettingsInput["thresholds"];
  for (const id of HEALTH_KPI_IDS) {
    thresholds[id] = { green: typed(draft[`${id}.green`]), amber: typed(draft[`${id}.amber`]) };
  }
  const windows: SettingsInput["windows"] = {};
  for (const key of WINDOW_KEYS) windows[key] = typed(draft[key]);
  return checkSettings({ thresholds, windows });
}

/** "from 80%" / "up to 7 days": a limit in words, in the KPI's direction. */
export function limitText(id: HealthKpiId, value: number): string {
  const { unit, higherIsBetter } = KPI_DEFINITIONS[id];
  const shown =
    unit === "percent" ? `${value}%` : unit === "days" ? daysText(value) : String(value);
  return `${higherIsBetter ? "from" : "up to"} ${shown}`;
}

export const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
