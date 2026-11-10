import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

/**
 * Stories you can fix, in Refinement: the story being refined shows its
 * acceptance criteria beside the Definition of Ready ticks and they are
 * edited there; it can be deleted with Undo (or, in a running sprint, only
 * moved out of the sprint); its ticket opens the tracker; and "Check the
 * story" holds the six INVEST questions and five ways to split a story,
 * with no AI and nothing saved.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
type ExportProps = { csvData: { headers: string[]; rows: unknown[][] }; markdown: string };
const exported = vi.hoisted(() => ({ props: null as null | ExportProps }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: ExportProps) => {
    exported.props = p;
    return null;
  },
}));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { RefinementClient } from "@/app/(tools)/refinement/refinement-client";
import { useRefinementStore, type Criterion } from "@/app/(tools)/refinement/store";
import { buildExample } from "@/app/(tools)/refinement/example";
import { INVEST_QUESTIONS, SPLIT_PATTERNS, investResult } from "@/app/(tools)/refinement/invest";

const C: Criterion[] = [
  { id: "c1", label: "Acceptance criteria defined" },
  { id: "c2", label: "Fits in a sprint" },
];

const sprint = (id: string, status: Sprint["status"]): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 0,
  status,
});

const STORIES: Story[] = [
  {
    id: "a",
    title: "Pay with a saved card",
    status: "backlog",
    priorityScore: 30,
    acceptanceCriteria: "- A saved card shows at checkout\n- Only the security code is asked",
    notes: "Cards are stored by the provider.",
    ticketKey: "PAY-12",
    link: "https://tracker.example.com/browse/PAY-12",
  },
  { id: "b", title: "Refund flow", status: "backlog", priorityScore: 20 },
  { id: "c", title: "Gift cards", status: "backlog", priorityScore: 10 },
];

const ws = () => useWorkspaceStore.getState();
const story = (id: string) => ws().stories.find((s) => s.id === id);
const ids = () => ws().stories.map((s) => s.id);
const renderPage = () =>
  render(
    <TooltipProvider>
      <RefinementClient />
    </TooltipProvider>
  );
const panel = () => screen.getByRole("button", { name: "Mark ready" }).closest("section")!;
const details = (title: string) => screen.getByRole("group", { name: `Details of ${title}` });
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const classesOf = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  exported.props = null;
  window.localStorage.clear();
  // The workspace store skips hydration in tests; the page waits for it.
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({
    stories: STORIES.map((s) => ({ ...s })),
    sprints: [],
    pokerEstimationLogs: [],
    whiteboardObjects: [],
  });
  useRefinementStore.setState({
    criteria: C,
    history: [],
    exampleStories: [],
    storyName: "",
    storyDescription: "",
    currentChecks: {},
  });
});

/* ── Acceptance criteria beside the ticks ────────────────────────────── */

