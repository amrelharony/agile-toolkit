import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Polarity, PolarityPole } from "@/lib/stores/workspace-types";

/**
 * Polarity Map: creating a polarity (two poles + anchors), editing each
 * pole's upsides / downsides, removing, and the CSV export. The create
 * validation messages are covered by polarity-map-fixes.test.tsx.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = p.csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { PolarityMapClient } from "@/app/(tools)/polarity-map/polarity-map-client";

const polarity = (id: string, title: string, extra: Partial<Polarity> = {}): Polarity => ({
  id,
  title,
  ...extra,
});
const pole = (
  id: string,
  polarityId: string,
  side: PolarityPole["side"],
  label: string,
  upsides: string[] = [],
  downsides: string[] = []
): PolarityPole => ({ id, polarityId, side, label, upsides, downsides });

const state = () => useWorkspaceStore.getState();
const polesOf = (polarityId: string) =>
  (state().polarityPoles ?? []).filter((p) => p.polarityId === polarityId);
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const create = () => fireEvent.click(screen.getByRole("button", { name: "Create polarity" }));
/** The pole column's textareas, in order: left up, left down, right up, right down. */
const poleBoxes = () => screen.getAllByRole("textbox").filter((el) => el.tagName === "TEXTAREA");

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ polarities: [], polarityPoles: [] });
});

describe("Polarity Map: creating", () => {
  it("starts with no maps and nothing to export", () => {
    render(<PolarityMapClient />);
    expect(screen.queryByRole("button", { name: /Remove polarity/ })).toBeNull();
    expect(exported.csv).toBeUndefined();
  });

  it("creates the polarity with two empty poles, trimmed, and clears the form", () => {
    render(<PolarityMapClient />);
    type("Polarity title", "  Autonomy ↔ Standardisation  ");
    type("Left pole label", " Autonomy ");
    type("Right pole label", "Standardisation");
    type("Greater purpose (above both poles)", "  Ship value fast  ");
    type("Deeper fear (below both poles)", "Chaos");
    create();

    expect(state().polarities).toHaveLength(1);
    const pol = state().polarities![0];
    expect(pol).toMatchObject({
      title: "Autonomy ↔ Standardisation",
      greaterPurpose: "Ship value fast",
      deeperFear: "Chaos",
    });
    const poles = polesOf(pol.id);
    expect(poles.map((p) => [p.side, p.label, p.upsides, p.downsides])).toEqual([
      ["left", "Autonomy", [], []],
      ["right", "Standardisation", [], []],
    ]);
    expect(new Set(poles.map((p) => p.id)).size).toBe(2);

    expect(screen.getByText("Autonomy ↔ Standardisation")).toBeInTheDocument();
    expect(screen.getByText("↑ Ship value fast")).toBeInTheDocument();
    expect(screen.getByText("↓ Chaos")).toBeInTheDocument();
    for (const label of ["Polarity title", "Left pole label", "Deeper fear (below both poles)"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
  });

  it("stores blank anchors as undefined and shows no anchor lines", () => {
    render(<PolarityMapClient />);
    type("Polarity title", "Speed vs safety");
    type("Left pole label", "Speed");
    type("Right pole label", "Safety");
    type("Greater purpose (above both poles)", "   ");
    create();
    const pol = state().polarities![0];
    expect(pol.greaterPurpose).toBeUndefined();
    expect(pol.deeperFear).toBeUndefined();
    expect(screen.queryByText(/^↑/)).toBeNull();
    expect(screen.queryByText(/^↓/)).toBeNull();
  });

  it("refuses whitespace-only labels", () => {
    render(<PolarityMapClient />);
    type("Polarity title", "Speed vs safety");
    type("Left pole label", "   ");
    type("Right pole label", "Safety");
    create();
    expect(state().polarities).toEqual([]);
    expect(state().polarityPoles).toEqual([]);
  });
});

describe("Polarity Map: editing poles", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      polarities: [polarity("p1", "Autonomy ↔ Standardisation")],
      polarityPoles: [
        pole("L", "p1", "left", "Autonomy", ["Fast decisions"], ["Duplicated tools"]),
        pole("R", "p1", "right", "Standardisation"),
      ],
    });
  });

  it("shows each pole's lists, one per line", () => {
    render(<PolarityMapClient />);
    const [leftUp, leftDown, rightUp, rightDown] = poleBoxes();
    expect(leftUp).toHaveValue("Fast decisions");
    expect(leftDown).toHaveValue("Duplicated tools");
    expect(rightUp).toHaveValue("");
    expect(rightDown).toHaveValue("");
    // Each list is labelled.
    expect(screen.getAllByLabelText("Upsides (one per line)")).toEqual([leftUp, rightUp]);
    expect(screen.getAllByLabelText("Downsides (one per line)")).toEqual([leftDown, rightDown]);
  });

  it("saves trimmed, non-empty lines on blur, and keeps the other list", () => {
    render(<PolarityMapClient />);
    const [leftUp] = poleBoxes();
    fireEvent.change(leftUp, { target: { value: "Fast decisions\n\n  Ownership  \n" } });
    // Nothing is written while typing.
    expect(polesOf("p1").find((p) => p.id === "L")?.upsides).toEqual(["Fast decisions"]);
    fireEvent.blur(leftUp);
    const left = polesOf("p1").find((p) => p.id === "L")!;
    expect(left.upsides).toEqual(["Fast decisions", "Ownership"]);
    expect(left.downsides).toEqual(["Duplicated tools"]);
    expect(left.label).toBe("Autonomy");
  });

  it("edits the right pole without touching the left one", () => {
    render(<PolarityMapClient />);
    const rightDown = poleBoxes()[3];
    fireEvent.change(rightDown, { target: { value: "Slow to adapt" } });
    fireEvent.blur(rightDown);
    expect(polesOf("p1").find((p) => p.id === "R")?.downsides).toEqual(["Slow to adapt"]);
    expect(polesOf("p1").find((p) => p.id === "L")?.downsides).toEqual(["Duplicated tools"]);
  });

  it("clearing a list saves it empty", () => {
    render(<PolarityMapClient />);
    const [leftUp] = poleBoxes();
    fireEvent.change(leftUp, { target: { value: "" } });
    fireEvent.blur(leftUp);
    expect(polesOf("p1").find((p) => p.id === "L")?.upsides).toEqual([]);
  });

  it("a blur without changes writes nothing", () => {
    render(<PolarityMapClient />);
    const before = state().polarityPoles;
    fireEvent.blur(poleBoxes()[0]);
    expect(state().polarityPoles).toBe(before);
  });

  it("picks up a change made elsewhere (e.g. another device)", () => {
    const { rerender } = render(<PolarityMapClient />);
    useWorkspaceStore.setState({
      polarityPoles: [
        pole("L", "p1", "left", "Autonomy", ["Synced line"], []),
        pole("R", "p1", "right", "Standardisation"),
      ],
    });
    rerender(<PolarityMapClient />);
    expect(poleBoxes()[0]).toHaveValue("Synced line");
  });
});

