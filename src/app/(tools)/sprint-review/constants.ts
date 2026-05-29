/**
 * Sprint Review Kit — seed defaults + feedback-category presentation maps.
 * Pure data, no React; shared by the store hook and the feedback tab.
 */

import type { ChecklistItem, DemoFeature, FeedbackCategory, FeedbackItem } from "./types";

export const DEFAULT_FEATURES: DemoFeature[] = [
  {
    id: "f1",
    name: "User Login Flow",
    description: "Enhanced authentication with SSO support",
    acceptanceCriteria: "User can log in via email/password and Google SSO",
    timeMinutes: 5,
  },
];

export const DEFAULT_FEEDBACK: FeedbackItem[] = [];

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "c1", label: "Environment is working", checked: false },
  { id: "c2", label: "Demo data prepared", checked: false },
  { id: "c3", label: "Acceptance criteria reviewed", checked: false },
  { id: "c4", label: "Stakeholders invited", checked: false },
  { id: "c5", label: "Meeting link shared", checked: false },
  { id: "c6", label: "Screen sharing tested", checked: false },
  { id: "c7", label: "Backup plan ready", checked: false },
  { id: "c8", label: "Release notes prepared", checked: false },
];

export const DEFAULT_STATE = {
  sprintName: "Sprint Alpha",
  sprintNumber: "1",
  features: DEFAULT_FEATURES,
  // Empty on the server to avoid hydration mismatch — the main component
  // initializes this on first client mount via useEffect.
  meetingDate: "",
  feedbackItems: DEFAULT_FEEDBACK,
  checklistItems: DEFAULT_CHECKLIST,
  committed: 40,
  completed: 36,
  totalBacklog: 200,
  backlogDone: 36,
};

export const CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  positive: "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/20",
  concern: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20",
  suggestion: "bg-[#ffaa00]/10 text-[#ffaa00] border-[#ffaa00]/20",
};

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  positive: "Positive",
  concern: "Concern",
  suggestion: "Suggestion",
};