describe("the story being refined", () => {
  it("shows its acceptance criteria, notes and ticket with the Definition of Ready", () => {
    renderPage();
    const about = details("Pay with a saved card");
    expect(panel().contains(about)).toBe(true);
    expect(within(about).getByText("Acceptance criteria")).toBeInTheDocument();
    expect(within(about).getByText(/A saved card shows at checkout/)).toBeInTheDocument();
    expect(within(about).getByText("Cards are stored by the provider.")).toBeInTheDocument();
    // The ticks are in the same panel.
    expect(
      within(panel()).getByRole("checkbox", { name: "Acceptance criteria defined" })
    ).toBeInTheDocument();
  });

  it("puts the details beside the ticks when the panel is wide, and before them when read in order", () => {
    renderPage();
    const about = details("Pay with a saved card");
    const form = within(panel()).getByRole("button", { name: "Mark ready" }).closest("form")!;
    const grid = about.parentElement!;
    expect(form.parentElement).toBe(grid);
    // The panel measures itself, so the sidebar's width doesn't matter.
    expect(classesOf(panel())).toContain("@container");
    expect(classesOf(grid)).toEqual(expect.arrayContaining(["grid", "@2xl:grid-cols-2"]));
    expect(classesOf(about)).toEqual(
      expect.arrayContaining(["@2xl:col-start-2", "@2xl:row-start-1"])
    );
    expect(classesOf(form)).toEqual(
      expect.arrayContaining(["@2xl:col-start-1", "@2xl:row-start-1"])
    );
    // In the document the story comes first: a phone and a screen reader
    // meet the criteria before the boxes that ask about them.
    expect(about.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the tracker's issue in a new tab from the ticket key", () => {
    renderPage();
    const link = within(details("Pay with a saved card")).getByRole("link", { name: /^PAY-12/ });
    expect(link).toHaveAttribute("href", "https://tracker.example.com/browse/PAY-12");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("edits the details in place and saves them on the story", () => {
    renderPage();
    fireEvent.click(
      within(details("Pay with a saved card")).getByRole("button", {
        name: "Edit details: Pay with a saved card",
      })
    );
    const about = details("Pay with a saved card");
    const criteria = within(about).getByLabelText("Acceptance criteria");
    expect(criteria).toHaveFocus();
    expect(criteria).toHaveValue(
      "- A saved card shows at checkout\n- Only the security code is asked"
    );
    fireEvent.change(criteria, { target: { value: "- A saved card shows at checkout" } });
    fireEvent.change(within(about).getByLabelText("Notes"), { target: { value: "" } });
    fireEvent.click(within(about).getByRole("button", { name: "Save details" }));

    expect(story("a")).toMatchObject({
      acceptanceCriteria: "- A saved card shows at checkout",
      ticketKey: "PAY-12",
      link: "https://tracker.example.com/browse/PAY-12",
    });
    expect(story("a") && "notes" in story("a")!).toBe(false);
    expect(
      within(details("Pay with a saved card")).getByRole("button", {
        name: "Edit details: Pay with a saved card",
      })
    ).toHaveFocus();
    expect(logs).toContainEqual({
      action: "story_updated",
      payload: { storyId: "a", details: true },
    });
  });

  it("offers to add details to a story that has none, and stays put when cancelled", () => {
    renderPage();
    fireEvent.click(
      within(screen.getByRole("list", { name: "Stories to refine" })).getByRole("button", {
        name: /Refund flow/,
      })
    );
    const about = details("Refund flow");
    expect(
      within(about).getByText("No acceptance criteria, notes or link yet.")
    ).toBeInTheDocument();
    fireEvent.click(within(about).getByRole("button", { name: "Add details: Refund flow" }));
    fireEvent.change(within(details("Refund flow")).getByLabelText("Link to the issue"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(within(details("Refund flow")).getByRole("button", { name: "Save details" }));
    expect(
      within(details("Refund flow")).getByText(
        "Enter a web address that starts with http:// or https://."
      )
    ).toBeInTheDocument();
    expect(story("b")?.link).toBeUndefined();
    fireEvent.click(within(details("Refund flow")).getByRole("button", { name: "Cancel" }));
    // Always shown here, so the panel stays, back on its text.
    expect(
      within(details("Refund flow")).getByRole("button", { name: "Add details: Refund flow" })
    ).toHaveFocus();
  });

  it("keeps the details out of the Markdown and the CSV", () => {
    renderPage();
    expect(exported.props?.markdown).toContain("Pay with a saved card");
    for (const text of ["security code", "stored by the provider", "PAY-12", "tracker.example"]) {
      expect(exported.props?.markdown).not.toContain(text);
      expect(JSON.stringify(exported.props?.csvData)).not.toContain(text);
    }
  });

  it("queues it for Planning Poker with its notes and acceptance criteria", () => {
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Queue for Poker" }));
    const queue = ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID)?.queue ?? [];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      title: "Pay with a saved card",
      description:
        "Cards are stored by the provider.\n\nAcceptance criteria:\n- A saved card shows at checkout\n- Only the security code is asked",
      sourceRef: { tool: "story", id: "a" },
    });
  });

  it("queues every unsized story with its own text", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Queue 3 unsized for Planning Poker" }));
    const queue = ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID)?.queue ?? [];
    expect(queue.map((q) => [q.title, Boolean(q.description)])).toEqual([
      ["Pay with a saved card", true],
      ["Refund flow", false],
      ["Gift cards", false],
    ]);
  });

  it("keeps a check by name's description as the notes of the story it becomes", () => {
    useWorkspaceStore.setState({ stories: [] });
    useRefinementStore.setState({
      history: [
        {
          id: "h1",
          storyName: "Partner refunds",
          description: "Refunds paid out by a partner bank.",
          date: "2026-10-10",
          checks: [],
          totalCriteria: 2,
          metCount: 0,
          passRate: 0,
        },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog: Partner refunds" }));
    expect(ws().stories[0]).toMatchObject({
      title: "Partner refunds",
      notes: "Refunds paid out by a partner bank.",
    });
    expect(
      within(details("Partner refunds")).getByText("Refunds paid out by a partner bank.")
    ).toBeInTheDocument();
  });
});

/* ── Delete, or leave the sprint ─────────────────────────────────────── */

describe("deleting the story being refined", () => {
  it("deletes it with Undo, and goes on to the next story", () => {
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Delete Pay with a saved card" }));
    expect(story("a")).toBeUndefined();
    expect(lastToast()[0]).toBe("Deleted “Pay with a saved card”");
    expect(logs).toContainEqual({
      action: "story_removed",
      payload: { storyId: "a", title: "Pay with a saved card" },
    });
    // The walk moves on, with focus on the next story's name.
    expect(within(panel()).getByRole("heading", { name: "Refund flow" })).toHaveFocus();

    undoLast();
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(story("a")).toEqual(STORIES[0]);
  });

  it("deletes a story planned into a sprint that hasn't started", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s1", "planned")],
      stories: [{ ...STORIES[1], status: "todo", sprintId: "s1" }, STORIES[2]],
    });
    renderPage();
    fireEvent.click(within(panel()).getByRole("button", { name: "Delete Refund flow" }));
    expect(story("b")).toBeUndefined();
  });

  it("only moves a story out of a running sprint, with the move on record and Undo", () => {
    const planned: Story = {
      ...STORIES[1],
      status: "todo",
      sprintId: "s1",
      sprintHistory: [{ sprintId: "s1", at: "2026-10-05T08:00:00.000Z" }],
    };
    useWorkspaceStore.setState({ sprints: [sprint("s1", "active")], stories: [planned] });
    renderPage();
    expect(within(panel()).queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(within(panel()).getByText("In Sprint 1")).toBeInTheDocument();
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Remove Refund flow from the sprint" })
    );
    expect(story("b")).toMatchObject({ status: "backlog" });
    expect(story("b")?.sprintId).toBeUndefined();
    // Burnup reads this: the story left Sprint 1, it didn't vanish from it.
    expect(story("b")?.sprintHistory).toHaveLength(2);
    expect(story("b")?.sprintHistory?.[1]).toMatchObject({ from: "s1" });
    expect(lastToast()[0]).toBe("Moved “Refund flow” back to the backlog");
    expect(lastToast()[1].description).toBe("It is out of Sprint 1. Undo puts it back.");
    // Still being refined, now as a backlog story; focus is on its name.
    expect(within(panel()).getByRole("heading", { name: "Refund flow" })).toHaveFocus();
    expect(within(panel()).queryByText("In Sprint 1")).toBeNull();
    // Out of the sprint it is still part of the sprint's past: the button
    // doesn't turn into a bin, and the panel says why.
    expect(within(panel()).queryByRole("button", { name: /^(Delete|Remove) / })).toBeNull();
    expect(
      within(panel()).getByText("Was in Sprint 1, so it can't be deleted.")
    ).toBeInTheDocument();

    undoLast();
    expect(story("b")).toEqual(planned);
    expect(within(panel()).queryByText(/so it can't be deleted/)).toBeNull();
  });

  it("offers no bin on a story a closed sprint's left-over became, and says why", () => {
    const carried: Story = {
      ...STORIES[1],
      status: "todo",
      sprintId: "s2",
      sprintHistory: [
        { sprintId: "s1", at: "2026-10-05T08:00:00.000Z" },
        { sprintId: "s2", from: "s1", at: "2026-10-19T08:00:00.000Z" },
      ],
    };
    useWorkspaceStore.setState({
      sprints: [sprint("s1", "completed"), sprint("s2", "planned")],
      stories: [carried, STORIES[2]],
    });
    renderPage();
    expect(within(panel()).getByRole("heading", { name: "Refund flow" })).toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: /^(Delete|Remove) / })).toBeNull();
    expect(
      within(panel()).getByText("Was in Sprint 1, so it can't be deleted.")
    ).toBeInTheDocument();
    // A story no started sprint counts keeps its bin, with no note.
    fireEvent.click(
      within(screen.getByRole("list", { name: "Stories to refine" })).getByRole("button", {
        name: /Gift cards/,
      })
    );
    expect(within(panel()).getByRole("button", { name: "Delete Gift cards" })).toBeInTheDocument();
    expect(within(panel()).queryByText(/so it can't be deleted/)).toBeNull();
  });

  it("offers neither on a story a closed sprint left over", () => {
    useWorkspaceStore.setState({
      sprints: [sprint("s1", "completed")],
      stories: [{ ...STORIES[1], status: "todo", sprintId: "s1" }],
    });
    renderPage();
    expect(within(panel()).getByRole("heading", { name: "Refund flow" })).toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: /^(Delete|Remove) / })).toBeNull();
  });

  it("deletes an example story from the example only", () => {
    useWorkspaceStore.setState({ stories: [] });
    const example = buildExample(C);
    useRefinementStore.setState({ exampleStories: example });
    renderPage();
    const first = within(panel()).getByRole("heading", { level: 3 }).textContent!;
    const firstId = example.find((s) => s.title === first)!.id;
    fireEvent.click(within(panel()).getByRole("button", { name: `Delete ${first}` }));
    const left = () => useRefinementStore.getState().exampleStories.map((s) => s.id);
    expect(left()).not.toContain(firstId);
    expect(ws().stories).toEqual([]);
    undoLast();
    expect(left()).toEqual(example.map((s) => s.id));
  });
});

