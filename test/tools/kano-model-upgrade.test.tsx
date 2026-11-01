import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";

/**
 * The Kano model derives its category: one person's answer pair through the
 * evaluation table (with a real Questionable), or survey counts whose most
 * common class wins (ties M > O > A > I > R > Q) once 3 people answered,
 * with Better and Worse. A survey round through the kit's 5×5 count grid
 * (live rooms are off here) replaces a feature's counts, or adds to them,
 * with Undo. Old hand-picked categories read "Picked by hand", never
 * Performance by default.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const exported = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: Record<string, unknown>) => {
    exported.props = p;
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { KanoModelClient } from "@/app/(tools)/kano-model/kano-model-client";
import { buildExample } from "@/app/(tools)/kano-model/example";
import { toMarkdown } from "@/app/(tools)/kano-model/markdown";
import { kanoVerdict } from "@/app/(tools)/kano-model/verdict";
import { kanoRows, toCsv } from "@/app/(tools)/kano-model/model";
import { kanoSurvey } from "@/app/(tools)/kano-model/survey";
import "@/lib/actions/tools/kano-model";

const FW = "kano" as const;
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === FW);
const stored = (id: string) => rows().find((r) => r.id === id);

const feature = (
  id: string,
  title: string,
  fields: Record<string, number | string> = {},
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: FW,
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...extra,
});
const counts = (A: number, O: number, M: number, I: number, R: number, Q: number) => ({
  kanoA: A,
  kanoO: O,
  kanoM: M,
  kanoI: I,
  kanoR: R,
  kanoQ: Q,
  kanoN: A + O + M + I + R + Q,
  kanoSource: "counts",
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <KanoModelClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const HAS = "If it has this, how do you feel?";
const HASNT = "If it doesn't have this, how do you feel?";
const addForm = () => screen.getByRole("button", { name: "Add" }).closest("form") as HTMLElement;
const choose = (scope: HTMLElement, group: string, value: string) =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: value,
    })
  );
const list = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
const listed = (label: string) =>
  within(list(label))
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
const lastUndo = (label?: string) => {
  const calls = toastSpy.mock.calls.filter((c) => !label || c[0] === label);
  const call = calls[calls.length - 1];
  return (call[1] as { action: { onClick: () => void } }).action.onClick;
};

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  exported.props = null;
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("Kano: adding", () => {
  it("has no default category: a feature needs answers, with focus on the first question", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Feature title/), { target: { value: "Dark mode" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(0);
    expect(
      screen.getByText("Answer both questions, or enter the survey counts.")
    ).toBeInTheDocument();
    const has = within(addForm()).getByRole("radiogroup", { name: HAS });
    expect(has.contains(document.activeElement)).toBe(true);
    // One answer alone is refused too.
    choose(addForm(), HAS, "I like it");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Answer both questions.")).toBeInTheDocument();
  });

  it("derives one person's pair through the table, Questionable included", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Feature title/), { target: { value: "Dark mode" } });
    choose(addForm(), HAS, "I like it");
    choose(addForm(), HASNT, "I dislike it");
    expect(
      screen.getByText("“I like it” if it has it, “I dislike it” if it doesn't: Performance (O).")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()[0].fields).toEqual({ functional: "like", dysfunctional: "dislike" });
    expect(rows()[0].score).toBe(4);
    expect(listed("Performance")).toEqual([expect.stringContaining("Dark mode")]);
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Added “Dark mode”: Performance")
    );

    fireEvent.change(screen.getByLabelText(/^Feature title/), { target: { value: "Sounds" } });
    choose(addForm(), HAS, "I like it");
    choose(addForm(), HASNT, "I like it");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(listed("Questionable")).toEqual([expect.stringContaining("Sounds")]);
    expect(rows().find((r) => r.title === "Sounds")?.score).toBe(0);
  });

  it("takes survey counts: the mode wins, ties go M > O > A, Better and Worse from 3", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Feature title/), { target: { value: "SSO" } });
    choose(addForm(), "How you have the answers", "Survey counts");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Enter at least one answer.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Attractive \(A\)/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Must-be \(M\)/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Performance \(O\)/), { target: { value: "2" } });
    expect(screen.getByText("10 answers: Must-be. Better 0.6, Worse -0.6.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const [r] = rows();
    expect(r.fields).toMatchObject({
      kanoA: 4,
      kanoO: 2,
      kanoM: 4,
      kanoN: 10,
      kanoSource: "counts",
    });
    expect(r.fields).not.toHaveProperty("category");
    expect(listed("Must-be")).toEqual([expect.stringContaining("Better 0.6 · Worse -0.6")]);
  });

  it("refuses a fraction or a negative count", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Feature title/), { target: { value: "SSO" } });
    choose(addForm(), "How you have the answers", "Survey counts");
    fireEvent.change(screen.getByLabelText(/^Attractive \(A\)/), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Enter a whole number, 0 or more.")).toBeInTheDocument();
  });
});

describe("Kano: reading what's stored", () => {
  it("never shows a feature as Performance by default", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        // The old page: a hand-picked category with Sat/Dissat scores.
        feature("old", "Old pick", { category: "attractive", satIfPresent: 4, dissatIfAbsent: 1 }),
        feature("junk", "Misspelt pick", { category: "delighter" }),
        feature("none", "Nothing yet"),
        feature("few", "Two answers", counts(0, 2, 0, 0, 0, 0)),
      ],
    });
    renderPage();
    expect(listed("Attractive")).toEqual([expect.stringContaining("Picked by hand")]);
    expect(screen.getByRole("button", { name: "Add answers for Old pick" })).toBeInTheDocument();
    expect(listed("Not answered").join(" ")).toContain("Misspelt pick");
    expect(listed("Not answered").join(" ")).toContain("Nothing yet");
    expect(listed("Needs more answers")).toEqual([
      expect.stringContaining(
        "Better and Worse from 3 answers, not counting Reverse or Questionable (2 so far)"
      ),
    ]);
    expect(screen.queryByRole("region", { name: /^Performance/ })).toBeNull();
    // Nothing is rewritten on read: the old scores stay where they were.
    expect(stored("old")?.fields).toEqual({
      category: "attractive",
      satIfPresent: 4,
      dissatIfAbsent: 1,
    });
  });

  it("replaces a hand pick once answers are added, keeping a rename without them", () => {
    useWorkspaceStore.setState({
      prioritizations: [feature("old", "Old pick", { category: "attractive" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Old pick" }));
    let editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    expect(within(editor).getByText(/Picked by hand as Attractive/)).toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText(/^Feature title/), {
      target: { value: "Old pick, renamed" },
    });
    fireEvent.submit(editor);
    expect(stored("old")).toMatchObject({
      title: "Old pick, renamed",
      fields: { category: "attractive" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add answers for Old pick, renamed" }));
    editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    choose(editor, HAS, "I'm neutral");
    choose(editor, HASNT, "I dislike it");
    fireEvent.submit(editor);
    expect(stored("old")?.fields).toEqual({ functional: "neutral", dysfunctional: "dislike" });
    expect(listed("Must-be")).toEqual([expect.stringContaining("Old pick, renamed")]);
  });

  it("orders Must-be by how much missing it hurts", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Mild", counts(0, 0, 3, 3, 0, 0)),
        feature("b", "Severe", counts(0, 1, 6, 0, 0, 0)),
        feature("c", "One pair", { functional: "must", dysfunctional: "dislike" }),
      ],
    });
    renderPage();
    // "Mild" ties M and I: the tie goes to Must-be.
    expect(listed("Must-be")).toEqual([
      expect.stringMatching(/^Severe/),
      expect.stringMatching(/^Mild/),
      expect.stringMatching(/^One pair/),
    ]);
  });
});

describe("Kano: a survey round (count entry, live rooms off)", () => {
  const fill = (featureText: string, cells: [string, string, number][]) => {
    for (const [a, b, n] of cells) {
      fireEvent.change(screen.getByLabelText(`${featureText}: ${a}, then ${b}`), {
        target: { value: String(n) },
      });
    }
  };

  it("asks about the user's own features in list order, never the examples", () => {
    const survey = kanoSurvey([
      feature("done", "Answered", counts(3, 0, 0, 0, 0, 0)),
      feature("todo", "Unanswered"),
      feature("example-kano-1", "An example"),
    ]);
    // List order, not unanswered first: saving a round never reshuffles the sheet.
    expect(survey.sheet?.items.map((i) => i.id)).toEqual(["done", "todo"]);
    expect(survey.sheet?.answers).toEqual([
      "I like it",
      "I expect it",
      "I'm neutral",
      "I can live with it",
      "I dislike it",
    ]);
    expect(survey.left).toBe(0);
    const many = Array.from({ length: 40 }, (_, i) => feature(`f${i}`, `Feature ${i}`));
    expect(kanoSurvey(many)).toMatchObject({ left: 8 });
    expect(kanoSurvey(many).sheet?.items).toHaveLength(32);
    // Over the cap the unanswered ones are asked, still in list order.
    const mixed = many.map((f, i) => (i < 10 ? { ...f, fields: counts(3, 0, 0, 0, 0, 0) } : f));
    const asked = kanoSurvey(mixed).sheet?.items.map((i) => i.id) ?? [];
    expect(asked).toHaveLength(32);
    expect(asked.slice(0, 2)).toEqual(["f0", "f1"]);
    expect(asked.filter((id) => Number(id.slice(1)) >= 10)).toHaveLength(30);
    expect(asked).toEqual([...asked].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it("replaces a feature's counts with the round's, with Undo", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("dm", "Dark mode", counts(0, 0, 9, 0, 0, 0)),
        feature("sso", "SSO"),
      ],
    });
    renderPage();
    expect(await screen.findByText(/Live rounds are off on this site/)).toBeInTheDocument();
    fill("Dark mode", [
      ["I like it", "I'm neutral", 3],
      ["I like it", "I dislike it", 1],
    ]);
    fill("SSO", [["I like it", "I like it", 1]]);
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    expect(screen.getByText("What saving does")).toBeInTheDocument();
    expect(screen.getByText(/Attractive · 4 answers · Better 1, Worse -0.25/)).toBeInTheDocument();
    expect(screen.getByText("Not saved: 1 answer, fewer than 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(stored("dm")?.fields).toMatchObject({
      kanoA: 3,
      kanoO: 1,
      kanoM: 0,
      kanoN: 4,
      kanoSource: "tally",
    });
    expect(stored("dm")?.fields?.kanoRoundId).toMatch(/^tally-/);
    expect(stored("sso")?.fields).toEqual({});
    expect(listed("Attractive")).toEqual([expect.stringContaining("Dark mode")]);
    act(() => lastUndo("Saved the round")());
    expect(stored("dm")?.fields).toEqual(counts(0, 0, 9, 0, 0, 0));
  });

  it("adds to earlier answers when asked", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("dm", "Dark mode", { functional: "like", dysfunctional: "neutral" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByLabelText(/Add to earlier answers/));
    fill("Dark mode", [["I expect it", "I dislike it", 3]]);
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    expect(screen.getByText(/Must-be · 4 answers in all/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    // The one earlier pair (A) counted with the round's three M.
    expect(stored("dm")?.fields).toMatchObject({ kanoA: 1, kanoM: 3, kanoN: 4 });
  });

  it("only offers the round for the user's own features", () => {
    useWorkspaceStore.setState({ prioritizations: buildExample() });
    renderPage();
    expect(
      screen.getByText("Clear the example to survey customers about your own features.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show totals" })).toBeNull();
  });
});

describe("Kano: edit, delete and reset", () => {
  it("switches a feature from one pair to survey counts", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Dark mode", { functional: "like", dysfunctional: "neutral" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    choose(editor, "How you have the answers", "Survey counts");
    fireEvent.change(within(editor).getByLabelText(/^Performance \(O\)/), {
      target: { value: "5" },
    });
    fireEvent.submit(editor);
    expect(stored("a")?.fields).toMatchObject({ kanoO: 5, kanoN: 5 });
    expect(stored("a")?.fields).not.toHaveProperty("functional");
    expect(listed("Performance")).toEqual([expect.stringContaining("5 answers")]);
  });

  it("deletes with Undo, and clears every feature after a confirm, with Undo", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Dark mode", { functional: "like", dysfunctional: "neutral" }),
        feature("b", "SSO"),
        { ...feature("ice", "An ICE idea"), framework: "ice" },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Dark mode" }));
    expect(stored("a")).toBeUndefined();
    expect(toastSpy.mock.calls[0][0]).toBe("Deleted “Dark mode”");
    act(() => lastUndo()());
    expect(stored("a")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear features" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear features" })
    );
    expect(rows()).toHaveLength(0);
    expect(state().prioritizations?.map((r) => r.id)).toEqual(["ice"]);
    act(() => lastUndo("Cleared the Kano features")());
    expect(
      rows()
        .map((r) => r.id)
        .sort()
    ).toEqual(["a", "b"]);
  });
});

describe("Kano: first run, results and export", () => {
  it("loads the example from the empty state and clears only example rows", () => {
    renderPage();
    expect(screen.getByText(/No features yet\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows()).toHaveLength(6);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cover “Single sign-on with Okta” and “Export the board to CSV” first (Must-be); “Dark mode” delights (Better 0.75); “Sound effects when a task is done” got contradictory answers: check the question; 1 category comes from one person's answers: survey customers to confirm it."
      )
    ).toBeInTheDocument();
    act(() => state().upsertPrioritization(feature("mine", "Mine")));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(rows().map((r) => r.id)).toEqual(["mine"]);
  });

  it("covers every category in the example, with example ids and no stored category", () => {
    const ex = buildExample(new Date("2026-10-26T09:00:00Z"));
    expect(ex.every((r) => r.id.startsWith("example-kano-"))).toBe(true);
    expect(ex.every((r) => !("category" in (r.fields ?? {})))).toBe(true);
    const buckets = kanoRows(ex).map((r) => r.result.bucket);
    for (const c of ["must-be", "performance", "attractive", "indifferent", "questionable"]) {
      expect(buckets).toContain(c);
    }
  });

  it("plots Better against Worse from 3 answers, with a summary and a table", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Dark mode", counts(6, 2, 0, 2, 0, 0)),
        feature("b", "SSO", counts(0, 1, 2, 0, 0, 0)),
        feature("c", "Few", counts(1, 1, 0, 0, 0, 0)),
      ],
    });
    renderPage();
    const fig = screen.getByRole("figure", { name: "Better vs Worse" });
    expect(fig).toHaveAccessibleDescription(
      "2 features with enough answers. Most satisfying to have: “Dark mode” (Better 0.8). Most missed when absent: “SSO” (Worse -1)."
    );
    fireEvent.click(within(fig).getByRole("button", { name: /table/i }));
    const table = within(fig).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("says what to collect while no feature has 3 answers", () => {
    useWorkspaceStore.setState({
      prioritizations: [feature("c", "Few", counts(1, 1, 0, 0, 0, 0))],
    });
    renderPage();
    expect(
      screen.getByText("Collect 1 more answer to see Better and Worse for a feature.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("figure", { name: "Better vs Worse" })).toBeNull();
  });

  it("explains the verdict for nothing answered and too few answers", () => {
    expect(kanoVerdict([])).toBe("No features yet.");
    expect(kanoVerdict(kanoRows([feature("a", "A"), feature("b", "B")]))).toBe(
      "Answer both questions about the 2 features, or run a survey, to find their categories."
    );
    // The feature that needs more is named, with how many; the rest are counted.
    expect(kanoVerdict(kanoRows([feature("a", "A", counts(1, 1, 0, 0, 0, 0))]))).toBe(
      "“A” needs 1 more answer for a category."
    );
    expect(
      kanoVerdict(
        kanoRows([
          feature("a", "A", counts(1, 0, 0, 0, 0, 0)),
          feature("b", "B"),
          feature("c", "C"),
        ])
      )
    ).toBe("“A” needs 2 more answers for a category; 2 not answered yet.");
    expect(
      kanoVerdict(
        kanoRows([
          feature("a", "A", counts(1, 0, 0, 0, 0, 0)),
          feature("b", "B", counts(0, 2, 0, 0, 0, 0)),
        ])
      )
    ).toBe("“A” and “B” need more answers: a category shows from 3.");
  });

  it("exports Markdown with counts and coefficients, CSV derived, JSON as shown", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Dark | mode", counts(6, 2, 0, 2, 0, 0)),
        feature("b", "Old pick", { category: "must-be" }),
        feature("c", "Few", counts(1, 1, 0, 0, 0, 0)),
      ],
    });
    renderPage();
    const ranked = kanoRows(state().prioritizations ?? []);
    const md = toMarkdown(ranked, new Date("2026-10-26T09:00:00Z"));
    expect(md).toContain("# Kano Model — 26 Oct 2026");
    expect(md).toContain(
      "| Dark \\| mode | Attractive | 10 answers | 6 | 2 | 0 | 2 | 0 | 0 | 0.8 | -0.2 |"
    );
    expect(md).toContain(
      "| Old pick | Must-be (picked by hand) | Picked by hand | — | — | — | — | — | — | — | — |"
    );
    expect(md).toContain(
      "| Few | Needs more answers | 2 answers | 1 | 1 | 0 | 0 | 0 | 0 | — | — |"
    );
    expect(md).toMatch(/\*\*Cover “Old pick” first \(Must-be\);/);
    expect(exported.props?.markdown).toContain("# Kano Model");
    expect(toCsv(ranked).rows[0]).toEqual([
      "Old pick",
      "Must-be",
      "Picked by hand",
      0,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    const json = exported.props?.jsonData as PrioritizationItem[];
    expect(json.find((r) => r.id === "a")?.score).toBe(3);
  });
});

describe("Kano: the agent reads what the page shows", () => {
  it("list_items groups the same features into the same categories", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Dark mode", counts(6, 2, 0, 2, 0, 0)),
        feature("b", "Old pick", { category: "must-be" }),
        feature("c", "Few", counts(1, 1, 0, 0, 0, 0)),
        feature("d", "Sounds", { functional: "like", dysfunctional: "like" }),
      ],
    });
    const out = (await registry
      .get("tool.kano_model.list_items")!
      .handler({}, { userId: "u", source: "agent", squadProfileIds: [] } as never)) as Record<
      string,
      { id: string; extra?: { better?: number } }[]
    >;
    renderPage();
    expect(out.attractive.map((r) => r.id)).toEqual(["a"]);
    expect(out.attractive[0].extra?.better).toBeCloseTo(0.8);
    expect(listed("Attractive")).toEqual([expect.stringContaining("Better 0.8")]);
    expect(out["must-be"].map((r) => r.id)).toEqual(["b"]);
    expect(listed("Must-be")).toEqual([expect.stringContaining("Old pick")]);
    expect(out.questionable.map((r) => r.id)).toEqual(["d"]);
    expect(listed("Questionable")).toEqual([expect.stringContaining("Sounds")]);
    // Too few answers: needs_more for the agent, "Needs more answers" on the page.
    expect(out.needs_more.map((r) => r.id)).toEqual(["c"]);
    expect(out.unanswered).toEqual([]);
    expect(listed("Needs more answers")).toEqual([expect.stringContaining("Few")]);
  });
});

describe("Kano: theme tokens only", () => {
  it("has no hex colours in its sources", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/kano-model");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
