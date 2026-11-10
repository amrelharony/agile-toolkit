import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

/**
 * Stories you can fix, in Sprint Planning: the bin on a row (with Undo back
 * to its place) for a story in the backlog or in a sprint that hasn't
 * started, "remove from the sprint" in a running one, nothing on done work
 * or a closed sprint; a story's acceptance criteria, notes, ticket key and
 * link behind Details, with the key opening the tracker in a new tab; and
 * "Paste stories", one title per line with one Undo.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    dismiss: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "test",
  }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/sprint-planning",
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [DEFAULT_CADENCE, () => {}] };
});

import { SprintPlanning } from "@/app/(tools)/sprint-planning/planning";
import {
  PASTE_STORIES_CAP,
  pasteSummary,
  pastedStories,
  validatePaste,
} from "@/app/(tools)/sprint-planning/view";
import { createExampleStore, exampleWriter } from "@/app/(tools)/sprint-planning/writer";
import { PASTE_LINE_CAP, pastedLines, splitPastedLines } from "@/lib/utils/paste-lines";

const sprint = (id: string, patch: Partial<Sprint> = {}): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate: "2026-10-05",
  endDate: "2026-10-19",
  pointsPlanned: 0,
  status: "planned",
  ...patch,
});

const S1 = sprint("s1", {
  startDate: "2026-09-21",
  endDate: "2026-10-05",
  pointsPlanned: 30,
  pointsCompleted: 30,
  status: "completed",
});
const S2 = sprint("s2");

const STORIES: Story[] = [
  { id: "left-1", title: "Refund flow", status: "in_progress", sprintId: "s1", points: 5 },
  { id: "in-1", title: "Pay with a saved card", status: "todo", sprintId: "s2", points: 8 },
  { id: "in-done", title: "Receipts", status: "done", sprintId: "s2", points: 2 },
  { id: "in-2", title: "Card nicknames", status: "todo", sprintId: "s2" },
  { id: "b1", title: "Remove a saved card", status: "backlog", points: 5, priorityScore: 9 },
  { id: "b2", title: "Apple Pay", status: "backlog", points: 13, priorityScore: 8 },
  { id: "b3", title: "Fraud checks", status: "backlog", priorityScore: 7 },
];

const state = () => useWorkspaceStore.getState();
const story = (id: string) => state().stories.find((s) => s.id === id);
const ids = () => state().stories.map((s) => s.id);
const renderPlanning = () =>
  render(
    <TooltipProvider>
      <SprintPlanning />
    </TooltipProvider>
  );
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
/** The Undo of the last undoable toast. */
const undoLast = () => act(() => lastToast()[1].action.onClick());
const list = (name: string) => screen.getByRole("list", { name });
const row = (listName: string, title: string) =>
  within(list(listName)).getByText(title).closest("li")!;
const details = (title: string) => screen.getByRole("group", { name: `Details of ${title}` });

beforeEach(() => {
  toastSpy.mockClear();
  logs.length = 0;
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [S1, S2],
    sprintSeries: [],
    stories: STORIES.map((s) => ({ ...s })),
    backlogItems: [],
    capacityPlans: [],
    pokerEstimationLogs: [],
    whiteboardObjects: [],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], stories: [], backlogItems: [], capacityPlans: [] });
});

/* ── Delete ──────────────────────────────────────────────────────────── */

