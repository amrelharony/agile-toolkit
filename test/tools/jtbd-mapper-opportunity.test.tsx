import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { JobStory, TreeNode } from "@/lib/stores/workspace-types";

/**
 * Job Story Mapper → Opportunity Tree: a job can name the opportunity it
 * serves. The row links and unlinks it (with Undo), the chip opens the
 * tree, a deleted node reads "Opportunity removed", an empty tree says so
 * and points there, the add form can set it, example jobs never link, the
 * Markdown export names it, and jobs saved before the field still load.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { JtbdMapperClient } from "@/app/(tools)/jtbd-mapper/jtbd-mapper-client";
import { buildExample } from "@/app/(tools)/jtbd-mapper/example";
import { toMarkdown } from "@/app/(tools)/jtbd-mapper/markdown";
import { EMPTY_JOB_DRAFT, jobDraftFrom, validateJob } from "@/app/(tools)/jtbd-mapper/job-form";
import {
  NO_OUTCOME,
  OPPORTUNITY_TREE_ID,
  nodeTitle,
  opportunityGroups,
  opportunityIds,
  outcomeOf,
  resolveOpportunity,
  treeNodes,
  withoutOpportunity,
} from "@/app/(tools)/jtbd-mapper/opportunities";

const node = (
  id: string,
  kind: TreeNode["kind"],
  text: string,
  parentId: string | null = null
): TreeNode => ({ id, kind, text, parentId });

/** Two outcomes, their opportunities (one untitled), a solution, and one opportunity under no outcome. */
const NODES: TreeNode[] = [
  node("o1", "outcome", "Cut reimbursement time"),
  node("opp-fast", "opportunity", "Payouts take too long", "o1"),
  node("sol", "solution", "Same-day transfer", "opp-fast"),
  node("opp-blank", "opportunity", "", "o1"),
  node("o2", "outcome", "Fewer policy breaches"),
  node("opp-rules", "opportunity", "Nobody knows the limits", "o2"),
  node("opp-loose", "opportunity", "Receipts get lost", null),
];

const job = (id: string, situation: string, extra: Partial<JobStory> = {}): JobStory => ({
  id,
  situation,
  motivation: "m",
  outcome: "o",
  ...extra,
});

const setTree = (nodes: TreeNode[]) =>
  useWorkspaceStore.setState({ opportunityTrees: [{ id: OPPORTUNITY_TREE_ID, nodes }] });
const jobs = () => useWorkspaceStore.getState().jobStories ?? [];
const jobById = (id: string) => jobs().find((j) => j.id === id);
const renderJtbd = () =>
  render(
    <TooltipProvider>
      <JtbdMapperClient />
    </TooltipProvider>
  );
const addForm = () => screen.getByRole("button", { name: "Add job story" }).closest("form")!;
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const linkButton = (situation: string) =>
  screen.getByRole("button", { name: `Link to opportunity: when ${situation}` });
const openLinkMenu = (situation: string) =>
  fireEvent.keyDown(linkButton(situation), { key: "Enter" });

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ jobStories: [], stories: [], opportunityTrees: [] });
});

