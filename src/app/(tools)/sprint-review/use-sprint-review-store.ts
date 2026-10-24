"use client";

/**
 * The live review: a sprint's document in the synced workspace store (or
 * the draft without a sprint), so agent writes round-trip into the page.
 * Every write reads the freshest document through getState(), so rapid
 * edits never clobber each other, and the first write to a sprint without
 * a document creates it from `blankReview(sprint)`.
 *
 * The example has the same shape of source over an in-memory store, so the
 * tabs never need to know which one they are editing.
 */

import { useMemo } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintGoal, SprintReview, Story } from "@/lib/stores/workspace-types";
import { DRAFT_REVIEW_ID, reviewFacts } from "@/lib/sprints/review-doc";
import { viewReview } from "./doc";
import type { ReviewExample } from "./example";
import type { ReviewSource, ReviewWriter } from "./types";

/**
 * The draft's id. The ids are shared with the cockpit and the
 * tool.sprint_review.* agent actions through lib/sprints/review-doc.
 */
export const SR_ID = DRAFT_REVIEW_ID;

const NO_REVIEWS: SprintReview[] = [];
const NO_STORIES: Story[] = [];
const NO_GOALS: SprintGoal[] = [];

/** Writes `sprint`'s review (the draft without one) in the workspace. */
export function liveWriter(sprint?: Pick<Sprint, "id" | "name">): ReviewWriter {
  const read = () => viewReview(useWorkspaceStore.getState().sprintReviews, sprint).doc;
  return {
    read,
    update: (change) => useWorkspaceStore.getState().upsertSprintReview(change(read())),
  };
}

/** The review of `sprint` (the draft without one), its facts and its writer. */
export function useLiveReview(sprint: Sprint | undefined): ReviewSource {
  const docs = useWorkspaceStore((s) => s.sprintReviews) ?? NO_REVIEWS;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const goals = useWorkspaceStore((s) => s.sprintGoals) ?? NO_GOALS;
  const view = useMemo(() => viewReview(docs, sprint), [docs, sprint]);
  const facts = useMemo(
    () => (sprint ? reviewFacts(sprint, stories, goals) : null),
    [sprint, stories, goals]
  );
  const writer = useMemo(() => liveWriter(sprint), [sprint]);
  return { ...view, sprint, facts, stories, writer, example: false };
}

/* ── The example, in memory ──────────────────────────────────────────── */

export type ExampleReviewStore = StoreApi<{ review: SprintReview }>;

/** An in-memory copy of the example review, alive while the example is open. */
export function createExampleReviewStore(example: ReviewExample): ExampleReviewStore {
  return createStore(() => ({ review: example.review }));
}

/** The example as a review source: same tabs, nothing leaves memory. */
export function useExampleReview(example: ReviewExample, store: ExampleReviewStore): ReviewSource {
  const doc = useStore(store, (s) => s.review);
  const facts = useMemo(
    () => reviewFacts(example.sprint, example.stories, example.goals),
    [example]
  );
  const writer = useMemo<ReviewWriter>(
    () => ({
      read: () => store.getState().review,
      update: (change) => store.setState((s) => ({ review: change(s.review) })),
    }),
    [store]
  );
  return {
    doc,
    stored: true,
    sprint: example.sprint,
    facts,
    stories: example.stories,
    writer,
    example: true,
  };
}