describe("deleting a story", () => {
  it("deletes a backlog story from its row, and Undo puts it back in its place", () => {
    renderPlanning();
    const before = ids();
    fireEvent.click(screen.getByRole("button", { name: "Delete Apple Pay" }));
    expect(story("b2")).toBeUndefined();
    expect(within(list("Backlog")).queryByText("Apple Pay")).toBeNull();
    expect(lastToast()[0]).toBe("Deleted “Apple Pay”");
    expect(logs).toContainEqual({
      action: "story_deleted",
      payload: { storyId: "b2", title: "Apple Pay" },
    });

    undoLast();
    // Not at the end of the list: where it was.
    expect(ids()).toEqual(before);
    expect(story("b2")).toEqual(STORIES.find((s) => s.id === "b2"));
    expect(within(list("Backlog")).getByText("Apple Pay")).toBeInTheDocument();
  });

  it("deletes a story planned into a sprint that hasn't started", () => {
    renderPlanning();
    fireEvent.click(screen.getByRole("button", { name: "Delete Card nicknames" }));
    expect(story("in-2")).toBeUndefined();
    undoLast();
    expect(story("in-2")).toMatchObject({ sprintId: "s2", status: "todo" });
    // Put back as it was: no new "joined the sprint" stamp on a story that had none.
    expect(story("in-2")?.sprintHistory).toBeUndefined();
  });

  it("puts focus on the next story once the row is gone", () => {
    renderPlanning();
    fireEvent.click(screen.getByRole("button", { name: "Delete Remove a saved card" }));
    expect(screen.getByLabelText("Add to sprint: Apple Pay")).toHaveFocus();
  });

  it("offers no bin on a done story or on a closed sprint's left-overs", () => {
    renderPlanning();
    expect(screen.queryByRole("button", { name: "Delete Receipts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Refund flow" })).toBeNull();
    // The left-over row keeps its other controls.
    expect(
      within(row("Left over from Sprint 1", "Refund flow")).getByRole("button", {
        name: "Edit Refund flow",
      })
    ).toBeInTheDocument();
  });

  it("only lets a story leave a running sprint, and records that it left", () => {
    useWorkspaceStore.setState({ sprints: [S1, { ...S2, status: "active" }] });
    renderPlanning();
    const inSprint = row("Stories in Sprint 2", "Pay with a saved card");
    expect(within(inSprint).queryByRole("button", { name: /^Delete/ })).toBeNull();
    fireEvent.click(
      within(inSprint).getByRole("button", { name: "Remove Pay with a saved card from the sprint" })
    );
    // Still there, back in the backlog, with the move on record for Burnup.
    expect(story("in-1")).toMatchObject({ status: "backlog" });
    expect(story("in-1")?.sprintId).toBeUndefined();
    expect(story("in-1")?.sprintHistory?.at(-1)).toMatchObject({ from: "s2" });
    expect(story("in-1")?.sprintHistory?.at(-1)?.sprintId).toBeUndefined();
    // Out of the sprint it is still part of the sprint's past: its backlog
    // row has no bin either, and says why.
    const out = row("Backlog", "Pay with a saved card");
    expect(within(out).queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(within(out).getByText("Was in Sprint 2, so it can't be deleted")).toBeInTheDocument();
    // Other backlog stories can still be deleted while a sprint runs.
    expect(screen.getByRole("button", { name: "Delete Apple Pay" })).toBeInTheDocument();
    expect(within(row("Backlog", "Apple Pay")).queryByText(/so it can't be deleted/)).toBeNull();
    // A done story stays locked: no bin, no way out of the sprint.
    const done = row("Stories in Sprint 2", "Receipts");
    expect(within(done).queryByRole("button", { name: /Remove|Delete/ })).toBeNull();
  });

  it("keeps a closed sprint's left-over once it is carried over, or sent back to the backlog", () => {
    renderPlanning();
    fireEvent.click(screen.getByRole("button", { name: "Carry over 1 story (5 points)" }));
    expect(story("left-1")).toMatchObject({ sprintId: "s2" });
    const carried = row("Stories in Sprint 2", "Refund flow");
    // Sprint 1's chart still counts it: deleting it here would rewrite that.
    expect(within(carried).queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(
      within(carried).getByText("Was in Sprint 1, so it can't be deleted")
    ).toBeInTheDocument();
    // A story planned into Sprint 2 from the backlog keeps its bin.
    expect(screen.getByRole("button", { name: "Delete Card nicknames" })).toBeInTheDocument();

    undoLast();
    fireEvent.click(screen.getByRole("button", { name: "Back to the backlog" }));
    expect(story("left-1")?.sprintId).toBeUndefined();
    const sentBack = row("Backlog", "Refund flow");
    expect(within(sentBack).queryByRole("button", { name: /^Delete/ })).toBeNull();
    expect(
      within(sentBack).getByText("Was in Sprint 1, so it can't be deleted")
    ).toBeInTheDocument();
  });

  it("locks every story of a closed sprint that is being looked at", () => {
    useWorkspaceStore.setState({ sprints: [S1, { ...S2, status: "completed" }] });
    renderPlanning();
    const closed = row("Stories in Sprint 2", "Pay with a saved card");
    expect(within(closed).queryByRole("button", { name: /Remove|Delete/ })).toBeNull();
  });

  it("gives the bin a 44px target on touch that stands clear of the pencil's", () => {
    renderPlanning();
    const classes = (
      screen.getByRole("button", { name: "Delete Apple Pay" }).className ?? ""
    ).split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        "h-7",
        "w-7",
        "pointer-coarse:min-h-11",
        "pointer-coarse:min-w-11",
        "md:pointer-coarse:min-h-11",
        "md:pointer-coarse:min-w-11",
        // The pencil's 44px reaches 8px past its slot: the 4px gap plus this margin.
        "pointer-coarse:ml-1",
        "pointer-coarse:-mr-2",
        "pointer-coarse:-mt-2",
      ])
    );
  });

  it("re-links the Canvas card pinned to the story when the delete is undone", () => {
    const card = {
      id: "card-1",
      type: "sticky",
      boardId: "wb1",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 1,
      version: 3,
      updatedAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
      sourceRef: { tool: "story", entityId: "b2" },
    };
    useWorkspaceStore.setState({ whiteboardObjects: [card as never] });
    renderPlanning();
    fireEvent.click(screen.getByRole("button", { name: "Delete Apple Pay" }));
    expect(state().whiteboardObjects?.[0].sourceRef).toBeUndefined();
    undoLast();
    expect(state().whiteboardObjects?.[0]).toMatchObject({
      sourceRef: { tool: "story", entityId: "b2" },
      // Bumped twice, so other devices take each change.
      version: 5,
    });
  });

  it("works on the example plan in memory, and nothing reaches the workspace", () => {
    const store = createExampleStore({
      sprints: [S2],
      stories: [
        { id: "example-a", title: "A", status: "backlog" },
        { id: "example-b", title: "B", status: "backlog" },
        { id: "example-c", title: "C", status: "backlog" },
      ],
    });
    const writer = exampleWriter(store);
    const restore = writer.deleteStory("example-b");
    expect(store.getState().stories.map((s) => s.id)).toEqual(["example-a", "example-c"]);
    restore?.();
    expect(store.getState().stories.map((s) => s.id)).toEqual([
      "example-a",
      "example-b",
      "example-c",
    ]);
    // A second Undo, or one after it came back, changes nothing.
    restore?.();
    expect(store.getState().stories).toHaveLength(3);
    expect(writer.deleteStory("nope")).toBeNull();
    expect(ids()).toEqual(STORIES.map((s) => s.id));
  });
});

/* ── Details ─────────────────────────────────────────────────────────── */

describe("a story's details", () => {
  const open = (title: string) =>
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`etails: ${title}$`) }));

  it("adds acceptance criteria, notes, a ticket key and a link from the row", () => {
    renderPlanning();
    const toggle = screen.getByRole("button", { name: "Add details: Apple Pay" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Nothing to read yet, so it opens on the form, in its first field.
    const panel = details("Apple Pay");
    const criteria = within(panel).getByLabelText("Acceptance criteria");
    expect(criteria).toHaveFocus();
    fireEvent.change(criteria, { target: { value: "- Pay in one tap\n- Receipt by email" } });
    fireEvent.change(within(panel).getByLabelText("Notes"), {
      target: { value: "  Phones only for now.  " },
    });
    fireEvent.change(within(panel).getByLabelText("Ticket key"), { target: { value: " PAY-12 " } });
    fireEvent.change(within(panel).getByLabelText("Link to the issue"), {
      target: { value: "https://tracker.example.com/browse/PAY-12" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Save details" }));

    expect(story("b2")).toMatchObject({
      acceptanceCriteria: "- Pay in one tap\n- Receipt by email",
      notes: "Phones only for now.",
      ticketKey: "PAY-12",
      link: "https://tracker.example.com/browse/PAY-12",
      // The rest of the story is untouched.
      points: 13,
      priorityScore: 8,
    });
    // The panel now reads the details back, with a way to edit them.
    expect(within(details("Apple Pay")).getByText(/Pay in one tap/)).toBeInTheDocument();
    expect(within(details("Apple Pay")).getByText("Phones only for now.")).toBeInTheDocument();
    expect(
      within(details("Apple Pay")).getByRole("button", { name: "Edit details: Apple Pay" })
    ).toHaveFocus();
    expect(screen.getByRole("button", { name: "Details: Apple Pay" })).toBeInTheDocument();
  });

  it("shows the ticket key on the row as a link that opens the tracker in a new tab", () => {
    useWorkspaceStore.setState({
      stories: STORIES.map((s) =>
        s.id === "b2"
          ? { ...s, ticketKey: "PAY-12", link: "https://tracker.example.com/browse/PAY-12" }
          : s.id === "b1"
            ? { ...s, ticketKey: "PAY-7" }
            : s.id === "b3"
              ? { ...s, link: "https://tracker.example.com/browse/PAY-9" }
              : s
      ),
    });
    renderPlanning();
    const link = within(row("Backlog", "Apple Pay")).getByRole("link", { name: /^PAY-12/ });
    expect(link).toHaveAttribute("href", "https://tracker.example.com/browse/PAY-12");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName("PAY-12: open the issue for Apple Pay (opens in a new tab)");
    expect(link.className).toContain("pointer-coarse:min-h-11");
    // A 50-character key with no space breaks rather than widen a phone's row.
    expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "max-w-full"]));
    expect(within(link).getByText("PAY-12").className).toContain("break-all");
    // A key with no link is text; a link with no key still opens the issue.
    const plain = within(row("Backlog", "Remove a saved card")).getByText("PAY-7");
    expect(plain.tagName).toBe("SPAN");
    expect(plain.className).toContain("break-all");
    expect(
      within(row("Backlog", "Fraud checks")).getByRole("link", { name: /^Open issue/ })
    ).toHaveAttribute("href", "https://tracker.example.com/browse/PAY-9");
  });

  it("never turns a link that isn't http or https into a link", () => {
    // A row synced from elsewhere could hold anything: it is checked again when drawn.
    useWorkspaceStore.setState({
      stories: STORIES.map((s) =>
        s.id === "b2" ? { ...s, ticketKey: "PAY-12", link: "javascript:alert(1)" } : s
      ),
    });
    renderPlanning();
    expect(within(row("Backlog", "Apple Pay")).queryByRole("link", { name: /PAY-12/ })).toBeNull();
    expect(within(row("Backlog", "Apple Pay")).getByText("PAY-12")).toBeInTheDocument();
  });

  it("says what is wrong with a link and saves nothing until it is fixed", () => {
    renderPlanning();
    open("Apple Pay");
    const panel = details("Apple Pay");
    const link = within(panel).getByLabelText("Link to the issue");
    fireEvent.change(link, { target: { value: "tracker.example.com/PAY-12" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save details" }));
    expect(
      within(panel).getByText("Enter a web address that starts with http:// or https://.")
    ).toBeInTheDocument();
    expect(link).toHaveFocus();
    expect(story("b2")?.link).toBeUndefined();
    fireEvent.change(link, { target: { value: "https://tracker.example.com/PAY-12" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save details" }));
    expect(story("b2")?.link).toBe("https://tracker.example.com/PAY-12");
  });

  it("removes a field that is cleared, and closes when nothing is left", () => {
    useWorkspaceStore.setState({
      stories: STORIES.map((s) => (s.id === "b2" ? { ...s, notes: "Phones only." } : s)),
    });
    renderPlanning();
    open("Apple Pay");
    fireEvent.click(
      within(details("Apple Pay")).getByRole("button", { name: "Edit details: Apple Pay" })
    );
    fireEvent.change(within(details("Apple Pay")).getByLabelText("Notes"), {
      target: { value: "" },
    });
    fireEvent.click(within(details("Apple Pay")).getByRole("button", { name: "Save details" }));
    expect(story("b2") && "notes" in story("b2")!).toBe(false);
    expect(screen.queryByRole("group", { name: "Details of Apple Pay" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add details: Apple Pay" })).toHaveFocus();
  });

  it("cancels without saving, and Escape cancels too", () => {
    renderPlanning();
    open("Apple Pay");
    fireEvent.change(within(details("Apple Pay")).getByLabelText("Notes"), {
      target: { value: "Half typed" },
    });
    fireEvent.keyDown(within(details("Apple Pay")).getByLabelText("Notes"), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Details of Apple Pay" })).toBeNull();
    expect(story("b2")?.notes).toBeUndefined();
  });

  it("lets a done story's details be read, and starts none on a done story without any", () => {
    useWorkspaceStore.setState({
      stories: [
        ...STORIES,
        {
          id: "in-done-2",
          title: "Card on file",
          status: "done",
          sprintId: "s2",
          acceptanceCriteria: "- Stored after the first payment",
        },
      ],
    });
    renderPlanning();
    expect(screen.queryByRole("button", { name: /etails: Receipts$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details: Card on file" }));
    expect(
      within(details("Card on file")).getByText("- Stored after the first payment")
    ).toBeInTheDocument();
  });

  it("leaves the details out of the Markdown a share link carries", () => {
    useWorkspaceStore.setState({
      stories: STORIES.map((s) =>
        s.id === "in-1" ? { ...s, notes: "SECRET-NOTE", ticketKey: "PAY-1" } : s
      ),
    });
    renderPlanning();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("Pay with a saved card");
    expect(md).not.toContain("SECRET-NOTE");
    expect(md).not.toContain("PAY-1");
  });

  it("sends the notes and acceptance criteria along when a story is queued for Planning Poker", () => {
    useWorkspaceStore.setState({
      stories: STORIES.map((s) =>
        s.id === "in-2"
          ? { ...s, notes: "Shown on the card list.", acceptanceCriteria: "- Up to 20 characters" }
          : s
      ),
    });
    renderPlanning();
    fireEvent.click(screen.getByRole("button", { name: "Estimate 1 in Planning Poker" }));
    const queue = state().pokerEstimationLogs?.find((l) => l.id === POKER_LOG_ID)?.queue ?? [];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      title: "Card nicknames",
      description: "Shown on the card list.\n\nAcceptance criteria:\n- Up to 20 characters",
      sourceRef: { tool: "story", id: "in-2" },
    });
  });
});

/* ── Paste stories ───────────────────────────────────────────────────── */

describe("pasted lines (logic)", () => {
  it("makes one title per non-empty line, without list marks", () => {
    expect(pastedStories("- Pay with a card\n\n2. Refunds  \r\n  Gift   cards\n")).toEqual({
      titles: ["Pay with a card", "Refunds", "Gift cards"],
      dropped: 0,
      cut: 0,
    });
    // One line is a list of one here.
    expect(pastedStories("Just one").titles).toEqual(["Just one"]);
    expect(pastedStories("  \n ").titles).toEqual([]);
  });

  it("takes up to 200 lines a paste and cuts a title at 200 characters", () => {
    const lines = Array.from({ length: 214 }, (_, i) => `Story ${i + 1}`);
    const pasted = pastedStories([...lines.slice(0, 1), "x".repeat(250), ...lines].join("\n"));
    expect(PASTE_STORIES_CAP).toBe(200);
    expect(pasted.titles).toHaveLength(200);
    expect(pasted.dropped).toBe(16);
    expect(pasted.cut).toBe(1);
    expect(pasted.titles[1]).toHaveLength(200);
    expect(pasteSummary(pasted)).toBe(
      "200 stories to add. 16 more lines are over the limit of 200 and will be left out. 1 title is longer than 200 characters and will be cut."
    );
    expect(pasteSummary(pastedStories("One\nTwo"))).toBe("2 stories to add.");
    expect(pasteSummary(pastedStories(""))).toBe("");
  });

  it("needs at least one title", () => {
    expect(validatePaste({ text: " \n ", intoSprint: false })).toEqual({
      ok: false,
      errors: { text: "Paste or type at least one story title, one per line." },
    });
    expect(validatePaste({ text: "One", intoSprint: true })).toEqual({
      ok: true,
      values: { titles: ["One"], dropped: 0, cut: 0, intoSprint: true },
    });
  });

  it("keeps the 30-line cap everywhere else", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n");
    expect(PASTE_LINE_CAP).toBe(30);
    expect(splitPastedLines(text)?.lines).toHaveLength(30);
    expect(splitPastedLines(text)?.dropped).toBe(10);
    expect(pastedLines(text).lines).toHaveLength(30);
    // The add boxes still leave a one-line paste to the input.
    expect(splitPastedLines("one line")).toBeNull();
    expect(pastedLines("one line")).toEqual({ lines: ["one line"], dropped: 0 });
  });
});

describe("Paste stories", () => {
  const openPaste = () => fireEvent.click(screen.getByRole("button", { name: "Paste stories" }));
  const panel = () => screen.getByRole("region", { name: "Paste stories" });

  it("adds one backlog story per line, with one Undo for the lot", () => {
    renderPlanning();
    const before = ids();
    openPaste();
    const field = within(panel()).getByLabelText("Stories to add");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "- Gift cards\n- Split payments\n\n- Pay later" } });
    expect(within(panel()).getByText("3 stories to add.")).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Add 3 stories to the backlog" }));

    const added = state().stories.slice(before.length);
    expect(added.map((s) => [s.title, s.status, s.sprintId])).toEqual([
      ["Gift cards", "backlog", undefined],
      ["Split payments", "backlog", undefined],
      ["Pay later", "backlog", undefined],
    ]);
    expect(lastToast()[0]).toBe("Added 3 stories to the backlog");
    expect(logs.at(-1)).toEqual({
      action: "stories_pasted",
      payload: { sprintId: "s2", count: 3, intoSprint: false },
    });
    // The panel closes and focus goes back to its button.
    expect(screen.queryByRole("region", { name: "Paste stories" })).toBeNull();
    expect(screen.getByRole("button", { name: "Paste stories" })).toHaveFocus();
    expect(within(list("Backlog")).getByText("Split payments")).toBeInTheDocument();

    undoLast();
    expect(ids()).toEqual(before);
  });

  it("can put them straight into the sprint", () => {
    renderPlanning();
    openPaste();
    fireEvent.change(within(panel()).getByLabelText("Stories to add"), {
      target: { value: "Gift cards\nSplit payments" },
    });
    fireEvent.click(within(panel()).getByLabelText("Put them straight into Sprint 2"));
    fireEvent.click(within(panel()).getByRole("button", { name: "Add 2 stories to Sprint 2" }));
    expect(state().stories.slice(-2)).toMatchObject([
      { title: "Gift cards", status: "todo", sprintId: "s2" },
      { title: "Split payments", status: "todo", sprintId: "s2" },
    ]);
    expect(lastToast()[0]).toBe("Added 2 stories to Sprint 2");
  });

  it("saves nothing from an empty box, and says why", () => {
    renderPlanning();
    const before = ids();
    openPaste();
    fireEvent.click(within(panel()).getByRole("button", { name: "Add to the backlog" }));
    expect(
      within(panel()).getByText("Paste or type at least one story title, one per line.")
    ).toBeInTheDocument();
    expect(ids()).toEqual(before);
    fireEvent.click(within(panel()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Paste stories" })).toBeNull();
  });

  it("stops at 200 lines and says how many were left out", () => {
    renderPlanning();
    const before = ids().length;
    openPaste();
    const text = Array.from({ length: 203 }, (_, i) => `Story ${i + 1}`).join("\n");
    fireEvent.change(within(panel()).getByLabelText("Stories to add"), { target: { value: text } });
    expect(
      within(panel()).getByText(
        "200 stories to add. 3 more lines are over the limit of 200 and will be left out."
      )
    ).toBeInTheDocument();
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Add 200 stories to the backlog" })
    );
    expect(ids()).toHaveLength(before + 200);
    expect(lastToast()[1].description).toBe("3 more lines were left out.");
    undoLast();
    expect(ids()).toHaveLength(before);
  });

  it("opens with a list pasted into the add-story field, ready for the sprint", () => {
    renderPlanning();
    const field = screen.getByLabelText("New story");
    fireEvent.paste(field, {
      clipboardData: { getData: () => "Gift cards\nSplit payments\nPay later" },
    });
    expect(within(panel()).getByLabelText("Stories to add")).toHaveValue(
      "Gift cards\nSplit payments\nPay later"
    );
    expect(within(panel()).getByLabelText("Put them straight into Sprint 2")).toBeChecked();
    expect(
      within(panel()).getByRole("button", { name: "Add 3 stories to Sprint 2" })
    ).toBeInTheDocument();
    // A one-line paste is left to the field.
    fireEvent.click(within(panel()).getByRole("button", { name: "Cancel" }));
    fireEvent.paste(field, { clipboardData: { getData: () => "Just one story" } });
    expect(screen.queryByRole("region", { name: "Paste stories" })).toBeNull();
  });

  it("adds a list pasted into the add-story field to the panel when it is already open", () => {
    renderPlanning();
    openPaste();
    const box = () => within(panel()).getByLabelText("Stories to add");
    fireEvent.change(box(), { target: { value: "Already typed\n" } });
    const field = screen.getByLabelText("New story");
    act(() => field.focus());
    fireEvent.paste(field, { clipboardData: { getData: () => "Gift cards\nSplit payments" } });
    // Nothing is lost: the list joins what the panel held, bound for the
    // sprint as that field's stories are, and focus follows it there.
    expect(box()).toHaveValue("Already typed\nGift cards\nSplit payments");
    expect(within(panel()).getByLabelText("Put them straight into Sprint 2")).toBeChecked();
    expect(box()).toHaveFocus();
    expect(field).toHaveValue("");
    // And again: every paste is added, also the same list twice.
    fireEvent.paste(field, { clipboardData: { getData: () => "Gift cards\nSplit payments" } });
    expect(box()).toHaveValue(
      "Already typed\nGift cards\nSplit payments\nGift cards\nSplit payments"
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Add 5 stories to Sprint 2" }));
    expect(
      state()
        .stories.slice(-5)
        .map((s) => [s.title, s.sprintId])
    ).toEqual([
      ["Already typed", "s2"],
      ["Gift cards", "s2"],
      ["Split payments", "s2"],
      ["Gift cards", "s2"],
      ["Split payments", "s2"],
    ]);

    // Opened again from the button, it starts empty and for the backlog.
    openPaste();
    expect(box()).toHaveValue("");
    expect(within(panel()).getByLabelText("Put them straight into Sprint 2")).not.toBeChecked();
    // A list pasted into an empty open panel is the panel's text as it is.
    fireEvent.paste(field, { clipboardData: { getData: () => "Pay later\nGift receipts" } });
    expect(box()).toHaveValue("Pay later\nGift receipts");
  });

  it("only offers the backlog while the sprint is closed", () => {
    useWorkspaceStore.setState({ sprints: [S1, { ...S2, status: "completed" }] });
    renderPlanning();
    openPaste();
    expect(within(panel()).queryByLabelText(/Put them straight into/)).toBeNull();
    fireEvent.change(within(panel()).getByLabelText("Stories to add"), {
      target: { value: "Gift cards" },
    });
    fireEvent.click(within(panel()).getByRole("button", { name: "Add 1 story to the backlog" }));
    expect(state().stories.at(-1)).toMatchObject({ title: "Gift cards", status: "backlog" });
  });
});
