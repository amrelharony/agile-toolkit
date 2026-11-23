/**
 * Release Readiness's AI task, the def: release notes drafted from the
 * stories a release ships, for customers or for the team. The page checks
 * the answer (`checkedDraft`: no story it wasn't given, every story
 * covered), shows it as plain text, and fills the notes box only when the
 * person uses the draft; it is saved only when they save it, with Undo.
 *
 * At its caps the input can pass TOOL_AI_BODY_BUDGET in 3-byte text, so the
 * page sends it through `fitReleaseNotesInput` (story notes first). Without
 * AI the template answers (`draftReleaseNotes`, through
 * `release-readiness.lite.ts`, which pages import). The prompt is in
 * `release-readiness.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  NOTES_AUDIENCES,
  NOTES_EPIC_MAX,
  NOTES_HEADLINE_MAX,
  NOTES_ID_MAX,
  NOTES_INTRO_MAX,
  NOTES_ITEMS_MAX,
  NOTES_ITEM_MAX,
  NOTES_ITEM_STORIES_MAX,
  NOTES_KEY_MAX,
  NOTES_SECTIONS_MAX,
  NOTES_SECTION_TITLE_MAX,
  NOTES_STORIES_MAX,
  NOTES_STORY_NOTES_MAX,
  NOTES_STORY_TITLE_MAX,
} from "@/lib/releases/notes";
import { releaseNotesFallback } from "./release-readiness.lite";

export { fitReleaseNotesInput, releaseNotesFallback } from "./release-readiness.lite";

const Id = z.string().trim().min(1).max(NOTES_ID_MAX);

const input = z.object({
  release: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  audience: z.enum(NOTES_AUDIENCES),
  rolledBack: z.boolean(),
  stories: z
    .array(
      z.object({
        id: Id,
        title: z.string().trim().min(1).max(NOTES_STORY_TITLE_MAX),
        notes: z.string().trim().max(NOTES_STORY_NOTES_MAX).optional(),
        epic: z.string().trim().max(NOTES_EPIC_MAX).optional(),
        kind: z.enum(["new", "fix", "change"]),
        key: z.string().trim().max(NOTES_KEY_MAX).optional(),
      })
    )
    .min(1)
    .max(NOTES_STORIES_MAX),
});

const output = z.object({
  headline: z.string().trim().min(1).max(NOTES_HEADLINE_MAX),
  intro: z.string().trim().max(NOTES_INTRO_MAX),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(NOTES_SECTION_TITLE_MAX),
        items: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(NOTES_ITEM_MAX),
              storyIds: z.array(Id).min(1).max(NOTES_ITEM_STORIES_MAX),
            })
          )
          .min(1)
          .max(NOTES_ITEMS_MAX),
      })
    )
    .min(1)
    .max(NOTES_SECTIONS_MAX),
});

export type ReleaseNotesInput = z.infer<typeof input>;
export type ReleaseNotesOutput = z.infer<typeof output>;

export const releaseReadinessNotesTask = defineAiTask({
  id: "release-readiness.release_notes",
  toolId: "release-readiness",
  tier: "full",
  effort: "low",
  maxTokens: 8192,
  input,
  output,
  fallback: releaseNotesFallback,
  sample: {
    release: "v3.4 Checkout redesign",
    date: "2026-11-23",
    audience: "customers",
    rolledBack: false,
    stories: [
      { id: "story_a1", title: "One-page checkout", kind: "new", epic: "Checkout" },
      { id: "story_a2", title: "Fix the postcode check for Irish addresses", kind: "fix" },
      { id: "story_a3", title: "Update the order summary layout", kind: "change" },
    ],
  },
});