describe("Link to opportunity", () => {
  beforeEach(() => {
    setTree(NODES);
    useWorkspaceStore.setState({ jobStories: [job("j1", "a claim is late")] });
  });

  it("offers only opportunities, grouped under their outcome, and links the one picked", async () => {
    renderJtbd();
    openLinkMenu("a claim is late");

    const first = screen.getByRole("group", { name: "Outcome: Cut reimbursement time" });
    expect(
      within(first)
        .getAllByRole("menuitem")
        .map((m) => m.textContent)
    ).toEqual(["Payouts take too long", "Untitled opportunity"]);
    const second = screen.getByRole("group", { name: "Outcome: Fewer policy breaches" });
    expect(
      within(second)
        .getAllByRole("menuitem")
        .map((m) => m.textContent)
    ).toEqual(["Nobody knows the limits"]);
    // An opportunity under no outcome still shows, last.
    const loose = screen.getByRole("group", { name: NO_OUTCOME });
    expect(
      within(loose)
        .getAllByRole("menuitem")
        .map((m) => m.textContent)
    ).toEqual(["Receipts get lost"]);
    // Outcomes and solutions are not opportunities.
    expect(screen.queryByRole("menuitem", { name: "Same-day transfer" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Cut reimbursement time" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Payouts take too long" }));
    expect(jobById("j1")?.opportunityId).toBe("opp-fast");

    // The row now shows a chip that opens the tree, and focus lands on it.
    const chip = screen.getByRole("link", {
      name: "Opportunity: Payouts take too long (open in the Opportunity Tree)",
    });
    expect(chip).toHaveAttribute("href", "/opportunity-tree");
    expect(chip).toHaveAttribute(
      "title",
      "Payouts take too long (outcome: Cut reimbursement time)"
    );
    await waitFor(() => expect(chip).toHaveFocus());
    // The closing menu's own focus return (a timer) doesn't take it away again.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(chip).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Link to opportunity/ })).not.toBeInTheDocument();
  });

  it("shows the opportunity by today's wording when it is renamed in the tree", () => {
    useWorkspaceStore.setState({
      jobStories: [job("j1", "a claim is late", { opportunityId: "opp-rules" })],
    });
    renderJtbd();
    expect(screen.getByRole("link", { name: /Opportunity: Nobody knows the limits/ })).toBeTruthy();
    act(() =>
      setTree(NODES.map((n) => (n.id === "opp-rules" ? { ...n, text: "Limits are hidden" } : n)))
    );
    expect(screen.getByRole("link", { name: /Opportunity: Limits are hidden/ })).toBeTruthy();
  });

  it("unlinks with Undo, and focus returns to “Link to opportunity”", () => {
    useWorkspaceStore.setState({
      jobStories: [job("j1", "a claim is late", { opportunityId: "opp-fast" })],
    });
    renderJtbd();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlink the opportunity: when a claim is late" })
    );
    expect(jobById("j1")).toEqual(job("j1", "a claim is late"));
    expect(jobById("j1")).not.toHaveProperty("opportunityId");
    expect(lastToast()[0]).toBe("Unlinked the opportunity");
    expect(linkButton("a claim is late")).toHaveFocus();

    undoLast();
    expect(jobById("j1")?.opportunityId).toBe("opp-fast");
    expect(screen.getByRole("link", { name: /Opportunity: Payouts take too long/ })).toBeTruthy();
  });

  it("Undo of an unlink doesn't overwrite a link made since", () => {
    useWorkspaceStore.setState({
      jobStories: [job("j1", "a claim is late", { opportunityId: "opp-fast" })],
    });
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: /^Unlink the opportunity/ }));
    openLinkMenu("a claim is late");
    fireEvent.click(screen.getByRole("menuitem", { name: "Receipts get lost" }));
    undoLast();
    expect(jobById("j1")?.opportunityId).toBe("opp-loose");
  });

  it("a job whose node was deleted reads “Opportunity removed” and can be unlinked", () => {
    useWorkspaceStore.setState({
      jobStories: [job("j1", "a claim is late", { opportunityId: "opp-fast" })],
    });
    renderJtbd();
    // Deleted in the tree (another tab, an agent): the job keeps the id.
    act(() => setTree(NODES.filter((n) => n.id !== "opp-fast")));
    expect(screen.getByText("Opportunity removed")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Opportunity:/ })).not.toBeInTheDocument();
    expect(jobById("j1")?.opportunityId).toBe("opp-fast");

    fireEvent.click(
      screen.getByRole("button", { name: "Unlink the opportunity: when a claim is late" })
    );
    expect(jobById("j1")).not.toHaveProperty("opportunityId");
    expect(screen.queryByText("Opportunity removed")).not.toBeInTheDocument();
    expect(linkButton("a claim is late")).toBeInTheDocument();
  });
});

