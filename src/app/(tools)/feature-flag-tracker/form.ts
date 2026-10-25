/**
 * Feature Flag Tracker: the draft behind the add form and the editor, its
 * checks, how saved values land on a flag, and the releases a flag can ship
 * behind. Pure.
 *
 * The old form saved every flag as a prod rollout created today, whatever
 * was chosen, and cut long names short without a word. Now the purpose is
 * unset until picked (staleness depends on it), the environment stays empty
 * unless chosen, the created day starts at today but can be moved back
 * (a flag added for an old codebase isn't new), and a name that's too long
 * is an error.
 */

import type {
  FeatureFlag,
  FeatureFlagEnv,
  FeatureFlagPurpose,
  Release,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";
import {
  FLAG_DESCRIPTION_MAX,
  FLAG_NAME_MAX,
  FLAG_OWNER_MAX,
  flagDateErrors,
} from "@/lib/flags/model";
import type { FormErrors, Validation } from "@/lib/utils/form";

export interface FlagDraft {
  name: string;
  owner: string;
  purpose: FeatureFlagPurpose | null;
  /** "" for not set. */
  environment: FeatureFlagEnv | "";
  createdAt: string;
  /** "" for no planned removal date. */
  removeBy: string;
  /** "" for not linked to a release. */
  releaseId: string;
  description: string;
  /** Only checked for a retired flag (the editor shows it then). */
  retiredAt: string;
}

export type FlagField = keyof FlagDraft;

export interface FlagValues {
  name: string;
  owner?: string;
  purpose: FeatureFlagPurpose;
  environment?: FeatureFlagEnv;
  createdAt: string;
  removeBy?: string;
  releaseId?: string;
  description?: string;
  retiredAt?: string;
}

/** A blank add form: nothing chosen, created today. */
export function emptyDraft(today: string): FlagDraft {
  return {
    name: "",
    owner: "",
    purpose: null,
    environment: "",
    createdAt: today,
    removeBy: "",
    releaseId: "",
    description: "",
    retiredAt: "",
  };
}

/** The editor's draft for a stored flag. */
export function draftFrom(f: FeatureFlag): FlagDraft {
  return {
    name: f.name,
    owner: f.owner ?? "",
    purpose: f.purpose,
    environment: f.environment ?? "",
    createdAt: f.createdAt,
    removeBy: f.removeBy ?? "",
    releaseId: f.releaseId ?? "",
    description: f.description ?? "",
    retiredAt: f.retiredAt ?? "",
  };
}

/**
 * Check a draft against `today`. A missing name or purpose is an error,
 * never a default. Dates follow lib/flags flagDateErrors (the agent's
 * rules too); `retired` checks the retired day (the editor of a retired
 * flag). A date the editor opened with and the user left alone isn't
 * judged again: an agent's day, written in UTC, can read as tomorrow here.
 */
export function validateFlag(
  d: FlagDraft,
  today: string,
  { retired = false, stored }: { retired?: boolean; stored?: FlagDraft } = {}
): Validation<FlagValues, FlagField> {
  const errors: FormErrors<FlagField> = {};
  const name = d.name.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const owner = d.owner.trim();
  const description = d.description.trim();
  if (!name) errors.name = "Enter the flag's name, as it is in the code.";
  else if (name.length > FLAG_NAME_MAX)
    errors.name = `Keep the name to ${FLAG_NAME_MAX} characters.`;
  if (!d.purpose) errors.purpose = "Pick what the flag is for: it decides when it goes stale.";
  if (owner.length > FLAG_OWNER_MAX)
    errors.owner = `Keep the name to ${FLAG_OWNER_MAX} characters.`;
  if (description.length > FLAG_DESCRIPTION_MAX)
    errors.description = `Keep the description to ${FLAG_DESCRIPTION_MAX} characters.`;

  // A flag retired before retired days were kept may stay without one.
  const undated = stored !== undefined && stored.retiredAt === "" && d.retiredAt === "";
  const dates = flagDateErrors(
    {
      createdAt: d.createdAt,
      removeBy: d.removeBy,
      ...(retired ? { retiredAt: d.retiredAt } : {}),
    },
    today,
    { retiring: retired && !undated }
  );
  const kept = (k: "createdAt" | "removeBy" | "retiredAt") =>
    stored !== undefined && d[k] === stored[k] && d.createdAt === stored.createdAt;
  for (const k of ["createdAt", "removeBy", "retiredAt"] as const) {
    if (dates[k] && !(kept(k) && d[k] !== "")) errors[k] = dates[k];
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      purpose: d.purpose as FeatureFlagPurpose,
      createdAt: d.createdAt,
      ...(owner ? { owner } : {}),
      ...(d.environment ? { environment: d.environment } : {}),
      ...(d.removeBy ? { removeBy: d.removeBy } : {}),
      ...(d.releaseId ? { releaseId: d.releaseId } : {}),
      ...(description ? { description } : {}),
      ...(retired && d.retiredAt ? { retiredAt: d.retiredAt } : {}),
    },
  };
}

/** A new live flag (on). */
export function newFlag(v: FlagValues, id: string): FeatureFlag {
  const { retiredAt, ...rest } = v;
  void retiredAt;
  return { id, status: "on", ...rest };
}

const OPTIONAL = ["owner", "environment", "removeBy", "releaseId", "description"] as const;

/** `f` with the editor's values; fields the editor doesn't show (status, sentTo) are kept. Unchanged: the same object. */
export function applyFlag(f: FeatureFlag, v: FlagValues): FeatureFlag {
  const next: FeatureFlag = { ...f, name: v.name, purpose: v.purpose, createdAt: v.createdAt };
  for (const key of OPTIONAL) {
    const value = v[key];
    if (value === undefined) delete next[key];
    else (next as unknown as Record<string, string>)[key] = value;
  }
  if (f.status === "retired" && v.retiredAt) next.retiredAt = v.retiredAt;
  return JSON.stringify(next) === JSON.stringify(f) ? f : next;
}

/** The validated retired day for "Retire" (defaults to today, can be moved back). */
export function validateRetiredDay(
  day: string,
  createdAt: string,
  today: string
): Validation<string, "retiredAt"> {
  const error = flagDateErrors({ createdAt, retiredAt: day }, today, { retiring: true }).retiredAt;
  return error ? { ok: false, errors: { retiredAt: error } } : { ok: true, values: day };
}

/* ── Releases a flag can ship behind ────────────────────────────────── */

export interface ReleaseOption {
  id: string;
  label: string;
}

/**
 * Release Readiness's releases, for "Ships with": the ones being planned
 * first (soonest first), then the rest, newest first. Example releases (a
 * loaded example over there) and unnamed ones aren't offered.
 */
export function releaseOptions(releases: readonly Release[] | undefined): ReleaseOption[] {
  const real = (releases ?? []).filter((r) => !isExampleId(r.id) && r.name?.trim());
  const planning = real
    .filter((r) => r.status === "planning")
    .sort((a, b) => (a.plannedDate || "").localeCompare(b.plannedDate || ""));
  const rest = real
    .filter((r) => r.status !== "planning")
    .sort((a, b) =>
      (b.shippedDate ?? b.plannedDate ?? "").localeCompare(a.shippedDate ?? a.plannedDate ?? "")
    );
  return [...planning, ...rest].map((r) => ({
    id: r.id,
    label: `${r.name.trim()} (${r.status === "planning" ? `planned ${r.plannedDate}` : r.status === "shipped" ? "shipped" : "rolled back"})`,
  }));
}
