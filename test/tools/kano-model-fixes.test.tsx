import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import type { PairRoundResult } from "@/lib/realtime/vote-room/pair";
import { registry } from "@/lib/actions/registry";

/**
 * The Kano review fixes: a saved round is never folded in twice (the
 * preview after Save round, a second save, record_round with the same
 * round id); the survey sheet keeps list order, so saving a round or
 * typing counts in a row editor never wipes the count grid; Better and
 * Worse wait for 3 answers that aren't Reverse or Questionable, on the
 * page and for the agent; a category from one person's pair says so; the
 * add form's live line stays quiet after Add; and focus comes back to the
 * row after its editor closes.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { KanoModelClient } from "@/app/(tools)/kano-model/kano-model-client";
import { kanoVerdict } from "@/app/(tools)/kano-model/verdict";
import { featureView, kanoRows, shownCoefficients } from "@/app/(tools)/kano-model/model";
import { applyKanoRound, kanoSurvey } from "@/app/(tools)/kano-model/survey";
import "@/lib/actions/tools/kano-model";

const FW = "kano" as const;
const state = () => useWorkspaceStore.getState();
const stored = (id: string) => (state().prioritizations ?? []).find((r) => r.id === id);

const feature = (
  id: string,
  title: string,
  fields: Record<string, number | string> = {}
): PrioritizationItem => ({
  id,
  framework: FW,
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
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
const joint = (cells: [number, number, number][]) => {
  const out = new Array<number>(25).fill(0);
  for (const [f, s, n] of cells) out[f * 5 + s] = n;
  return out;
};
const round = (items: PairRoundResult["items"], roundId = "round_abcdefgh"): PairRoundResult => ({
  kind: "pair",
  roundId,
  tool: "kano-model",
  sheetId: "kano-survey",
  title: "Kano survey",
  prompts: { first: "If it has this, how do you feel?", second: "If it doesn't?" },
  answers: ["I like it", "I expect it", "I'm neutral", "I can live with it", "I dislike it"],
  closedAt: "2026-10-27T10:00:00.000Z",
  minN: 3,
  ballots: 3,
  source: "live",
  items,
});
const agent = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <KanoModelClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const fill = (featureText: string, cells: [string, string, number][]) => {
  for (const [a, b, n] of cells) {
    fireEvent.change(screen.getByLabelText(`${featureText}: ${a}, then ${b}`), {
      target: { value: String(n) },
    });
  }
};
const list = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
const listed = (label: string) =>
  within(list(label))
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("Kano fixes: a round is counted once", () => {
  it("keeps the preview at the stored counts after Save round with Add to earlier answers on", () => {
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
    expect(stored("dm")?.fields).toMatchObject({ kanoA: 1, kanoM: 3, kanoN: 4 });
    // Not {A 1, M 3} + {M 3} = 7: the row already holds the round.
    expect(screen.getByText(/Saved: Must-be · 4 answers/)).toBeInTheDocument();
    expect(screen.queryByText(/7 answers/)).toBeNull();
  });

  it("changes nothing when the same round is applied again", () => {
    const rows = [feature("dm", "Dark mode", counts(2, 0, 0, 0, 0, 0))];
    const r = round([{ id: "dm", text: "Dark mode", responses: 3, joint: joint([[1, 4, 3]]) }]);
    const once = applyKanoRound(rows, r, { add: true });
    expect(once[0].fields).toMatchObject({ kanoA: 2, kanoM: 3, kanoN: 5 });
    expect(applyKanoRound(once, r, { add: true })).toEqual([]);
    // Another round still adds.
    expect(applyKanoRound(once, { ...r, roundId: "round_zzzzzzzz" }, { add: true })).toHaveLength(
      1
    );
  });

  it("record_round with the same round id doesn't count it twice", async () => {
    useWorkspaceStore.setState({
      prioritizations: [feature("dm", "Dark mode", counts(2, 0, 0, 0, 0, 0))],
    });
    const record = registry.get("tool.kano_model.record_round")!;
    const params = {
      featureId: "dm",
      joint: joint([[1, 4, 3]]),
      add: true,
      roundId: "round_abcdefgh",
    };
    const first = (await record.handler(params as never, agent())) as Record<string, unknown>;
    expect(first).toMatchObject({ n: 5, alreadyRecorded: false });
    const fields = stored("dm")?.fields;
    const again = (await record.handler(params as never, agent())) as Record<string, unknown>;
    expect(again).toMatchObject({ n: 5, category: "must-be", alreadyRecorded: true });
    expect(stored("dm")?.fields).toEqual(fields);
  });

  it("adds a round to one stored pair the same way on the page and for the agent", async () => {
    const pair = feature("b", "Feature b", { functional: "like", dysfunctional: "neutral" });
    useWorkspaceStore.setState({ prioritizations: [pair] });
    const j = joint([[1, 4, 2]]);
    const page = applyKanoRound(
      [pair],
      round([{ id: "b", text: "Feature b", responses: 3, joint: j }]),
      { add: true }
    )[0];
    await registry.get("tool.kano_model.record_round")!.handler(
      {
        featureId: "b",
        joint: j,
        add: true,
        source: "room",
        roundId: "round_abcdefgh",
        at: "2026-10-27T10:00:00.000Z",
      } as never,
      agent()
    );
    expect(stored("b")?.fields).toEqual(page.fields);
    expect(stored("b")?.fields).toMatchObject({ kanoA: 1, kanoM: 2, kanoN: 3 });
  });
});

describe("Kano fixes: the count grid holds still", () => {
  it("keeps the saved view after a round answers features that were unanswered", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Answered", counts(3, 0, 0, 0, 0, 0)),
        feature("b", "Search"),
        feature("c", "Export"),
      ],
    });
    renderPage();
    fill("Search", [["I like it", "I dislike it", 3]]);
    fill("Export", [["I expect it", "I dislike it", 3]]);
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(stored("b")?.fields).toMatchObject({ kanoO: 3 });
    // The sheet kept its order, so the grid didn't start over.
    expect(screen.getByRole("button", { name: "Round saved" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enter another round" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search: I like it, then I dislike it")).toHaveValue(3);
  });

  it("keeps typed boxes when counts are saved in a row editor meanwhile", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Answered", counts(3, 0, 0, 0, 0, 0)),
        feature("b", "Search"),
        feature("c", "Export"),
      ],
    });
    renderPage();
    fill("Export", [["I like it", "I'm neutral", 2]]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Search" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("radio", { name: "Survey counts" }));
    fireEvent.change(within(editor).getByLabelText(/^Performance \(O\)/), {
      target: { value: "4" },
    });
    fireEvent.submit(editor);
    expect(stored("b")?.fields).toMatchObject({ kanoO: 4 });
    expect(kanoSurvey(state().prioritizations ?? []).sheet?.items.map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(screen.getByLabelText("Export: I like it, then I'm neutral")).toHaveValue(2);
  });
});

describe("Kano fixes: Better and Worse count only what says something", () => {
  it("waits for 3 answers that aren't Reverse or Questionable", () => {
    expect(shownCoefficients({ A: 1, O: 0, M: 0, I: 0, R: 1, Q: 1 })).toBeNull();
    expect(shownCoefficients({ A: 0, O: 0, M: 0, I: 0, R: 3, Q: 2 })).toBeNull();
    expect(shownCoefficients({ A: 2, O: 0, M: 1, I: 0, R: 4, Q: 0 })).toMatchObject({
      better: 2 / 3,
      n: 3,
    });
    useWorkspaceStore.setState({
      prioritizations: [
        feature("one", "One that counts", counts(1, 0, 0, 0, 1, 1)),
        feature("rq", "All contradictory", counts(0, 0, 0, 0, 3, 2)),
      ],
    });
    renderPage();
    // A category from 3 answers, but Better and Worse from the one that counts.
    expect(listed("Attractive")).toEqual([
      expect.stringContaining(
        "Better and Worse from 3 answers, not counting Reverse or Questionable (1 so far)"
      ),
    ]);
    expect(listed("Reverse")).toEqual([
      expect.stringContaining("All 5 answers were Reverse or Questionable: no Better or Worse"),
    ]);
    expect(screen.queryByRole("figure", { name: "Better vs Worse" })).toBeNull();
    expect(
      screen.getByText("Collect 2 more answers to see Better and Worse for a feature.")
    ).toBeInTheDocument();
  });

  it("gives the agent the same nulls", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("one", "One that counts", counts(1, 0, 0, 0, 1, 1)),
        feature("ok", "Enough", counts(3, 1, 0, 0, 0, 0)),
      ],
    });
    const out = (await registry.get("tool.kano_model.list_items")!.handler({}, agent())) as Record<
      string,
      { id: string; extra?: { better?: number | null; worse?: number | null } }[]
    >;
    const one = out.attractive.find((r) => r.id === "one");
    expect(one?.extra).toMatchObject({ better: null, worse: null });
    expect(out.attractive.find((r) => r.id === "ok")?.extra?.better).toBe(1);
    const classified = (await registry
      .get("tool.kano_model.classify")!
      .handler({ counts: { A: 1, O: 0, M: 0, I: 0, R: 1, Q: 1 } } as never, agent())) as Record<
      string,
      unknown
    >;
    expect(classified).toMatchObject({ category: "attractive", better: null, worse: null });
    const recorded = (await registry
      .get("tool.kano_model.record_round")!
      .handler(
        { featureId: "ok", counts: { A: 1, O: 0, M: 0, I: 0, R: 1, Q: 1 } } as never,
        agent()
      )) as Record<string, unknown>;
    expect(recorded).toMatchObject({ n: 3, enough: true, better: null, worse: null });
  });
});

describe("Kano fixes: one person's answers say so", () => {
  it("marks a category from a single pair in the row and the verdict", () => {
    const rows = kanoRows([
      feature("sso", "SSO", counts(0, 1, 4, 0, 0, 0)),
      feature("csv", "Export", { functional: "must", dysfunctional: "dislike" }),
    ]);
    expect(featureView(rows.find((r) => r.row.id === "csv")!).fromPair).toBe(true);
    expect(featureView(rows.find((r) => r.row.id === "sso")!).fromPair).toBe(false);
    expect(kanoVerdict(rows)).toBe(
      "Cover “SSO” and “Export” first (Must-be); 1 category comes from one person's answers: survey customers to confirm it."
    );
    useWorkspaceStore.setState({ prioritizations: rows.map((r) => r.row) });
    renderPage();
    expect(listed("Must-be")).toEqual([
      expect.stringContaining("5 answers"),
      expect.stringContaining("One person's answers: I expect it / I dislike it"),
    ]);
    expect(
      screen.getByText(/From a survey, a feature's category shows from 3 answers\./)
    ).toBeInTheDocument();
  });
});

describe("Kano fixes: announcements and focus", () => {
  it("leaves the live line empty after Add, so only “Added …” is read out", async () => {
    renderPage();
    const form = screen.getByRole("button", { name: "Add" }).closest("form") as HTMLElement;
    const live = within(form).getByRole("status");
    expect(live).toHaveTextContent("");
    expect(within(form).getByText("Answer both questions to see the category.")).toBeVisible();
    fireEvent.change(screen.getByLabelText(/^Feature title/), { target: { value: "Dark mode" } });
    const pick = (group: string, value: string) =>
      fireEvent.click(
        within(within(form).getByRole("radiogroup", { name: group })).getByRole("radio", {
          name: value,
        })
      );
    pick("If it has this, how do you feel?", "I like it");
    expect(live).toHaveTextContent("Answer both questions to see the category.");
    pick("If it doesn't have this, how do you feel?", "I'm neutral");
    expect(live).toHaveTextContent(/Attractive \(A\)/);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(state().prioritizations).toHaveLength(1);
    expect(within(form).getByRole("status")).toHaveTextContent("");
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Added “Dark mode”: Attractive")
    );
  });

  it("puts focus back on the row's Edit button after Save and after Cancel", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("dm", "Dark mode", { functional: "like", dysfunctional: "neutral" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    let editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    // A new answer moves the feature to Must-be.
    fireEvent.click(
      within(
        within(editor).getByRole("radiogroup", { name: "If it has this, how do you feel?" })
      ).getByRole("radio", { name: "I expect it" })
    );
    fireEvent.click(
      within(
        within(editor).getByRole("radiogroup", {
          name: "If it doesn't have this, how do you feel?",
        })
      ).getByRole("radio", { name: "I dislike it" })
    );
    fireEvent.submit(editor);
    expect(listed("Must-be")).toEqual([expect.stringContaining("Dark mode")]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Dark mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Dark mode" }));
  });
});
