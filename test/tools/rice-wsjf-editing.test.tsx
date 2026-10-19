import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * WSJF and RICE (audit remainder): Enter adds a row, rows stay editable
 * (name inline, scores in a row editor), the scores use each method's
 * standard scale, an off-scale stored value shows as "Custom" and is left
 * alone until the user picks a new one, and blank scores are blocked with a
 * message instead of a silent default.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
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

import { RiceScoringClient } from "@/app/(tools)/rice-scoring/rice-scoring-client";
import { WsjfClient } from "@/app/(tools)/wsjf/wsjf-client";

const rows = () => useWorkspaceStore.getState().prioritizations ?? [];
const stored = (id: string) => rows().find((x) => x.id === id);

const row = (
  id: string,
  framework: "rice" | "wsjf",
  title: string,
  score: number,
  fields: Record<string, number>,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework,
  title,
  score,
  fields,
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...extra,
});

/**
 * What a browser does when Enter is pressed in a form's text field:
 * implicit submission clicks the form's submit button.
 */
function pressEnter(input: HTMLElement) {
  const notPrevented = fireEvent.keyDown(input, { key: "Enter" });
  const form = (input as HTMLInputElement).form;
  expect(form).not.toBeNull();
  const submit = form!.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect(submit).not.toBeNull();
  if (notPrevented) fireEvent.click(submit!);
}

function scale(group: string, option: string, root: HTMLElement = document.body) {
  return within(within(root).getByRole("radiogroup", { name: group })).getByRole("radio", {
    name: option,
  });
}

const pick = (group: string, option: string, root?: HTMLElement) =>
  fireEvent.click(scale(group, option, root));

const type = (label: string, value: string, root: HTMLElement = document.body) =>
  fireEvent.change(within(root).getByLabelText(label), { target: { value } });

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("RICE: adding", () => {
  it("adds the row when Enter is pressed in the title, with the picked scale values", () => {
    render(<RiceScoringClient />);
    type("Reach (people per quarter)", "500");
    type("Effort (person-months)", "2");
    pick("Impact", "0.25 Minimal");
    pick("Confidence", "80% Medium");
    type("Initiative title", "Saved searches");
    pressEnter(screen.getByLabelText("Initiative title"));

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      framework: "rice",
      title: "Saved searches",
      fields: { reach: 500, impact: 0.25, confidence: 80, effort: 2 },
    });
    expect(rows()[0].score).toBeCloseTo((500 * 0.25 * 0.8) / 2);
    // The form is ready for the next one.
    expect(screen.getByLabelText("Initiative title")).toHaveValue("");
    expect(scale("Impact", "0.25 Minimal")).not.toBeChecked();
  });

  it("blocks a blank confidence with a message instead of assuming 100%", () => {
    render(<RiceScoringClient />);
    type("Initiative title", "Saved searches");
    type("Reach (people per quarter)", "500");
    type("Effort (person-months)", "2");
    pick("Impact", "2 High");
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a confidence.");
    // Focus goes to the scale that needs a value.
    expect(document.activeElement).toBe(scale("Confidence", "100% High"));

    pick("Confidence", "50% Low");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()[0].fields).toMatchObject({ impact: 2, confidence: 50 });
  });

  it("names every blank input, with no row added", () => {
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    const messages = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(messages).toEqual([
      "Enter a title.",
      "Enter the reach.",
      "Enter the effort.",
      "Pick an impact.",
      "Pick a confidence.",
    ]);
    expect(screen.getByLabelText("Initiative title")).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(screen.getByLabelText("Initiative title"));
    expect(rows()).toEqual([]);
  });

  it("explains each scale value in a legend", () => {
    render(<RiceScoringClient />);
    expect(screen.getByText(/from 3× \(massive\) down to 0\.25× \(minimal\)/)).toBeVisible();
    expect(
      screen.getByText(/100% backed by data, 80% some evidence, 50% mostly a guess/)
    ).toBeVisible();
    expect(
      within(screen.getByRole("radiogroup", { name: "Impact" }))
        .getAllByRole("radio")
        .map((r) => r.textContent)
    ).toEqual(["3 Massive", "2 High", "1 Medium", "0.5 Low", "0.25 Minimal"]);
  });
});

