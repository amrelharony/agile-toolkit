import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { JobStory, Story } from "@/lib/stores/workspace-types";

/**
 * Job Story Mapper against the tool UX contract: a job needs all three
 * clauses, edits happen in place, removing a job says what happens to its
 * sub-jobs (with Undo), a job becomes a backlog story that links back, the
 * vanity KPI cards gave way to one summary line, and there is an example
 * and a Markdown export.
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
import { jtbdSummary } from "@/app/(tools)/jtbd-mapper/verdict";
import {
  CLAUSE_MAX,
  EMPTY_JOB_DRAFT,
  cleanClause,
  validateJob,
} from "@/app/(tools)/jtbd-mapper/job-form";
import {
  descendantIds,
  isCompleteJob,
  jobTree,
  jobsInTreeOrder,
  storiesByJob,
  storyTitleFor,
  wouldCycle,
} from "@/app/(tools)/jtbd-mapper/jobs";
import { STORY_TITLE_MAX } from "@/lib/handoffs/targets/backlog-story";

const job = (id: string, situation: string, parentJobId?: string): JobStory => ({
  id,
  situation,
  motivation: "m",
  outcome: "o",
  ...(parentJobId ? { parentJobId } : {}),
});
const story = (id: string, jobId: string, status: Story["status"] = "backlog"): Story => ({
  id,
  title: `Story ${id}`,
  status,
  sourceRef: { tool: "jtbd-mapper", id: jobId },
});

const jobs = () => useWorkspaceStore.getState().jobStories ?? [];
const stories = () => useWorkspaceStore.getState().stories;
const renderJtbd = () =>
  render(
    <TooltipProvider>
      <JtbdMapperClient />
    </TooltipProvider>
  );
const addForm = () => screen.getByRole("button", { name: "Add job story" }).closest("form")!;
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ jobStories: [], stories: [] });
});

describe("Job Story Mapper first run", () => {
  it("loads the example from the empty state and clears only the example's jobs", () => {
    renderJtbd();
    expect(screen.getByText(/No job stories yet\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(jobs()).toHaveLength(5);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText("5 job stories, 2 at the top level; none has a story yet.")
    ).toBeInTheDocument();
    // No KPI cards any more.
    expect(screen.queryByText("Max depth")).not.toBeInTheDocument();
    expect(screen.queryByText("Without children")).not.toBeInTheDocument();

    // A job of the user's filed under an example job survives the clear, at the top level.
    act(() =>
      useWorkspaceStore.setState({
        jobStories: [...jobs(), job("mine", "I file my own", "example-job-travel")],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(jobs()).toEqual([job("mine", "I file my own")]);
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
  });

  it("won't make backlog stories from example jobs", () => {
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const create = screen.getByRole("button", {
      name: "Create story: when I get back from a work trip",
    });
    expect(create).toBeDisabled();
    // The reason is on screen, not in a tooltip a disabled button never shows.
    const note = screen.getByText(/Example jobs can’t become backlog stories or link/);
    expect(create).toHaveAttribute("aria-describedby", note.id);
    expect(create).not.toHaveAttribute("title");
    expect(stories()).toEqual([]);
  });
});

describe("Job Story Mapper add form", () => {
  it("saves nothing until all three clauses are filled, and shows why inline", () => {
    renderJtbd();
    const form = addForm();
    fireEvent.change(within(form).getByLabelText(/^When/), { target: { value: "I travel" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()).toEqual([]);
    expect(within(form).getByText("Say what they want to do.")).toBeInTheDocument();
    expect(within(form).getByText("Say what it lets them do.")).toBeInTheDocument();
    // The first missing clause gets focus.
    expect(within(form).getByLabelText(/^I want to/)).toHaveFocus();

    fireEvent.change(within(form).getByLabelText(/^I want to/), {
      target: { value: "I want to claim the taxi." },
    });
    fireEvent.change(within(form).getByLabelText(/^So I can/), {
      target: { value: "so that I can get paid back" },
    });
    expect(within(form).getByText(/When I travel, I want to claim the taxi/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Add job story" }));
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({
      situation: "I travel",
      motivation: "claim the taxi",
      outcome: "get paid back",
    });
    expect(jobs()[0]).not.toHaveProperty("parentJobId");
    expect(jobs()[0]).not.toHaveProperty("description");
    // The form starts again, empty.
    expect(within(form).getByLabelText(/^When/)).toHaveValue("");
  });

  it("“Add a job under” points the add form at that job", () => {
    useWorkspaceStore.setState({ jobStories: [job("a", "onboarding")] });
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Add a job under: when onboarding" }));
    const form = addForm();
    expect(within(form).getByLabelText(/^Under job/)).toHaveValue("a");
    expect(within(form).getByLabelText(/^When/)).toHaveFocus();
  });
});

describe("Job Story Mapper editing", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      jobStories: [job("a", "onboarding"), job("b", "first login", "a"), job("c", "invoicing")],
    })
  );

  it("edits in place, and the parent picker leaves out the job and its sub-jobs", () => {
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Edit job story: when onboarding" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    expect(within(editor).getByLabelText(/^When/)).toHaveFocus();
    const parent = within(editor).getByLabelText(/^Under job/) as HTMLSelectElement;
    expect(Array.from(parent.options).map((o) => o.value)).toEqual(["", "c"]);

    fireEvent.change(within(editor).getByLabelText(/^So I can/), {
      target: { value: "start a trial" },
    });
    fireEvent.change(parent, { target: { value: "c" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(jobs().find((j) => j.id === "a")).toMatchObject({
      outcome: "start a trial",
      parentJobId: "c",
    });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("won't save an edit that empties a clause, and Escape cancels", () => {
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Edit job story: when invoicing" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    const want = within(editor).getByLabelText(/^I want to/);
    fireEvent.change(want, { target: { value: "  " } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(within(editor).getByText("Say what they want to do.")).toBeInTheDocument();
    expect(jobs().find((j) => j.id === "c")?.motivation).toBe("m");

    fireEvent.keyDown(want, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(jobs().find((j) => j.id === "c")?.motivation).toBe("m");
  });

  it("a legacy job with a blank clause shows the gap and must be completed to save", () => {
    useWorkspaceStore.setState({
      jobStories: [{ id: "old", situation: "I pay", motivation: "", outcome: "" }],
    });
    renderJtbd();
    expect(screen.getByText("(motivation)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit job story: when I pay" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Say what it lets them do.")).toBeInTheDocument();
    expect(jobs()[0]).toEqual({ id: "old", situation: "I pay", motivation: "", outcome: "" });
  });
});

describe("Job Story Mapper removing a job with sub-jobs", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      jobStories: [
        job("top", "travelling"),
        job("mid", "booking", "top"),
        job("leaf", "paying", "mid"),
        job("other", "approving"),
      ],
    })
  );

  it("can keep the sub-jobs, moving them up a level, and Undo puts everything back", () => {
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Remove job story: when booking" }));
    const dialog = screen.getByRole("dialog");
    // Cancel has focus, so Enter never removes anything.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep nested, remove this one" }));

    expect(jobs().map((j) => j.id)).toEqual(["top", "leaf", "other"]);
    expect(jobs().find((j) => j.id === "leaf")?.parentJobId).toBe("top");
    expect(lastToast()[0]).toBe("Removed a job story; 1 nested story moved up a level");

    undoLast();
    expect(jobs()).toEqual([
      job("top", "travelling"),
      job("mid", "booking", "top"),
      job("leaf", "paying", "mid"),
      job("other", "approving"),
    ]);
  });

  it("a top-level job's kept sub-jobs become top-level", () => {
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Remove job story: when travelling" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep nested, remove this one" }));
    expect(jobs().find((j) => j.id === "mid")).not.toHaveProperty("parentJobId");
    expect(jobs().find((j) => j.id === "leaf")?.parentJobId).toBe("mid");
  });
});

describe("Job Story Mapper → backlog story", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      jobStories: [
        {
          id: "j1",
          situation: "a customer asks where their order is",
          motivation: "see the parcel's latest scan",
          outcome: "give a delivery date in my first reply",
        },
      ],
    })
  );

  it("creates a backlog story titled from the job that links back, with Undo", () => {
    renderJtbd();
    expect(screen.getByText(/1 job story; none has a story yet\./)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create story: when a customer asks where their order is",
      })
    );
    expect(stories()).toHaveLength(1);
    expect(stories()[0]).toMatchObject({
      status: "backlog",
      title:
        "When a customer asks where their order is, I want to see the parcel's latest scan, so I can give a delivery date in my first reply.",
      sourceRef: { tool: "jtbd-mapper", id: "j1" },
    });
    expect(lastToast()[0]).toBe("Added to the backlog");
    // The row now links to the story instead of offering another.
    expect(screen.getByRole("link", { name: /Story on the backlog/ })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );
    expect(screen.queryByRole("button", { name: /^Create story/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 job story; it has a story.")).toBeInTheDocument();

    undoLast();
    expect(stories()).toEqual([]);
    expect(screen.getByRole("button", { name: /^Create story/ })).toBeInTheDocument();
  });

  it("a legacy job with a blank clause can't make a story; it offers to be completed", () => {
    useWorkspaceStore.setState({
      jobStories: [{ id: "old", situation: "I pay", motivation: "", outcome: "  " }],
    });
    renderJtbd();
    expect(screen.queryByRole("button", { name: /^Create story/ })).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Complete the job to make a story: when I pay" })
    );
    // It opens the editor on the job, and nothing reached the backlog.
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    expect(within(editor).getByLabelText(/^When/)).toHaveFocus();
    expect(stories()).toEqual([]);

    fireEvent.change(within(editor).getByLabelText(/^I want to/), {
      target: { value: "split the bill" },
    });
    fireEvent.change(within(editor).getByLabelText(/^So I can/), {
      target: { value: "get paid back" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Create story: when I pay" }));
    expect(stories()[0].title).toBe(
      "When I pay, I want to split the bill, so I can get paid back."
    );
  });

  it("isCompleteJob needs every clause, blanks and whitespace counting as missing", () => {
    expect(isCompleteJob({ situation: "s", motivation: "m", outcome: "o" })).toBe(true);
    expect(isCompleteJob({ situation: "s", motivation: " ", outcome: "o" })).toBe(false);
    expect(isCompleteJob({ situation: "s", motivation: "m", outcome: "" })).toBe(false);
    // Hand-edited stored data may lack a clause altogether.
    expect(isCompleteJob({ situation: "s", motivation: "m" } as JobStory)).toBe(false);
  });

  it("a story deleted in Sprint Planning frees the job to make a new one", () => {
    useWorkspaceStore.setState({ stories: [story("s1", "j1", "in_progress")] });
    renderJtbd();
    expect(screen.getByRole("link", { name: /Story in progress/ })).toBeInTheDocument();
    act(() => useWorkspaceStore.setState({ stories: [] }));
    expect(screen.getByRole("button", { name: /^Create story/ })).toBeInTheDocument();
  });
});

describe("Job Story Mapper logic", () => {
  it("validates every clause and drops typed lead-ins", () => {
    const empty = validateJob(EMPTY_JOB_DRAFT, { jobs: [] });
    expect(empty).toEqual({
      ok: false,
      errors: {
        situation: "Describe the situation: when does this job come up?",
        motivation: "Say what they want to do.",
        outcome: "Say what it lets them do.",
      },
    });
    expect(cleanClause("situation", "When, I travel. ")).toBe("I travel");
    expect(cleanClause("situation", "Whenever I travel")).toBe("Whenever I travel");
    expect(cleanClause("motivation", "I need to file it;")).toBe("file it");
    expect(cleanClause("outcome", "So I can rest...")).toBe("rest");

    const long = "x".repeat(CLAUSE_MAX + 1);
    const tooLong = validateJob(
      {
        ...EMPTY_JOB_DRAFT,
        situation: long,
        motivation: "m",
        outcome: "o",
        description: "y".repeat(4001),
      },
      { jobs: [] }
    );
    expect(tooLong).toEqual({
      ok: false,
      errors: {
        situation: `Keep it to ${CLAUSE_MAX} characters (now ${CLAUSE_MAX + 1}).`,
        description: "Keep the notes to 4,000 characters.",
      },
    });
  });

  it("checks the parent: it must exist, and an edit can't create a cycle", () => {
    const all = [job("a", "a"), job("b", "b", "a"), job("c", "c")];
    const draft = { ...EMPTY_JOB_DRAFT, situation: "s", motivation: "m", outcome: "o" };
    expect(validateJob({ ...draft, parentJobId: "gone" }, { jobs: all })).toMatchObject({
      ok: false,
      errors: { parentJobId: "That job was removed. Pick another, or none." },
    });
    expect(
      validateJob({ ...draft, parentJobId: "b" }, { jobs: all, editingId: "a" })
    ).toMatchObject({
      ok: false,
      errors: { parentJobId: "A job can’t sit under itself or one of its own sub-jobs." },
    });
    expect(validateJob({ ...draft, parentJobId: "c" }, { jobs: all, editingId: "a" })).toEqual({
      ok: true,
      values: { situation: "s", motivation: "m", outcome: "o", parentJobId: "c" },
    });
    expect(wouldCycle(all, "a", "a")).toBe(true);
    expect(wouldCycle(all, "b", "a")).toBe(false);
    expect(Array.from(descendantIds(all, "a"))).toEqual(["b"]);
  });

  it("shows every job once, even orphans and hand-edited cycles", () => {
    const tree = jobTree([
      job("orphan", "o", "deleted"),
      job("x", "x", "y"),
      job("y", "y", "x"),
      job("self", "s", "self"),
      job("root", "r"),
      job("kid", "k", "root"),
    ]);
    expect(tree.roots.map((j) => j.id)).toEqual(["orphan", "self", "root", "x"]);
    expect(tree.children.get("x")?.map((j) => j.id)).toEqual(["y"]);
    expect(tree.children.get("y")).toEqual([]);
    const order = jobsInTreeOrder([job("x", "x", "y"), job("y", "y", "x"), job("z", "z", "y")]);
    expect(order.map(({ job: j, depth }) => `${j.id}:${depth}`)).toEqual(["x:0", "y:1", "z:2"]);
    expect(jobTree([])).toEqual({ roots: [], children: new Map() });
  });

  it("renders orphaned jobs instead of hiding them", () => {
    useWorkspaceStore.setState({ jobStories: [job("lost", "my parent was deleted", "gone")] });
    renderJtbd();
    expect(screen.getByText("my parent was deleted")).toBeInTheDocument();
  });

  it("titles a story from the job, falling back to the motivation when it's too long", () => {
    expect(storyTitleFor({ situation: "s", motivation: "m", outcome: "o" })).toBe(
      "When s, I want to m, so I can o."
    );
    const wordy = { situation: "w ".repeat(120), motivation: "export the report", outcome: "o" };
    expect(storyTitleFor(wordy)).toBe("Export the report");
    const huge = storyTitleFor({ situation: "a", motivation: "word ".repeat(100), outcome: "o" });
    expect(huge.length).toBeLessThanOrEqual(STORY_TITLE_MAX);
    expect(huge.endsWith("…")).toBe(true);
  });

  it("reads each job's story off the stories' sourceRef", () => {
    const map = storiesByJob([
      story("s1", "j1"),
      story("s2", "j1"),
      { id: "s3", title: "t", status: "todo", sourceRef: { tool: "retro", id: "j2" } },
    ]);
    expect(Array.from(map.keys())).toEqual(["j1"]);
    expect(map.get("j1")?.id).toBe("s1");
  });

  it("summarises the map in one line", () => {
    expect(jtbdSummary([], [])).toBe("No job stories yet.");
    const all = [job("a", "a"), job("b", "b", "a"), job("c", "c")];
    // The total includes the top-level jobs, and says so.
    expect(jtbdSummary(all, [])).toBe("3 job stories, 2 at the top level; none has a story yet.");
    expect(jtbdSummary(all, [story("s", "b")])).toBe(
      "3 job stories, 2 at the top level; 1 has a story."
    );
    expect(jtbdSummary([job("a", "a"), job("c", "c")], [story("s", "a"), story("t", "c")])).toBe(
      "2 job stories; all have stories."
    );
  });

  it("counts a job's story wherever it now is, not as “on the backlog”", () => {
    const two = [job("a", "a"), job("c", "c")];
    expect(jtbdSummary(two, [story("s", "a", "done"), story("t", "c", "in_progress")])).toBe(
      "2 job stories; all have stories (1 done)."
    );
    expect(jtbdSummary(two, [story("s", "a", "done"), story("t", "c", "done")])).toBe(
      "2 job stories; all have stories (all done)."
    );
    expect(jtbdSummary(two, [story("s", "a", "done")])).toBe(
      "2 job stories; 1 has a story (done)."
    );
    expect(jtbdSummary([job("a", "a")], [story("s", "a", "review")])).toBe(
      "1 job story; it has a story."
    );
    // A story from another tool, or for a job that's gone, counts for nothing.
    expect(
      jtbdSummary(two, [
        { id: "x", title: "x", status: "done", sourceRef: { tool: "retro", id: "a" } },
        story("y", "gone", "done"),
      ])
    ).toBe("2 job stories; none has a story yet.");
  });

  it("exports a nested Markdown list with each job's story and notes", () => {
    const example = buildExample();
    const md = toMarkdown(
      [...example, { ...job("n", "noted"), description: "line one\nline two" }],
      [story("s", "example-job-receipt", "done")],
      new Date("2026-10-23T12:00:00Z")
    );
    expect(md).toContain("# Job stories — 23 Oct 2026");
    expect(md).toContain(
      "- When I get back from a work trip, I want to get my expenses paid back without chasing anyone, so I can keep my own money separate from the company’s costs."
    );
    expect(md).toContain(
      "  - When I pay for something on the road, I want to capture the receipt in a few seconds, so I can stop losing paper receipts before I claim. _(story done)_"
    );
    expect(md).toContain("  line one line two");
    expect(md).toContain("**6 job stories, 3 at the top level; 1 has a story (done).**");
    expect(
      jtbdSummary([job("a", "a"), job("b", "b"), job("c", "c")], [story("s", "a"), story("t", "b")])
    ).toBe("3 job stories; 2 have stories.");
    expect(toMarkdown([], [])).toContain("No job stories yet.");
  });
});

describe("Job Story Mapper keyboard focus", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      jobStories: [
        { ...job("a", "onboarding"), motivation: "set up", outcome: "start" },
        job("b", "first login", "a"),
        job("c", "invoicing"),
      ],
    })
  );
  const editButton = (situation: string) =>
    screen.getByRole("button", { name: `Edit job story: when ${situation}` });

  it("returns to the row's Edit button after Save or Cancel", () => {
    renderJtbd();
    fireEvent.click(editButton("invoicing"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(editButton("invoicing")).toHaveFocus();

    fireEvent.click(editButton("onboarding"));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.keyDown(within(editor).getByLabelText(/^I want to/), { key: "Escape" });
    expect(editButton("onboarding")).toHaveFocus();
  });

  it("lands on the new story link after Create story", () => {
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Create story: when invoicing" }));
    expect(screen.getByRole("link", { name: /Story on the backlog/ })).toHaveFocus();
  });

  it("moves to the next row after a remove, else the previous, else the add form", () => {
    renderJtbd();
    // A job with a sub-job, all removed: the next row standing is "invoicing".
    fireEvent.click(screen.getByRole("button", { name: "Remove job story: when onboarding" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove 2 job stories" }));
    expect(editButton("invoicing")).toHaveFocus();

    act(() => useWorkspaceStore.setState({ jobStories: [job("x", "first"), job("y", "last")] }));
    fireEvent.click(screen.getByRole("button", { name: "Remove job story: when last" }));
    expect(editButton("first")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Remove job story: when first" }));
    expect(within(addForm()).getByLabelText(/^When/)).toHaveFocus();
  });

  it("keeps a removed job's sub-jobs in reach: focus goes to the first of them", () => {
    renderJtbd();
    fireEvent.click(screen.getByRole("button", { name: "Remove job story: when onboarding" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep nested, remove this one" }));
    expect(editButton("first login")).toHaveFocus();
  });

  it("lets a nested row's actions wrap on a narrow screen", () => {
    renderJtbd();
    const actions = editButton("first login").parentElement!;
    expect(actions).toHaveClass("min-w-0", "flex-wrap");
    expect(actions).not.toHaveClass("shrink-0");
  });
});
