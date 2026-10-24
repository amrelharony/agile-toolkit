/**
 * Sprint Review Kit — fixed data: the standard showcase checklist, the old
 * tool's starter content (so it can be told apart from a user's draft), and
 * the feedback categories' labels and colours. Pure data, no React.
 */

import type { SprintReview } from "@/lib/stores/workspace-types";
import type { FeedbackCategory } from "./types";

/** What a team usually checks before it shows the increment. */
export const STANDARD_CHECKLIST: readonly string[] = [
  "Environment is working",
  "Demo data prepared",
  "Acceptance criteria reviewed",
  "Stakeholders invited",
  "Meeting link shared",
  "Screen sharing tested",
  "Backup plan ready",
  "Release notes prepared",
];

/**
 * What the review held before reviews were per sprint and nothing was
 * typed: a made-up "Sprint Alpha" with one demo item, the checklist and
 * velocity numbers (40 committed, 36 done). The old page stored it on the
 * first visit (stamping the meeting date), so most drafts are exactly this.
 * It is example content, not the user's, and is read as an empty draft
 * (doc.ts, `isStarterDraft`).
 */
export const LEGACY_STARTER: Omit<SprintReview, "id" | "meetingDate"> = {
  sprintName: "Sprint Alpha",
  sprintNumber: "1",
  features: [
    {
      id: "f1",
      name: "User Login Flow",
      description: "Enhanced authentication with SSO support",
      acceptanceCriteria: "User can log in via email/password and Google SSO",
      timeMinutes: 5,
    },
  ],
  feedbackItems: [],
  checklistItems: STANDARD_CHECKLIST.map((label, i) => ({
    id: `c${i + 1}`,
    label,
    checked: false,
  })),
  committed: 40,
  completed: 36,
  totalBacklog: 200,
  backlogDone: 36,
};

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
