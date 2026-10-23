import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * ICE, the pilot for the tool UX contract: example data, edit in place
 * without the list jumping, delete with Undo, a one-sentence verdict and
 * a Markdown export.
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

import { IceScoreClient } from "@/app/(tools)/ice-score/ice-score-client";
import { buildExample } from "@/app/(tools)/ice-score/example";
import { toMarkdown } from "@/app/(tools)/ice-score/markdown";
import { iceVerdict } from "@/app/(tools)/ice-score/verdict";
import { EMPTY_ICE_DRAFT, validateIce } from "@/app/(tools)/ice-score/ice-inputs";

const rows = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter((r) => r.framework === "ice");
const renderIce = () =>
  render(
    <TooltipProvider>
      <IceScoreClient />
    </TooltipProvider>
  );
const list = () => screen.getByRole("list", { name: "Ideas, highest ICE first" });
const titles = () =>
  within(list())
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
const row = (
  id: string,
  title: string,
  scores: { impact: number; confidence: number; ease: number }
): PrioritizationItem => ({
  id,
  framework: "ice",
  title,
  score: scores.impact * scores.confidence * scores.ease,
  fields: scores,
  status: "scored",
  updatedAt: "2026-10-23T00:00:00.000Z",
});

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("ICE first run", () => {
  it("loads the example from the empty state and clears only example rows", () => {
    renderIce();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows()).toHaveLength(6);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText("Do first: “Setup-checklist email on day 1” (ICE 432).")
    ).toBeInTheDocument();

    useWorkspaceStore
      .getState()
      .upsertPrioritization(row("mine", "My idea", { impact: 2, confidence: 2, ease: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(rows().map((r) => r.id)).toEqual(["mine"]);
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
  });
});

describe("ICE editing", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("a", "Alpha", { impact: 8, confidence: 8, ease: 8 }), // 512
        row("b", "Beta", { impact: 5, confidence: 5, ease: 5 }), // 125
      ],
    });
  });

  it("edits in place, keeps the order until Re-sort, then re-ranks", () => {
    renderIce();
    expect(titles()[0]).toContain("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    expect(within(editor).getByLabelText(/Idea or experiment/)).toHaveFocus();
    fireEvent.click(
      within(editor).getByRole("radiogroup", { name: "Impact" }).querySelector('[role="radio"]')!
    );
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(rows().find((r) => r.id === "a")).toMatchObject({ score: 64, fields: { impact: 1 } });
    // Alpha (64) now ranks below Beta (125) but stays where the user was looking.
    expect(titles()[0]).toContain("Alpha");
    expect(screen.getByLabelText("Rank 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(titles()[0]).toContain("Beta");
  });

  it("cancels an edit with Escape and saves nothing", () => {
    renderIce();
    fireEvent.click(screen.getByRole("button", { name: "Edit Beta" }));
    const title = within(
      screen.getByRole("button", { name: "Save" }).closest("form")!
    ).getByLabelText(/Idea or experiment/);
    fireEvent.change(title, { target: { value: "Changed" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(rows().find((r) => r.id === "b")?.title).toBe("Beta");
  });

  it("deletes with Undo", () => {
    renderIce();
    fireEvent.click(screen.getByRole("button", { name: "Delete Beta" }));
    expect(rows().map((r) => r.id)).toEqual(["a"]);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Deleted “Beta”");
    opts.action.onClick();
    expect(
      rows()
        .map((r) => r.id)
        .sort()
    ).toEqual(["a", "b"]);
  });

  it("keeps an off-scale stored score unless a new one is picked", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("c", "Gamma", { impact: 6.5, confidence: 4, ease: 4 })],
    });
    renderIce();
    expect(within(list()).getByText("custom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Gamma" }));
    expect(screen.getByRole("radio", { name: "Custom: 6.5" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows()[0].fields).toMatchObject({ impact: 6.5 });
  });
});

describe("ICE logic", () => {
  it("rejects blanks and out-of-range scores instead of defaulting them", () => {
    expect(validateIce(EMPTY_ICE_DRAFT)).toMatchObject({ ok: false });
    expect(validateIce({ title: "x", impact: 11, confidence: 5, ease: 0 })).toEqual({
      ok: false,
      errors: { impact: "Impact runs from 1 to 10.", ease: "Ease runs from 1 to 10." },
    });
    expect(validateIce({ title: " x ", impact: 2, confidence: 3, ease: 4 })).toEqual({
      ok: true,
      values: { title: "x", impact: 2, confidence: 3, ease: 4 },
    });
  });

  it("names ties and warns when the front-runner is a hunch", () => {
    expect(iceVerdict([])).toBe("No ideas scored yet.");
    expect(
      iceVerdict([
        row("a", "A", { impact: 10, confidence: 2, ease: 10 }),
        row("b", "B", { impact: 5, confidence: 5, ease: 5 }),
      ])
    ).toBe("Do first: “A” (ICE 200). Confidence is low, so test it cheaply before building.");
    expect(
      iceVerdict([
        row("a", "A", { impact: 4, confidence: 5, ease: 5 }),
        row("b", "B", { impact: 5, confidence: 4, ease: 5 }),
      ])
    ).toBe("Do first: “A” and “B” tie at ICE 100.");
  });

  it("exports a ranked Markdown table with the verdict", () => {
    const md = toMarkdown(buildExample(), new Date("2026-10-23T12:00:00Z"));
    expect(md).toContain("# ICE Scores — 23 Oct 2026");
    expect(md).toContain("| 1 | Setup-checklist email on day 1 | 6 | 8 | 9 | 432 |");
    // The two in-app nudges tie for second place.
    expect(md.match(/\| 2 \|/g)).toHaveLength(2);
    expect(md).toContain("**Do first: “Setup-checklist email on day 1” (ICE 432).**");
    expect(toMarkdown([])).toContain("No ideas scored yet.");
  });
});
