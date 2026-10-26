/**
 * MoSCoW: Must have, Should have, Could have, Won't have (this time).
 *
 * A bucket is required to save and is never a default: a row or an item
 * without one is "Not sorted yet" (in the tool, the hub and the agent
 * actions alike). The score is the bucket's priority, 4 / 3 / 2 / 1, so a
 * cross-method view can order Musts above Won'ts.
 */

import type { BacklogItem } from "@/lib/stores/workspace-types";
import { readBacklogItem } from "../defaults";
import {
  defined,
  formatNumber,
  inputErrors,
  notScored,
  put,
  toChoice,
  toNumber,
  toValidation,
} from "./fields";
import type { BucketDef, MethodInput, PrioritizationMethod, RowFields, Values } from "./types";

export const MOSCOW_BUCKETS = ["must", "should", "could", "wont"] as const;
export type MoscowBucket = (typeof MOSCOW_BUCKETS)[number];

export const MOSCOW_LABEL: Record<MoscowBucket, string> = {
  must: "Must have",
  should: "Should have",
  could: "Could have",
  wont: "Won't have (this time)",
};

export const MOSCOW_MEANING: Record<MoscowBucket, string> = {
  must: "Without it the release fails, is unsafe or not allowed.",
  should: "Important, but there's a workaround.",
  could: "Nice to have; first to drop if time runs short.",
  wont: "Agreed out of scope for now.",
};

/** The bucket's priority: the score a cross-method view sorts by. */
export const MOSCOW_PRIORITY: Record<MoscowBucket, number> = {
  must: 4,
  should: 3,
  could: 2,
  wont: 1,
};

export const isMoscowBucket = (v: unknown): v is MoscowBucket =>
  toChoice(MOSCOW_BUCKETS, v) !== undefined;

/** Musts should take at most about this share of the planned effort. */
export const MUST_BUDGET_SHARE = 0.6;
/** The budget bar shows from this many sized items (MIN_SAMPLE.average). */
export const MUST_BUDGET_MIN_SIZED = 3;

const BUCKETS: readonly BucketDef[] = [
  { id: "must", label: MOSCOW_LABEL.must, meaning: MOSCOW_MEANING.must, order: 0, tone: "danger" },
  {
    id: "should",
    label: MOSCOW_LABEL.should,
    meaning: MOSCOW_MEANING.should,
    order: 1,
    tone: "accent",
  },
  {
    id: "could",
    label: MOSCOW_LABEL.could,
    meaning: MOSCOW_MEANING.could,
    order: 2,
    tone: "warning",
  },
  { id: "wont", label: MOSCOW_LABEL.wont, meaning: MOSCOW_MEANING.wont, order: 3, tone: "muted" },
];

const INPUTS: readonly MethodInput[] = [
  {
    key: "bucket",
    kind: "choice",
    label: "Bucket",
    hint: "Must: the release fails without it. Won't: agreed out of scope this time.",
    missing: "Pick a bucket.",
    backlogKey: "moscow",
    options: MOSCOW_BUCKETS.map((id) => ({
      id,
      label: MOSCOW_LABEL[id],
      meaning: MOSCOW_MEANING[id],
    })),
  },
  {
    key: "effort",
    kind: "number",
    label: "Effort",
    hint: "For the Must budget, when the item isn't on the backlog (the backlog's job size counts when it is).",
    missing: "Enter the effort.",
    min: 0,
    optional: true,
  },
];

function read(fields: Values | undefined): Values {
  return {
    bucket: toChoice(MOSCOW_BUCKETS, fields?.bucket),
    effort: toNumber(fields?.effort),
  };
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  const out: RowFields = { ...fields };
  put(out, "bucket", toChoice(MOSCOW_BUCKETS, v.bucket));
  put(out, "effort", toNumber(v.effort));
  return out;
}

export const MOSCOW: PrioritizationMethod = {
  id: "moscow",
  toolId: "moscow",
  label: "MoSCoW",
  embedded: true,
  inputs: INPUTS,
  buckets: BUCKETS,
  read,
  write,
  validate: (draft) => toValidation(draft, inputErrors(INPUTS, draft)),
  evaluate(v) {
    const bucket = toChoice(MOSCOW_BUCKETS, v.bucket);
    if (!bucket) return notScored(["bucket"]);
    const priority = MOSCOW_PRIORITY[bucket];
    return { score: priority, bucket, sortKey: priority, missing: [], warnings: [] };
  },
  format: (score) => formatNumber(score, 2),
  owns: ["moscow"],
  fromBacklog: (item: BacklogItem) => ({
    bucket: toChoice(MOSCOW_BUCKETS, readBacklogItem(item).moscow),
  }),
  toBacklog: (v) => defined({ moscow: toChoice(MOSCOW_BUCKETS, v.bucket) }),
};

/** One row's place in the Must budget: its bucket and effort (null: not sized). */
export interface MoscowBudgetEntry {
  bucket: MoscowBucket | null;
  effort: number | null;
}

export interface MoscowBudget {
  /** Effort of the sized Musts. */
  mustEffort: number;
  /** Effort of the sized Musts, Shoulds and Coulds (Won't has no place in the plan). */
  plannedEffort: number;
  /** mustEffort ÷ plannedEffort, once MUST_BUDGET_MIN_SIZED items are sized; else null. */
  share: number | null;
  /** The Musts take more than MUST_BUDGET_SHARE of the planned effort. */
  over: boolean;
  /** How much Must effort sits above the limit (0 when within it). */
  excess: number;
  /** Planned items (Must, Should, Could) with an effort, and without one. */
  sized: number;
  unsized: number;
}

/**
 * The Must budget: Musts should take at most about 60% of the effort of
 * what's planned (Must + Should + Could; Won't is out of the plan). Below
 * three sized items the share is null: too few to say.
 */
export function mustBudget(entries: readonly MoscowBudgetEntry[]): MoscowBudget {
  let mustEffort = 0;
  let plannedEffort = 0;
  let sized = 0;
  let unsized = 0;
  for (const e of entries) {
    if (!e.bucket || e.bucket === "wont") continue;
    if (e.effort === null || !Number.isFinite(e.effort) || e.effort < 0) {
      unsized += 1;
      continue;
    }
    sized += 1;
    plannedEffort += e.effort;
    if (e.bucket === "must") mustEffort += e.effort;
  }
  const share =
    sized >= MUST_BUDGET_MIN_SIZED && plannedEffort > 0 ? mustEffort / plannedEffort : null;
  const excess = share === null ? 0 : Math.max(0, mustEffort - MUST_BUDGET_SHARE * plannedEffort);
  return {
    mustEffort,
    plannedEffort,
    share,
    over: share !== null && share > MUST_BUDGET_SHARE,
    excess,
    sized,
    unsized,
  };
}

/**
 * A MoSCoW row's effort for the budget: the linked item's WSJF job size,
 * else the row's own optional effort; null when neither is set.
 */
export function moscowEffort(fields: RowFields | undefined, item?: BacklogItem): number | null {
  const size = item ? readBacklogItem(item).jobSize : undefined;
  if (size !== undefined && Number.isFinite(size) && size >= 0) return size;
  return toNumber(fields?.effort) ?? null;
}
