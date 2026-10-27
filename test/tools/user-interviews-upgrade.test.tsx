import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Interview, InterviewQuote, TreeNode } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { todayLocalISO } from "@/lib/utils/formatters";
import { isExampleId } from "@/lib/utils/example-id";
import { UI_ID, participantCount, themeCounts } from "@/lib/interviews/model";
import { OPPORTUNITY_TREE_ID } from "@/lib/opportunity-tree/model";
import { registry } from "@/lib/actions/registry";
import { INTERVIEWS, OPPORTUNITIES } from "../stores/phase8-fixtures";

/**
 * User Interviews, upgraded (Phase 8): draft-then-save for interviews and
 * quotes; themes counted per participant with a tag filter that shows the
 * quotes behind a theme; anonymising that numbers the participants and
 * redacts context and quotes in that view, every export and the AI
 * prompt; a quote raised as an opportunity under a picked outcome; delete
 * with Undo; an example, a verdict and a Markdown export, with the agent
 * counting the same participants.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { prompt: string }[] } }) => (
    <pre data-testid="ai-prompt">{config.prompts.map((p) => p.prompt).join("\n")}</pre>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    markdown,
    csvData,
    jsonData,
  }: {
    markdown?: string;
    csvData?: unknown;
    jsonData?: unknown;
  }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <pre data-testid="export-csv">{JSON.stringify(csvData)}</pre>
      <pre data-testid="export-json">{JSON.stringify(jsonData)}</pre>
    </>
  ),
}));

import { UserInterviewsClient } from "@/app/(tools)/user-interviews/user-interviews-client";
import { buildExample } from "@/app/(tools)/user-interviews/example";
import { interviewsToMarkdown } from "@/app/(tools)/user-interviews/markdown";
import {
  emptyInterviewDraft,
  parseTags,
  validateInterview,
  validateQuote,
} from "@/app/(tools)/user-interviews/form";
import {
  anonymisedById,
  forExport,
  interviewsVerdict,
  parentGroups,
} from "@/app/(tools)/user-interviews/view";
import "@/lib/actions/tools/user-interviews";

const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n) as string;

const quote = (id: string, text: string, tags: string[] = []): InterviewQuote => ({
  id,
  text,
  tags,
});
const interview = (id: string, participant: string, over: Partial<Interview> = {}): Interview => ({
  id,
  participant,
  date: ago(5),
  quotes: [],
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = () => (ws().userInterviewLogs ?? []).find((d) => d.id === UI_ID)?.interviews ?? [];
const one = (id: string) => stored().find((i) => i.id === id);
const nodes = () =>
  (ws().opportunityTrees ?? []).find((d) => d.id === OPPORTUNITY_TREE_ID)?.nodes ?? [];
const seed = (list: Interview[], tree: TreeNode[] = []) =>
  useWorkspaceStore.setState({
    userInterviewLogs: list.length > 0 ? [{ id: UI_ID, interviews: list }] : [],
    opportunityTrees: tree.length > 0 ? [{ id: OPPORTUNITY_TREE_ID, nodes: tree }] : [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <UserInterviewsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const openInterview = (participant: string) =>
  fireEvent.click(
    within(screen.getByRole("list", { name: "Interviews, newest first" })).getByRole("button", {
      name: new RegExp(participant),
    })
  );
const pane = () => screen.getByRole("region", { name: /^Interview with/ });
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.user_interviews.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  toastSpy.mockReset();
  seed([]);
});

/* ── The checks and the counts ──────────────────────────────────────── */

