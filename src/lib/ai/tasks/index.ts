/**
 * Every tool AI task's browser-safe half, listed by hand (no codegen). Add a
 * tool's task here and its prompt to `index.server.ts`; the contract test
 * fails until both are in.
 */

import type { AiTaskDef } from "../task-types";
import { suggestOptionsTask } from "./_example";
import { clusterTask, mergeQuestionsTask, toBacklogTask } from "./audience-wall";
import { backlogHealthReviewTask } from "./backlog-health";
import { bugTriageSeverityTask } from "./bug-triage";
import { cardForMoodTask, generateCardsTask } from "./card-decks";
import { mapExamplesTask, mapQuestionsTask, mapRulesTask } from "./example-mapping";
import { agendaTask } from "./facilitator-timers";
import { hillChartUpdateNoteTask } from "./hill-chart";
import { interruptClassifyTask } from "./interrupt-buffer";
import { meetingAuditSuggestTask } from "./meeting-audit";
import { notesToActionsExtractTask } from "./notes-to-actions";
import { parkingRouteTask } from "./parking-lot";
import { themeNamesTask } from "./picker";
import { pokerSimilarTask } from "./planning-poker";
import { productCanvasDraftTask, productCanvasGapsTask } from "./product-canvas";
import { productGoalDraftTask } from "./product-goal";
import { sizingDiscussTask, sizingSplitTask } from "./relative-sizing";
import { releaseReadinessNotesTask } from "./release-readiness";
import { groupTopicsTask, surprisePlanTask } from "./retro";
import { retroActionsThemesTask } from "./retro-actions";
import { categoriesTask, countermeasureTask, nextWhyTask } from "./root-cause";
import { notebookTagTask, notebookWeeklySummaryTask } from "./sm-notebook";
import { sprintRiskNoteTask } from "./sprint";
import { testSessionsChartersTask } from "./test-sessions";

// `any` here only erases each task's own input/output types for the list; the
// routes check every input and output against the task's schemas at run time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AI_TASKS: readonly AiTaskDef<any, any>[] = [
  suggestOptionsTask,
  clusterTask,
  mergeQuestionsTask,
  toBacklogTask,
  backlogHealthReviewTask,
  bugTriageSeverityTask,
  generateCardsTask,
  cardForMoodTask,
  mapRulesTask,
  mapExamplesTask,
  mapQuestionsTask,
  agendaTask,
  hillChartUpdateNoteTask,
  interruptClassifyTask,
  meetingAuditSuggestTask,
  notesToActionsExtractTask,
  parkingRouteTask,
  themeNamesTask,
  pokerSimilarTask,
  productCanvasDraftTask,
  productCanvasGapsTask,
  productGoalDraftTask,
  sizingDiscussTask,
  sizingSplitTask,
  releaseReadinessNotesTask,
  surprisePlanTask,
  groupTopicsTask,
  retroActionsThemesTask,
  nextWhyTask,
  categoriesTask,
  countermeasureTask,
  notebookWeeklySummaryTask,
  notebookTagTask,
  sprintRiskNoteTask,
  testSessionsChartersTask,
];
