/**
 * Every tool AI task's browser-safe half, listed by hand (no codegen). Add a
 * tool's task here and its prompt to `index.server.ts`; the contract test
 * fails until both are in.
 */

import type { AiTaskDef } from "../task-types";
import { suggestOptionsTask } from "./_example";
import { clusterTask, mergeQuestionsTask, toBacklogTask } from "./audience-wall";
import { backlogHealthReviewTask } from "./backlog-health";
import { cardForMoodTask, generateCardsTask } from "./card-decks";
import { agendaTask } from "./facilitator-timers";
import { interruptClassifyTask } from "./interrupt-buffer";
import { meetingAuditSuggestTask } from "./meeting-audit";
import { parkingRouteTask } from "./parking-lot";
import { themeNamesTask } from "./picker";
import { productGoalDraftTask } from "./product-goal";
import { groupTopicsTask, surprisePlanTask } from "./retro";
import { retroActionsThemesTask } from "./retro-actions";
import { categoriesTask, countermeasureTask, nextWhyTask } from "./root-cause";
import { notebookTagTask, notebookWeeklySummaryTask } from "./sm-notebook";
import { sprintRiskNoteTask } from "./sprint";

// `any` here only erases each task's own input/output types for the list; the
// routes check every input and output against the task's schemas at run time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AI_TASKS: readonly AiTaskDef<any, any>[] = [
  suggestOptionsTask,
  clusterTask,
  mergeQuestionsTask,
  toBacklogTask,
  backlogHealthReviewTask,
  generateCardsTask,
  cardForMoodTask,
  agendaTask,
  interruptClassifyTask,
  meetingAuditSuggestTask,
  parkingRouteTask,
  themeNamesTask,
  productGoalDraftTask,
  surprisePlanTask,
  groupTopicsTask,
  retroActionsThemesTask,
  nextWhyTask,
  categoriesTask,
  countermeasureTask,
  notebookWeeklySummaryTask,
  notebookTagTask,
  sprintRiskNoteTask,
];
