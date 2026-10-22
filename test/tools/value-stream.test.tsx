import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";
import { VALUE_STREAM_ACTIONS } from "@/lib/history/event-actions";

/**
 * Value Stream Map: add/rename/remove stages, the lead/process/flow/%C/A
 * KPIs, per-stage wait + data-quality warning, the IQR lead-time outlier
 * callout, the NumCell commit rules and the CSV export.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ moves: 0 }));

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
vi.mock("@/lib/history/selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history/selectors")>()),
  selectEvents: (q: { toolId?: string; action?: string }) =>
    q.toolId === "kanban" && q.action === "card_moved"
      ? Array.from({ length: signals.moves }, () => ({}))
      : [],
}));

import { ValueStreamClient } from "@/app/(tools)/value-stream/value-stream-client";

const stage = (
  id: string,
  name: string,
  processTime: number,
  leadTime: number,
  completeAccurate = 100,
  description?: string
): ValueStreamStage => ({ id, name, processTime, leadTime, completeAccurate, description });

function stages(): ValueStreamStage[] {
  return useWorkspaceStore.getState().valueStreamStages ?? [];
}

function kpi(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.nextElementSibling!.textContent ?? "";
}

function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

/** A stage's column (card + trailing arrow), found via its name field. */
function card(index: number): HTMLElement {
  const content = screen.getByLabelText(`Name for stage ${index}`).closest("div.space-y-2")!;
  return content.parentElement!.closest("div.space-y-2") as HTMLElement;
}

beforeEach(() => {
  useWorkspaceStore.setState({ valueStreamStages: [] });
  exported.csv = undefined;
  history.log.mockClear();
  signals.moves = 0;
});

describe("Value Stream — empty state", () => {
  it("shows the empty message and zeroed KPIs (no NaN)", () => {
    render(<ValueStreamClient />);
    expect(screen.getByText(/No stages yet/)).toBeInTheDocument();
    expect(kpi("Lead Time")).toBe("0.0d");
    expect(kpi("Process Time")).toBe("0.0d");
    expect(kpi("Flow Efficiency")).toBe("0%");
    expect(kpi("Rolled %C/A")).toBe("0%");
    expect(screen.queryByText(/outlier lead time/)).not.toBeInTheDocument();
  });
});

describe("Value Stream — add / edit / remove", () => {
  it("adds numbered stages with the default timings and logs them", () => {
    render(<ValueStreamClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Stage/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add Stage/ }));
    expect(stages().map((s) => s.name)).toEqual(["Stage 1", "Stage 2"]);
    expect(stages()[0]).toMatchObject({ processTime: 1, leadTime: 2, completeAccurate: 90 });
    expect(new Set(stages().map((s) => s.id)).size).toBe(2);
    expect(history.log).toHaveBeenCalledWith(VALUE_STREAM_ACTIONS.STAGE_ADDED, {
      stageId: stages()[1].id,
      name: "Stage 2",
    });
  });

  it("reuses the first free number instead of duplicating one", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", "Stage 1", 1, 2), stage("c", "Stage 3", 1, 2)],
    });
    render(<ValueStreamClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Stage/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add Stage/ }));
    expect(stages().map((s) => s.name)).toEqual(["Stage 1", "Stage 3", "Stage 2", "Stage 4"]);
  });

  it("removes exactly the clicked stage", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage("a", "Plan", 1, 2),
        stage("b", "Build", 1, 2),
        stage("c", "Ship", 1, 2),
      ],
    });
    render(<ValueStreamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove stage Build" }));
    expect(stages().map((s) => s.id)).toEqual(["a", "c"]);
    expect(history.log).toHaveBeenCalledWith(VALUE_STREAM_ACTIONS.STAGE_REMOVED, {
      stageId: "b",
      name: "Build",
    });
  });

  it("renames a stage and stores a blank description as undefined", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", "Stage 1", 1, 2, 90, "old")] });
    render(<ValueStreamClient />);
    commit(screen.getByLabelText("Name for stage 1"), "Code review");
    expect(stages()[0].name).toBe("Code review");
    commit(screen.getByLabelText("Description for stage Code review"), "waits on 2 approvers");
    expect(stages()[0].description).toBe("waits on 2 approvers");
    commit(screen.getByLabelText("Description for stage Code review"), "   ");
    expect(stages()[0].description).toBeUndefined();
  });
});

describe("Value Stream — KPIs", () => {
  it("sums lead/process time and computes flow efficiency and rolled %C/A", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", "Dev", 2, 10, 90), stage("b", "Test", 3, 10, 80)],
    });
    render(<ValueStreamClient />);
    expect(kpi("Lead Time")).toBe("20.0d");
    expect(kpi("Process Time")).toBe("5.0d");
    expect(kpi("Flow Efficiency")).toBe("25%");
    // 90% × 80% = 72%
    expect(kpi("Rolled %C/A")).toBe("72%");
  });

  it("caps flow efficiency at 100% when process exceeds lead", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", "Dev", 11, 6)] });
    render(<ValueStreamClient />);
    expect(kpi("Flow Efficiency")).toBe("100%");
  });

  it("ignores negative times and clamps %C/A into 0..100 (corrupted data)", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", "Dev", -5, 4, 150), stage("b", "Ops", 1, -4, 50)],
    });
    render(<ValueStreamClient />);
    expect(kpi("Process Time")).toBe("1.0d");
    expect(kpi("Lead Time")).toBe("4.0d");
    expect(kpi("Flow Efficiency")).toBe("25%");
    expect(kpi("Rolled %C/A")).toBe("50%");
  });

  it("shows each stage's wait time and warns when process exceeds lead", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage("a", "Dev", 1.5, 4),
        stage("b", "QA", 5, 3),
        stage("c", "Idle", 0, 0),
      ],
    });
    render(<ValueStreamClient />);
    expect(card(1)).toHaveTextContent("Wait: 2.5d");
    expect(card(1)).not.toHaveTextContent("process > lead");
    expect(card(2)).toHaveTextContent("Wait: 0.0d");
    expect(card(2)).toHaveTextContent("process > lead");
    // No lead time → no wait line.
    expect(card(3)).not.toHaveTextContent("Wait:");
  });
});

