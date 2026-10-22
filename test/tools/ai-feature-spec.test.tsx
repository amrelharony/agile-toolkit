import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AiFeatureSpec } from "@/lib/stores/workspace-types";

/**
 * AI Feature Spec: one synced singleton document of 11 free-text sections.
 * Typing writes straight to the store (no trimming), blur logs history once,
 * and the clipboard Markdown / CSV exports list every section in order with
 * a TBD placeholder for blanks.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({
  clipboard: undefined as string | undefined,
  csv: undefined as CsvData | undefined,
  json: undefined as unknown,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    clipboardText,
    csvData,
    jsonData,
  }: {
    clipboardText?: string;
    csvData?: CsvData;
    jsonData?: unknown;
  }) => {
    exported.clipboard = clipboardText;
    exported.csv = csvData;
    exported.json = jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { AIFeatureSpecClient } from "@/app/(tools)/ai-feature-spec/ai-feature-spec-client";

const SPEC_ID = "aiFeatureSpec:current";

const LABELS = [
  "Feature name",
  "Problem & user goal",
  "Model choice & justification",
  "Eval criteria (what 'good' means)",
  "Fallback if model fails",
  "Latency budget (ms p95)",
  "Hallucination tolerance",
  "Cost budget",
  "Human-in-the-loop checkpoints",
  "Rollout plan",
  "Success metric",
];

const blank: Omit<AiFeatureSpec, "id"> = {
  featureName: "",
  problem: "",
  modelChoice: "",
  evalCriteria: "",
  fallback: "",
  latencyBudgetMs: "",
  hallucinationTolerance: "",
  costBudget: "",
  humanLoop: "",
  rolloutPlan: "",
  successMetric: "",
};

const stored = () =>
  (useWorkspaceStore.getState().aiFeatureSpecs ?? []).find((s) => s.id === SPEC_ID);

beforeEach(() => {
  useWorkspaceStore.setState({ aiFeatureSpecs: [] });
  history.log.mockClear();
  exported.clipboard = undefined;
  exported.csv = undefined;
  exported.json = undefined;
});

describe("AI Feature Spec: empty document", () => {
  it("renders all 11 labelled sections, blank, without writing to the store", () => {
    render(<AIFeatureSpecClient />);
    for (const label of LABELS) expect(screen.getByLabelText(label)).toHaveValue("");
    // Single-line fields are inputs, the rest are textareas.
    expect(screen.getByLabelText("Feature name").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Latency budget (ms p95)").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Problem & user goal").tagName).toBe("TEXTAREA");
    expect(useWorkspaceStore.getState().aiFeatureSpecs ?? []).toHaveLength(0);
  });

  it("exports an all-TBD Markdown spec titled (unnamed)", () => {
    render(<AIFeatureSpecClient />);
    const md = exported.clipboard ?? "";
    expect(md.startsWith("# AI Feature Spec — (unnamed)\n\n## Feature name\n\n_TBD_")).toBe(true);
    expect(md.match(/^## /gm)).toHaveLength(11);
    expect(md.match(/_TBD_/g)).toHaveLength(11);
    expect(exported.csv?.headers).toEqual(["Section", "Value"]);
    expect(exported.csv?.rows).toEqual(LABELS.map((l) => [l, ""]));
  });
});

describe("AI Feature Spec: editing", () => {
  it("creates the singleton on first keystroke and keeps the text exactly as typed", () => {
    render(<AIFeatureSpecClient />);
    fireEvent.change(screen.getByLabelText("Feature name"), {
      target: { value: "Smart triage " },
    });
    expect(screen.getByLabelText("Feature name")).toHaveValue("Smart triage ");
    expect(useWorkspaceStore.getState().aiFeatureSpecs ?? []).toHaveLength(1);
    expect(stored()).toEqual({ id: SPEC_ID, ...blank, featureName: "Smart triage " });
  });

  it("keeps newlines in multi-line sections", () => {
    render(<AIFeatureSpecClient />);
    fireEvent.change(screen.getByLabelText("Rollout plan"), {
      target: { value: "1% canary\n10% for 7 days\n100%" },
    });
    expect(stored()?.rolloutPlan).toBe("1% canary\n10% for 7 days\n100%");
  });

  it("merges edits across sections instead of overwriting earlier ones", () => {
    render(<AIFeatureSpecClient />);
    fireEvent.change(screen.getByLabelText("Feature name"), { target: { value: "Triage" } });
    fireEvent.change(screen.getByLabelText("Cost budget"), { target: { value: "$0.02/req" } });
    fireEvent.change(screen.getByLabelText("Latency budget (ms p95)"), {
      target: { value: "0" },
    });
    expect(stored()).toMatchObject({
      featureName: "Triage",
      costBudget: "$0.02/req",
      latencyBudgetMs: "0",
    });
  });

  it("lets a filled section be cleared back to empty", () => {
    useWorkspaceStore.setState({
      aiFeatureSpecs: [{ id: SPEC_ID, ...blank, problem: "Inbox overload" }],
    });
    render(<AIFeatureSpecClient />);
    const problem = screen.getByLabelText("Problem & user goal");
    expect(problem).toHaveValue("Inbox overload");
    fireEvent.change(problem, { target: { value: "" } });
    expect(problem).toHaveValue("");
    expect(stored()?.problem).toBe("");
  });

  it("logs a history event on blur, not on every keystroke", () => {
    render(<AIFeatureSpecClient />);
    const field = screen.getByLabelText("Hallucination tolerance");
    fireEvent.change(field, { target: { value: "Z" } });
    fireEvent.change(field, { target: { value: "Ze" } });
    fireEvent.change(field, { target: { value: "Zero" } });
    expect(history.log).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(history.log).toHaveBeenCalledTimes(1);
    expect(history.log).toHaveBeenCalledWith("section_updated", {
      section: "hallucinationTolerance",
    });
  });

  it("reflects a spec written outside the page (agent / sync) and ignores other ids", () => {
    render(<AIFeatureSpecClient />);
    act(() =>
      useWorkspaceStore.setState({
        aiFeatureSpecs: [
          { id: "aiFeatureSpec:other", ...blank, featureName: "Not me" },
          { id: SPEC_ID, ...blank, featureName: "From agent", successMetric: "+5% retention" },
        ],
      })
    );
    expect(screen.getByLabelText("Feature name")).toHaveValue("From agent");
    expect(screen.getByLabelText("Success metric")).toHaveValue("+5% retention");
  });
});

describe("AI Feature Spec: exports of a filled spec", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      aiFeatureSpecs: [
        {
          id: SPEC_ID,
          ...blank,
          featureName: "Smart triage",
          problem: "Inbox overload",
          latencyBudgetMs: "1500",
        },
      ],
    });
  });

  it("builds Markdown with every section in display order, TBD for blanks", () => {
    render(<AIFeatureSpecClient />);
    const md = exported.clipboard ?? "";
    expect(md).toBe(
      "# AI Feature Spec — Smart triage\n\n" +
        [
          "## Feature name\n\nSmart triage",
          "## Problem & user goal\n\nInbox overload",
          "## Model choice & justification\n\n_TBD_",
          "## Eval criteria (what 'good' means)\n\n_TBD_",
          "## Fallback if model fails\n\n_TBD_",
          "## Latency budget (ms p95)\n\n1500",
          "## Hallucination tolerance\n\n_TBD_",
          "## Cost budget\n\n_TBD_",
          "## Human-in-the-loop checkpoints\n\n_TBD_",
          "## Rollout plan\n\n_TBD_",
          "## Success metric\n\n_TBD_",
        ].join("\n\n")
    );
  });

  it("exports CSV section/value rows and the raw spec as JSON", () => {
    render(<AIFeatureSpecClient />);
    expect(exported.csv?.rows[0]).toEqual(["Feature name", "Smart triage"]);
    expect(exported.csv?.rows[5]).toEqual(["Latency budget (ms p95)", "1500"]);
    expect(exported.csv?.rows[10]).toEqual(["Success metric", ""]);
    expect(exported.json).toMatchObject({ id: SPEC_ID, featureName: "Smart triage" });
  });

  it("updates the Markdown after an edit", () => {
    render(<AIFeatureSpecClient />);
    fireEvent.change(screen.getByLabelText("Feature name"), { target: { value: "Triage v2" } });
    expect(exported.clipboard?.startsWith("# AI Feature Spec — Triage v2\n")).toBe(true);
  });
});
