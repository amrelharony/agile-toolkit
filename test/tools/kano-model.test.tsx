import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * Kano Model: classifying features (scores clamped to 0–5), grouping them
 * into the five categories (unknown categories fall back to Performance),
 * removing, and the CSV export. Backlog import/linking is covered in
 * rice-backlog-import.test.tsx.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { KanoModelClient } from "@/app/(tools)/kano-model/kano-model-client";

const row = (
  id: string,
  title: string,
  category: string,
  framework: PrioritizationItem["framework"] = "kano"
): PrioritizationItem => ({
  id,
  framework,
  title,
  score: 1,
  fields: { category, satIfPresent: 1, dissatIfAbsent: 0 },
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const kanoRows = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter((x) => x.framework === "kano");
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));
/** The category's column: its title, count and features. */
const column = (label: string) =>
  screen.getByText(label, { selector: "span.font-bold" }).closest(".min-w-0") as HTMLElement;
const titlesIn = (label: string) =>
  within(column(label))
    .queryAllByRole("listitem")
    .map((li) => li.querySelector(".flex-1")?.textContent);

function chooseCategory(option: RegExp) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Kano category" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("Kano Model: empty state", () => {
  it("shows the five categories with their hints and no features", () => {
    render(<KanoModelClient />);
    expect(screen.getByText("Categories (0 features)")).toBeInTheDocument();
    for (const [label, hint] of [
      ["Must-be", "Expected; absence causes dissatisfaction"],
      ["Performance", "Linear: more is better"],
      ["Attractive", "Delight; absence is OK"],
      ["Indifferent", "Customers don't care"],
      ["Reverse", "Presence causes dissatisfaction"],
    ]) {
      expect(column(label)).toHaveTextContent(`${label}0${hint}`);
    }
  });
});

describe("Kano Model: classifying a feature", () => {
  it("needs a title", () => {
    render(<KanoModelClient />);
    add();
    type("Feature title", "   ");
    add();
    expect(kanoRows()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("adds to Performance by default, scoring satisfaction plus dissatisfaction", () => {
    render(<KanoModelClient />);
    type("Feature title", "  Faster search ");
    type("Satisfaction if present (0-5)", "4");
    type("Dissatisfaction if absent (0-5)", "2.5");
    add();

    const [r] = kanoRows();
    expect(r).toMatchObject({
      framework: "kano",
      title: "Faster search",
      score: 6.5,
      fields: { category: "performance", satIfPresent: 4, dissatIfAbsent: 2.5 },
      status: "scored",
    });
    expect(r.backlogItemId).toBeUndefined();
    expect(history.log).toHaveBeenCalledWith("item_added", {
      title: "Faster search",
      category: "performance",
    });
    expect(titlesIn("Performance")).toEqual(["Faster search"]);
    expect(screen.getByText("Categories (1 features)")).toBeInTheDocument();
    expect(screen.getByLabelText("Feature title")).toHaveValue("");
    expect(screen.getByLabelText("Satisfaction if present (0-5)")).toHaveValue(null);
    expect(screen.getByLabelText("Dissatisfaction if absent (0-5)")).toHaveValue(null);
  });

  it("files the feature under the chosen category and keeps it for the next one", () => {
    render(<KanoModelClient />);
    chooseCategory(/^Attractive/);
    type("Feature title", "Confetti on launch");
    add();
    type("Feature title", "Dark mode");
    add();
    expect(kanoRows().map((r) => r.fields?.category)).toEqual(["attractive", "attractive"]);
    expect(titlesIn("Attractive")).toEqual(["Confetti on launch", "Dark mode"]);
    expect(within(column("Attractive")).getByText("2")).toBeInTheDocument();
  });

  it("clamps scores to 0–5 and treats blanks as 0", () => {
    render(<KanoModelClient />);
    type("Feature title", "Export");
    type("Satisfaction if present (0-5)", "200");
    type("Dissatisfaction if absent (0-5)", "-3");
    add();
    type("Feature title", "Import");
    add();
    const [exp, imp] = kanoRows();
    expect(exp.fields).toMatchObject({ satIfPresent: 5, dissatIfAbsent: 0 });
    expect(exp.score).toBe(5);
    expect(imp.fields).toMatchObject({ satIfPresent: 0, dissatIfAbsent: 0 });
    expect(imp.score).toBe(0);
  });
});

describe("Kano Model: the category board", () => {
  it("groups Kano features by category and ignores other frameworks", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("k1", "Login works", "must-be"),
        row("k2", "Fast pages", "performance"),
        row("k3", "Easter egg", "attractive"),
        row("k4", "Font picker", "indifferent"),
        row("k5", "Autoplay video", "reverse"),
        row("w1", "WSJF row", "attractive", "wsjf"),
      ],
    });
    render(<KanoModelClient />);
    expect(screen.getByText("Categories (5 features)")).toBeInTheDocument();
    expect(titlesIn("Must-be")).toEqual(["Login works"]);
    expect(titlesIn("Performance")).toEqual(["Fast pages"]);
    expect(titlesIn("Attractive")).toEqual(["Easter egg"]);
    expect(titlesIn("Indifferent")).toEqual(["Font picker"]);
    expect(titlesIn("Reverse")).toEqual(["Autoplay video"]);
    expect(screen.queryByText("WSJF row")).toBeNull();
  });

  it("files a feature with an unknown or missing category under Performance", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("k1", "Legacy row", "basic"),
        { ...row("k2", "No fields", "x"), fields: undefined },
      ],
    });
    render(<KanoModelClient />);
    expect(titlesIn("Performance")).toEqual(["Legacy row", "No fields"]);
  });

  it("removes only the feature whose bin was clicked, leaving other frameworks alone", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("k1", "Login works", "must-be"),
        row("k2", "Fast pages", "performance"),
        row("w1", "WSJF row", "attractive", "wsjf"),
      ],
    });
    render(<KanoModelClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Login works" }));
    expect((useWorkspaceStore.getState().prioritizations ?? []).map((x) => x.id)).toEqual([
      "k2",
      "w1",
    ]);
    expect(history.log).toHaveBeenCalledWith("item_removed", { id: "k1" });
    expect(titlesIn("Must-be")).toEqual([]);
  });

  it("exports one CSV row per Kano feature", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          ...row("k1", "Login works", "must-be"),
          fields: { category: "must-be", satIfPresent: 1, dissatIfAbsent: 5 },
        },
        row("k2", "Easter egg", "attractive"),
        row("w1", "WSJF row", "attractive", "wsjf"),
      ],
    });
    render(<KanoModelClient />);
    expect(exported.csv?.headers).toEqual([
      "Category",
      "Title",
      "Sat-if-present",
      "Dissat-if-absent",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["must-be", "Login works", 1, 5],
      ["attractive", "Easter egg", 1, 0],
    ]);
  });
});
