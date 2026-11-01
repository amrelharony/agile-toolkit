/**
 * The prioritization methods that score the shared backlog: where each
 * one's tool lives and when to pick it.
 *
 * The Backlog Prioritizer (`/prioritizer`) owns the backlog: workspace
 * `backlogItems`, where each item holds its MoSCoW, WSJF, RICE and
 * value/effort inputs. Seven method tools score backlog items as rows in
 * workspace `prioritizations`, linked back through `backlogItemId`.
 *
 * The scoring itself, and how a row's inputs map to the item's, live in
 * the method registry (./methods); this list adds the hub's routing. A
 * method the backlog holds inputs for is `embedded`: the item owns them, a
 * linked row reads them from the item and a save in the tool writes them
 * back, live in both directions (./binding, ./backlog-links).
 *
 * Eisenhower (personal tasks), Buy-a-Feature and $100 (group games) are
 * deliberately left out.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { JOBS } from "@/lib/constants/jobs";
import { ownedPatch } from "./binding";
import { OLD_BACKLOG_DEFAULTS } from "./defaults";
import { defined, toNumber } from "./methods/fields";
import { method, type MethodId, type RowFields } from "./methods";

export type { RowFields };
export { isMoscowBucket, type MoscowBucket } from "./methods/moscow";

export type FrameworkKey = PrioritizationItem["framework"];
/** The RICE impact steps. BacklogItem.impact is a plain number since Phase 7
 *  (an exact custom value is kept); the steps are what snapImpact rounds to. */
export type ImpactValue = 0.25 | 0.5 | 1 | 2 | 3;

/** The query parameter a "Score with…" link uses to preselect a backlog item. */
export const BACKLOG_ITEM_PARAM = "backlogItem";

/** The RICE impact steps. */
export const IMPACT_STEPS: readonly ImpactValue[] = [0.25, 0.5, 1, 2, 3];

/**
 * The nearest RICE impact step (0.25, 0.5, 1, 2 or 3). A value halfway
 * between two steps takes the lower one; anything unreadable becomes 1.
 * For display only: the backlog keeps the exact impact (no snapping).
 */
export function snapImpact(v: unknown): ImpactValue {
  const n = toNumber(v);
  if (n === undefined) return 1;
  let best = IMPACT_STEPS[0];
  for (const step of IMPACT_STEPS) {
    if (Math.abs(step - n) < Math.abs(best - n)) best = step;
  }
  return best;
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

/** The registry's prefill for a method: the inputs the item holds, by input key. */
const prefillFor =
  (id: MethodId) =>
  (item: BacklogItem): RowFields =>
    defined(method(id).fromBacklog?.(item) ?? {}) as RowFields;

/** The registry's owned backlog fields for a row's stored inputs. */
const backlogFor =
  (id: MethodId) =>
  (fields: RowFields | undefined): Partial<BacklogItem> =>
    ownedPatch(id, method(id).read(fields));

/** In the order the hub shows them. */
export const FRAMEWORKS: readonly PrioritizationFramework[] = [
  {
    id: "moscow",
    framework: "moscow",
    label: "MoSCoW",
    path: "/moscow",
    pickWhen: jobPickWhen("moscow", "you need a quick must/should/could cut for a release"),
    embedded: true,
    fromBacklog: prefillFor("moscow"),
    toBacklog: backlogFor("moscow"),
  },
  {
    id: "wsjf",
    framework: "wsjf",
    label: "WSJF",
    path: "/wsjf",
    pickWhen: jobPickWhen("wsjf", "you're in SAFe or want cost of delay over job size"),
    embedded: true,
    fromBacklog: prefillFor("wsjf"),
    toBacklog: backlogFor("wsjf"),
  },
  {
    id: "rice-scoring",
    framework: "rice",
    label: "RICE",
    path: "/rice-scoring",
    pickWhen: jobPickWhen("rice-scoring", "you know reach and impact for each idea"),
    embedded: true,
    fromBacklog: prefillFor("rice"),
    toBacklog: backlogFor("rice"),
  },
  {
    id: "value-effort-matrix",
    framework: "value-effort",
    label: "Value/Effort",
    path: "/value-effort-matrix",
    pickWhen: "you want a quick 2×2 to spot the quick wins",
    embedded: true,
    fromBacklog: prefillFor("value-effort"),
    toBacklog: backlogFor("value-effort"),
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
    pickWhen: "you can say what a week of waiting costs and how long the work takes",
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

/**
 * @deprecated The pre-Phase 7 "Add item" mid values. Nothing applies them
 * any more (a new item starts Not scored); they are the old-default
 * fingerprints lib/prioritization/defaults clears on read.
 */
export const BACKLOG_DEFAULTS = OLD_BACKLOG_DEFAULTS;

/**
 * A new backlog item named `name` with `patch`, and nothing else: every
 * method it isn't given starts Not scored (no mid-range defaults, and the
 * one value field `businessValue` isn't copied anywhere). Stamped as saved
 * by the new code, so its values are read as chosen.
 */
export function createBacklogItem(
  name: string,
  patch: Partial<BacklogItem> = {},
  id: string = crypto.randomUUID(),
  now: string = new Date().toISOString()
): BacklogItem {
  return {
    ...(defined(patch) as Partial<BacklogItem>),
    id,
    name: name.trim().slice(0, 200),
    updatedAt: now,
  };
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
