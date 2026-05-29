"use client";

/**
 * The sprint review is a singleton document in the synced workspace store
 * (one row under a fixed id) rather than an isolated localStorage store, so
 * MCP-written reviews round-trip into the UI. `useSprintReviewStore` keeps the
 * exact shape the components consumed before the migration; each setter reads
 * the freshest doc via getState() to avoid clobbering on rapid edits.
 *
 * SR_ID MUST match the constant in src/lib/actions/tools/sprint-review.ts so
 * agent writes land on the same row the UI renders.
 */

import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintReview } from "@/lib/stores/workspace-types";
import type { SprintReviewStore } from "./types";
import { DEFAULT_STATE } from "./constants";

export const SR_ID = "sprint-review:current";

function currentDoc(): SprintReview {
  const list = useWorkspaceStore.getState().sprintReviews ?? [];
  return list.find((r) => r.id === SR_ID) ?? { id: SR_ID, ...DEFAULT_STATE };
}

export function useSprintReviewStore(): SprintReviewStore {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.sprintReviews ?? []).find((r) => r.id === SR_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertSprintReview);
  const cur: SprintReview = doc ?? { id: SR_ID, ...DEFAULT_STATE };
  return {
    sprintName: cur.sprintName,
    sprintNumber: cur.sprintNumber,
    features: cur.features,
    meetingDate: cur.meetingDate,
    feedbackItems: cur.feedbackItems,
    checklistItems: cur.checklistItems,
    committed: cur.committed,
    completed: cur.completed,
    totalBacklog: cur.totalBacklog,
    backlogDone: cur.backlogDone,
    setSprintName: (v) => upsert({ ...currentDoc(), sprintName: v }),
    setSprintNumber: (v) => upsert({ ...currentDoc(), sprintNumber: v }),
    addFeature: () =>
      upsert({
        ...currentDoc(),
        features: [
          ...currentDoc().features,
          {
            id: crypto.randomUUID(),
            name: "",
            description: "",
            acceptanceCriteria: "",
            timeMinutes: 5,
          },
        ],
      }),
    removeFeature: (id) =>
      upsert({ ...currentDoc(), features: currentDoc().features.filter((f) => f.id !== id) }),
    updateFeature: (id, updates) =>
      upsert({
        ...currentDoc(),
        features: currentDoc().features.map((f) => (f.id === id ? { ...f, ...updates } : f)),
      }),
    setMeetingDate: (v) => upsert({ ...currentDoc(), meetingDate: v }),
    addFeedback: () =>
      upsert({
        ...currentDoc(),
        feedbackItems: [
          ...currentDoc().feedbackItems,
          { id: crypto.randomUUID(), stakeholder: "", feedback: "", category: "positive" },
        ],
      }),
    removeFeedback: (id) =>
      upsert({
        ...currentDoc(),
        feedbackItems: currentDoc().feedbackItems.filter((f) => f.id !== id),
      }),
    updateFeedback: (id, updates) =>
      upsert({
        ...currentDoc(),
        feedbackItems: currentDoc().feedbackItems.map((f) =>
          f.id === id ? { ...f, ...updates } : f
        ),
      }),
    toggleChecklist: (id) =>
      upsert({
        ...currentDoc(),
        checklistItems: currentDoc().checklistItems.map((c) =>
          c.id === id ? { ...c, checked: !c.checked } : c
        ),
      }),
    addChecklistItem: (label) =>
      upsert({
        ...currentDoc(),
        checklistItems: [
          ...currentDoc().checklistItems,
          { id: crypto.randomUUID(), label, checked: false },
        ],
      }),
    removeChecklistItem: (id) =>
      upsert({
        ...currentDoc(),
        checklistItems: currentDoc().checklistItems.filter((c) => c.id !== id),
      }),
    updateChecklistLabel: (id, label) =>
      upsert({
        ...currentDoc(),
        checklistItems: currentDoc().checklistItems.map((c) => (c.id === id ? { ...c, label } : c)),
      }),
    setCommitted: (v) => upsert({ ...currentDoc(), committed: v }),
    setCompleted: (v) => upsert({ ...currentDoc(), completed: v }),
    setTotalBacklog: (v) => upsert({ ...currentDoc(), totalBacklog: v }),
    setBacklogDone: (v) => upsert({ ...currentDoc(), backlogDone: v }),
    reset: () => upsert({ id: SR_ID, ...DEFAULT_STATE }),
  };
}