describe("RICE: editing a row", () => {
  const r1 = row(
    "r1",
    "rice",
    "Saved searches",
    266.67,
    { reach: 500, impact: 2, confidence: 80, effort: 3 },
    { backlogItemId: "b1" }
  );

  it("renames inline and keeps the backlog link", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Saved searches" }));
    const input = screen.getByLabelText("Rename Saved searches");
    fireEvent.change(input, { target: { value: "Saved filters" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(stored("r1")).toMatchObject({
      title: "Saved filters",
      backlogItemId: "b1",
      fields: r1.fields,
      score: r1.score,
    });
    expect(screen.getByRole("button", { name: "Saved filters" })).toBeInTheDocument();
  });

  it("edits a score, rescores, and hands focus back to the Edit button", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    const editButton = screen.getByRole("button", { name: "Edit scores for Saved searches" });
    fireEvent.click(editButton);
    expect(editButton).toHaveAttribute("aria-expanded", "true");

    const editor = screen.getByRole("form", { name: "Edit scores for Saved searches" });
    // The editor opens on its first input, prefilled from the row.
    expect(document.activeElement).toBe(
      within(editor).getByLabelText("Reach (people per quarter)")
    );
    expect(scale("Impact", "2 High", editor)).toBeChecked();

    pick("Impact", "3 Massive", editor);
    type("Reach (people per quarter)", "600", editor);
    pressEnter(within(editor).getByLabelText("Reach (people per quarter)"));

    const saved = stored("r1")!;
    expect(saved.fields).toEqual({ reach: 600, impact: 3, confidence: 80, effort: 3 });
    expect(saved.score).toBeCloseTo((600 * 3 * 0.8) / 3);
    expect(saved.backlogItemId).toBe("b1");
    expect(saved.updatedAt).not.toBe(r1.updatedAt);
    expect(screen.queryByRole("form", { name: "Edit scores for Saved searches" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit scores for Saved searches" })
    );
  });

  it("Escape cancels without saving", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Saved searches" }));
    const editor = screen.getByRole("form", { name: "Edit scores for Saved searches" });
    pick("Impact", "0.5 Low", editor);
    fireEvent.keyDown(scale("Impact", "0.5 Low", editor), { key: "Escape" });

    expect(screen.queryByRole("form", { name: "Edit scores for Saved searches" })).toBeNull();
    expect(stored("r1")).toEqual(r1);
  });

  it("blocks clearing a required input in the editor", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Saved searches" }));
    const editor = screen.getByRole("form", { name: "Edit scores for Saved searches" });
    type("Effort (person-months)", "", editor);
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(within(editor).getByRole("alert")).toHaveTextContent("Enter the effort.");
    expect(stored("r1")).toEqual(r1);
  });

  it("shows an off-scale value as Custom and leaves it alone until a new value is picked", () => {
    const legacy = row("r2", "rice", "Order tracking", 560, {
      reach: 800,
      impact: 1.5,
      confidence: 70,
      effort: 1.5,
    });
    useWorkspaceStore.setState({ prioritizations: [legacy] });
    render(<RiceScoringClient />);

    // The table marks the off-scale inputs.
    const tableRow = screen.getByRole("button", { name: "Order tracking" }).closest("tr")!;
    expect(within(tableRow).getAllByText("custom")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Order tracking" }));
    let editor = screen.getByRole("form", { name: "Edit scores for Order tracking" });
    expect(scale("Impact", "Custom: 1.5", editor)).toBeChecked();
    expect(scale("Confidence", "Custom: 70%", editor)).toBeChecked();

    // Saving untouched writes nothing.
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(stored("r2")).toEqual(legacy);

    // Picking a scale value replaces only that input.
    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Order tracking" }));
    editor = screen.getByRole("form", { name: "Edit scores for Order tracking" });
    pick("Impact", "2 High", editor);
    // The custom value stays on offer until the edit is saved.
    expect(scale("Impact", "Custom: 1.5", editor)).not.toBeChecked();
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(stored("r2")!.fields).toEqual({ reach: 800, impact: 2, confidence: 70, effort: 1.5 });
    expect(stored("r2")!.score).toBeCloseTo((800 * 2 * 0.7) / 1.5);
  });

  it("keeps confidence under confidencePct for rows the MCP actions saved", () => {
    const fromAgent = row("r3", "rice", "Bulk export", 160, {
      reach: 200,
      impact: 1,
      confidencePct: 80,
      effort: 1,
    });
    useWorkspaceStore.setState({ prioritizations: [fromAgent] });
    render(<RiceScoringClient />);

    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Bulk export" }));
    const editor = screen.getByRole("form", { name: "Edit scores for Bulk export" });
    expect(scale("Confidence", "80% Medium", editor)).toBeChecked();
    pick("Confidence", "100% High", editor);
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(stored("r3")!.fields).toEqual({ reach: 200, impact: 1, confidencePct: 100, effort: 1 });
    expect(stored("r3")!.score).toBe(200);
  });

  it("deletes with Undo, closing an open editor", () => {
    useWorkspaceStore.setState({ prioritizations: [r1] });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Saved searches" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Saved searches" }));

    expect(stored("r1")).toBeUndefined();
    expect(screen.queryByRole("form", { name: "Edit scores for Saved searches" })).toBeNull();
    expect(undo.last!.label).toBe("Deleted “Saved searches”");
    act(() => undo.last!.revert());
    expect(stored("r1")).toEqual(r1);
  });
});

