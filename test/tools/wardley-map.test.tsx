import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WardleyComponent, WardleyLink, WardleyMap } from "@/lib/stores/workspace-types";
import { WARDLEY_ACTIONS } from "@/lib/history/event-actions";

/**
 * Wardley Map Canvas: the add-component form (0..1 parsing, clamping, a
 * deliberate 0), evolution stages, KPIs, SVG placement, numeric
 * repositioning, links (add / dedupe / remove / cascade on delete) and the
 * CSV export.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { WardleyMapClient } from "@/app/(tools)/wardley-map/wardley-map-client";

const WM_ID = "wardleyMap:current";

const comp = (
  id: string,
  name: string,
  evolution: number,
  visibility: number,
  description?: string
): WardleyComponent => ({ id, name, evolution, visibility, description });

function seed(components: WardleyComponent[], links: WardleyLink[] = []) {
  useWorkspaceStore.setState({ wardleyMaps: [{ id: WM_ID, components, links }] });
}

function map(): WardleyMap {
  const m = (useWorkspaceStore.getState().wardleyMaps ?? []).find((d) => d.id === WM_ID);
  if (!m) throw new Error("no wardley map");
  return m;
}

function kpi(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.nextElementSibling!.textContent ?? "";
}

function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

/** The component-list row for a component. */
function row(name: string): HTMLElement {
  return screen.getByRole("button", { name: `Remove ${name}` }).parentElement!;
}

function choose(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

const linkButton = () => screen.getByRole("button", { name: /^Link$/ });
const canvas = () => screen.getByRole("img", { name: "Wardley map canvas" });

beforeEach(() => {
  useWorkspaceStore.setState({ wardleyMaps: [] });
  exported.csv = undefined;
  history.log.mockClear();
});

describe("Wardley Map — empty state", () => {
  it("shows zero KPIs and no list, link form or dots", () => {
    render(<WardleyMapClient />);
    expect(kpi("Components")).toBe("0");
    expect(kpi("Links")).toBe("0");
    expect(kpi("Commodity")).toBe("0");
    expect(kpi("Avg evolution")).toBe("0.00");
    expect(screen.queryByText("Add link")).not.toBeInTheDocument();
    expect(canvas().querySelectorAll("circle")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Add component/ })).toBeDisabled();
  });
});