describe("the forms' checks", () => {
  it("needs who it was with and a day that has happened", () => {
    expect(validateInterview(emptyInterviewDraft(TODAY), TODAY)).toMatchObject({
      ok: false,
      errors: { participant: expect.stringMatching(/pseudonym/) },
    });
    expect(
      validateInterview({ participant: "Dana", date: addDays(TODAY, 1)!, context: "" }, TODAY)
    ).toMatchObject({ ok: false, errors: { date: expect.stringMatching(/hasn't happened/) } });
    expect(
      validateInterview({ participant: " Dana ", date: ago(30), context: "  " }, TODAY)
    ).toEqual({ ok: true, values: { participant: "Dana", date: ago(30), context: undefined } });
  });

  it("keeps a saved day an agent stamped for the user's tomorrow", () => {
    const saved = interview("i", "Dana", { date: addDays(TODAY, 1)! });
    expect(
      validateInterview(
        { participant: "Dana B", date: addDays(TODAY, 1)!, context: "" },
        TODAY,
        saved
      ).ok
    ).toBe(true);
  });

  it("needs a quote's words and tidies its tags", () => {
    expect(validateQuote({ text: "  ", tags: "x" }).ok).toBe(false);
    expect(parseTags(" Pricing, UX ,pricing,, ")).toEqual(["pricing", "ux"]);
    expect(validateQuote({ text: " hi ", tags: "A, a" })).toEqual({
      ok: true,
      values: { text: "hi", tags: ["a"] },
    });
  });
});

describe("themes per participant", () => {
  const list = [
    interview("a", "Dana", {
      quotes: [quote("q1", "one", ["Pricing"]), quote("q2", "two", ["pricing", "ux"])],
    }),
    interview("b", "dana ", { quotes: [quote("q3", "three", ["pricing"])] }),
    interview("c", "", { quotes: [quote("q4", "four", ["ux"])] }),
    interview("d", "", { quotes: [quote("q5", "five", ["ux"])] }),
  ];

  it("counts a person once, however many quotes, and unnamed sessions apart", () => {
    expect(themeCounts(list)).toEqual([
      { tag: "ux", participants: 3, quotes: 3 },
      { tag: "pricing", participants: 1, quotes: 3 },
    ]);
    expect(participantCount(list)).toBe(3);
    expect(interviewsVerdict(list)).toBe(
      "“ux” is the strongest theme: 3 of 3 participants raised it (3 quotes)."
    );
  });

  it("calls a theme from fewer than three people a hunch", () => {
    expect(interviewsVerdict([list[0]])).toMatch(/treat it as a hunch\.$/);
    expect(interviewsVerdict([])).toBe("No interviews yet.");
    expect(interviewsVerdict([interview("x", "X")])).toBe(
      "1 interview with 1 participant; tag quotes to see the themes."
    );
  });

  it("shows the badge counts and filters to the quotes behind a theme", () => {
    seed(list);
    renderPage();
    const badge = screen.getByRole("button", { name: /^ux · 3 of 3 people/ });
    expect(badge).toHaveAttribute("aria-pressed", "false");
    expect(badge).toHaveAccessibleName("ux · 3 of 3 people (3 quotes)");
    fireEvent.click(screen.getByRole("button", { name: /^pricing/ }));
    const tagged = screen.getByRole("region", { name: "Quotes tagged pricing" });
    expect(within(tagged).getAllByRole("listitem")).toHaveLength(3);
    // Anonymised by default: the quotes read with a pseudonym.
    expect(within(tagged).queryByText(/Dana/)).toBeNull();
    expect(within(tagged).getAllByText(/^Participant \d/).length).toBeGreaterThan(0);
    // The interview list follows the filter.
    expect(screen.getByText("2 interviews with “pricing”")).toBeInTheDocument();
    fireEvent.click(within(tagged).getByRole("button", { name: "Clear filter" }));
    expect(screen.queryByRole("region", { name: "Quotes tagged pricing" })).toBeNull();
  });

  it("the agent counts the same participants and themes", async () => {
    seed(list);
    const agent = await run<{ participants: number; themes: unknown }>("list_state");
    expect(agent.participants).toBe(participantCount(stored()));
    expect(agent.themes).toEqual(themeCounts(stored()));
  });
});

describe("anonymising", () => {
  const list = [
    interview("a", "Dana Lee", {
      date: ago(1),
      context: "Dana runs ops; mail dana@acme.com",
      quotes: [quote("q1", "Dana said call 555-123-4567", ["ops"])],
    }),
    interview("b", "Sam", { date: ago(9), quotes: [quote("q2", "Fine", ["ops"])] }),
  ];

  it("numbers people by their first interview and redacts context and quotes", () => {
    const anon = anonymisedById(list);
    expect(anon.get("b")?.participant).toBe("Participant 1");
    expect(anon.get("a")?.participant).toBe("Participant 2");
    expect(anon.get("a")?.context).not.toMatch(/Dana|dana@acme\.com/);
    expect(anon.get("a")?.quotes[0].text).not.toMatch(/Dana|555-123-4567/);
    expect(forExport(list, false)).toEqual(list);
  });

  it("covers the CSV, the JSON, the Markdown and the AI prompt, and follows the toggle", () => {
    seed(list);
    renderPage();
    for (const id of ["export-csv", "export-json", "export-markdown", "ai-prompt"]) {
      expect(screen.getByTestId(id).textContent, id).not.toMatch(
        /Dana|dana@acme\.com|555-123-4567/
      );
    }
    expect(screen.getByTestId("export-csv").textContent).toContain("Participant 2");
    expect(screen.getByTestId("export-csv").textContent).toContain("Context");
    fireEvent.click(screen.getByRole("checkbox", { name: "Anonymise" }));
    expect(screen.getByTestId("export-csv").textContent).toContain("Dana Lee");
    expect(screen.getByTestId("ai-prompt").textContent).toContain("Dana Lee");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("interviews and quotes", () => {
  it("saves no blank interview, then adds one first and opens it", () => {
    seed([interview("old", "Old one", { date: ago(30) })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New interview" }));
    fireEvent.click(screen.getByRole("button", { name: "Add interview" }));
    expect(stored()).toHaveLength(1);
    expect(screen.getByText(/a pseudonym like “Customer 3” is fine/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Participant/), { target: { value: "Customer 3" } });
    fireEvent.change(screen.getByLabelText(/^Interviewed on/), { target: { value: ago(2) } });
    fireEvent.click(screen.getByRole("button", { name: "Add interview" }));
    expect(stored()[0]).toMatchObject({ participant: "Customer 3", date: ago(2), quotes: [] });
    expect(pane()).toHaveAccessibleName("Interview with Customer 3");
  });

  it("refuses a blank quote, adds one with tags, and edits it in place", () => {
    seed([interview("i", "Dana")]);
    renderPage();
    openInterview("Dana");
    fireEvent.click(within(pane()).getByRole("button", { name: "Add quote" }));
    expect(one("i")?.quotes).toHaveLength(0);
    expect(within(pane()).getByText("Type what they said.")).toBeInTheDocument();
    const text = within(pane()).getByLabelText(/^New quote from Dana/);
    fireEvent.change(text, { target: { value: "It takes ages" } });
    fireEvent.change(within(pane()).getByLabelText(/^Tags/), { target: { value: "Speed, speed" } });
    fireEvent.keyDown(text, { key: "Enter" });
    expect(one("i")?.quotes).toEqual([
      expect.objectContaining({ text: "It takes ages", tags: ["speed"] }),
    ]);

    fireEvent.click(within(pane()).getByRole("button", { name: "Edit quote 1" }));
    const edit = within(pane()).getByLabelText(/^Quote 1/);
    fireEvent.change(edit, { target: { value: "" } });
    fireEvent.click(within(pane()).getByRole("button", { name: "Save quote" }));
    expect(one("i")?.quotes[0].text).toBe("It takes ages");
    fireEvent.change(edit, { target: { value: "It takes far too long" } });
    fireEvent.click(within(pane()).getByRole("button", { name: "Save quote" }));
    expect(one("i")?.quotes[0].text).toBe("It takes far too long");
  });

  it("backdates the day but never into the future, and keeps a name from being cleared", () => {
    seed([interview("i", "Dana", { date: ago(3) })]);
    renderPage();
    openInterview("Dana");
    const day = within(pane()).getByLabelText(/^Interviewed on, Dana/);
    fireEvent.change(day, { target: { value: addDays(TODAY, 1) } });
    fireEvent.blur(day);
    expect(one("i")?.date).toBe(ago(3));
    fireEvent.change(day, { target: { value: ago(40) } });
    fireEvent.blur(day);
    expect(one("i")?.date).toBe(ago(40));

    const name = within(pane()).getByLabelText(/^Participant/);
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);
    expect(one("i")?.participant).toBe("Dana");
    expect(within(pane()).getByRole("alert")).toHaveTextContent(/pseudonym/);
  });

  it("deletes a quote with Undo, back in its place", () => {
    seed([
      interview("i", "Dana", {
        quotes: [quote("q1", "one"), quote("q2", "two"), quote("q3", "three")],
      }),
    ]);
    renderPage();
    openInterview("Dana");
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete quote 2" }));
    expect(one("i")?.quotes.map((q) => q.id)).toEqual(["q1", "q3"]);
    undoLast();
    expect(one("i")?.quotes.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
  });

  it("deletes an interview with Undo, back in its place and open again", () => {
    seed([
      interview("a", "Ana", { date: ago(1) }),
      interview("b", "Ben", { date: ago(2), quotes: [quote("q", "hi")] }),
      interview("c", "Cy", { date: ago(3) }),
    ]);
    renderPage();
    openInterview("Ben");
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete interview" }));
    expect(stored().map((i) => i.id)).toEqual(["a", "c"]);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted the interview with Ben (1 quote)");
    expect(screen.queryByRole("region", { name: /^Interview with/ })).toBeNull();
    undoLast();
    expect(stored().map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(pane()).toHaveAccessibleName("Interview with Ben");
  });

  it("lists interviews newest first and holds the order while a day is edited", () => {
    seed([
      interview("old", "Older", { date: ago(10) }),
      interview("new", "Newer", { date: ago(1) }),
    ]);
    renderPage();
    const names = () =>
      within(screen.getByRole("list", { name: "Interviews, newest first" }))
        .getAllByRole("button")
        .map((b) => b.textContent);
    expect(names()[0]).toMatch(/^Newer/);
    openInterview("Older");
    const day = within(pane()).getByLabelText(/^Interviewed on, Older/);
    fireEvent.change(day, { target: { value: TODAY } });
    fireEvent.blur(day);
    expect(names()[0]).toMatch(/^Newer/);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(names()[0]).toMatch(/^Older/);
  });
});

describe("a quote raised as an opportunity", () => {
  const tree: TreeNode[] = [
    { id: "o1", kind: "outcome", text: "Teams see blockers sooner", parentId: null },
    { id: "op1", kind: "opportunity", text: "Status is hard to share", parentId: "o1" },
    { id: "example-x", kind: "outcome", text: "Example outcome", parentId: null },
  ];

  it("offers the tree's outcomes and opportunities, never example nodes", () => {
    expect(parentGroups(tree)).toEqual([
      {
        outcomeId: "o1",
        label: "Outcome: Teams see blockers sooner",
        options: [
          { id: "o1", label: "Directly under “Teams see blockers sooner”" },
          { id: "op1", label: "Under “Status is hard to share”" },
        ],
      },
    ]);
  });

  it("goes under the picked node with its redacted words, links back, and Undo takes both back", () => {
    seed(
      [
        interview("i", "Dana Lee", {
          date: ago(4),
          quotes: [quote("q", "Dana here: I copy the board to a sheet, call 555-123-4567")],
        }),
      ],
      tree
    );
    renderPage();
    openInterview("Dana Lee");
    fireEvent.click(
      within(pane()).getByRole("button", { name: "Raise as an opportunity: quote 1" })
    );
    fireEvent.change(within(pane()).getByLabelText("Put it under"), { target: { value: "op1" } });
    fireEvent.click(within(pane()).getByRole("button", { name: "Add to the tree" }));

    const node = nodes().at(-1)!;
    expect(node).toMatchObject({
      kind: "opportunity",
      parentId: "op1",
      evidence: `From an interview on ${ago(4)}`,
      sourceRef: { tool: "user-interviews", id: "q", doc: "i" },
    });
    expect(node.text).not.toMatch(/Dana|555-123-4567/);
    expect(one("i")?.quotes[0].sentTo).toEqual([
      expect.objectContaining({ route: "opportunity", targetId: node.id }),
    ]);
    expect(
      within(pane()).getByRole("link", { name: /On the Opportunity Tree · Open/ })
    ).toHaveAttribute("href", "/opportunity-tree");

    undoLast();
    expect(nodes().map((n) => n.id)).toEqual(["o1", "op1", "example-x"]);
    expect(one("i")?.quotes[0].sentTo ?? []).toEqual([]);
    expect(
      within(pane()).getByRole("button", { name: "Raise as an opportunity: quote 1" })
    ).toBeEnabled();
  });

  it("goes to the top of the tree when no parent is picked", () => {
    seed([interview("i", "Sam", { quotes: [quote("q", "Too slow")] })]);
    renderPage();
    openInterview("Sam");
    fireEvent.click(
      within(pane()).getByRole("button", { name: "Raise as an opportunity: quote 1" })
    );
    fireEvent.click(within(pane()).getByRole("button", { name: "Add to the tree" }));
    expect(nodes()).toEqual([expect.objectContaining({ text: "Too slow", parentId: null })]);
  });

  it("reads a fixture quote already on the tree as sent", () => {
    seed(INTERVIEWS.interviews, OPPORTUNITIES.nodes);
    renderPage();
    openInterview("Dana");
    expect(within(pane()).getAllByRole("link", { name: /On the Opportunity Tree/ })).toHaveLength(
      1
    );
    expect(
      within(pane()).getByRole("button", { name: "Raise as an opportunity: quote 2" })
    ).toBeEnabled();
  });
});

describe("first run, example and export", () => {
  it("offers the example from the empty state and clears only it; its quotes can't be sent", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored()).toHaveLength(3);
    expect(stored().every((i) => isExampleId(i.id))).toBe(true);
    expect(screen.getByRole("button", { name: /^reporting · 3 of 3 people/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pricing · 1 of 3 people/ })).toBeInTheDocument();
    openInterview("Sam");
    expect(within(pane()).getAllByRole("button", { name: /as an opportunity/ })[0]).toBeDisabled();

    act(() => {
      ws().upsertUserInterviewLog({
        id: UI_ID,
        interviews: [interview("mine", "Mine"), ...stored()],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((i) => i.id)).toEqual(["mine"]);
  });

  it("the example passes the page's own checks", () => {
    for (const i of buildExample(TODAY)) {
      expect(
        validateInterview(
          { participant: i.participant, date: i.date, context: i.context ?? "" },
          TODAY
        ).ok
      ).toBe(true);
      for (const q of i.quotes)
        expect(validateQuote({ text: q.text, tags: q.tags.join(",") }).ok).toBe(true);
    }
  });

  it("exports Markdown with the themes and each interview", () => {
    const list = buildExample(TODAY);
    const md = interviewsToMarkdown(list, { anonymise: false });
    expect(md).toContain("# User interviews");
    expect(md).toContain(
      "> “reporting” is the strongest theme: 3 of 3 participants raised it (3 quotes)."
    );
    expect(md).toContain("| reporting | 3 of 3 | 3 |");
    expect(md).toContain("· Sam, engineering manager");
    expect(md).toMatch(/- “Every Friday I copy the board.*” _\(reporting, blockers\)_/);
    const anon = interviewsToMarkdown(list, { anonymise: true });
    expect(anon).not.toContain("Sam, engineering manager");
    expect(anon).toContain("Participant 1");
    expect(interviewsToMarkdown([], { anonymise: true })).toContain("No interviews yet.");
  });

  it("reads legacy mixed-case tags as one theme", () => {
    seed([
      interview("a", "A", { quotes: [quote("q1", "x", ["UX "])] }),
      interview("b", "B", { quotes: [quote("q2", "y", ["ux"])] }),
    ]);
    renderPage();
    expect(screen.getByRole("button", { name: /^ux · 2 of 2 people/ })).toBeInTheDocument();
  });
});

describe("after review", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  /** Runs the frames the page asked for, after React has rendered. */
  const nextFrame = () => act(() => frames.splice(0).forEach((f) => f(0)));

  it("saves the context and day of an older interview saved with no participant", () => {
    // The old page's "New Interview" saved exactly this.
    seed([interview("legacy", "", { date: ago(3) })]);
    renderPage();
    openInterview("unnamed");
    const context = within(pane()).getByLabelText(/^Context/);
    fireEvent.change(context, { target: { value: "Runs the Monday planning" } });
    fireEvent.blur(context);
    expect(one("legacy")).toMatchObject({ participant: "", context: "Runs the Monday planning" });
    const day = within(pane()).getByLabelText(/^Interviewed on/);
    fireEvent.change(day, { target: { value: ago(6) } });
    fireEvent.blur(day);
    expect(one("legacy")?.date).toBe(ago(6));
    expect(within(pane()).queryByRole("alert")).toBeNull();
    // The name is still asked for whenever its own field is edited.
    const name = within(pane()).getByLabelText(/^Participant/);
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.blur(name);
    expect(within(pane()).getByRole("alert")).toHaveTextContent(/pseudonym/);
    fireEvent.change(name, { target: { value: "Customer 7" } });
    fireEvent.blur(name);
    expect(one("legacy")?.participant).toBe("Customer 7");
  });

  it("says why a context wasn't saved instead of dropping it", () => {
    seed([interview("i", "Dana", { context: "Short" })]);
    renderPage();
    openInterview("Dana");
    const context = within(pane()).getByLabelText(/^Context/);
    fireEvent.change(context, { target: { value: "x".repeat(2001) } });
    fireEvent.blur(context);
    expect(one("i")?.context).toBe("Short");
    expect(within(pane()).getByRole("alert")).toHaveTextContent(/2000 characters or fewer/);
    fireEvent.change(context, { target: { value: "Fine now" } });
    fireEvent.blur(context);
    expect(one("i")?.context).toBe("Fine now");
    expect(within(pane()).queryByRole("alert")).toBeNull();
  });

  it("takes no new quote on an example interview, on the page or from an agent", async () => {
    seed(buildExample(TODAY));
    renderPage();
    openInterview("Sam");
    expect(within(pane()).queryByRole("button", { name: "Add quote" })).toBeNull();
    expect(
      within(pane()).getByText(/Example interviews take no new quotes: add your own interview/)
    ).toBeInTheDocument();
    const exampleId = stored()[0].id;
    expect(await run("add_quote", { interviewId: exampleId, text: "Mine" })).toEqual({
      added: false,
      reason: "example",
    });
    expect(one(exampleId)?.quotes.some((q) => q.text === "Mine")).toBe(false);
  });

  it("moves focus to the next quote after a delete, and to Add quote after the last", () => {
    seed([interview("i", "Dana", { quotes: [quote("q1", "one"), quote("q2", "two")] })]);
    renderPage();
    openInterview("Dana");
    nextFrame();
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete quote 1" }));
    nextFrame();
    // The quote left is now quote 1.
    expect(document.activeElement).toBe(
      within(pane()).getByRole("button", { name: "Delete quote 1" })
    );
    fireEvent.click(within(pane()).getByRole("button", { name: "Delete quote 1" }));
    nextFrame();
    expect(document.activeElement).toBe(within(pane()).getByLabelText(/^New quote from Dana/));
  });

  it("moves focus to the new link once a quote is on the tree", () => {
    seed([interview("i", "Sam", { quotes: [quote("q", "Too slow")] })]);
    renderPage();
    openInterview("Sam");
    fireEvent.click(
      within(pane()).getByRole("button", { name: "Raise as an opportunity: quote 1" })
    );
    fireEvent.click(within(pane()).getByRole("button", { name: "Add to the tree" }));
    expect(document.activeElement).toBe(
      within(pane()).getByRole("link", { name: /On the Opportunity Tree · Open/ })
    );
  });

  it("names the top of the tree for what it does, and keys two same-named outcomes apart", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    seed(
      [interview("i", "Sam", { quotes: [quote("q", "Too slow")] })],
      [
        { id: "o1", kind: "outcome", text: "", parentId: null },
        { id: "o2", kind: "outcome", text: "", parentId: null },
      ]
    );
    renderPage();
    openInterview("Sam");
    fireEvent.click(
      within(pane()).getByRole("button", { name: "Raise as an opportunity: quote 1" })
    );
    const picker = within(pane()).getByLabelText("Put it under");
    expect(
      within(picker).getByRole("option", { name: "The top of the tree, under no outcome" })
    ).toBeInTheDocument();
    expect(picker.querySelectorAll("optgroup")).toHaveLength(2);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    expect(parentGroups([{ id: "o", kind: "opportunity", text: "Loose", parentId: null }])).toEqual(
      [
        {
          outcomeId: null,
          label: "Not under an outcome",
          options: [{ id: "o", label: "Under “Loose”" }],
        },
      ]
    );
  });

  it("reads plain “The top of the tree” on a tree with no outcome", () => {
    seed([interview("i", "Sam", { quotes: [quote("q", "Too slow")] })]);
    renderPage();
    openInterview("Sam");
    fireEvent.click(
      within(pane()).getByRole("button", { name: "Raise as an opportunity: quote 1" })
    );
    expect(
      within(within(pane()).getByLabelText("Put it under")).getByRole("option", {
        name: "The top of the tree",
      })
    ).toBeInTheDocument();
  });

  it("the agent puts no quote under an example node, as the picker offers none", async () => {
    seed(
      [interview("i", "Sam", { quotes: [quote("q", "Too slow")] })],
      [{ id: "example-o", kind: "outcome", text: "Example outcome", parentId: null }]
    );
    expect(
      await run("send_quote_to_opportunity", {
        interviewId: "i",
        quoteId: "q",
        parentId: "example-o",
      })
    ).toEqual({ sent: false, reason: "example" });
    expect(nodes()).toHaveLength(1);
  });
});
