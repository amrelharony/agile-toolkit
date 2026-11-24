/**
 * The Impact Map's new-map and map-details checks: a goal (the map's
 * root) within its cap, an optional measure, and a due day that exists.
 * Nothing is saved blank.
 */

import { isIsoDate } from "@/lib/sprints/calendar";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { MAP_TITLE_MAX, NODE_FIELD_MAX, NODE_TEXT_MAX } from "@/lib/strategy-map/model";

export interface NewMapDraft {
  goal: string;
  measure: string;
  targetDate: string;
  /** The Product Goal it starts from ("Start from the Product Goal"), or "". */
  productGoalId: string;
}

export type NewMapField = keyof NewMapDraft;

export interface NewMapValues {
  goal: string;
  measure?: string;
  targetDate?: string;
  productGoalId?: string;
}

export const emptyNewMap = (): NewMapDraft => ({
  goal: "",
  measure: "",
  targetDate: "",
  productGoalId: "",
});

const over = (max: number) => `Keep it to ${max} characters or fewer.`;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && isIsoDate(v);

export function validateNewMap(d: NewMapDraft): Validation<NewMapValues, NewMapField> {
  const errors: FormErrors<NewMapField> = {};
  const goal = d.goal.replace(/\s+/g, " ").trim();
  const measure = d.measure.replace(/\s+/g, " ").trim();
  const date = d.targetDate.trim();
  if (!goal) errors.goal = "Say the change the business wants.";
  else if (goal.length > NODE_TEXT_MAX) errors.goal = over(NODE_TEXT_MAX);
  if (measure.length > NODE_FIELD_MAX) errors.measure = over(NODE_FIELD_MAX);
  if (date && !isDay(date)) errors.targetDate = "Pick a day that exists.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      goal,
      ...(measure ? { measure } : {}),
      ...(date ? { targetDate: date } : {}),
      ...(d.productGoalId ? { productGoalId: d.productGoalId } : {}),
    },
  };
}

export interface MapDetailsDraft {
  title: string;
  targetDate: string;
}

export type MapDetailsField = keyof MapDetailsDraft;

export function validateMapDetails(
  d: MapDetailsDraft
): Validation<{ title: string; targetDate?: string }, MapDetailsField> {
  const errors: FormErrors<MapDetailsField> = {};
  const title = d.title.replace(/\s+/g, " ").trim();
  const date = d.targetDate.trim();
  if (!title) errors.title = "Give the map a name.";
  else if (title.length > MAP_TITLE_MAX) errors.title = over(MAP_TITLE_MAX);
  if (date && !isDay(date)) errors.targetDate = "Pick a day that exists.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { title, ...(date ? { targetDate: date } : {}) } };
}
