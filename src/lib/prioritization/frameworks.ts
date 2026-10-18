/**
 * The prioritization methods that score the shared backlog.
 *
 * The Backlog Prioritizer (`/prioritizer`) owns the backlog: workspace
 * `backlogItems`, where each item holds its MoSCoW, WSJF, RICE and
 * value/effort inputs. Seven method tools score backlog items as rows in
 * workspace `prioritizations`, linked back through `backlogItemId`.
 *
 * This registry is the one place that says, per method: where its tool
 * lives, which `PrioritizationItem.framework` key its rows carry, when to
 * pick it, and how its row fields map to BacklogItem fields where both
 * sides hold the same input. Methods the backlog holds inputs for are
 * `embedded`: the hub reads them from the BacklogItem, and a linked row
 * writes its inputs to the item when it's added (no live two-way sync).
 *
 * Eisenhower (personal tasks), Buy-a-Feature and $100 (group games) are
 * deliberately left out.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { JOBS } from "@/lib/constants/jobs";

export type FrameworkKey = PrioritizationItem["framework"];
export type RowFields = Record<string, number | string>;
export type ImpactValue = BacklogItem["impact"];
export type MoscowBucket = BacklogItem["moscow"];

/** The query parameter a "Score with…" link uses to preselect a backlog item. */
export const BACKLOG_ITEM_PARAM = "backlogItem";

/** The RICE impact steps the backlog allows. */
export const IMPACT_STEPS: readonly ImpactValue[] = [0.25, 0.5, 1, 2, 3];

const MOSCOW_BUCKETS: readonly MoscowBucket[] = ["must", "should", "could", "wont"];

/** A finite number from a row field (numbers or numeric strings), else undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * The nearest allowed RICE impact (0.25, 0.5, 1, 2 or 3). A value halfway
 * between two steps takes the lower one; anything unreadable becomes 1.
 */
export function snapImpact(v: unknown): ImpactValue {
  const n = num(v);
  if (n === undefined) return 1;
  let best = IMPACT_STEPS[0];
  for (const step of IMPACT_STEPS) {
    if (Math.abs(step - n) < Math.abs(best - n)) best = step;
  }
  return best;
}

export function isMoscowBucket(v: unknown): v is MoscowBucket {
  return typeof v === "string" && (MOSCOW_BUCKETS as readonly string[]).includes(v);
}

/** Drop the keys whose value is undefined. */
function compact<T extends Record<string, unknown>>(
  o: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export interface PrioritizationFramework {
  /** The tool id, which is also its route segment. */
  id: string;
  /** The `PrioritizationItem.framework` key its rows carry. */
  framework: FrameworkKey;
  /** Short name for column headers and links. */
  label: string;
  path: string;
  /** "Pick this when…", finishing the sentence. */
  pickWhen: string;
  /** The BacklogItem holds this method's inputs, so the hub reads them from the item. */
  embedded: boolean;
  /** Prefill for the tool's add form from a backlog item (inputs both sides hold). */
  fromBacklog?: (item: BacklogItem) => RowFields;
  /** BacklogItem fields from a row's inputs (inputs both sides hold). */
  toBacklog?: (fields: RowFields | undefined) => Partial<BacklogItem>;
}

/** "Pick this when" from the home page's Prioritize job, so the wording stays in one place. */
function jobPickWhen(toolId: string, fallback: string): string {
  const job = JOBS.find((j) => j.id === "prioritize");
  return job?.alternatives.find((a) => a.toolId === toolId)?.pickWhen ?? fallback;
}

/** In the order the hub shows them. */
export const FRAMEWORKS: readonly PrioritizationFramework[] = [
  {
    id: "moscow",
    framework: "moscow",
    label: "MoSCoW",
    path: "/moscow",
    pickWhen: jobPickWhen("moscow", "you need a quick must/should/could cut for a release"),
    embedded: true,
    fromBacklog: (item): RowFields => (isMoscowBucket(item.moscow) ? { bucket: item.moscow } : {}),
    toBacklog: (fields) => (isMoscowBucket(fields?.bucket) ? { moscow: fields.bucket } : {}),
  },
  {
    id: "wsjf",
    framework: "wsjf",
    label: "WSJF",
    path: "/wsjf",
    pickWhen: jobPickWhen("wsjf", "you're in SAFe or want cost of delay over job size"),
    embedded: true,
    fromBacklog: (item) =>
      compact({
        businessValue: num(item.businessValue),
        timeCriticality: num(item.timeCriticality),
        rrOe: num(item.riskReduction),
        jobSize: num(item.jobSize),
      }),
    toBacklog: (fields) =>
      compact({
        businessValue: num(fields?.businessValue),
        timeCriticality: num(fields?.timeCriticality),
        riskReduction: num(fields?.rrOe),
        jobSize: num(fields?.jobSize),
      }),
  },
  {
    id: "rice-scoring",
    framework: "rice",
    label: "RICE",
    path: "/rice-scoring",
    pickWhen: jobPickWhen("rice-scoring", "you know reach and impact for each idea"),
    embedded: true,
    fromBacklog: (item) =>
      compact({
        reach: num(item.reach),
        impact: num(item.impact),
        confidence: num(item.confidence),
        effort: num(item.effort),
      }),
    toBacklog: (fields) =>
      compact({
        reach: num(fields?.reach),
        impact: num(fields?.impact) === undefined ? undefined : snapImpact(fields?.impact),
        confidence: num(fields?.confidence),
        effort: num(fields?.effort),
      }),
  },
  {
    id: "value-effort-matrix",
    framework: "value-effort",
    label: "Value/Effort",
    path: "/value-effort-matrix",
    pickWhen: "you want a quick 2×2 to spot the quick wins",
    embedded: true,
    fromBacklog: (item) => compact({ value: num(item.value), effort: num(item.matrixEffort) }),
    toBacklog: (fields) =>
      compact({ value: num(fields?.value), matrixEffort: num(fields?.effort) }),
  },
  {
    id: "ice-score",
    framework: "ice",
    label: "ICE",
    path: "/ice-score",
    pickWhen: "you're ranking quick experiments and want a fast gut-check score",
    embedded: false,
  },
  {
    id: "kano-model",
    framework: "kano",
    label: "Kano",
    path: "/kano-model",
    pickWhen: "you want to know which features customers expect and which delight them",
    embedded: false,
  },
  {
    id: "cost-of-delay",
    framework: "cost-of-delay",
    label: "Cost of Delay",
    path: "/cost-of-delay",
    pickWhen: "you can put a money figure on every week of waiting",
    embedded: false,
  },
];

export function frameworkById(id: string): PrioritizationFramework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}

