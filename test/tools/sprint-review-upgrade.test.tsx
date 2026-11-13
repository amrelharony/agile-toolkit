import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { reviewFacts } from "@/lib/sprints/review-doc";
import type { Sprint, SprintGoal, SprintReview, Story } from "@/lib/stores/workspace-types";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * Sprint Review, Phase 3 of the tool upgrade: one review per sprint
 * (keyed by sprintId) with the draft as the fallback; built from the
 * sprint's goal, its answer to "Goal met?" and its done stories; feedback
 * that becomes a backlog story; draft-then-save forms, Undo on every
 * delete and a confirmed, undoable reset of the review on screen; an
 * example that never reaches the workspace.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn() }));
const exported = vi.hoisted(() => ({
  byFile: {} as Record<string, string | undefined>,
  csvByFile: {} as Record<string, { rows: (string | number)[][] } | undefined>,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    filename,
    markdown,
    csvData,
  }: {
    filename: string;
    markdown?: string;
    csvData?: { rows: (string | number)[][] };
  }) => {
    exported.byFile[filename] = markdown;
    exported.csvByFile[filename] = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SprintReviewClient } from "@/app/(tools)/sprint-review/sprint-review-client";
import { SR_ID } from "@/app/(tools)/sprint-review/use-sprint-review-store";
import {
  DRAFT_REVIEW_ID,
  FEEDBACK_TITLE_MAX,
  blankReview,
  demoCandidates,
  demoIdFor,
  demoLength,
  featureFromStory,
  feedbackStoryTitle,
  isStarterDraft,
  moveItem,
  normalizeReview,
  resetSummary,
  reviewDocId,
  startFromDraft,
  usableDraft,
  viewReview,
  withStoriesInDemo,
} from "@/app/(tools)/sprint-review/doc";
import { LEGACY_STARTER } from "@/app/(tools)/sprint-review/constants";
import { buildExample } from "@/app/(tools)/sprint-review/example";
import { demoScript, toMarkdown } from "@/app/(tools)/sprint-review/markdown";
import {
  backlogProgress,
  notDoneSummary,
  numbersChartText,
  pointsLabel,
  reviewNumbers,
  sourceNote,
  sprintOwnNumbers,
} from "@/app/(tools)/sprint-review/numbers";
import { numbersClause, reviewVerdict } from "@/app/(tools)/sprint-review/verdict";
import { validateDemo } from "@/app/(tools)/sprint-review/components/demo-form";
import { validateFeedback } from "@/app/(tools)/sprint-review/components/feedback-form";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const s12: Sprint = {
  id: "s12",
  name: "Sprint 12",
  startDate: "2026-10-12",
  endDate: "2026-10-23",
  pointsPlanned: 0,
  status: "active",
};
const s11: Sprint = {
  id: "s11",
  name: "Sprint 11",
  startDate: "2026-09-28",
  endDate: "2026-10-09",
  pointsPlanned: 20,
  pointsCompleted: 18,
  status: "completed",
};

const STORIES: Story[] = [
  { id: "a", title: "Pay with a saved card", points: 5, status: "done", sprintId: "s12" },
  { id: "b", title: "Receipts by email", points: 3, status: "done", sprintId: "s12" },
  { id: "c", title: "Card nicknames", points: 2, status: "in_progress", sprintId: "s12" },
  { id: "z", title: "Fraud checks", points: 8, status: "backlog" },
];

const GOALS: SprintGoal[] = [
  {
    id: "sprint-goal:sprint:s12",
    sprintId: "s12",
    businessObjective: "",
    goal: "Shoppers pay in one tap",
    criteria: [],
    keyResults: [],
    outcome: { met: "partly", note: "Nicknames slipped", decidedAt: "2026-10-23" },
  },
];

const review = (id: string, extra: Partial<SprintReview> = {}): SprintReview => ({
  ...blankReview(),
  id,
  ...extra,
});

/** A draft as the old page left it after a real edit. */
const legacyDraft = (): SprintReview => ({
  id: SR_ID,
  sprintName: "Sprint Alpha",
  sprintNumber: "7",
  meetingDate: "2026-05-01",
  features: [
    {
      id: "f1",
      name: "Checkout redesign",
      description: "New layout",
      acceptanceCriteria: "",
      timeMinutes: 5,
    },
  ],
  feedbackItems: [
    { id: "fb1", stakeholder: "Marco", feedback: "Love the layout", category: "positive" },
  ],
  checklistItems: [{ id: "c1", label: "Environment is working", checked: true }],
  committed: 30,
  completed: 24,
  totalBacklog: 200,
  backlogDone: 60,
});

const reviews = () => useWorkspaceStore.getState().sprintReviews ?? [];
const reviewById = (id: string) => reviews().find((r) => r.id === id);

const renderReview = () =>
  render(
    <TooltipProvider>
      <SprintReviewClient />
    </TooltipProvider>
  );

// Radix tabs switch on mouse down, not click.
const openTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

/** Click Undo on the most recent undoable toast. */
const undoLast = () => {
  const [, opts] = toastSpy.mock.calls.at(-1)!;
  act(() => opts.action.onClick());
};

const seed = (state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) =>
  useWorkspaceStore.setState(state);

const EMPTY = { sprints: [], sprintReviews: [], sprintGoals: [], stories: [], teamMembers: [] };

beforeEach(() => {
  toastSpy.mockReset();
  history.log.mockClear();
  exported.byFile = {};
  exported.csvByFile = {};
  resetSelectedSprint();
  window.localStorage.clear();
  seed(EMPTY);
});

afterEach(async () => {
  // The page moves focus on the next frame (focusSoon). Let that run while this
  // test's page is still here, or it lands in the next test's and takes focus
  // from whatever that test just focused.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  seed(EMPTY);
});

// ─── Documents ──────────────────────────────────────────────────────────────

describe("one review document per sprint", () => {
  it("keeps the draft id and keys sprints by their id", () => {
    expect(SR_ID).toBe("sprint-review:current");
    expect(DRAFT_REVIEW_ID).toBe(SR_ID);
    expect(reviewDocId("s12")).toBe("sprint-review:sprint:s12");
  });

  it("shows a sprint with no document as a blank review, not stored", () => {
    const view = viewReview([], s12);
    expect(view.stored).toBe(false);
    expect(view.doc).toMatchObject({
      id: "sprint-review:sprint:s12",
      sprintId: "s12",
      sprintName: "Sprint 12",
      features: [],
      feedbackItems: [],
      checklistItems: [],
    });
  });

  it("gives an agent-written sprint document its sprint back, and the draft stays separate", () => {
    const docs = [review(reviewDocId("s12"), { sprintName: "" }), legacyDraft()];
    expect(viewReview(docs, s12)).toMatchObject({
      stored: true,
      doc: { sprintId: "s12", sprintName: "Sprint 12" },
    });
    expect(viewReview(docs, s11).stored).toBe(false);
    expect(viewReview(docs).doc.features[0].name).toBe("Checkout redesign");
  });

  it("loads stored shapes with missing lists and odd numbers", () => {
    const odd = {
      id: SR_ID,
      sprintName: "Alpha",
      sprintNumber: 3,
      meetingDate: undefined,
      features: [{ id: "f", name: "Demo", timeMinutes: "5" }, null, { name: "no id" }],
      committed: Number.NaN,
      completed: -4,
      totalBacklog: 1e9,
    } as unknown as SprintReview;
    const doc = normalizeReview(odd);
    expect(doc.sprintNumber).toBe("3");
    expect(doc.meetingDate).toBe("");
    expect(doc.features).toEqual([
      { id: "f", name: "Demo", description: "", acceptanceCriteria: "", timeMinutes: 0 },
    ]);
    expect(doc.feedbackItems).toEqual([]);
    expect(doc.checklistItems).toEqual([]);
    expect([doc.committed, doc.completed, doc.totalBacklog, doc.backlogDone]).toEqual([
      0, 0, 1e9, 0,
    ]);
  });

  it("reads the old page's untouched starter content as no draft", () => {
    const starter: SprintReview = { id: SR_ID, ...LEGACY_STARTER, meetingDate: "2026-04-02" };
    expect(isStarterDraft(starter)).toBe(true);
    expect(viewReview([starter])).toMatchObject({ stored: false, doc: { features: [] } });
    expect(usableDraft([starter])).toBeNull();
    // Anything the user did makes it theirs.
    const ticked = {
      ...starter,
      checklistItems: starter.checklistItems.map((c, i) => (i === 0 ? { ...c, checked: true } : c)),
    };
    expect(isStarterDraft(ticked)).toBe(false);
    expect(usableDraft([ticked])?.id).toBe(SR_ID);
    expect(isStarterDraft({ ...starter, committed: 41 })).toBe(false);
  });

  it("offers only a draft with demo items, feedback or a checklist", () => {
    expect(usableDraft([])).toBeNull();
    expect(usableDraft([review(SR_ID, { sprintName: "Named only", committed: 10 })])).toBeNull();
    expect(usableDraft([legacyDraft()])?.features).toHaveLength(1);
  });

  it("starts a sprint's review from the draft without touching the draft", () => {
    const draft = {
      ...legacyDraft(),
      feedbackItems: [
        {
          id: "fb1",
          stakeholder: "Marco",
          feedback: "Add receipts",
          category: "suggestion" as const,
          sentTo: [{ route: "backlog-story" as const, targetId: "story_1", at: "2026-10-01" }],
        },
      ],
    };
    const before = JSON.stringify(draft);
    const sprintDoc = { ...blankReview(s12), meetingDate: "2026-10-23", committed: 0 };
    const next = startFromDraft(sprintDoc, draft, s12);
    // The draft's date and typed numbers stay behind: only the three lists are copied.
    expect(next).toMatchObject({
      id: "sprint-review:sprint:s12",
      sprintId: "s12",
      sprintName: "Sprint 12",
      meetingDate: "2026-10-23",
      committed: 0,
      completed: 0,
      totalBacklog: 0,
      backlogDone: 0,
    });
    expect(startFromDraft(blankReview(s12), draft, s12).meetingDate).toBe("");
    expect(next.features.map((f) => f.name)).toEqual(["Checkout redesign"]);
    expect(next.feedbackItems[0].sentTo?.[0].targetId).toBe("story_1");
    expect(next.features[0]).not.toBe(draft.features[0]);
    expect(JSON.stringify(draft)).toBe(before);
  });
});

// ─── Demo items from done stories ───────────────────────────────────────────

describe("demo candidates", () => {
  const done = STORIES.filter((s) => s.status === "done");

  it("makes an untimed demo item whose id names the story", () => {
    expect(demoIdFor("a")).toBe("story-a");
    expect(featureFromStory({ id: "a", title: "  Pay with a saved card " })).toEqual({
      id: "story-a",
      name: "Pay with a saved card",
      description: "",
      acceptanceCriteria: "",
      timeMinutes: 0,
    });
  });

  it("marks the stories already in the demo, and adds each one once", () => {
    const doc = withStoriesInDemo(blankReview(s12), [done[0]]);
    expect(demoCandidates(done, doc.features).map((c) => c.inDemo)).toEqual([true, false]);
    const twice = withStoriesInDemo(doc, done);
    expect(twice.features.map((f) => f.id)).toEqual(["story-a", "story-b"]);
    expect(withStoriesInDemo(twice, done)).toBe(twice);
  });

  it("totals the demo and counts the items with no time", () => {
    const features = [
      { ...featureFromStory(done[0]), timeMinutes: 6 },
      featureFromStory(done[1]),
      { ...featureFromStory(STORIES[2]), timeMinutes: 4 },
    ];
    expect(demoLength(features)).toEqual({ minutes: 10, untimed: 1 });
    expect(demoLength([])).toEqual({ minutes: 0, untimed: 0 });
  });

  it("moves an item and clamps at the ends", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(moveItem(items, "3", -1).map((x) => x.id)).toEqual(["1", "3", "2"]);
    expect(moveItem(items, "1", -1).map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(moveItem(items, "1", 99).map((x) => x.id)).toEqual(["2", "3", "1"]);
    expect(moveItem(items, "missing", 1)).toEqual(items);
  });
});

// ─── Numbers and the verdict ────────────────────────────────────────────────

describe("the review's numbers", () => {
  const facts = reviewFacts(s12, STORIES, GOALS);

  it("come from the sprint's stories when they have points", () => {
    const n = reviewNumbers(review(reviewDocId("s12"), { committed: 99 }), facts, s12);
    expect(n).toMatchObject({
      source: "stories",
      committed: 10,
      completed: 8,
      storyCount: 3,
      doneCount: 2,
      notDonePoints: 2,
    });
    expect(n.sayDo?.pct).toBe(80);
    expect(sourceNote(n, "Sprint 12")).toBe("From the 3 stories planned into Sprint 12.");
  });

  it("fall back to the review's typed numbers, then the sprint's own", () => {
    const noStories = reviewFacts(s11, STORIES, []);
    const typed = reviewNumbers(
      review(reviewDocId("s11"), { committed: 30, completed: 15 }),
      noStories,
      s11
    );
    expect(typed).toMatchObject({ source: "typed", committed: 30, completed: 15 });
    expect(typed.sayDo?.grade).toBe("missed");
    const own = reviewNumbers(blankReview(s11), noStories, s11);
    expect(own).toMatchObject({ source: "sprint", committed: 20, completed: 18 });
    // A sprint with a plan but no result recorded has no "completed" yet.
    const unfinished = { ...s11, pointsCompleted: undefined };
    const open = reviewNumbers(
      blankReview(unfinished),
      reviewFacts(unfinished, [], []),
      unfinished
    );
    expect(open).toMatchObject({ source: "sprint", committed: 20, completed: null, sayDo: null });
  });

  it("are empty for the draft with nothing typed", () => {
    expect(reviewNumbers(blankReview(), null)).toEqual({
      source: "none",
      committed: 0,
      completed: null,
      sayDo: null,
      storyCount: 0,
      doneCount: 0,
      notDonePoints: 0,
    });
    expect(numbersChartText(reviewNumbers(blankReview(), null), undefined).table.rows).toEqual([]);
  });

  it("chart the points with a sentence and a table", () => {
    const text = numbersChartText(reviewNumbers(blankReview(s12), facts, s12), "Sprint 12");
    expect(text.summary).toBe("8 of 10 committed points done (80%): close to the commitment.");
    expect(text.table.rows).toEqual([
      ["Committed", 10],
      ["Completed", 8],
      ["Not done", 2],
    ]);
  });

  it("handle huge and fractional points", () => {
    const n = reviewNumbers(review(SR_ID, { committed: 1_000_000, completed: 999_999.5 }), null);
    expect(numbersClause(n)).toBe("999999.5 of 1000000 points done");
  });

  it("sum every story for the backlog's progress", () => {
    expect(backlogProgress(STORIES)).toEqual({ total: 18, done: 8 });
    expect(backlogProgress([])).toEqual({ total: 0, done: 0 });
  });
});

describe("the verdict", () => {
  const verdictFor = (
    sprint: Sprint,
    stories: Story[],
    goals: SprintGoal[],
    doc = blankReview(sprint)
  ) => {
    const facts = reviewFacts(sprint, stories, goals);
    return reviewVerdict({ doc, sprint, facts, numbers: reviewNumbers(doc, facts, sprint) });
  };

  it("leads with the goal's answer from Sprint Goal", () => {
    expect(verdictFor(s12, STORIES, GOALS)).toBe(
      "Sprint 12 partly met its goal: 2 of 3 stories done, 8 of 10 points."
    );
    const met = [{ ...GOALS[0], outcome: { met: "met" as const, decidedAt: "2026-10-23" } }];
    expect(verdictFor(s12, STORIES, met)).toMatch(/^Sprint 12 met its goal:/);
    const missed = [{ ...GOALS[0], outcome: { met: "not-met" as const, decidedAt: "2026-10-23" } }];
    expect(verdictFor(s12, STORIES, missed)).toMatch(/^Sprint 12 didn't meet its goal:/);
  });

  it("says when the goal isn't answered, or there's nothing to count", () => {
    const unanswered = [{ ...GOALS[0], outcome: undefined }];
    expect(verdictFor(s12, STORIES, unanswered)).toBe(
      "Sprint 12: 2 of 3 stories done, 8 of 10 points; “Did we meet the sprint goal?” isn't answered yet."
    );
    expect(verdictFor({ ...s12, pointsPlanned: 0 }, [], [])).toBe(
      "Sprint 12 has no goal, stories or points yet."
    );
    expect(verdictFor(s11, [], [])).toBe("Sprint 11: 18 of 20 points done.");
  });

  it("describes the draft from its typed numbers or its content", () => {
    const say = (doc: SprintReview) =>
      reviewVerdict({ doc, facts: null, numbers: reviewNumbers(doc, null) });
    expect(say(legacyDraft())).toBe("Sprint Alpha: 24 of 30 points done.");
    expect(say({ ...legacyDraft(), committed: 0, completed: 0 })).toBe(
      "The draft holds 1 demo item, 1 piece of feedback and a checklist of 1."
    );
    expect(say(blankReview())).toMatch(/^Nothing in this review yet/);
  });

  it("matches the example: Sprint 12 met its goal", () => {
    const ex = buildExample("2026-10-23");
    const facts = reviewFacts(ex.sprint, ex.stories, ex.goals);
    expect(
      reviewVerdict({
        doc: ex.review,
        sprint: ex.sprint,
        facts,
        numbers: reviewNumbers(ex.review, facts, ex.sprint),
      })
    ).toBe("Sprint 12 met its goal: 8 of 10 stories done, 34 of 40 points.");
  });
});

// ─── Forms ──────────────────────────────────────────────────────────────────

describe("draft-then-save checks", () => {
  it("needs a demo item's name; its time is optional whole minutes", () => {
    const base = { name: "", minutes: "", description: "", acceptanceCriteria: "" };
    expect(validateDemo(base)).toEqual({ ok: false, errors: { name: "Name what you'll demo." } });
    expect(validateDemo({ ...base, name: " Login " })).toEqual({
      ok: true,
      values: { name: "Login", timeMinutes: 0, description: "", acceptanceCriteria: "" },
    });
    for (const minutes of ["0", "2.5", "481", "abc", "-3"]) {
      const result = validateDemo({ ...base, name: "x", minutes });
      expect(result.ok, minutes).toBe(false);
    }
    expect(validateDemo({ ...base, name: "x", minutes: "480" })).toMatchObject({
      ok: true,
      values: { timeMinutes: 480 },
    });
  });

  it("needs who, what kind and what for feedback, with no default kind", () => {
    expect(validateFeedback({ stakeholder: " ", category: null, feedback: "" })).toEqual({
      ok: false,
      errors: {
        stakeholder: "Enter who gave the feedback.",
        category: "Pick what kind of feedback it is.",
        feedback: "Write down what they said.",
      },
    });
    expect(
      validateFeedback({ stakeholder: "Marco ", category: "concern", feedback: " Slow " })
    ).toEqual({
      ok: true,
      values: { stakeholder: "Marco", category: "concern", feedback: "Slow" },
    });
  });
});

// ─── Export ─────────────────────────────────────────────────────────────────

describe("Markdown export", () => {
  it("has the verdict, goal, demo, numbers, not-done, feedback and checklist", () => {
    const facts = reviewFacts(s12, STORIES, GOALS);
    const doc: SprintReview = {
      ...withStoriesInDemo(blankReview(s12), [STORIES[0]]),
      meetingDate: "2026-10-23",
      feedbackItems: [
        {
          id: "f1",
          stakeholder: "Marco | Support",
          feedback: "Show the card\nused",
          category: "concern",
          sentTo: [{ route: "backlog-story", targetId: "story_9", at: "2026-10-23" }],
        },
        { id: "f2", stakeholder: "", feedback: "", category: "positive" },
      ],
      checklistItems: [{ id: "c", label: "Demo data", checked: true }],
    };
    const md = toMarkdown(
      doc,
      {
        sprint: s12,
        facts,
        numbers: reviewNumbers(doc, facts, s12),
        backlog: backlogProgress(STORIES),
        storyTitle: (id) => (id === "story_9" ? "Show the card used" : undefined),
      },
      new Date(2026, 9, 24)
    );
    expect(md).toContain("# Sprint Review — Sprint 12 · 24 Oct 2026");
    expect(md).toContain("Review on 23 Oct 2026");
    expect(md).toContain("**Sprint 12 partly met its goal: 2 of 3 stories done, 8 of 10 points.**");
    expect(md).toContain("> Shoppers pay in one tap");
    expect(md).toContain("Goal met? **Partly met** · Nicknames slipped");
    expect(md).toContain("## Demo script (1 not timed)");
    expect(md).toContain("1. **Pay with a saved card**");
    expect(md).toContain("| Committed | 10 |");
    expect(md).toContain("Say/do: 80%, close to the commitment.");
    expect(md).toContain("Product backlog: 8 of 18 points done.");
    expect(md).toContain("### Not done (1 story, 2 pts)");
    expect(md).toContain("- Card nicknames · 2 pts · In progress");
    expect(md).toContain("### Concerns");
    expect(md).toContain(
      "- **Marco | Support:** Show the card used _(on the backlog: “Show the card used”)_"
    );
    // A blank row from the old "Add feedback" isn't exported.
    expect(md).not.toContain("Unnamed");
    expect(md).toContain("## Showcase checklist (1 of 1 ready)");
    expect(md).toContain("- [x] Demo data");
  });

  it("exports an empty draft without inventing anything", () => {
    const doc = blankReview();
    const md = toMarkdown(
      doc,
      { facts: null, numbers: reviewNumbers(doc, null) },
      new Date(2026, 9, 24)
    );
    expect(md).toContain("# Sprint Review — 24 Oct 2026");
    expect(md).toContain("_Nothing on the demo script._");
    expect(md).toContain("_No numbers yet. Type the points below._");
    expect(md).toContain("_No feedback recorded._");
    expect(md).not.toContain("Showcase checklist");
    expect(md).not.toContain("Sprint goal");
  });

  it("writes the demo script alone, untimed items named", () => {
    const doc = {
      ...blankReview(s12),
      features: [
        { id: "1", name: "Login", description: "SSO", acceptanceCriteria: "", timeMinutes: 5 },
        { id: "2", name: "", description: "", acceptanceCriteria: "Given x", timeMinutes: 0 },
      ],
    };
    expect(demoScript(doc, "Sprint 12")).toBe(
      [
        "# Demo script — Sprint 12",
        "",
        "Estimated length: 5 min (1 item not timed)",
        "",
        "## 1. Login (5 min)",
        "What: SSO",
        "",
        "## 2. Untitled item",
        "Acceptance criteria: Given x",
        "",
      ].join("\n")
    );
  });
});

describe("the example", () => {
  it("never borrows a real id and keeps its review on its own sprint", () => {
    const ex = buildExample("2026-10-23");
    expect(ex.sprint.id.startsWith("example-")).toBe(true);
    expect(ex.sprint.endDate).toBe("2026-10-23");
    expect(
      ex.stories.every((s) => s.id.startsWith("example-") && s.sprintId === ex.sprint.id)
    ).toBe(true);
    expect(ex.review.id).toBe(reviewDocId(ex.sprint.id));
    expect(ex.review.feedbackItems.every((f) => f.id.startsWith("example-") && !f.sentTo)).toBe(
      true
    );
    expect(ex.review.checklistItems.every((c) => c.id.startsWith("example-"))).toBe(true);
  });
});

// ─── The page ───────────────────────────────────────────────────────────────

describe("the page, for a sprint", () => {
  beforeEach(() => seed({ sprints: [s12, s11], stories: STORIES, sprintGoals: GOALS }));

  it("shows the sprint's facts and stores nothing until an edit", async () => {
    renderReview();
    expect(
      await screen.findByText("Sprint 12 partly met its goal: 2 of 3 stories done, 8 of 10 points.")
    ).toBeInTheDocument();
    expect(screen.getByText("Shoppers pay in one tap")).toBeInTheDocument();
    expect(screen.getByText("Partly met")).toBeInTheDocument();
    expect(screen.getByText("Nicknames slipped")).toBeInTheDocument();
    const done = screen.getByRole("list", { name: "Stories done in Sprint 12" });
    expect(within(done).getAllByRole("listitem")).toHaveLength(2);
    expect(reviews()).toEqual([]);
    expect(exported.byFile["sprint-review-sprint-12"]).toContain("Goal met? **Partly met**");
  });

  it("links to Sprint Goal when the goal isn't answered", async () => {
    seed({ sprintGoals: [{ ...GOALS[0], outcome: undefined }] });
    renderReview();
    const link = await screen.findByRole("link", { name: /Answer it in Sprint Goal/ });
    expect(link).toHaveAttribute("href", "/sprint-goal?sprint=s12");
  });

  it("adds a done story to the demo, creating the sprint's review", async () => {
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "Add all 2 to the demo" }));
    const doc = reviewById("sprint-review:sprint:s12")!;
    expect(doc.sprintId).toBe("s12");
    expect(doc.features.map((f) => [f.id, f.name, f.timeMinutes])).toEqual([
      ["story-a", "Pay with a saved card", 0],
      ["story-b", "Receipts by email", 0],
    ]);
    expect(screen.getAllByText("In the demo")).toHaveLength(2);
    expect(screen.getAllByText("Not timed")).toHaveLength(2);
    expect(reviewById(SR_ID)).toBeUndefined();
  });

  it("edits a demo item in place and deletes it with Undo", async () => {
    seed({
      sprintReviews: [
        review(reviewDocId("s12"), {
          sprintId: "s12",
          features: [featureFromStory(STORIES[0]), featureFromStory(STORIES[1])],
        }),
      ],
    });
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Receipts by email" }));
    const script = screen.getByRole("list", { name: "Demo script, in running order" });
    const minutes = within(script).getByLabelText(/Minutes/);
    fireEvent.change(minutes, { target: { value: "0" } });
    fireEvent.click(within(script).getByRole("button", { name: "Save" }));
    expect(await within(script).findByText(/Enter whole minutes/)).toBeInTheDocument();
    expect(minutes).toHaveFocus();
    fireEvent.change(minutes, { target: { value: "4" } });
    fireEvent.click(within(script).getByRole("button", { name: "Save" }));
    expect(reviewById("sprint-review:sprint:s12")!.features[1].timeMinutes).toBe(4);

    fireEvent.click(screen.getByRole("button", { name: "Move Receipts by email up" }));
    expect(reviewById("sprint-review:sprint:s12")!.features.map((f) => f.id)).toEqual([
      "story-b",
      "story-a",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Delete Pay with a saved card" }));
    expect(reviewById("sprint-review:sprint:s12")!.features.map((f) => f.id)).toEqual(["story-b"]);
    expect(toastSpy.mock.calls.at(-1)![0]).toBe("Removed “Pay with a saved card” from the demo");
    undoLast();
    expect(reviewById("sprint-review:sprint:s12")!.features.map((f) => f.id)).toEqual([
      "story-b",
      "story-a",
    ]);
  });

  it("records feedback only once it is complete, with no default kind", async () => {
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Stakeholder Feedback");
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }));
    expect(await screen.findByText("Enter who gave the feedback.")).toBeInTheDocument();
    expect(screen.getByText("Pick what kind of feedback it is.")).toBeInTheDocument();
    expect(screen.getByText("Write down what they said.")).toBeInTheDocument();
    expect(reviews()).toEqual([]);
    const kinds = screen.getByRole("radiogroup", { name: "Kind of feedback" });
    for (const radio of within(kinds).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }

    fireEvent.change(screen.getByLabelText(/Stakeholder/, { selector: "input" }), {
      target: { value: "Marco" },
    });
    fireEvent.click(within(kinds).getByRole("radio", { name: "Concern" }));
    fireEvent.change(screen.getByLabelText(/What they said/), {
      target: { value: "Support can't see the card used" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add feedback" }));
    const doc = reviewById("sprint-review:sprint:s12")!;
    expect(doc.feedbackItems).toEqual([
      {
        id: expect.any(String),
        stakeholder: "Marco",
        category: "concern",
        feedback: "Support can't see the card used",
      },
    ]);
    expect(history.log).toHaveBeenCalledWith("feedback_added", { category: "concern" });
  });

  it("turns feedback into a backlog story and links to it", async () => {
    seed({
      sprintReviews: [
        review(reviewDocId("s12"), {
          sprintId: "s12",
          feedbackItems: [
            {
              id: "fb1",
              stakeholder: "Lena",
              feedback: "Let shoppers name cards",
              category: "suggestion",
            },
          ],
        }),
      ],
    });
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Stakeholder Feedback");
    fireEvent.keyDown(screen.getByRole("button", { name: /^Send to… Let shoppers name cards/ }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));

    const story = useWorkspaceStore
      .getState()
      .stories.find((s) => s.title === "Let shoppers name cards")!;
    expect(story).toMatchObject({
      status: "backlog",
      sourceRef: { tool: "sprint-review", id: "fb1", doc: "sprint-review:sprint:s12" },
    });
    expect(story.sprintId).toBeUndefined();
    const item = reviewById("sprint-review:sprint:s12")!.feedbackItems[0];
    expect(item.sentTo).toEqual([
      { route: "backlog-story", targetId: story.id, at: expect.any(String) },
    ]);
    expect(
      await screen.findByRole("link", { name: /On the backlog: “Let shoppers name cards”/ })
    ).toHaveAttribute("href", "/sprint-planning");

    // Undo takes the story and the link away again.
    undoLast();
    expect(useWorkspaceStore.getState().stories.some((s) => s.id === story.id)).toBe(false);
    expect(reviewById("sprint-review:sprint:s12")!.feedbackItems[0].sentTo).toEqual([]);
  });

  it("deletes feedback with Undo, back in its place", async () => {
    seed({
      sprintReviews: [
        review(reviewDocId("s12"), {
          sprintId: "s12",
          feedbackItems: [
            { id: "1", stakeholder: "Priya", feedback: "Fast", category: "positive" },
            { id: "2", stakeholder: "Marco", feedback: "Slow", category: "concern" },
          ],
        }),
      ],
    });
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Stakeholder Feedback");
    fireEvent.click(screen.getByRole("button", { name: "Delete feedback from Priya" }));
    expect(reviewById("sprint-review:sprint:s12")!.feedbackItems.map((f) => f.id)).toEqual(["2"]);
    undoLast();
    expect(reviewById("sprint-review:sprint:s12")!.feedbackItems.map((f) => f.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("backdates the review, and clearing an unsaved date stores nothing", async () => {
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Stakeholder Feedback");
    const date = screen.getByLabelText(/Review date/);
    fireEvent.change(date, { target: { value: "" } });
    expect(reviews()).toEqual([]);
    fireEvent.change(date, { target: { value: "2026-10-22" } });
    expect(reviewById("sprint-review:sprint:s12")!.meetingDate).toBe("2026-10-22");
  });

  it("resets only the review on screen, after a confirm, with Undo", async () => {
    const mine = review(reviewDocId("s12"), {
      sprintId: "s12",
      checklistItems: [{ id: "c", label: "Demo data", checked: true }],
    });
    const other = review(reviewDocId("s11"), {
      sprintId: "s11",
      features: [featureFromStory({ id: "q", title: "Old demo" })],
    });
    seed({ sprintReviews: [mine, other, legacyDraft()] });
    renderReview();
    await screen.findByText(/partly met its goal/);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reset Sprint 12's review?");
    expect(dialog).toHaveTextContent("Sprint 12's stories and goal stay as they are.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset review" }));
    expect(reviewById(mine.id)).toBeUndefined();
    expect(reviewById(other.id)).toEqual(other);
    expect(reviewById(SR_ID)).toEqual(legacyDraft());
    await waitFor(() => expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled());
    undoLast();
    expect(reviewById(mine.id)).toEqual(mine);
  });

  it("starts an empty sprint review from the draft, and Undo takes it back", async () => {
    seed({ sprintReviews: [legacyDraft()] });
    renderReview();
    expect(
      await screen.findByText(/You have a review draft that isn't tied to a sprint: 1 demo item/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start from the draft" }));
    const doc = reviewById("sprint-review:sprint:s12")!;
    expect(doc.features.map((f) => f.name)).toEqual(["Checkout redesign"]);
    expect(doc.sprintId).toBe("s12");
    expect(reviewById(SR_ID)).toEqual(legacyDraft());
    // The sprint has its own review now: the offer goes, the draft can still be opened.
    expect(screen.queryByRole("button", { name: "Start from the draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open draft" })).toBeInTheDocument();
    undoLast();
    expect(reviewById("sprint-review:sprint:s12")).toBeUndefined();
  });

  it("opens the draft while a sprint is chosen, and goes back", async () => {
    seed({ sprintReviews: [legacyDraft()] });
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "Open draft" }));
    expect(screen.getByText("Showing the draft that isn't tied to a sprint.")).toBeInTheDocument();
    expect(screen.getByText("Sprint Alpha: 24 of 30 points done.")).toBeInTheDocument();
    expect(screen.getByLabelText("Sprint name")).toHaveValue("Sprint Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Back to Sprint 12" }));
    expect(screen.getByText(/partly met its goal/)).toBeInTheDocument();
  });

  it("falls back to typed numbers for a sprint without pointed stories", async () => {
    localStorage.setItem("agile-toolkit:sprint-metrics:selected", "s11");
    renderReview();
    expect(await screen.findByText("Sprint 11: 18 of 20 points done.")).toBeInTheDocument();
    openTab("Velocity Summary");
    expect(screen.getByText(/Sprint 11's own numbers/)).toBeInTheDocument();
    const committed = screen.getByLabelText("Committed points");
    // Tabbing through a field isn't an edit.
    fireEvent.blur(committed);
    expect(reviews()).toEqual([]);
    fireEvent.change(committed, { target: { value: "25" } });
    fireEvent.blur(committed);
    expect(reviewById("sprint-review:sprint:s11")).toMatchObject({
      sprintId: "s11",
      committed: 25,
    });
    expect(
      screen.getByText(/Typed here, because Sprint 11 has no pointed stories/)
    ).toBeInTheDocument();
  });
});

describe("the page, with no sprint (the draft)", () => {
  it("keeps the old singleton review working", async () => {
    seed({
      sprintReviews: [
        {
          ...legacyDraft(),
          // A blank row the old "Add feedback" saved.
          feedbackItems: [{ id: "blank", stakeholder: "", feedback: "", category: "positive" }],
        },
      ],
    });
    renderReview();
    expect(await screen.findByText("Sprint Alpha: 24 of 30 points done.")).toBeInTheDocument();
    expect(screen.getByText("Checkout redesign")).toBeInTheDocument();
    const name = screen.getByLabelText("Sprint name");
    fireEvent.change(name, { target: { value: "Sprint Beta" } });
    fireEvent.blur(name);
    expect(reviewById(SR_ID)!.sprintName).toBe("Sprint Beta");

    openTab("Stakeholder Feedback");
    expect(screen.getByText("Unnamed stakeholder")).toBeInTheDocument();
    expect(screen.getByText("Nothing written yet")).toBeInTheDocument();
    // Nothing to send until it says something.
    expect(screen.queryByRole("button", { name: /^Send to…/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit feedback from Unnamed stakeholder" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter who gave the feedback.")).toBeInTheDocument();
  });

  it("shows the untouched starter draft as empty, and the first edit replaces it", async () => {
    seed({ sprintReviews: [{ id: SR_ID, ...LEGACY_STARTER, meetingDate: "2026-04-02" }] });
    renderReview();
    expect(await screen.findByText(/No review yet\./)).toBeInTheDocument();
    expect(screen.queryByText("User Login Flow")).toBeNull();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/What you'll demo/), { target: { value: "Search" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const doc = reviewById(SR_ID)!;
    expect(doc.features.map((f) => f.name)).toEqual(["Search"]);
    expect(doc.sprintName).toBe("");
    expect(doc.checklistItems).toEqual([]);
    expect(doc.committed).toBe(0);
  });

  it("adds the standard checklist on request, renames in place, deletes with Undo", async () => {
    renderReview();
    await screen.findByText(/No review yet\./);
    openTab("Showcase Checklist");
    fireEvent.click(screen.getByRole("button", { name: "Use the standard checklist" }));
    expect(reviewById(SR_ID)!.checklistItems).toHaveLength(8);
    fireEvent.click(screen.getByRole("checkbox", { name: "Demo data prepared" }));
    expect(reviewById(SR_ID)!.checklistItems[1].checked).toBe(true);

    const rename = screen.getByLabelText("Rename checklist item: Backup plan ready");
    fireEvent.change(rename, { target: { value: "  " } });
    fireEvent.blur(rename);
    expect(reviewById(SR_ID)!.checklistItems[6].label).toBe("Backup plan ready");

    fireEvent.click(
      screen.getByRole("button", { name: "Delete checklist item: Meeting link shared" })
    );
    expect(reviewById(SR_ID)!.checklistItems).toHaveLength(7);
    undoLast();
    expect(reviewById(SR_ID)!.checklistItems[4].label).toBe("Meeting link shared");

    // A blank new item isn't added.
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Name the item.")).toBeInTheDocument();
    expect(reviewById(SR_ID)!.checklistItems).toHaveLength(8);
  });
});

describe("the example, in memory", () => {
  it("loads, works and clears without writing to the workspace", async () => {
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "See an example review" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText("Sprint 12 met its goal: 8 of 10 stories done, 34 of 40 points.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add all 5 to the demo" }));
    expect(screen.getAllByText("In the demo")).toHaveLength(8);
    // No way out of the example: no Sprint Goal or board links, nothing to send.
    expect(screen.queryByRole("link", { name: /Sprint Goal/ })).toBeNull();
    openTab("Stakeholder Feedback");
    expect(screen.queryByRole("button", { name: /^Send to…/ })).toBeNull();
    expect(reviews()).toEqual([]);
    expect(useWorkspaceStore.getState().stories).toEqual([]);
    expect(useWorkspaceStore.getState().sprints).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(await screen.findByText(/No review yet\./)).toBeInTheDocument();
    expect(reviews()).toEqual([]);
  });
});

// ─── Review fixes ───────────────────────────────────────────────────────────

/** The old page's starter with one checklist item ticked: the most common draft. */
const starterDraft = (): SprintReview => ({
  id: SR_ID,
  ...LEGACY_STARTER,
  meetingDate: "2026-03-02",
  checklistItems: LEGACY_STARTER.checklistItems.map((c, i) =>
    i === 0 ? { ...c, checked: true } : c
  ),
});

const pickSprint = (id: string) =>
  localStorage.setItem("agile-toolkit:sprint-metrics:selected", id);

describe("starting a sprint's review from the draft keeps the sprint's numbers", () => {
  it("leaves the draft's date and typed numbers behind", () => {
    const draft = starterDraft();
    expect(usableDraft([draft])).not.toBeNull();
    const next = startFromDraft(blankReview(s11), draft, s11);
    expect(next).toMatchObject({
      meetingDate: "",
      committed: 0,
      completed: 0,
      totalBacklog: 0,
      backlogDone: 0,
    });
    expect(next.checklistItems).toHaveLength(8);
    const facts = reviewFacts(s11, [], []);
    const numbers = reviewNumbers(next, facts, s11);
    expect(reviewVerdict({ doc: next, sprint: s11, facts, numbers })).toBe(
      "Sprint 11: 18 of 20 points done."
    );
    const md = toMarkdown(next, { sprint: s11, facts, numbers }, new Date(2026, 9, 24));
    expect(md).not.toContain("Review on");
    expect(md).not.toContain("Release progress");
    expect(md).toContain("| Committed | 20 |");
  });

  it("on the page, the verdict is still the sprint's own after the start", async () => {
    seed({
      sprints: [s12, s11],
      stories: STORIES,
      sprintGoals: GOALS,
      sprintReviews: [starterDraft()],
    });
    pickSprint("s11");
    renderReview();
    expect(await screen.findByText("Sprint 11: 18 of 20 points done.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start from the draft" }));
    expect(reviewById(reviewDocId("s11"))).toMatchObject({
      meetingDate: "",
      committed: 0,
      completed: 0,
      totalBacklog: 0,
      backlogDone: 0,
    });
    expect(screen.getByText("Sprint 11: 18 of 20 points done.")).toBeInTheDocument();
    expect(exported.byFile["sprint-review-sprint-11"]).not.toContain("Review on");
  });
});

