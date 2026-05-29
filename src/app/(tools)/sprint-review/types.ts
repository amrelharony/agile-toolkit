/**
 * Sprint Review Kit — shared component types.
 *
 * These describe the in-UI shape consumed by the four tabs and the store
 * hook. The persisted entity is `SprintReview` in workspace-types; the
 * `useSprintReviewStore` hook bridges the two (the doc is structurally a
 * superset of these fields plus an id).
 */

export interface DemoFeature {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string;
  timeMinutes: number;
}

export type FeedbackCategory = "positive" | "concern" | "suggestion";

export interface FeedbackItem {
  id: string;
  stakeholder: string;
  feedback: string;
  category: FeedbackCategory;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface SprintReviewStore {
  // Tab 1 - Demo Script
  sprintName: string;
  sprintNumber: string;
  features: DemoFeature[];

  // Tab 2 - Stakeholder Feedback
  meetingDate: string;
  feedbackItems: FeedbackItem[];

  // Tab 3 - Showcase Checklist
  checklistItems: ChecklistItem[];

  // Tab 4 - Velocity Summary
  committed: number;
  completed: number;
  totalBacklog: number;
  backlogDone: number;

  setSprintName: (v: string) => void;
  setSprintNumber: (v: string) => void;
  addFeature: () => void;
  removeFeature: (id: string) => void;
  updateFeature: (id: string, updates: Partial<DemoFeature>) => void;

  setMeetingDate: (v: string) => void;
  addFeedback: () => void;
  removeFeedback: (id: string) => void;
  updateFeedback: (id: string, updates: Partial<FeedbackItem>) => void;

  toggleChecklist: (id: string) => void;
  addChecklistItem: (label: string) => void;
  removeChecklistItem: (id: string) => void;
  updateChecklistLabel: (id: string, label: string) => void;

  setCommitted: (v: number) => void;
  setCompleted: (v: number) => void;
  setTotalBacklog: (v: number) => void;
  setBacklogDone: (v: number) => void;

  reset: () => void;
}
