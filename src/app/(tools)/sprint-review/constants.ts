/**
 * Sprint Review Kit — fixed data: the standard showcase checklist, the old
 * tool's starter content (so it can be told apart from a user's draft), and
 * the feedback categories' labels and colours. Pure data, no React.
 */

import type { FeedbackCategory } from "./types";

// The checklist and the old starter draft moved to lib/sprints/review-doc,
// so the cockpit and agents can tell the starter draft from a real one.
export { LEGACY_STARTER, STANDARD_CHECKLIST } from "@/lib/sprints/review-doc";

/** The longest demo slot the form takes: a full working day. */
export const MAX_DEMO_MINUTES = 480;

export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = [
  "positive",
  "concern",
  "suggestion",
];

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  positive: "Positive",
  concern: "Concern",
  suggestion: "Suggestion",
};

/** Plural headings for the grouped summary and the export. */
export const CATEGORY_HEADINGS: Record<FeedbackCategory, string> = {
  positive: "What landed well",
  concern: "Concerns",
  suggestion: "Suggestions",
};

/** What each category means, for the picker's tooltips. */
export const CATEGORY_MEANING: Record<FeedbackCategory, string> = {
  positive: "Something that works for them as it is",
  concern: "A problem or a risk they see",
  suggestion: "Something they would add or change",
};

/** Badge colours (theme tokens). */
export const CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  positive: "bg-accent-green/10 text-accent-green border-accent-green/20",
  concern: "bg-danger/10 text-danger border-danger/20",
  suggestion: "bg-accent-amber/10 text-accent-amber border-accent-amber/20",
};

/** The summary's left rule per category (theme tokens). */
export const CATEGORY_RULE: Record<FeedbackCategory, string> = {
  positive: "border-accent-green",
  concern: "border-danger",
  suggestion: "border-accent-amber",
};
