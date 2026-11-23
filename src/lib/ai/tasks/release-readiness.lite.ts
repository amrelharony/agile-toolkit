/**
 * Release Readiness's AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `release-readiness.ts` and loads on first AI use):
 * the input fitter, the notes without AI (the template) and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { draftReleaseNotes } from "@/lib/releases/notes";
import type { ReleaseNotesInput, ReleaseNotesOutput } from "./release-readiness";
export type { ReleaseNotesInput, ReleaseNotesOutput } from "./release-readiness";

const TASK_ID = "release-readiness.release_notes";

/**
 * The input cut to fit the AI body budget: at its caps (40 stories with
 * notes, epics and keys) it can pass it in 3-byte text. Story notes go
 * first, from the last story back, then the last stories themselves, so at
 * least one story is always sent. An input that fits comes back as it is.
 */
export function fitReleaseNotesInput(
  input: ReleaseNotesInput,
  budget = TOOL_AI_BODY_BUDGET
): ReleaseNotesInput {
  const size = (stories: ReleaseNotesInput["stories"]) =>
    jsonBytes({ task: TASK_ID, input: { ...input, stories } });
  if (size(input.stories) <= budget) return input;
  let stories = input.stories.map((s) => ({ ...s }));
  for (let i = stories.length - 1; i >= 0 && size(stories) > budget; i--) {
    delete stories[i].notes;
  }
  while (stories.length > 1 && size(stories) > budget) stories = stories.slice(0, -1);
  return { ...input, stories };
}

/** The notes without AI: New, Fixed and Changed from the stories (lib/releases/notes). */
export function releaseNotesFallback(input: ReleaseNotesInput): ReleaseNotesOutput {
  return draftReleaseNotes(input);
}

export const releaseReadinessNotesTask = lazyAiTask<ReleaseNotesInput, ReleaseNotesOutput>(
  { id: TASK_ID, toolId: "release-readiness", fallback: releaseNotesFallback },
  () => import("./release-readiness").then((m) => m.releaseReadinessNotesTask)
);