describe("An Opportunity Tree with no opportunities yet", () => {
  it.each([
    ["never started", () => useWorkspaceStore.setState({ opportunityTrees: [] })],
    ["only an outcome", () => setTree([node("o1", "outcome", "Cut reimbursement time")])],
  ])("the picker says so and links to the tree (%s)", (_label, arrange) => {
    arrange();
    useWorkspaceStore.setState({ jobStories: [job("j1", "a claim is late")] });
    renderJtbd();
    // The add form's picker offers only None, with a pointer to the tree in
    // its hint. It stays enabled (like "Under job"), so a keyboard user tabs
    // to it and hears why.
    const form = addForm();
    const select = within(form).getByLabelText(/^Opportunity/) as HTMLSelectElement;
    expect(select).toBeEnabled();
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["None"]);
    expect(select).toHaveAccessibleDescription(/^None yet: map them in the Opportunity Tree/);
    expect(within(form).getByRole("link", { name: "Opportunity Tree" })).toHaveAttribute(
      "href",
      "/opportunity-tree"
    );

    openLinkMenu("a claim is late");
    expect(screen.getByText(/No opportunities in the Opportunity Tree yet\./)).toBeInTheDocument();
    const open = screen.getByRole("menuitem", { name: "Open the Opportunity Tree" });
    expect(open).toHaveAttribute("href", "/opportunity-tree");
    // Focus lands on the item, so the reason is its description.
    expect(open).toHaveAccessibleDescription(
      /^No opportunities in the Opportunity Tree yet\. Map the outcome/
    );
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });
});

describe("The add form's opportunity", () => {
  const fillClauses = (form: HTMLElement) => {
    fireEvent.change(within(form).getByLabelText(/^When/), { target: { value: "I travel" } });
    fireEvent.change(within(form).getByLabelText(/^I want to/), {
      target: { value: "claim the taxi" },
    });
    fireEvent.change(within(form).getByLabelText(/^So I can/), {
      target: { value: "get paid back" },
    });
  };

  beforeEach(() => setTree(NODES));

  it("is optional: a job added without one has no link", () => {
    renderJtbd();
    const form = addForm();
    expect(within(form).getByLabelText(/^Opportunity/)).toHaveValue("");
    fillClauses(form);
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).not.toHaveProperty("opportunityId");
  });

  it("links the new job to the opportunity picked, grouped by outcome", () => {
    renderJtbd();
    const form = addForm();
    const select = within(form).getByLabelText(/^Opportunity/) as HTMLSelectElement;
    expect(Array.from(select.querySelectorAll("optgroup")).map((g) => g.label)).toEqual([
      "Outcome: Cut reimbursement time",
      "Outcome: Fewer policy breaches",
      NO_OUTCOME,
    ]);
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "",
      "opp-fast",
      "opp-blank",
      "opp-rules",
      "opp-loose",
    ]);
    fillClauses(form);
    fireEvent.change(select, { target: { value: "opp-rules" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()[0]).toMatchObject({ situation: "I travel", opportunityId: "opp-rules" });
    expect(screen.getByRole("link", { name: /Opportunity: Nobody knows the limits/ })).toBeTruthy();
    // The form starts again with no opportunity.
    expect(within(form).getByLabelText(/^Opportunity/)).toHaveValue("");
  });

  it("won't save a pick deleted from the tree while the form was open", () => {
    renderJtbd();
    const form = addForm();
    fillClauses(form);
    fireEvent.change(within(form).getByLabelText(/^Opportunity/), {
      target: { value: "opp-rules" },
    });
    act(() => setTree(NODES.filter((n) => n.id !== "opp-rules")));
    const select = within(form).getByLabelText(/^Opportunity/) as HTMLSelectElement;
    // The stale pick shows as removed, not as a "None" that isn't true.
    expect(select).toHaveDisplayValue("Opportunity removed");
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()).toEqual([]);
    expect(
      within(form).getByText("That opportunity was removed from the tree. Pick another, or none.")
    ).toBeInTheDocument();
    expect(select).toHaveFocus();

    // Picking another clears the error and saves that one.
    fireEvent.change(select, { target: { value: "opp-loose" } });
    expect(within(form).queryByText(/That opportunity was removed/)).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Opportunity removed" })).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ opportunityId: "opp-loose" });
  });

  it("recovers when every opportunity is deleted while the form is open", () => {
    renderJtbd();
    const form = addForm();
    fillClauses(form);
    const select = within(form).getByLabelText(/^Opportunity/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "opp-rules" } });
    // The whole tree is cleared in another tab.
    act(() => setTree(NODES.filter((n) => n.kind !== "opportunity")));

    // The select still holds the pick, so it can be focused and changed.
    expect(select).toBeEnabled();
    expect(select).toHaveDisplayValue("Opportunity removed");
    expect(Array.from(select.options).map((o) => [o.text, o.disabled])).toEqual([
      ["None", false],
      ["Opportunity removed", true],
    ]);
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()).toEqual([]);
    // There is no "another" to pick, so the message says what to do.
    expect(
      within(form).getByText(
        "That opportunity was removed from the tree. Choose None to add the job without one."
      )
    ).toBeInTheDocument();
    expect(select).toHaveFocus();

    fireEvent.change(select, { target: { value: "" } });
    expect(select).toHaveValue("");
    expect(select).toBeEnabled();
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["None"]);
    expect(within(form).queryByText(/That opportunity was removed/)).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ situation: "I travel" });
    expect(jobs()[0]).not.toHaveProperty("opportunityId");
  });

  it("shows a pick the tree put back (an undo there) as picked again", () => {
    renderJtbd();
    const form = addForm();
    const select = within(form).getByLabelText(/^Opportunity/) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "opp-rules" } });
    act(() => setTree(NODES.filter((n) => n.id !== "opp-rules")));
    expect(select).toHaveDisplayValue("Opportunity removed");
    act(() => setTree(NODES));
    expect(select).toHaveDisplayValue("Nobody knows the limits");
    expect(within(select).queryByRole("option", { name: "Opportunity removed" })).toBeNull();
  });
});