describe("Wardley Map — add component", () => {
  it("adds a trimmed component, logs it and resets the form", () => {
    render(<WardleyMapClient />);
    fireEvent.change(screen.getByLabelText("Component name"), { target: { value: "  Compute " } });
    commit(screen.getByLabelText("Evolution (0-1)"), "0.8");
    commit(screen.getByLabelText("Visibility (0-1)"), "0.3");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  AWS  " } });
    fireEvent.click(screen.getByRole("button", { name: /Add component/ }));

    expect(map().components).toHaveLength(1);
    expect(map().components[0]).toMatchObject({
      name: "Compute",
      evolution: 0.8,
      visibility: 0.3,
      description: "AWS",
    });
    expect(history.log).toHaveBeenCalledWith(
      WARDLEY_ACTIONS.COMPONENT_ADDED,
      expect.objectContaining({ name: "Compute", evolution: 0.8, visibility: 0.3 })
    );
    expect(screen.getByLabelText("Component name")).toHaveValue("");
    expect(screen.getByLabelText("Evolution (0-1)")).toHaveValue(0.5);
    expect(screen.getByLabelText("Visibility (0-1)")).toHaveValue(0.5);
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("submits on Enter and stores a blank description as undefined", () => {
    render(<WardleyMapClient />);
    const name = screen.getByLabelText("Component name");
    fireEvent.change(name, { target: { value: "User" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "   " } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(map().components[0]).toMatchObject({ name: "User", evolution: 0.5, visibility: 0.5 });
    expect(map().components[0].description).toBeUndefined();
  });

  it("ignores a blank name", () => {
    render(<WardleyMapClient />);
    const name = screen.getByLabelText("Component name");
    fireEvent.change(name, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /Add component/ })).toBeDisabled();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(useWorkspaceStore.getState().wardleyMaps).toEqual([]);
  });

  it("keeps a deliberate 0 (Genesis / infrastructure) instead of snapping to 0.5", () => {
    render(<WardleyMapClient />);
    fireEvent.change(screen.getByLabelText("Component name"), { target: { value: "Idea" } });
    commit(screen.getByLabelText("Evolution (0-1)"), "0");
    commit(screen.getByLabelText("Visibility (0-1)"), "0");
    expect(screen.getByLabelText("Evolution (0-1)")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: /Add component/ }));
    expect(map().components[0]).toMatchObject({ evolution: 0, visibility: 0 });
    expect(within(row("Idea")).getByText("Genesis")).toBeInTheDocument();
  });

  it("clamps out-of-range positions on blur and on submit", () => {
    render(<WardleyMapClient />);
    const evo = screen.getByLabelText("Evolution (0-1)");
    const vis = screen.getByLabelText("Visibility (0-1)");
    commit(evo, "1.7");
    commit(vis, "-2");
    expect(evo).toHaveValue(1);
    expect(vis).toHaveValue(0);
    // Unblurred raw value straight into an Enter submit is clamped too.
    fireEvent.change(evo, { target: { value: "5" } });
    const name = screen.getByLabelText("Component name");
    fireEvent.change(name, { target: { value: "Power" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(map().components[0]).toMatchObject({ evolution: 1, visibility: 0 });
  });

  // Bug: Number("") is 0, so clearing a position field silently moved the
  // new component to Genesis / bottom instead of keeping the 0.5 default.
  it("treats a cleared position field as the 0.50 default, not 0", () => {
    render(<WardleyMapClient />);
    const evo = screen.getByLabelText("Evolution (0-1)");
    commit(evo, "");
    expect(evo).toHaveValue(0.5);
    const vis = screen.getByLabelText("Visibility (0-1)");
    fireEvent.change(vis, { target: { value: "" } });
    const name = screen.getByLabelText("Component name");
    fireEvent.change(name, { target: { value: "Blank" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(map().components[0]).toMatchObject({ evolution: 0.5, visibility: 0.5 });
  });
});

describe("Wardley Map — derived values", () => {
  it("assigns evolution stages at the 0.25 / 0.5 / 0.75 boundaries", () => {
    seed([
      comp("a", "A", 0.24, 0.5),
      comp("b", "B", 0.25, 0.5),
      comp("c", "C", 0.5, 0.5),
      comp("d", "D", 0.749, 0.5),
      comp("e", "E", 0.75, 0.5),
      comp("f", "F", 1, 0.5),
    ]);
    render(<WardleyMapClient />);
    const stage = (n: string) => row(n).querySelector(".uppercase")!.textContent;
    expect(["A", "B", "C", "D", "E", "F"].map(stage)).toEqual([
      "Genesis",
      "Custom",
      "Product",
      "Product",
      "Commodity",
      "Commodity",
    ]);
    expect(kpi("Components")).toBe("6");
    expect(kpi("Commodity")).toBe("2");
    // (0.24 + 0.25 + 0.5 + 0.749 + 0.75 + 1) / 6 = 0.5815
    expect(kpi("Avg evolution")).toBe("0.58");
  });

  it("counts, lists and exports only links whose endpoints exist", () => {
    seed(
      [comp("a", "User", 0.2, 0.9), comp("b", "DB", 0.8, 0.2, "pg")],
      [
        { id: "l1", fromId: "a", toId: "b" },
        { id: "l2", fromId: "a", toId: "ghost" },
      ]
    );
    render(<WardleyMapClient />);
    expect(kpi("Links")).toBe("1");
    expect(screen.getByText("User → DB")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove link/ })).toHaveLength(1);
    expect(exported.csv?.rows).toEqual([
      ["component", "User", "", "0.20", "0.90", "Genesis", ""],
      ["component", "DB", "", "0.80", "0.20", "Commodity", "pg"],
      ["link", "User", "DB", "", "", "", ""],
    ]);
  });

  it("places dots on the canvas, inverting visibility and clamping bad stored values", () => {
    seed(
      [
        comp("a", "Top-left", 0, 1),
        comp("b", "Bottom-right", 1, 0),
        comp("c", "Out of range", 1.5, -0.2),
      ],
      [{ id: "l1", fromId: "a", toId: "b" }]
    );
    render(<WardleyMapClient />);
    const dots = Array.from(canvas().querySelectorAll("circle")).map((c) => [
      c.getAttribute("cx"),
      c.getAttribute("cy"),
    ]);
    expect(dots).toEqual([
      ["60", "16"],
      ["360", "266"],
      ["360", "266"],
    ]);
    const link = canvas().querySelector('line[stroke="var(--accent)"]')!;
    expect([
      link.getAttribute("x1"),
      link.getAttribute("y1"),
      link.getAttribute("x2"),
      link.getAttribute("y2"),
    ]).toEqual(["60", "16", "360", "266"]);
  });
});

describe("Wardley Map — reposition and remove", () => {
  it("commits a new evolution, logs the move and updates the stage", () => {
    seed([comp("a", "API", 0.3, 0.5)]);
    render(<WardleyMapClient />);
    const evo = screen.getByLabelText("Evolution for API");
    expect(evo).toHaveValue(0.3);
    commit(evo, "0.9");
    expect(map().components[0].evolution).toBe(0.9);
    expect(history.log).toHaveBeenCalledWith(WARDLEY_ACTIONS.COMPONENT_MOVED, {
      componentId: "a",
      evolution: 0.9,
    });
    expect(within(row("API")).getByText("Commodity")).toBeInTheDocument();
    commit(screen.getByLabelText("Visibility for API"), "3");
    expect(map().components[0]).toMatchObject({ evolution: 0.9, visibility: 1 });
    expect(screen.getByLabelText("Visibility for API")).toHaveValue(1);
  });

  // Bug: Number("") is 0, so clearing the field moved the component to 0.
  it("reverts a cleared position instead of moving the component to 0", () => {
    seed([comp("a", "API", 0.3, 0.5)]);
    render(<WardleyMapClient />);
    const evo = screen.getByLabelText("Evolution for API");
    commit(evo, "");
    expect(map().components[0].evolution).toBe(0.3);
    expect(evo).toHaveValue(0.3);
    expect(history.log).not.toHaveBeenCalled();
  });

  // Bug: every blur committed, so tabbing through the fields logged phantom
  // COMPONENT_MOVED events and rounded agent-written positions to 2 dp.
  it("does not log a move or round the stored value when the field is left untouched", () => {
    seed([comp("a", "API", 0.333, 0.5)]);
    render(<WardleyMapClient />);
    const evo = screen.getByLabelText("Evolution for API");
    act(() => evo.focus());
    fireEvent.blur(evo);
    const vis = screen.getByLabelText("Visibility for API");
    commit(vis, "0.5");
    expect(map().components[0]).toMatchObject({ evolution: 0.333, visibility: 0.5 });
    expect(history.log).not.toHaveBeenCalled();
  });

  it("re-syncs the field when a position changes elsewhere", () => {
    seed([comp("a", "API", 0.3, 0.5)]);
    render(<WardleyMapClient />);
    act(() => seed([comp("a", "API", 0.65, 0.5)]));
    expect(screen.getByLabelText("Evolution for API")).toHaveValue(0.65);
  });

  it("removes a component and every link that references it", () => {
    seed(
      [comp("a", "A", 0.1, 0.9), comp("b", "B", 0.5, 0.5), comp("c", "C", 0.9, 0.1)],
      [
        { id: "ab", fromId: "a", toId: "b" },
        { id: "bc", fromId: "b", toId: "c" },
        { id: "ac", fromId: "a", toId: "c" },
      ]
    );
    render(<WardleyMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove B" }));
    expect(map().components.map((c) => c.id)).toEqual(["a", "c"]);
    expect(map().links.map((l) => l.id)).toEqual(["ac"]);
    expect(history.log).toHaveBeenCalledWith(WARDLEY_ACTIONS.COMPONENT_REMOVED, {
      componentId: "b",
      name: "B",
    });
  });
});

describe("Wardley Map — links", () => {
  it("only offers the link form with two or more components", () => {
    seed([comp("a", "A", 0.1, 0.9)]);
    const { unmount } = render(<WardleyMapClient />);
    expect(screen.queryByText("Add link")).not.toBeInTheDocument();
    unmount();
    seed([comp("a", "A", 0.1, 0.9), comp("b", "B", 0.5, 0.5)]);
    render(<WardleyMapClient />);
    expect(screen.getByText("Add link")).toBeInTheDocument();
  });

  it("adds a link once both ends are chosen and resets the pickers", () => {
    seed([comp("a", "A", 0.1, 0.9), comp("b", "B", 0.5, 0.5)]);
    render(<WardleyMapClient />);
    expect(linkButton()).toBeDisabled();
    choose("From component", "A");
    expect(linkButton()).toBeDisabled();
    choose("To component", "A");
    // Same component at both ends is not a link.
    expect(linkButton()).toBeDisabled();
    choose("To component", "B");
    expect(linkButton()).toBeEnabled();
    fireEvent.click(linkButton());
    expect(map().links).toEqual([expect.objectContaining({ fromId: "a", toId: "b" })]);
    expect(history.log).toHaveBeenCalledWith(
      WARDLEY_ACTIONS.LINK_ADDED,
      expect.objectContaining({ fromId: "a", toId: "b" })
    );
    expect(screen.getByText("A → B")).toBeInTheDocument();
    expect(kpi("Links")).toBe("1");
    expect(linkButton()).toBeDisabled();
  });

  it("refuses a duplicate link in the same direction", () => {
    seed(
      [comp("a", "A", 0.1, 0.9), comp("b", "B", 0.5, 0.5)],
      [{ id: "ab", fromId: "a", toId: "b" }]
    );
    render(<WardleyMapClient />);
    choose("From component", "A");
    choose("To component", "B");
    fireEvent.click(linkButton());
    expect(map().links.map((l) => l.id)).toEqual(["ab"]);
  });

  it("removes exactly the clicked link", () => {
    seed(
      [comp("a", "A", 0.1, 0.9), comp("b", "B", 0.5, 0.5), comp("c", "C", 0.9, 0.1)],
      [
        { id: "ab", fromId: "a", toId: "b" },
        { id: "bc", fromId: "b", toId: "c" },
      ]
    );
    render(<WardleyMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove link B to C" }));
    expect(map().links.map((l) => l.id)).toEqual(["ab"]);
    expect(history.log).toHaveBeenCalledWith(WARDLEY_ACTIONS.LINK_REMOVED, { linkId: "bc" });
  });

  // Bug: deleting a component that was picked in the link form left its id in
  // the picker, so "Link" stayed enabled and stored a dangling link.
  it("does not store a dangling link after the picked component is deleted", () => {
    seed([comp("a", "A", 0.1, 0.9), comp("b", "B", 0.5, 0.5), comp("c", "C", 0.9, 0.1)]);
    render(<WardleyMapClient />);
    choose("From component", "A");
    choose("To component", "C");
    fireEvent.click(screen.getByRole("button", { name: "Remove C" }));
    expect(linkButton()).toBeDisabled();
    fireEvent.click(linkButton());
    expect(map().links).toEqual([]);
  });
});
