/**
 * Every tool AI task's server prompt, by task id. Server-only. Add a tool's
 * prompt here when its task goes into `index.ts`.
 */

import "server-only";
import type { AiTaskPrompt } from "../task-types";
import { suggestOptionsPrompt } from "./_example.server";
import { clusterPrompt, mergeQuestionsPrompt, toBacklogPrompt } from "./audience-wall.server";
import { backlogHealthReviewPrompt } from "./backlog-health.server";
import { bugTriageSeverityPrompt } from "./bug-triage.server";
import { cardForMoodPrompt, generateCardsPrompt } from "./card-decks.server";
import { mapExamplesPrompt, mapQuestionsPrompt, mapRulesPrompt } from "./example-mapping.server";
import { agendaPrompt } from "./facilitator-timers.server";
import { hillChartUpdateNotePrompt } from "./hill-chart.server";
import { interruptClassifyPrompt } from "./interrupt-buffer.server";
import { meetingAuditSuggestPrompt } from "./meeting-audit.server";
import { notesToActionsExtractPrompt } from "./notes-to-actions.server";
import { parkingRoutePrompt } from "./parking-lot.server";
import { themeNamesPrompt } from "./picker.server";
import { pokerSimilarPrompt } from "./planning-poker.server";
import { productCanvasDraftPrompt, productCanvasGapsPrompt } from "./product-canvas.server";
import { productGoalDraftPrompt } from "./product-goal.server";
import { sizingDiscussPrompt, sizingSplitPrompt } from "./relative-sizing.server";
import { releaseReadinessNotesPrompt } from "./release-readiness.server";
import { groupTopicsPrompt, surprisePlanPrompt } from "./retro.server";
import { retroActionsThemesPrompt } from "./retro-actions.server";
import { categoriesPrompt, countermeasurePrompt, nextWhyPrompt } from "./root-cause.server";
import { notebookTagPrompt, notebookWeeklySummaryPrompt } from "./sm-notebook.server";
import { sprintRiskNotePrompt } from "./sprint.server";
import { testSessionsChartersPrompt } from "./test-sessions.server";

// See index.ts on `any`: each prompt's input is checked by its task's schema first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AI_PROMPTS: readonly (AiTaskPrompt<any> & { taskId: string })[] = [
  suggestOptionsPrompt,
  clusterPrompt,
  mergeQuestionsPrompt,
  toBacklogPrompt,
  backlogHealthReviewPrompt,
  bugTriageSeverityPrompt,
  generateCardsPrompt,
  cardForMoodPrompt,
  mapRulesPrompt,
  mapExamplesPrompt,
  mapQuestionsPrompt,
  agendaPrompt,
  hillChartUpdateNotePrompt,
  interruptClassifyPrompt,
  meetingAuditSuggestPrompt,
  notesToActionsExtractPrompt,
  parkingRoutePrompt,
  themeNamesPrompt,
  pokerSimilarPrompt,
  productCanvasDraftPrompt,
  productCanvasGapsPrompt,
  productGoalDraftPrompt,
  sizingDiscussPrompt,
  sizingSplitPrompt,
  releaseReadinessNotesPrompt,
  surprisePlanPrompt,
  groupTopicsPrompt,
  retroActionsThemesPrompt,
  nextWhyPrompt,
  categoriesPrompt,
  countermeasurePrompt,
  notebookWeeklySummaryPrompt,
  notebookTagPrompt,
  sprintRiskNotePrompt,
  testSessionsChartersPrompt,
];