describe("Example jobs and opportunities", () => {
  it("example jobs never link, and the reason is on screen", () => {
    setTree(NODES);
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(buildExample().every((j) => !("opportunityId" in j))).toBe(true);
    const link = linkButton("I get back from a work trip");
    expect(link).toBeDisabled();
    const note = screen.getByText(/Example jobs can’t become backlog stories or link/);
    expect(link).toHaveAttribute("aria-describedby", note.id);
    expect(jobs().some((j) => j.opportunityId)).toBe(false);
  });

  it("a user's job is never offered an example node", () => {
    const groups = opportunityGroups([
      node("example-o", "outcome", "Example outcome"),
      node("example-opp", "opportunity", "Example need", "example-o"),
      node("mine", "opportunity", "My need", "example-o"),
    ]);
    expect(groups).toEqual([
      {
        outcomeId: "example-o",
        outcome: "Example outcome",
        options: [{ id: "mine", title: "My need" }],
      },
    ]);
  });
});

describe("Jobs saved before the opportunity link", () => {
  it("load, offer a link, and keep working", () => {
    setTree(NODES);
    // A legacy row: no opportunityId key at all.
    useWorkspaceStore.setState({
      jobStories: [{ id: "old", situation: "I pay", motivation: "split it", outcome: "save" }],
    });
    renderJtbd();
    expect(screen.getByText("I pay")).toBeInTheDocument();
    expect(linkButton("I pay")).toBeEnabled();
    expect(screen.queryByText("Opportunity removed")).not.toBeInTheDocument();
    expect(resolveOpportunity(jobs()[0], new Map())).toEqual({ state: "none" });
    // An empty id (hand-edited data) is no link either.
    expect(resolveOpportunity({ opportunityId: "" }, new Map())).toEqual({ state: "none" });
  });

  it("editing a linked job's clauses keeps its link", () => {
    setTree(NODES);
    useWorkspaceStore.setState({
      jobStories: [job("j1", "a claim is late", { opportunityId: "opp-fast" })],
    });
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Edit job story: when a claim is late" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    // The editor has no opportunity picker: the row owns the link.
    expect(within(editor).queryByLabelText(/^Opportunity/)).not.toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText(/^So I can/), {
      target: { value: "plan my month" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(jobById("j1")).toMatchObject({ outcome: "plan my month", opportunityId: "opp-fast" });
    expect(jobDraftFrom(jobById("j1")!)).not.toHaveProperty("opportunityId");
  });

  it("a draft with no opportunity key validates as before", () => {
    const legacyDraft = {
      situation: "s",
      motivation: "m",
      outcome: "o",
      description: "",
      parentJobId: "",
    };
    expect(validateJob(legacyDraft, { jobs: [] })).toEqual({
      ok: true,
      values: { situation: "s", motivation: "m", outcome: "o" },
    });
    // Without a list to check against (the editor), a pick passes through.
    expect(validateJob({ ...legacyDraft, opportunityId: "x" }, { jobs: [] })).toMatchObject({
      ok: true,
      values: { opportunityId: "x" },
    });
    expect(
      validateJob(
        { ...EMPTY_JOB_DRAFT, situation: "s", motivation: "m", outcome: "o", opportunityId: "x" },
        { jobs: [], opportunityIds: new Set(["y"]) }
      )
    ).toMatchObject({ ok: false, errors: { opportunityId: expect.any(String) } });
  });
});

describe("Markdown export", () => {
  it("names each job's opportunity and its outcome, or that it was removed", () => {
    const md = toMarkdown(
      [
        job("a", "a claim is late", { opportunityId: "opp-fast" }),
        job("b", "a receipt fades", { opportunityId: "opp-loose", description: "thermal paper" }),
        job("c", "I check the limit", { opportunityId: "deleted" }),
        job("d", "I travel"),
      ],
      [],
      new Date("2026-10-23T12:00:00Z"),
      NODES
    );
    expect(md).toContain(
      "- When a claim is late, I want to m, so I can o. _(opportunity: Payouts take too long; outcome: Cut reimbursement time)_"
    );
    expect(md).toContain(
      "- When a receipt fades, I want to m, so I can o. _(opportunity: Receipts get lost)_\n  thermal paper"
    );
    expect(md).toContain(
      "- When I check the limit, I want to m, so I can o. _(opportunity removed from the tree)_"
    );
    // A job without a link (or an export with no tree passed) has no tag.
    expect(md).toContain("- When I travel, I want to m, so I can o.\n");
    expect(toMarkdown([job("d", "I travel")], [])).not.toContain("opportunity");
  });

  it("puts the story tag first when a job has both", () => {
    const md = toMarkdown(
      [job("a", "a claim is late", { opportunityId: "opp-rules" })],
      [{ id: "s", title: "t", status: "done", sourceRef: { tool: "jtbd-mapper", id: "a" } }],
      new Date("2026-10-23T12:00:00Z"),
      NODES
    );
    expect(md).toContain(
      "o. _(story done)_ _(opportunity: Nobody knows the limits; outcome: Fewer policy breaches)_"
    );
  });
});

describe("Opportunity helpers", () => {
  it("reads only the tree's singleton document", () => {
    expect(treeNodes(undefined)).toEqual([]);
    expect(treeNodes([{ id: "other", nodes: NODES }])).toEqual([]);
    expect(treeNodes([{ id: OPPORTUNITY_TREE_ID, nodes: NODES }])).toBe(NODES);
  });

  it("finds the outcome past nested opportunities, and stops on cycles", () => {
    const nested = [
      node("o", "outcome", "Grow"),
      node("p", "opportunity", "Broad need", "o"),
      node("q", "opportunity", "Narrow need", "p"),
      node("x", "opportunity", "Loop A", "y"),
      node("y", "opportunity", "Loop B", "x"),
    ];
    const byId = new Map(nested.map((n) => [n.id, n]));
    expect(outcomeOf(nested[2], byId)?.id).toBe("o");
    expect(outcomeOf(nested[3], byId)).toBeUndefined();
    expect(opportunityGroups(nested).map((g) => g.outcome)).toEqual(["Grow", NO_OUTCOME]);
    expect(Array.from(opportunityIds(opportunityGroups(nested)))).toEqual(["p", "q", "x", "y"]);
  });

  it("names untitled nodes and folds whitespace", () => {
    expect(nodeTitle({ kind: "opportunity", text: "  " })).toBe("Untitled opportunity");
    expect(nodeTitle({ kind: "outcome", text: "" })).toBe("Untitled outcome");
    expect(nodeTitle({ kind: "opportunity", text: " Slow\n payouts " })).toBe("Slow payouts");
  });

  it("resolves a link to linked or missing, and drops it without an empty key", () => {
    const byId = new Map(NODES.map((n) => [n.id, n]));
    expect(resolveOpportunity({ opportunityId: "opp-loose" }, byId)).toEqual({
      state: "linked",
      id: "opp-loose",
      title: "Receipts get lost",
    });
    expect(resolveOpportunity({ opportunityId: "gone" }, byId)).toEqual({
      state: "missing",
      id: "gone",
    });
    expect(withoutOpportunity(job("a", "s", { opportunityId: "x" }))).toEqual(job("a", "s"));
  });

  it("has no opportunities to offer from an empty tree", () => {
    expect(opportunityGroups([])).toEqual([]);
    expect(opportunityGroups([node("o", "outcome", "Grow")])).toEqual([]);
  });
});