/* ── The story check ─────────────────────────────────────────────────── */

describe("the story check (logic)", () => {
  it("asks the six INVEST questions, each so that yes is good", () => {
    expect(INVEST_QUESTIONS.map((q) => q.word)).toEqual([
      "Independent",
      "Negotiable",
      "Valuable",
      "Estimable",
      "Small",
      "Testable",
    ]);
    for (const q of INVEST_QUESTIONS) expect(q.question.endsWith("?"), q.id).toBe(true);
  });

  it("lists five ways to split a story", () => {
    expect(SPLIT_PATTERNS.map((p) => p.id)).toEqual([
      "spike",
      "path",
      "interface",
      "data",
      "rules",
    ]);
    for (const p of SPLIT_PATTERNS) expect(p.how.length, p.id).toBeGreaterThan(20);
  });

  it("says where the story stands, and points at the splits when it isn't small", () => {
    expect(investResult([])).toMatchObject({
      yes: 0,
      tooBig: false,
      text: "Tick each question the answer is yes to.",
    });
    expect(investResult(["independent", "valuable", "testable", "negotiable"])).toMatchObject({
      yes: 4,
      tooBig: true,
      text: "Yes to 4 of 6. Still open: Estimable and Small. If it is too big for a sprint, try one of the splits below.",
    });
    expect(investResult(["small", "nonsense"])).toMatchObject({ yes: 1, tooBig: false });
    expect(investResult(["small"]).text).toBe(
      "Yes to 1 of 6. Still open: Independent, Negotiable, Valuable, Estimable and Testable."
    );
    expect(investResult(INVEST_QUESTIONS.map((q) => q.id))).toMatchObject({
      yes: 6,
      open: [],
      text: "Yes to all six: the story holds up.",
    });
  });
});

