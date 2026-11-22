/**
 * Facilitator Timers' AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `facilitator-timers.ts` and loads on first AI use).
 */

import { lazyAiTask } from "../task-ref";
import { fallbackAgenda } from "@/lib/facilitator-timers/agenda";
import type { AgendaInput, AgendaOutput } from "./facilitator-timers";
export type { AgendaInput, AgendaOutput } from "./facilitator-timers";

export const AGENDA_MAX_SEGMENTS = 12;

/** An agenda without AI: the nearest built-in agenda, split over the minutes. */
export const agendaFallback = (i: AgendaInput): AgendaOutput => fallbackAgenda(i);

export const agendaTask = lazyAiTask<AgendaInput, AgendaOutput>(
  { id: "facilitator-timers.agenda", toolId: "facilitator-timers", fallback: agendaFallback },
  () => import("./facilitator-timers").then((m) => m.agendaTask)
);