describe("typed numbers never count a blank field as 0", () => {
  const s11Facts = reviewFacts(s11, [], []);

  it("fill a blank field from the sprint's own number", () => {
    expect(sprintOwnNumbers(s11Facts, s11)).toEqual({ committed: 20, completed: 18 });
    expect(sprintOwnNumbers(reviewFacts(s12, STORIES, []), s12)).toEqual({
      committed: null,
      completed: null,
    });
    const doc = { ...blankReview(s11), committed: 20 };
    const n = reviewNumbers(doc, s11Facts, s11);
    expect(n).toMatchObject({
      source: "typed",
      committed: 20,
      completed: 18,
      fromSprint: "completed",
    });
    expect(n.sayDo).toMatchObject({ pct: 90, grade: "met" });
    expect(sourceNote(n, "Sprint 11")).toBe(
      "Typed here, because Sprint 11 has no pointed stories. The completed points are Sprint 11's own."
    );
    expect(reviewVerdict({ doc, sprint: s11, facts: s11Facts, numbers: n })).toBe(
      "Sprint 11: 18 of 20 points done."
    );
    expect(reviewNumbers({ ...blankReview(s11), completed: 15 }, s11Facts, s11)).toMatchObject({
      committed: 20,
      completed: 15,
      fromSprint: "committed",
    });
    expect(
      reviewNumbers({ ...blankReview(s11), committed: 30, completed: 15 }, s11Facts, s11).fromSprint
    ).toBeUndefined();
  });

  it("read a completed field nobody filled in as not recorded", () => {
    const draft = { ...blankReview(), sprintName: "Sprint Alpha", committed: 40 };
    const n = reviewNumbers(draft, null);
    expect(n).toMatchObject({ source: "typed", committed: 40, completed: null, sayDo: null });
    expect(reviewVerdict({ doc: draft, facts: null, numbers: n })).toBe(
      "Sprint Alpha: 40 points committed."
    );
    const chart = numbersChartText(n, undefined);
    expect(chart.summary).toBe("40 points committed; how many were done isn't recorded yet.");
    expect(chart.table.rows).toEqual([
      ["Committed", 40],
      ["Completed", "—"],
      ["Not done", "—"],
    ]);
    const md = toMarkdown(draft, { facts: null, numbers: n }, new Date(2026, 9, 24));
    expect(md).toContain("| Completed | — |");
    expect(md).not.toContain("Say/do");

    // A sprint with a plan and no result: typing the commitment invents none.
    const open = { ...s11, pointsCompleted: undefined };
    expect(
      reviewNumbers({ ...blankReview(open), committed: 25 }, reviewFacts(open, [], []), open)
    ).toMatchObject({ committed: 25, completed: null, sayDo: null });

    // Only the completed points typed, nothing committed anywhere.
    const doneOnly = reviewNumbers({ ...blankReview(), completed: 12 }, null);
    expect(numbersClause(doneOnly)).toBe("12 points done");
    expect(numbersChartText(doneOnly, undefined).table.rows).toEqual([
      ["Committed", "—"],
      ["Completed", 12],
      ["Not done", "—"],
    ]);
  });

  it("show blank fields with the sprint's numbers, and typing one keeps the other", async () => {
    seed({ sprints: [s12, s11], stories: STORIES, sprintGoals: GOALS });
    pickSprint("s11");
    renderReview();
    await screen.findByText("Sprint 11: 18 of 20 points done.");
    openTab("Velocity Summary");
    const committed = screen.getByLabelText("Committed points");
    const completed = screen.getByLabelText("Completed points");
    expect(committed).toHaveValue(null);
    expect(committed).toHaveAttribute("placeholder", "20");
    expect(completed).toHaveValue(null);
    expect(completed).toHaveAttribute("placeholder", "18");
    expect(
      screen.getByText("Leave a field blank to use Sprint 11's own number.")
    ).toBeInTheDocument();

    fireEvent.change(committed, { target: { value: "20" } });
    fireEvent.blur(committed);
    expect(reviewById(reviewDocId("s11"))).toMatchObject({ committed: 20, completed: 0 });
    expect(screen.getByText("Sprint 11: 18 of 20 points done.")).toBeInTheDocument();
    expect(screen.getByText(/The completed points are Sprint 11's own\./)).toBeInTheDocument();

    // Emptied again, it is a blank field, not 0.
    fireEvent.change(committed, { target: { value: "" } });
    fireEvent.blur(committed);
    expect(reviewById(reviewDocId("s11"))!.committed).toBe(0);
    expect(committed).toHaveValue(null);
    expect(screen.getByText(/Sprint 11's own numbers/)).toBeInTheDocument();
  });

  it("draw no Completed bar while completed isn't recorded", async () => {
    seed({ sprintReviews: [{ ...legacyDraft(), committed: 40, completed: 0 }] });
    renderReview();
    expect(await screen.findByText("Sprint Alpha: 40 points committed.")).toBeInTheDocument();
    openTab("Velocity Summary");
    const figure = screen.getByRole("figure", { name: "Committed and completed points" });
    expect(Array.from(figure.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Committed40",
    ]);
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByLabelText("Completed points")).toHaveValue(null);
    expect(screen.getByText("Leave a field blank while it isn't recorded.")).toBeInTheDocument();
  });
});

describe("pluralised points", () => {
  it("say 1 pt, and 'not estimated' instead of 0 points", () => {
    expect(pointsLabel(1)).toBe("1 pt");
    expect(pointsLabel(0.5)).toBe("0.5 pts");
    expect(notDoneSummary([{ id: "x", title: "X", points: 1, status: "todo" }])).toBe(
      "1 story, 1 pt"
    );
    expect(
      notDoneSummary([
        { id: "x", title: "X", status: "todo" },
        { id: "y", title: "Y", status: "review" },
      ])
    ).toBe("2 stories, not estimated");
    expect(
      notDoneSummary([
        { id: "x", title: "X", status: "todo" },
        { id: "y", title: "Y", points: 3, status: "review" },
      ])
    ).toBe("2 stories, 3 pts");
  });

  it("head the unfinished stories on the page and in the export", async () => {
    const unestimated = STORIES.map((s) => (s.id === "c" ? { ...s, points: undefined } : s));
    seed({ sprints: [s12], stories: unestimated, sprintGoals: GOALS });
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Velocity Summary");
    expect(screen.getByText("Not done: 1 story, not estimated")).toBeInTheDocument();
    expect(exported.byFile["sprint-review-sprint-12"]).toContain(
      "### Not done (1 story, not estimated)"
    );
  });
});

describe("keyboard focus", () => {
  beforeEach(() => seed({ sprints: [s12, s11], stories: STORIES, sprintGoals: GOALS }));

  const withDemo = () =>
    seed({
      sprintReviews: [
        review(reviewDocId("s12"), {
          sprintId: "s12",
          features: [featureFromStory(STORIES[0]), featureFromStory(STORIES[1])],
          feedbackItems: [
            { id: "1", stakeholder: "Priya", feedback: "Fast", category: "positive" },
            { id: "2", stakeholder: "Marco", feedback: "Slow", category: "concern" },
          ],
        }),
      ],
    });

  it("stays on a moved item's arrows, the other one at the ends", async () => {
    withDemo();
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "Move Receipts by email up" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move Receipts by email down" })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Move Receipts by email down" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move Receipts by email up" })).toHaveFocus()
    );
  });

  it("goes back to Edit when a demo item's editor closes", async () => {
    withDemo();
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Receipts by email" }));
    const script = screen.getByRole("list", { name: "Demo script, in running order" });
    fireEvent.click(within(script).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Receipts by email" })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Receipts by email" }));
    fireEvent.keyDown(within(script).getByLabelText(/What you'll demo/), { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Receipts by email" })).toHaveFocus()
    );
  });

  it("moves on to the next demo item after a delete, then to the add form", async () => {
    withDemo();
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Pay with a saved card" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Receipts by email" })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Receipts by email" }));
    await waitFor(() => expect(screen.getByLabelText(/What you'll demo/)).toHaveFocus());
  });

  it("lands on 'In the demo' after adding done stories", async () => {
    renderReview();
    fireEvent.click(await screen.findByRole("button", { name: "Add all 2 to the demo" }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-demo-added", "a"));
    expect(document.activeElement).toHaveTextContent("In the demo");
  });

  it("goes back to Edit when feedback's editor closes, and on after a delete", async () => {
    withDemo();
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Stakeholder Feedback");
    fireEvent.click(screen.getByRole("button", { name: "Edit feedback from Priya" }));
    fireEvent.keyDown(screen.getByDisplayValue("Fast"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit feedback from Priya" })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete feedback from Priya" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit feedback from Marco" })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete feedback from Marco" }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Stakeholder/, { selector: "input" })).toHaveFocus()
    );
  });

  it("lands on the checklist after 'Use the standard checklist', and on after a delete", async () => {
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Showcase Checklist");
    fireEvent.click(screen.getByRole("button", { name: "Use the standard checklist" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Environment is working" })).toHaveFocus()
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete checklist item: Environment is working" })
    );
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Demo data prepared" })).toHaveFocus()
    );
    // The rename field shows focus although it has no border.
    const rename = screen.getByLabelText("Rename checklist item: Demo data prepared");
    expect(rename.className).toContain("focus-visible:ring-2");
    expect(rename.className).not.toMatch(/focus-visible:ring-0|focus:ring-0/);
  });
});

describe("feedback sent to the backlog", () => {
  const long =
    "The saved card list should show the card's nickname, its last four digits and when it expires, and shoppers should be able to reorder the list so their usual card comes first every time they pay";

  it("gets a short title, cut at a word", () => {
    const title = feedbackStoryTitle(long);
    expect(title.length).toBeLessThanOrEqual(FEEDBACK_TITLE_MAX);
    expect(title.endsWith("…")).toBe(true);
    const kept = title.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
    expect(feedbackStoryTitle("  Short\n note ")).toBe("Short note");
    expect(feedbackStoryTitle("x".repeat(300))).toBe(`${"x".repeat(119)}…`);
    // No dangling comma before the ellipsis.
    expect(feedbackStoryTitle("aaaa, bbbb, cccc", 12)).toBe("aaaa, bbbb…");
    expect(feedbackStoryTitle("aaaa bbbb cccc dddd", 15)).toBe("aaaa bbbb…");
  });

  it("sends the short title, and the menu's name stays short", async () => {
    seed({
      sprints: [s12],
      stories: STORIES,
      sprintGoals: GOALS,
      sprintReviews: [
        review(reviewDocId("s12"), {
          sprintId: "s12",
          feedbackItems: [
            { id: "fb", stakeholder: "Lena", feedback: long, category: "suggestion" },
          ],
        }),
      ],
    });
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Stakeholder Feedback");
    const send = screen.getByRole("button", { name: /^Send to…/ });
    expect(send).toHaveAccessibleName(`Send to… ${feedbackStoryTitle(long)}`);
    fireEvent.keyDown(send, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    const story = useWorkspaceStore.getState().stories.find((s) => s.sourceRef?.id === "fb")!;
    expect(story.title).toBe(feedbackStoryTitle(long));
    // The full text stays on the feedback the story links back to.
    expect(reviewById(reviewDocId("s12"))!.feedbackItems[0].feedback).toBe(long);
  });
});

describe("the stakeholder field", () => {
  it("suggests the team but never flags a stakeholder who isn't on it", async () => {
    seed({ teamMembers: [{ id: "m1", name: "Ana" }] });
    renderReview();
    await screen.findByText(/No review yet\./);
    openTab("Stakeholder Feedback");
    const input = screen.getByLabelText(/Stakeholder/, { selector: "input" });
    const list = document.getElementById(input.getAttribute("list")!)!;
    expect(Array.from(list.querySelectorAll("option")).map((o) => o.value)).toEqual(["Ana"]);
    fireEvent.change(input, { target: { value: "Priya, Head of Payments" } });
    expect(screen.queryByText(/isn’t on the team/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Add to the team/ })).toBeNull();
  });

  it("doesn't point at the Team page while the roster is empty", async () => {
    seed({ teamMembers: [] });
    renderReview();
    await screen.findByText(/No review yet\./);
    openTab("Stakeholder Feedback");
    expect(screen.queryByText(/Team page/)).toBeNull();
  });
});

describe("the reset confirm", () => {
  it("names only what the review holds", () => {
    expect(resetSummary({ ...blankReview(s12), meetingDate: "2026-10-22" })).toBe(
      "This deletes the review date."
    );
    expect(
      resetSummary({
        ...blankReview(),
        sprintName: "Alpha",
        sprintNumber: "3",
        features: [featureFromStory(STORIES[0]), featureFromStory(STORIES[1])],
        committed: 5,
      })
    ).toBe("This deletes 2 demo items, the typed numbers and the sprint name and number.");
    expect(resetSummary({ ...blankReview(), sprintNumber: "3" })).toBe(
      "This deletes the sprint number."
    );
    // A sprint's review carries its sprint's name by itself.
    expect(resetSummary(blankReview(s12))).toBe(
      "The review holds nothing yet; resetting deletes it."
    );
    expect(resetSummary(legacyDraft())).toBe(
      "This deletes 1 demo item, 1 piece of feedback, a checklist of 1, the review date, the typed numbers and the sprint name and number."
    );
  });

  it("reads right for a review with only a date", async () => {
    seed({
      sprints: [s12],
      stories: STORIES,
      sprintGoals: GOALS,
      sprintReviews: [review(reviewDocId("s12"), { sprintId: "s12", meetingDate: "2026-10-22" })],
    });
    renderReview();
    await screen.findByText(/partly met its goal/);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "This deletes the review date. Sprint 12's stories and goal stay as they are. You can undo this right after."
    );
  });
});

describe("the review date hint", () => {
  it("gives a real sprint's end date, never a placeholder one", async () => {
    const placeholder: Sprint = {
      ...s11,
      id: "s3",
      name: "Sprint 3",
      startDate: "2020-01-01",
      endDate: "2020-01-03",
    };
    seed({ sprints: [placeholder, s12], stories: STORIES, sprintGoals: GOALS });
    pickSprint("s3");
    renderReview();
    await screen.findByText("Sprint 3: 18 of 20 points done.");
    openTab("Stakeholder Feedback");
    expect(screen.getByText("Backdate it if the review has already happened.")).toBeInTheDocument();
    expect(screen.queryByText(/ends 3 Jan 2020/)).toBeNull();
  });

  it("says when a real sprint ends", async () => {
    seed({ sprints: [s12], stories: STORIES, sprintGoals: GOALS });
    renderReview();
    await screen.findByText(/partly met its goal/);
    openTab("Stakeholder Feedback");
    expect(
      screen.getByText(
        "Sprint 12 ends 23 Oct 2026. Backdate it if the review has already happened."
      )
    ).toBeInTheDocument();
  });
});

describe("the CSV export", () => {
  it("leaves an untimed demo item's minutes blank", async () => {
    seed({
      sprints: [s12],
      stories: STORIES,
      sprintGoals: GOALS,
      sprintReviews: [
        review(reviewDocId("s12"), {
          sprintId: "s12",
          features: [
            featureFromStory(STORIES[0]),
            { ...featureFromStory(STORIES[1]), timeMinutes: 5 },
          ],
        }),
      ],
    });
    renderReview();
    await screen.findByText(/partly met its goal/);
    const rows = exported.csvByFile["sprint-review-sprint-12"]!.rows;
    expect(rows.map((r) => r[6])).toEqual(["", 5]);
  });
});

describe("theme tokens", () => {
  it("has no hard-coded hex colours", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/sprint-review");
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = path.join(d, n);
        return statSync(p).isDirectory() ? files(p) : [p];
      });
    for (const file of files(dir)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
    }
  });
});