describe("Check the story", () => {
  const toggle = () => within(panel()).getByRole("button", { name: /^Check the story/ });
  const result = () => panel().querySelector('[data-field="story-check-result"]')?.textContent;

  it("is closed until asked for, then shows the six questions and the splits", () => {
    renderPage();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(panel()).queryByRole("checkbox", { name: /^Small\./ })).toBeNull();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const questions = within(panel()).getByRole("group", {
      name: "Six questions to ask of it: Pay with a saved card",
    });
    expect(within(questions).getAllByRole("checkbox")).toHaveLength(6);
    expect(
      within(panel()).getByRole("heading", { name: "Too big? Five ways to split it" })
    ).toBeInTheDocument();
    for (const name of ["Spike.", "Path.", "Interface.", "Data.", "Rules."]) {
      expect(within(panel()).getByText(name)).toBeInTheDocument();
    }
  });

  it("counts the yes answers as they are ticked", () => {
    renderPage();
    fireEvent.click(toggle());
    expect(result()).toBe("Tick each question the answer is yes to.");
    fireEvent.click(within(panel()).getByRole("checkbox", { name: /^Independent\./ }));
    fireEvent.click(within(panel()).getByRole("checkbox", { name: /^Valuable\./ }));
    expect(result()).toBe(
      "Yes to 2 of 6. Still open: Negotiable, Estimable, Small and Testable. If it is too big for a sprint, try one of the splits below."
    );
    for (const word of ["Negotiable", "Estimable", "Small", "Testable"]) {
      fireEvent.click(within(panel()).getByRole("checkbox", { name: new RegExp(`^${word}\\.`) }));
    }
    expect(result()).toBe("Yes to all six: the story holds up.");
  });

  it("keeps each story's answers while the page is open, and saves none of them", () => {
    renderPage();
    const before = JSON.stringify(ws().stories);
    const refinementBefore = JSON.stringify(useRefinementStore.getState().criteria);
    fireEvent.click(toggle());
    fireEvent.click(within(panel()).getByRole("checkbox", { name: /^Small\./ }));
    // On to the next story: the check stays open, with that story's own blank answers.
    fireEvent.click(within(panel()).getByRole("button", { name: "Next story" }));
    expect(within(panel()).getByRole("heading", { name: "Refund flow" })).toBeInTheDocument();
    expect(within(panel()).getByRole("checkbox", { name: /^Small\./ })).not.toBeChecked();
    fireEvent.click(within(panel()).getByRole("button", { name: "Previous story" }));
    expect(within(panel()).getByRole("checkbox", { name: /^Small\./ })).toBeChecked();
    // Nothing was written anywhere, and the story is no nearer to "ready".
    expect(JSON.stringify(ws().stories)).toBe(before);
    expect(JSON.stringify(useRefinementStore.getState().criteria)).toBe(refinementBefore);
    expect(window.localStorage.getItem("agile-toolkit:refinement") ?? "").not.toContain("small");
    expect(
      within(panel()).getByRole("checkbox", { name: "Acceptance criteria defined" })
    ).not.toBeChecked();
  });
});
