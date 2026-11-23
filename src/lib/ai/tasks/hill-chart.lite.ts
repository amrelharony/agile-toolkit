/**
 * Hill Chart's AI task, the lite half pages import (no zod; the def, with
 * its schemas, is `hill-chart.ts` and loads on first AI use): the caps, the
 * page's input builder, the update without AI and the ref.
 */

import { lazyAiTask } from "../task-ref";
import {
  HILL_DONE,
  STUCK_DAYS,
  daysSinceMove,
  sideOf,
  type ScopeMovement,
} from "@/lib/hill-chart/model";
import type { HillChart } from "@/lib/stores/workspace-types";
import type { UpdateNoteInput, UpdateNoteOutput } from "./hill-chart";
export type { UpdateNoteInput, UpdateNoteOutput } from "./hill-chart";

/** A title as sent (a chart's or a scope's). */
export const UPDATE_TITLE_MAX = 200;
/** At most this many scopes: a chart's cap. */
export const UPDATE_SCOPES_MAX = 30;
/** The update's length: a short paragraph for the week. */
export const UPDATE_TEXT_MAX = 800;
export const UPDATE_QUESTIONS_MAX = 3;
export const UPDATE_QUESTION_MAX = 200;

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * What the page sends: the chart's title, today, and each scope with where
 * it was at the check-in compared against (`moves`), how long since it
 * moved and whether it is done. Names and notes never go.
 */
export function updateNoteInput(
  chart: Pick<HillChart, "title" | "scopes">,
  moves: readonly ScopeMovement[],
  today: string,
  now: Date
): UpdateNoteInput {
  const before = new Map(moves.map((m) => [m.scopeId, m.from]));
  return {
    title: cut(chart.title.trim(), UPDATE_TITLE_MAX),
    today,
    scopes: chart.scopes.slice(0, UPDATE_SCOPES_MAX).map((s) => {
      const previous = before.get(s.id);
      return {
        title: cut(s.title.trim(), UPDATE_TITLE_MAX),
        position: s.position,
        ...(typeof previous === "number" ? { previous } : {}),
        daysSinceMove: daysSinceMove(s, now),
        done: s.position >= HILL_DONE,
      };
    }),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The week's update without AI: how many pieces are over the hill, what
 * moved forward or back since the check-in compared against, and each
 * scope stuck on the uphill side; one question per stuck scope (up to 3).
 * A chart with no scopes throws, as its schema refuses it.
 */
export function updateNoteFallback(input: UpdateNoteInput): UpdateNoteOutput {
  if (input.scopes.length === 0) throw new Error("Add a scope to the chart first.");
  const scopes = input.scopes;
  const over = scopes.filter((s) => sideOf(s.position) !== "uphill").length;
  const done = scopes.filter((s) => s.done).length;
  const compared = scopes.filter((s) => typeof s.previous === "number");
  const forward = compared.filter((s) => s.position > (s.previous as number)).length;
  const back = compared.filter((s) => s.position < (s.previous as number)).length;
  // The stuck rule (lib/hill-chart isStuck), on the days the page counted.
  const stuckScopes = scopes
    .filter((s) => sideOf(s.position) === "uphill" && s.daysSinceMove >= STUCK_DAYS)
    .sort((a, b) => b.daysSinceMove - a.daysSinceMove);
  const parts = [
    `${over} of ${plural(scopes.length, "piece")} ${over === 1 ? "is" : "are"} over the hill${
      done > 0 ? `, ${done} done` : ""
    }.`,
  ];
  if (compared.length > 0) {
    parts.push(
      forward === 0 && back === 0
        ? "Nothing moved since the last check-in."
        : `${forward} moved forward${back > 0 ? ` and ${back} moved back` : ""} since the last check-in.`
    );
  }
  for (const s of stuckScopes.slice(0, 3)) {
    parts.push(`${s.title} hasn't moved uphill for ${plural(s.daysSinceMove, "day")}.`);
  }
  if (stuckScopes.length > 3) parts.push(`${stuckScopes.length - 3} more are stuck uphill.`);
  return {
    update: cut(parts.join(" "), UPDATE_TEXT_MAX),
    questions: stuckScopes
      .slice(0, UPDATE_QUESTIONS_MAX)
      .map((s) =>
        cut(
          `What is still unknown about ${s.title}, and who could help work it out?`,
          UPDATE_QUESTION_MAX
        )
      ),
  };
}

export const hillChartUpdateNoteTask = lazyAiTask<UpdateNoteInput, UpdateNoteOutput>(
  { id: "hill-chart.update_note", toolId: "hill-chart", fallback: updateNoteFallback },
  () => import("./hill-chart").then((m) => m.hillChartUpdateNoteTask)
);
