import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * WSJF gap-filling: the draft/validation helpers, Markdown edges, the
 * ranked table, and editor paths the editing suite doesn't take (Escape,
 * Cancel, a row missing a component, other fields kept on save).
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { WsjfClient } from "@/app/(tools)/wsjf/wsjf-client";
import { toMarkdown } from "@/app/(tools)/wsjf/markdown";
import {
  EMPTY_WSJF_DRAFT,
  clearErrors,
  sameWsjfValues,
  validateWsjf,
  wsjfCustomFrom,
  wsjfDraftFrom,
} from "@/app/(tools)/wsjf/wsjf-inputs";

const NOW = new Date(2026, 9, 18);

const row = (
  id: string,
  title: string,
  score: number | undefined,
  fields: Record<string, number | string>,
  framework: PrioritizationItem["framework"] = "wsjf"
): PrioritizationItem => ({
  id,
  framework,
  title,
  score,
  fields,
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const wsjf = (id: string, title: string, bv: number, tc: number, rr: number, size: number) =>
  row(id, title, (bv + tc + rr) / size, {
    businessValue: bv,
    timeCriticality: tc,
    rrOe: rr,
    jobSize: size,
  });

const rows = () => useWorkspaceStore.getState().prioritizations ?? [];
const stored = (id: string) => rows().find((x) => x.id === id);
const scale = (group: string, option: string, root: HTMLElement = document.body) =>
  within(within(root).getByRole("radiogroup", { name: group })).getByRole("radio", {
    name: option,
  });
const tableRow = (title: string) => screen.getByRole("button", { name: title }).closest("tr")!;
const cells = (title: string) =>
  within(tableRow(title))
    .getAllByRole("cell")
    .map((c) => c.textContent);

beforeEach(() => {
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("WSJF draft helpers", () => {
  it("reads stored numbers and numeric strings, and leaves unreadable components unpicked", () => {
    expect(
      wsjfDraftFrom({ businessValue: 8, timeCriticality: "5", rrOe: "n/a", jobSize: "" })
    ).toEqual({ businessValue: 8, timeCriticality: 5, rrOe: null, jobSize: null });
    expect(wsjfDraftFrom(undefined)).toEqual(EMPTY_WSJF_DRAFT);
  });

  it("keeps only off-scale values as Custom", () => {
    expect(
      wsjfCustomFrom({ businessValue: 4, timeCriticality: 5, rrOe: 0, jobSize: null })
    ).toEqual({ businessValue: 4, timeCriticality: null, rrOe: 0, jobSize: null });
  });

  it("validates every component, naming each missing one", () => {
    expect(validateWsjf(EMPTY_WSJF_DRAFT)).toEqual({
      ok: false,
      errors: {
        businessValue: "Pick a business value.",
        timeCriticality: "Pick a time criticality.",
        rrOe: "Pick a risk reduction score.",
        jobSize: "Pick a job size.",
      },
    });
    const full = { businessValue: 13, timeCriticality: 8, rrOe: 0, jobSize: 5 };
    // 0 is a picked value, not a missing one.
    expect(validateWsjf(full)).toEqual({ ok: true, values: full });
  });

  it("compares stored fields with edited values, numeric strings included", () => {
    const values = { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 2 };
    expect(
      sameWsjfValues({ businessValue: "8", timeCriticality: 5, rrOe: 3, jobSize: 2 }, values)
    ).toBe(true);
    expect(sameWsjfValues({ ...values, jobSize: 3 }, values)).toBe(false);
    expect(sameWsjfValues(undefined, values)).toBe(false);
  });

  it("clearErrors drops only the touched keys and leaves the input untouched", () => {
    const prev = { businessValue: "a", jobSize: "b", rrOe: "c" };
    expect(clearErrors(prev, { jobSize: 5, businessValue: 1 })).toEqual({ rrOe: "c" });
    expect(prev).toEqual({ businessValue: "a", jobSize: "b", rrOe: "c" });
  });
});

describe("WSJF toMarkdown edges", () => {
  it("shows a dash for a missing component and 0.00 for a row without a score", () => {
    const md = toMarkdown([row("a", "Unscored", undefined, { businessValue: 8 })], NOW);
    expect(md).toContain("| 1 | Unscored | 8 | — | — | — | 0.00 |");
    expect(md).toContain("**Do first:** Unscored (WSJF 0.00)");
  });

  it("names every tied leader under Do first", () => {
    const md = toMarkdown(
      [
        wsjf("a", "SSO", 8, 5, 3, 2),
        wsjf("b", "Audit log", 3, 3, 2, 1),
        wsjf("c", "X", 1, 1, 1, 3),
      ],
      NOW
    );
    expect(md).toContain("**Do first:** SSO, Audit log (WSJF 8.00)");
    expect(md).toContain("| 2 | X | 1 | 1 | 1 | 3 | 1.00 |");
  });

  it("collapses newlines in the Do first line too", () => {
    const md = toMarkdown([wsjf("a", "Two\nlines | here", 1, 1, 1, 1)], NOW);
    expect(md).toContain("**Do first:** Two lines \\| here (WSJF 3.00)");
  });
});

describe("WSJF table", () => {
  it("ranks features by WSJF with dense ranks and two decimals, other frameworks left out", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        wsjf("a", "Saved cards", 13, 3, 8, 8),
        wsjf("b", "Fix declined copy", 8, 13, 3, 2),
        wsjf("c", "Autocomplete", 8, 5, 2, 5),
        row("r", "A RICE row", 500, { reach: 1 }, "rice"),
      ],
    });
    render(<WsjfClient />);

    expect(screen.queryByRole("button", { name: "A RICE row" })).toBeNull();
    const top = cells("Fix declined copy");
    expect([top[0], ...top.slice(2, 7)]).toEqual(["1", "8", "13", "3", "2", "12.00"]);
    expect(cells("Saved cards")[0]).toBe("2");
    expect(cells("Autocomplete")[0]).toBe("2");
    expect(cells("Autocomplete")[6]).toBe("3.00");
    expect(
      screen.getAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label"))
    ).toEqual(["Remove Fix declined copy", "Remove Saved cards", "Remove Autocomplete"]);
  });

  it("blocks a blank title with a message and focuses the field", () => {
    render(<WsjfClient />);
    for (const [group, option] of [
      ["Business value", "1"],
      ["Time criticality", "1"],
      ["Risk reduction / opportunity enablement", "1"],
      ["Job size", "1"],
    ]) {
      fireEvent.click(scale(group, option));
    }
    fireEvent.change(screen.getByLabelText("Feature title"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a title.");
    expect(document.activeElement).toBe(screen.getByLabelText("Feature title"));

    fireEvent.change(screen.getByLabelText("Feature title"), { target: { value: " SSO " } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()[0]).toMatchObject({ title: "SSO", score: 3 });
  });
});

describe("WSJF editing: edges", () => {
  const w1 = wsjf("w1", "Single sign-on", 8, 5, 3, 2);

  it("Escape and Cancel close the editor without saving", () => {
    useWorkspaceStore.setState({ prioritizations: [w1] });
    render(<WsjfClient />);
    const edit = screen.getByRole("button", { name: "Edit scores for Single sign-on" });

    fireEvent.click(edit);
    let editor = screen.getByRole("form", { name: "Edit scores for Single sign-on" });
    fireEvent.click(scale("Job size", "13", editor));
    fireEvent.keyDown(scale("Job size", "13", editor), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Edit scores for Single sign-on" })).toBeNull();
    expect(stored("w1")).toEqual(w1);
    expect(document.activeElement).toBe(edit);

    fireEvent.click(edit);
    editor = screen.getByRole("form", { name: "Edit scores for Single sign-on" });
    fireEvent.click(scale("Job size", "13", editor));
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit scores for Single sign-on" })).toBeNull();
    expect(stored("w1")).toEqual(w1);
  });

  it("ignores a rename to blank", () => {
    useWorkspaceStore.setState({ prioritizations: [w1] });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Single sign-on" }));
    const input = screen.getByLabelText("Rename Single sign-on");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(stored("w1")).toEqual(w1);
  });

  it("asks for a missing component before saving, then keeps the row's other fields", () => {
    const partial = row("w2", "Audit log", 0, { businessValue: 8, timeCriticality: 5, rrOe: 3 });
    partial.fields!.note = "from the agent";
    useWorkspaceStore.setState({ prioritizations: [partial] });
    render(<WsjfClient />);
    expect(cells("Audit log")[5]).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Audit log" }));
    const editor = screen.getByRole("form", { name: "Edit scores for Audit log" });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(within(editor).getByRole("alert")).toHaveTextContent("Pick a job size.");
    expect(stored("w2")).toEqual(partial);

    fireEvent.click(scale("Job size", "2", editor));
    expect(within(editor).queryByRole("alert")).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(stored("w2")).toMatchObject({
      score: 8,
      fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 2, note: "from the agent" },
    });
  });
});