describe("Polarity Map: removing and exporting", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      polarities: [polarity("p1", "Autonomy ↔ Standardisation"), polarity("p2", "Speed vs safety")],
      polarityPoles: [
        pole("L1", "p1", "left", "Autonomy", ["Fast", "Owned"], ["Silos"]),
        pole("R1", "p1", "right", "Standardisation", ["Consistent"], []),
        pole("L2", "p2", "left", "Speed"),
        pole("R2", "p2", "right", "Safety"),
      ],
    });
  });

  it("removes a polarity together with its poles", () => {
    render(<PolarityMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove polarity: Speed vs safety" }));
    expect(state().polarities?.map((p) => p.id)).toEqual(["p1"]);
    expect(state().polarityPoles?.map((p) => p.id)).toEqual(["L1", "R1"]);
    expect(screen.queryByText("Speed vs safety")).toBeNull();
  });

  it("exports one CSV row per pole with its lists joined", () => {
    render(<PolarityMapClient />);
    expect(exported.csv?.headers).toEqual(["Polarity", "Pole", "Side", "Upsides", "Downsides"]);
    expect(exported.csv?.rows).toEqual([
      ["Autonomy ↔ Standardisation", "Autonomy", "left", "Fast; Owned", "Silos"],
      ["Autonomy ↔ Standardisation", "Standardisation", "right", "Consistent", ""],
      ["Speed vs safety", "Speed", "left", "", ""],
      ["Speed vs safety", "Safety", "right", "", ""],
    ]);
  });
});

describe("Polarity Map: a polarity created by the agent", () => {
  // Bug: tool.polarity_map.create_polarity writes only the Polarity row ("it
  // will appear in the UI but with no poles attached"), but the page skipped
  // any polarity missing a pole, so it never appeared and couldn't be
  // removed, while the export and AI prompts still counted it.
  beforeEach(() => {
    useWorkspaceStore.setState({
      polarities: [polarity("agent", "Centralise ↔ Decentralise", { greaterPurpose: "Scale" })],
      polarityPoles: [],
    });
  });

  it("shows the polarity, and editing a pole's list creates that pole", () => {
    render(<PolarityMapClient />);
    expect(screen.getByText("Centralise ↔ Decentralise")).toBeInTheDocument();
    expect(screen.getByText("↑ Scale")).toBeInTheDocument();
    const [leftUp] = poleBoxes();
    fireEvent.change(leftUp, { target: { value: "One source of truth" } });
    fireEvent.blur(leftUp);
    expect(polesOf("agent")).toEqual([
      expect.objectContaining({ side: "left", upsides: ["One source of truth"], downsides: [] }),
    ]);
  });

  it("can be removed", () => {
    render(<PolarityMapClient />);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove polarity: Centralise ↔ Decentralise" })
    );
    expect(state().polarities).toEqual([]);
  });
});