describe("the feedback room on the Feedback tab", () => {
  beforeEach(() => {
    seed({ sprints: [s12, s11], stories: STORIES, sprintGoals: GOALS });
    useHistoryStore.setState({ events: [] });
  });

  it(
    "keeps the tab, and the room's panel, when another tab is shown",
    { timeout: 30_000 },
    async () => {
      renderReview();
      await screen.findByText(/partly met its goal/);
      openTab("Stakeholder Feedback");
      fireEvent.click(screen.getByRole("button", { name: "Run a feedback room" }));
      // The button gives way to the room's panel: it isn't a toggle that could close a room.
      expect(screen.queryByRole("button", { name: "Run a feedback room" })).toBeNull();
      // The room's kit loads on demand (a cold import can take a while in a test run).
      await waitFor(() => expect(screen.queryByText("Loading the feedback room…")).toBeNull(), {
        timeout: 15_000,
      });
      openTab("Demo Script");
      // Still mounted, only hidden: a live room in it keeps running.
      const panel = document.querySelector('[role="tabpanel"][data-state="inactive"]');
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute("hidden");
      expect(panel!.textContent).toContain("Feedback room");
      openTab("Stakeholder Feedback");
      expect(screen.getByRole("heading", { name: "Feedback room" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "Run a feedback room" })).toBeNull();
    }
  );

  it("counts a room's saved round by its posts in the last 30 days", async () => {
    const event = (id: string, payload: Record<string, unknown>): HistoryEvent => ({
      id,
      clientEventId: id,
      clientId: "c",
      toolRunId: "r",
      userId: null,
      toolId: "sprint-review",
      action: "feedback_added",
      payload,
      isMilestone: false,
      occurredAt: new Date().toISOString(),
      syncedAt: null,
    });
    useHistoryStore.setState({
      events: [
        event("e1", { category: "positive", count: 12, from: "room" }),
        event("e2", { category: "concern" }),
      ],
    });
    renderReview();
    await screen.findByText(/partly met its goal/);
    expect(screen.getByText(/feedback items captured/).textContent).toContain("13");
  });
});