export function frameworkFor(key: FrameworkKey | string): PrioritizationFramework | undefined {
  return FRAMEWORKS.find((f) => f.framework === key);
}

/** Where a "Score with…" link goes: the method's tool with the item preselected. */
export function scoreWithHref(f: PrioritizationFramework, backlogItemId: string): string {
  return `${f.path}?${BACKLOG_ITEM_PARAM}=${encodeURIComponent(backlogItemId)}`;
}

/** The backlog item id a "Score with…" link asked for, if any. */
export function readBacklogItemParam(search: string): string | null {
  const id = new URLSearchParams(search).get(BACKLOG_ITEM_PARAM);
  return id && id.trim() ? id : null;
}

/** Defaults for a new backlog item: mid values, matching the Prioritizer's "Add Item". */
export const BACKLOG_DEFAULTS: Omit<BacklogItem, "id" | "name"> = {
  moscow: "should",
  businessValue: 5,
  timeCriticality: 5,
  riskReduction: 5,
  jobSize: 5,
  reach: 100,
  impact: 1,
  confidence: 80,
  effort: 1,
  value: 5,
  matrixEffort: 5,
};

const clamp10 = (n: number) => Math.min(10, Math.max(1, n));

/**
 * A new backlog item named `name` with `patch` over the defaults.
 *
 * The Prioritizer edits WSJF business value and the matrix value as one
 * "Value" column, so when the patch sets only one of them the other
 * follows (kept on the matrix's 1–10 scale).
 */
export function createBacklogItem(
  name: string,
  patch: Partial<BacklogItem> = {},
  id: string = crypto.randomUUID()
): BacklogItem {
  const coupled: Partial<BacklogItem> = { ...patch };
  if (patch.businessValue !== undefined && patch.value === undefined) {
    coupled.value = clamp10(patch.businessValue);
  } else if (patch.value !== undefined && patch.businessValue === undefined) {
    coupled.businessValue = patch.value;
  }
  return { ...BACKLOG_DEFAULTS, ...coupled, id, name: name.trim().slice(0, 200) };
}

/** Only the fields of `patch` that would change `item`. */
export function changedFields(
  item: BacklogItem,
  patch: Partial<BacklogItem>
): Partial<BacklogItem> {
  const out: Partial<BacklogItem> = {};
  for (const key of Object.keys(patch) as (keyof BacklogItem)[]) {
    if (patch[key] !== undefined && patch[key] !== item[key]) {
      (out as Record<string, unknown>)[key] = patch[key];
    }
  }
  return out;
}