describe("Value Stream — lead-time outliers (IQR)", () => {
  it("needs at least 4 stages", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", "A", 1, 1), stage("b", "B", 1, 1), stage("c", "C", 1, 90)],
    });
    render(<ValueStreamClient />);
    expect(screen.queryByText(/outlier lead time/)).not.toBeInTheDocument();
  });

  it("names the outlier stage", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        stage("a", "A", 1, 2),
        stage("b", "B", 1, 3),
        stage("c", "C", 1, 2),
        stage("d", "D", 1, 3),
        stage("e", "Approval", 1, 40),
      ],
    });
    render(<ValueStreamClient />);
    const alert = screen.getByText(/outlier lead time/).parentElement!;
    expect(alert).toHaveTextContent("Approval (40d)");
    expect(alert).not.toHaveTextContent("A (2d)");
  });

  it("flags every stage that shares an outlier lead time", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [
        ...["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => stage(n, n, 1, 2)),
        stage("f", "Gate1", 1, 30),
        stage("g", "Gate2", 1, 30),
      ],
    });
    render(<ValueStreamClient />);
    const alert = screen.getByText(/outlier lead time/).parentElement!;
    expect(alert).toHaveTextContent("Gate1 (30d), Gate2 (30d)");
  });
});

describe("Value Stream — number fields", () => {
  it("commits process time, lead time and %C/A on blur", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", "Dev", 1, 2, 90)] });
    render(<ValueStreamClient />);
    commit(screen.getByLabelText("Process Time (d)"), "2.5");
    commit(screen.getByLabelText("Lead Time (d)"), "10");
    commit(screen.getByLabelText("%C/A"), "75");
    expect(stages()[0]).toMatchObject({ processTime: 2.5, leadTime: 10, completeAccurate: 75 });
    expect(kpi("Flow Efficiency")).toBe("25%");
  });

  it("commits on Enter", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", "Dev", 1, 2, 90)] });
    render(<ValueStreamClient />);
    const lead = screen.getByLabelText("Lead Time (d)");
    lead.focus();
    fireEvent.change(lead, { target: { value: "6" } });
    fireEvent.keyDown(lead, { key: "Enter" });
    expect(stages()[0].leadTime).toBe(6);
  });

  it("clamps %C/A above 100 to 100", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", "Dev", 1, 2, 90)] });
    render(<ValueStreamClient />);
    const ca = screen.getByLabelText("%C/A");
    commit(ca, "150");
    expect(stages()[0].completeAccurate).toBe(100);
    expect(ca).toHaveValue(100);
  });

  // Bug: when the clamped value equalled the stored one the field kept the
  // rejected input ("150", "-3") while the store held 100 / 0.
  it("shows the clamped value even when it equals the stored value", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", "Dev", 0, 2, 100)] });
    render(<ValueStreamClient />);
    const ca = screen.getByLabelText("%C/A");
    commit(ca, "150");
    expect(stages()[0].completeAccurate).toBe(100);
    expect(ca).toHaveValue(100);
    const process = screen.getByLabelText("Process Time (d)");
    commit(process, "-3");
    expect(stages()[0].processTime).toBe(0);
    expect(process).toHaveValue(0);
  });

  // Bug: Number("") is 0, so emptying a field silently committed 0.
  it("reverts an emptied field instead of committing 0", () => {
    useWorkspaceStore.setState({ valueStreamStages: [stage("a", "Dev", 1, 8, 90)] });
    render(<ValueStreamClient />);
    const lead = screen.getByLabelText("Lead Time (d)");
    commit(lead, "");
    expect(stages()[0].leadTime).toBe(8);
    expect(lead).toHaveValue(8);
  });
});

describe("Value Stream — signals and export", () => {
  it("shows recent kanban moves as a staleness hint", () => {
    signals.moves = 3;
    render(<ValueStreamClient />);
    expect(screen.getByText(/3 stories changed/)).toHaveTextContent(
      "3 stories changed status in last 7 days"
    );
  });

  it("uses the singular for one move and hides the chip with none", () => {
    const { unmount } = render(<ValueStreamClient />);
    expect(screen.queryByText(/changed\s+status/)).not.toBeInTheDocument();
    unmount();
    signals.moves = 1;
    render(<ValueStreamClient />);
    expect(screen.getByText(/1 story changed/)).toBeInTheDocument();
  });

  it("exports one CSV row per stage with a blank for a missing description", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", "Dev", 2, 5, 90, "coding"), stage("b", "QA", 1, 3, 80)],
    });
    render(<ValueStreamClient />);
    expect(exported.csv?.headers).toEqual([
      "Stage",
      "Description",
      "Process Time",
      "Lead Time",
      "%C/A",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Dev", "coding", 2, 5, 90],
      ["QA", "", 1, 3, 80],
    ]);
  });

  it("draws an arrow between stages but not after the last", () => {
    useWorkspaceStore.setState({
      valueStreamStages: [stage("a", "Dev", 1, 2), stage("b", "QA", 1, 2)],
    });
    render(<ValueStreamClient />);
    expect(within(card(1)).getByText("→")).toBeInTheDocument();
    expect(within(card(2)).queryByText("→")).not.toBeInTheDocument();
  });
});
