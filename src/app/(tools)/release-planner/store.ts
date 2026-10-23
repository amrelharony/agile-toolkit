/**
 * The Release Planner's own settings, persisted per browser under
 * "agile-toolkit:release-planner" (nothing else reads them: the scope and
 * the velocities it forecasts from live in the workspace).
 *
 * Version 1 changed three things, and `migrateLegacyConfig` reads every
 * version-0 config into the new shape:
 *
 *   - The starter values (a 120-point backlog and the velocities
 *     "18, 22, 19, 25, 21, 17, 23, 20") looked like real data. A config that
 *     still holds both was never filled in, so it loads as empty.
 *   - "Scope buffer %" and the "Scope sensitivity" slider compounded the
 *     same idea. They are one "expected scope change %" now; an old config
 *     gets the two combined, so its forecast doesn't move.
 *   - The sprint length follows the team's cadence until one is typed. The
 *     old fixed 14 was the default rather than a choice, so it is dropped;
 *     any other length is kept.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { isExampleId } from "@/components/tool-frame/example-data";
import type { ScopeSource } from "./scope-source";
import { isStarterVelocityInput, type VelocitySource } from "./velocity-source";

export interface ReleasePlannerConfig {
  /** Where the scope comes from. Unset until picked: see `resolveScopeSource`. */
  scopeSource?: ScopeSource;
  /** The story-map slice to plan, when the scope comes from one. */
  sliceId?: string;
  /** Typed scope in points; null until typed. (Version 0's "Backlog size".) */
  backlogSize: number | null;
  /** Expected growth (+) or cut (−) of the scope by release, in percent; null: none. */
  scopeChangePct: number | null;
  /** Where velocities come from. Unset until picked: see `resolveVelocitySource`. */
  velocitySource?: VelocitySource;
  /** Typed velocities, oldest first: points completed per sprint. */
  velocityInput: string;
  /** Calendar days per sprint; null follows the team's ceremony cadence. */
  sprintLengthDays: number | null;
  /** First day to plan from (YYYY-MM-DD). Empty: the day after the active sprint ends, else today. */
  startDate: string;
  /** The date stakeholders ask about (YYYY-MM-DD); empty until picked. */
  targetDate: string;
  /**
   * Version 0's target, in sprints from the start ("" or a number). Read
   * only while no target date is set, so an old target still shows.
   */
  sprintsToReleaseTarget?: string;
  /** Set while the example is loaded (an `example-` id); "Clear example" empties the config. */
  example?: string;
}

export const EMPTY_CONFIG: ReleasePlannerConfig = {
  backlogSize: null,
  scopeChangePct: null,
  velocityInput: "",
  sprintLengthDays: null,
  startDate: "",
  targetDate: "",
};

/** True when the config holds nothing the user entered (Reset has nothing to do). */
export function isEmptyConfig(c: ReleasePlannerConfig): boolean {
  return (
    c.scopeSource === undefined &&
    c.sliceId === undefined &&
    c.backlogSize === null &&
    c.scopeChangePct === null &&
    c.velocitySource === undefined &&
    c.velocityInput.trim() === "" &&
    c.sprintLengthDays === null &&
    c.startDate === "" &&
    c.targetDate === "" &&
    !c.sprintsToReleaseTarget &&
    c.example === undefined
  );
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SCOPE_SOURCES: readonly ScopeSource[] = ["backlog", "slice", "typed"];

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const isoOrEmpty = (v: unknown): string => (typeof v === "string" && ISO_DAY.test(v) ? v : "");

/** A usable version-1 config from whatever was stored (hand edits, older clients). */
export function normalizeConfig(raw: unknown): ReleasePlannerConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const size = finite(r.backlogSize);
  const length = finite(r.sprintLengthDays);
  const config: ReleasePlannerConfig = {
    backlogSize: size !== null && size > 0 ? size : null,
    scopeChangePct: finite(r.scopeChangePct),
    velocityInput: text(r.velocityInput),
    sprintLengthDays: length !== null && Number.isInteger(length) && length >= 1 ? length : null,
    startDate: isoOrEmpty(r.startDate),
    targetDate: isoOrEmpty(r.targetDate),
  };
  if (SCOPE_SOURCES.includes(r.scopeSource as ScopeSource)) {
    config.scopeSource = r.scopeSource as ScopeSource;
  }
  if (typeof r.sliceId === "string" && r.sliceId) config.sliceId = r.sliceId;
  if (r.velocitySource === "manual" || r.velocitySource === "sprints") {
    config.velocitySource = r.velocitySource;
  }
  const target = text(r.sprintsToReleaseTarget).trim();
  if (target) config.sprintsToReleaseTarget = target;
  if (typeof r.example === "string" && isExampleId(r.example)) config.example = r.example;
  return config;
}

/** Version 0's starter backlog size. */
const LEGACY_STARTER_BACKLOG = 120;
/** Version 0's fixed sprint length. */
const LEGACY_DEFAULT_LENGTH = 14;

/** Version 0's buffer and adjustment as one change: (1 + b)(1 + a) − 1, to one decimal. */
export function combineScopeChange(bufferPct: unknown, adjustmentPct: unknown): number {
  const b = finite(bufferPct) ?? 0;
  const a = finite(adjustmentPct) ?? 0;
  const combined = ((1 + b / 100) * (1 + a / 100) - 1) * 100;
  return Math.round(combined * 10) / 10;
}

/** A version-0 config in the version-1 shape (see the header for the rules). */
export function migrateLegacyConfig(raw: unknown): ReleasePlannerConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const untouched =
    r.backlogSize === LEGACY_STARTER_BACKLOG && isStarterVelocityInput(text(r.velocityInput));
  const change = untouched ? 0 : combineScopeChange(r.scopeBuffer, r.scopeAdjustment);
  return normalizeConfig({
    ...r,
    backlogSize: untouched ? null : r.backlogSize,
    // The starter list was never the user's; an emptied box reads the same.
    velocityInput: isStarterVelocityInput(text(r.velocityInput)) ? "" : r.velocityInput,
    scopeChangePct: change === 0 ? null : change,
    sprintLengthDays: r.sprintLengthDays === LEGACY_DEFAULT_LENGTH ? null : r.sprintLengthDays,
  });
}

interface ReleasePlannerStore {
  config: ReleasePlannerConfig;
  updateConfig: (updates: Partial<ReleasePlannerConfig>) => void;
  /** Replace the whole config (Reset's Undo, Clear example). */
  setConfig: (config: ReleasePlannerConfig) => void;
  reset: () => void;
}

export const RELEASE_PLANNER_STORAGE_KEY = "agile-toolkit:release-planner";

export const useReleasePlannerStore = create<ReleasePlannerStore>()(
  persist(
    (set) => ({
      config: EMPTY_CONFIG,
      updateConfig: (updates) => set((s) => ({ config: { ...s.config, ...updates } })),
      setConfig: (config) => set({ config }),
      reset: () => set({ config: EMPTY_CONFIG }),
    }),
    {
      name: RELEASE_PLANNER_STORAGE_KEY,
      storage: safeJSONStorage("release-planner"),
      version: 1,
      partialize: (s) => ({ config: s.config }),
      migrate: (persisted, version) => {
        const config = (persisted as { config?: unknown } | null)?.config;
        return { config: version < 1 ? migrateLegacyConfig(config) : normalizeConfig(config) };
      },
      merge: (persisted, current) => ({
        ...current,
        config: normalizeConfig((persisted as { config?: unknown } | null)?.config),
      }),
    }
  )
);