describe("WSJF: adding", () => {
  it("adds the row when Enter is pressed in the title, on the Fibonacci scale", () => {
    render(<WsjfClient />);
    expect(
      within(screen.getByRole("radiogroup", { name: "Job size" }))
        .getAllByRole("radio")
        .map((r) => r.textContent)
    ).toEqual(["1", "2", "3", "5", "8", "13", "20"]);
    expect(screen.getByText(/1 is the smallest in the set/)).toBeVisible();

    pick("Business value", "13");
    pick("Time criticality", "8");
    pick("Risk reduction / opportunity enablement", "3");
    pick("Job size", "5");
    type("Feature title", "Single sign-on");
    pressEnter(screen.getByLabelText("Feature title"));

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      framework: "wsjf",
      title: "Single sign-on",
      fields: { businessValue: 13, timeCriticality: 8, rrOe: 3, jobSize: 5 },
      score: 24 / 5,
    });
  });

  it("blocks a missing component with a message instead of a silent 0", () => {
    render(<WsjfClient />);
    type("Feature title", "Single sign-on");
    pick("Business value", "13");
    pick("Time criticality", "8");
    pick("Risk reduction / opportunity enablement", "3");
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a job size.");
    expect(document.activeElement).toBe(scale("Job size", "1"));
  });

  it("keeps an off-scale backlog value as Custom when importing", async () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Passkey sign-in",
      moscow: "must",
      businessValue: 7,
      timeCriticality: 5,
      riskReduction: 3,
      jobSize: 2,
      reach: 100,
      impact: 1,
      confidence: 80,
      effort: 1,
      value: 7,
      matrixEffort: 3,
    };
    useWorkspaceStore.setState({ backlogItems: [item] });
    window.history.replaceState({}, "", "/wsjf?backlogItem=b1");
    render(<WsjfClient />);
    window.history.replaceState({}, "", "/");

    expect(scale("Business value", "Custom: 7")).toBeChecked();
    expect(scale("Time criticality", "5")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    expect(rows()[0]).toMatchObject({
      backlogItemId: "b1",
      fields: { businessValue: 7, timeCriticality: 5, rrOe: 3, jobSize: 2 },
    });
    // Nothing moved, so the backlog item is untouched.
    expect(useWorkspaceStore.getState().backlogItems).toEqual([item]);
  });
});

describe("WSJF: editing a row", () => {
  const w1 = row("w1", "wsjf", "Single sign-on", 8, {
    businessValue: 8,
    timeCriticality: 5,
    rrOe: 3,
    jobSize: 2,
  });

  it("renames inline", () => {
    useWorkspaceStore.setState({ prioritizations: [w1] });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Single sign-on" }));
    const input = screen.getByLabelText("Rename Single sign-on");
    fireEvent.change(input, { target: { value: "SAML sign-on" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(stored("w1")).toMatchObject({ title: "SAML sign-on", fields: w1.fields, score: 8 });
  });

  it("edits a score and rescores", () => {
    useWorkspaceStore.setState({ prioritizations: [w1] });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Single sign-on" }));
    const editor = screen.getByRole("form", { name: "Edit scores for Single sign-on" });
    // Opens on the first scale's checked value.
    expect(document.activeElement).toBe(scale("Business value", "8", editor));

    pick("Job size", "13", editor);
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    expect(stored("w1")).toMatchObject({
      fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 13 },
      score: 16 / 13,
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit scores for Single sign-on" })
    );
  });

  it("shows an off-scale value as Custom and leaves it alone on an untouched save", () => {
    const legacy = row("w2", "wsjf", "Dark mode", 2.5, {
      businessValue: 4,
      timeCriticality: 3,
      rrOe: 3,
      jobSize: 4,
    });
    useWorkspaceStore.setState({ prioritizations: [legacy] });
    render(<WsjfClient />);

    const tableRow = screen.getByRole("button", { name: "Dark mode" }).closest("tr")!;
    expect(within(tableRow).getAllByText("custom")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Edit scores for Dark mode" }));
    const editor = screen.getByRole("form", { name: "Edit scores for Dark mode" });
    expect(scale("Business value", "Custom: 4", editor)).toBeChecked();
    expect(scale("Job size", "Custom: 4", editor)).toBeChecked();
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(stored("w2")).toEqual(legacy);
  });

  it("deletes with Undo", () => {
    useWorkspaceStore.setState({ prioritizations: [w1] });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Single sign-on" }));
    expect(stored("w1")).toBeUndefined();
    act(() => undo.last!.revert());
    expect(stored("w1")).toEqual(w1);
    expect(screen.getByRole("button", { name: "Edit scores for Single sign-on" })).toBeVisible();
  });
});
