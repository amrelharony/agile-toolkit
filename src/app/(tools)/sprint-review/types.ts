/**
 * Sprint Review Kit — shared types.
 *
 * The persisted entity is `SprintReview` in workspace-types, one document
 * per sprint (lib/sprints/review-doc). The page renders it from a
 * `ReviewSource`: the live workspace document or the in-memory example, so
 * every tab works the same on both and the example never reaches the
 * workspace.
 */

import type { ReviewFacts } from "@/lib/sprints/review-doc";
import type { Sprint, SprintReview, Story } from "@/lib/stores/workspace-types";

export type {
  ChecklistItem,
  DemoFeature,
  FeedbackCategory,
  FeedbackItem,
  SprintReview,
} from "@/lib/stores/workspace-types";

/** Where the review's edits go. */
export interface ReviewWriter {
  /** The document as it stands right now (a blank one while nothing is stored). */
  read(): SprintReview;
  /**
   * Apply `change` to the document as it stands at that moment (never a
   * render's copy, so two quick edits don't overwrite each other). The
   * first change to a sprint's review creates its document.
   */
  update(change: (doc: SprintReview) => SprintReview): void;
}

/** One review on screen, and what it can say without typing. */
export interface ReviewSource {
  /** The document (a blank one while nothing is stored). */
  doc: SprintReview;
  /** False while there is no document: nothing is written until an edit. */
  stored: boolean;
  /** The sprint under review; absent for the draft. */
  sprint?: Sprint;
  /** The goal, the done stories and the points, read from the sprint. */
  facts: ReviewFacts | null;
  /** Every story (for the backlog's progress). */
  stories: readonly Story[];
  writer: ReviewWriter;
  /** The in-memory example: nothing is saved, sent or logged. */
  example: boolean;
}
