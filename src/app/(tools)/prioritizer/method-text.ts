/**
 * Backlog Prioritizer — one method's result in words, for the tables, the
 * Markdown export and the verdicts.
 *
 * Every number comes from the method registry (lib/prioritization/methods),
 * the code the method tools, Sprint Planning and the agent actions score
 * with; this only says it. A method that hasn't scored an item reads as
 * that method's own "not yet" ("Not sorted yet", "Not placed yet", "Not
 * scored"), never as 0 or a mid-range default.
 */

import {
  HUB_METHOD_IDS,
  method,
  type MethodId,
  type MethodScore,
} from "@/lib/prioritization/methods";
import { MOSCOW_LABEL, isMoscowBucket } from "@/lib/prioritization/methods/moscow";
import { VE_LABEL, isValueEffortQuadrant } from "@/lib/prioritization/methods/value-effort";
import { KANO_CATEGORY_LABEL, KANO_CATEGORIES } from "@/lib/prioritization/methods/kano";
import { COD_URGENCIES, COD_URGENCY_LABEL } from "@/lib/prioritization/methods/cost-of-delay";
import { toChoice } from "@/lib/prioritization/methods/fields";

export const NOT_SCORED = "Not scored";

/** What a method reads before it has scored an item. */
export const UNSCORED_TEXT: Record<MethodId, string> = {
  moscow: "Not sorted yet",
  wsjf: NOT_SCORED,
  rice: NOT_SCORED,
  "value-effort": "Not placed yet",
  ice: NOT_SCORED,
  kano: NOT_SCORED,
  "cost-of-delay": NOT_SCORED,
  eisenhower: "Not sorted yet",
};

/** The methods the hub holds inputs for and edits in place, in its column order. */
export const HUB_EDITED = [
  "moscow",
  "wsjf",
  "rice",
  "value-effort",
] as const satisfies readonly MethodId[];

/** Every hub method, in column order (the methods the consensus can use). */
export const HUB_METHODS: readonly MethodId[] = HUB_METHOD_IDS;

/** The short label of a method ("WSJF", "Value/Effort"). */
export const methodLabel = (id: MethodId): string => method(id).label;

/** One method's result as a short phrase: the score, bucket or quadrant, or its "not yet". */
export function methodText(id: MethodId, s: MethodScore): string {
  switch (id) {
    case "moscow":
      return isMoscowBucket(s.bucket) ? MOSCOW_LABEL[s.bucket] : UNSCORED_TEXT.moscow;
    case "value-effort": {
      if (!isValueEffortQuadrant(s.bucket)) return UNSCORED_TEXT[id];
      return `${VE_LABEL[s.bucket]} (value ${s.extra?.value}, effort ${s.extra?.effort})`;
    }
    case "kano": {
      const category = toChoice(KANO_CATEGORIES, s.bucket);
      return s.score !== null && category ? KANO_CATEGORY_LABEL[category] : NOT_SCORED;
    }
    case "cost-of-delay": {
      if (s.score === null) return NOT_SCORED;
      const lane = toChoice(COD_URGENCIES, s.bucket);
      const cd3 = `CD3 ${method(id).format(s.score)}`;
      return lane ? `${cd3}, ${COD_URGENCY_LABEL[lane]}` : cd3;
    }
    default:
      return s.score === null ? UNSCORED_TEXT[id] : method(id).format(s.score);
  }
}

/** True when the method has scored the item (a bucket, quadrant or number). */
export const scored = (s: MethodScore): boolean => s.sortKey !== null;

/** An item's name for a sentence or a toast: trimmed, "Untitled item" when blank, cut at `max`. */
export function itemName(name: string | undefined, max = 40): string {
  const t = name?.trim() || "Untitled item";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "a", "a and b", "a, b and c". */
export function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "1 item", "3 items". */
export const countText = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
