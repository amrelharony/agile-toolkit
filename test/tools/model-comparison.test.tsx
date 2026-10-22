import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import type { ModelEntry } from "@/lib/stores/workspace-types";

/**
 * Model Comparison Matrix: adding models (numbers parsed, zero kept, blank
 * left empty), the eval-sorted table, removing, the model.upgraded signal on
 * a replace, the CSV export, and Live Compare's provider picker and Run all.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };
type PanelProps = {
  prompt: string;
  runTrigger?: number;
  providerOverride?: { provider: string; model: string; apiKey: string };
};

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));

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
vi.mock("@/lib/signals/signal-bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/signals/signal-bus")>()),
  emitSignal: signals.emit,
}));
vi.mock("@/components/shared/ai-run-panel", () => ({
  default: ({ prompt, runTrigger, providerOverride }: PanelProps) => (
    <div data-testid="run-panel">
      {`${providerOverride?.provider}|${providerOverride?.model}|${runTrigger}|${prompt}`}
    </div>
  ),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { ModelComparisonClient } from "@/app/(tools)/model-comparison/model-comparison-client";

const model = (p: Partial<ModelEntry> & Pick<ModelEntry, "id" | "name">): ModelEntry => ({
  vendor: "Acme",
  status: "evaluation",
  ...p,
});

const models = () => useWorkspaceStore.getState().models ?? [];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addModel = () => fireEvent.click(screen.getByRole("button", { name: /Add model/ }));
const tableRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

function chooseStatus(option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Status" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
  useWorkspaceStore.setState({ models: [] });
  useLlmStore.setState({ activeProvider: null, providers: {} });
  useLlmUiStore.setState({ settingsOpen: false });
});

describe("Model Comparison: empty state", () => {
  it("shows no table and points at AI settings for Live Compare", () => {
    render(<ModelComparisonClient />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No BYOK providers configured yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt to test")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(useLlmUiStore.getState().settingsOpen).toBe(true);
  });
});

describe("Model Comparison: adding a model", () => {
  it("needs both a name and a vendor", () => {
    render(<ModelComparisonClient />);
    type("Model name", "gpt-x");
    addModel();
    type("Model name", "  ");
    type("Vendor", "OpenAI");
    addModel();
    expect(models()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("parses every number, keeps a typed zero, and leaves blanks empty", () => {
    render(<ModelComparisonClient />);
    type("Model name", "  free-tier  ");
    type("Vendor", " Acme ");
    type("Input cost ($ per 1k tokens)", "0");
    type("Output cost ($ per 1k tokens)", "0.002");
    type("Context window (tokens)", "128000");
    type("Latency p50 (ms)", "0");
    type("Eval score (0-1)", "0.72");
    addModel();

    const [m] = models();
    expect(m).toMatchObject({
      name: "free-tier",
      vendor: "Acme",
      inputCostPer1k: 0,
      outputCostPer1k: 0.002,
      contextWindow: 128000,
      latencyP50Ms: 0,
      evalScore: 0.72,
      status: "evaluation",
    });
    expect(m.latencyP95Ms).toBeUndefined();
    expect(history.log).toHaveBeenCalledWith("model_added", { name: "free-tier" });
    // A brand-new model is not an upgrade.
    expect(signals.emit).not.toHaveBeenCalled();
  });

  it("clears the form after adding but keeps the chosen status", () => {
    render(<ModelComparisonClient />);
    chooseStatus("production");
    type("Model name", "gpt-x");
    type("Vendor", "OpenAI");
    type("Latency p95 (ms)", "900");
    addModel();
    expect(models()[0]).toMatchObject({ status: "production", latencyP95Ms: 900 });
    expect(screen.getByLabelText("Model name")).toHaveValue("");
    expect(screen.getByLabelText("Vendor")).toHaveValue("");
    expect(screen.getByLabelText("Latency p95 (ms)")).toHaveValue(null);
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("production");
  });

  it("replacing a model by name keeps one row and signals an upgrade", () => {
    useWorkspaceStore.setState({ models: [model({ id: "m1", name: "gpt-x", evalScore: 0.5 })] });
    render(<ModelComparisonClient />);
    type("Model name", "gpt-x");
    type("Vendor", "OpenAI");
    type("Eval score (0-1)", "0.9");
    fireEvent.click(screen.getByRole("button", { name: /Replace model/ }));

    expect(models()).toHaveLength(1);
    expect(models()[0]).toMatchObject({ id: "m1", vendor: "OpenAI", evalScore: 0.9 });
    expect(signals.emit).toHaveBeenCalledTimes(1);
    expect(signals.emit.mock.calls[0][0]).toMatchObject({
      kind: "model.upgraded",
      toolId: "model-comparison",
      payload: { name: "gpt-x" },
    });
  });
});

describe("Model Comparison: the table", () => {
  const seed = () =>
    useWorkspaceStore.setState({
      models: [
        model({ id: "a", name: "mid", evalScore: 0.6, inputCostPer1k: 0.5 }),
        model({ id: "b", name: "unscored" }),
        model({
          id: "c",
          name: "best",
          vendor: "Anthropic",
          evalScore: 0.853,
          inputCostPer1k: 0.003,
          outputCostPer1k: 0.015,
          contextWindow: 200000,
          latencyP50Ms: 420,
          latencyP95Ms: 1200,
          status: "production",
        }),
      ],
    });

  it("sorts by eval score, best first, with unscored models last", () => {
    seed();
    render(<ModelComparisonClient />);
    expect(screen.getByText("Models (3) — sorted by eval score")).toBeInTheDocument();
    expect(tableRows().map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "best",
      "mid",
      "unscored",
    ]);
  });

  it("formats each metric and shows a dash for missing ones", () => {
    seed();
    render(<ModelComparisonClient />);
    const best = tableRows()[0];
    const cells = within(best)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(0, 9)).toEqual([
      "best",
      "Anthropic",
      "$0.003",
      "$0.015",
      (200000).toLocaleString(),
      "420ms",
      "1200ms",
      "85%",
      "production",
    ]);
    const unscored = within(tableRows()[2])
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(unscored.slice(2, 8)).toEqual(["—", "—", "—", "—", "—", "—"]);
  });

  it("removes only the model whose bin was clicked", () => {
    seed();
    render(<ModelComparisonClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove mid" }));
    expect(models().map((m) => m.id)).toEqual(["b", "c"]);
    expect(history.log).toHaveBeenCalledWith("model_removed", { id: "a" });
    expect(screen.queryByText("mid")).toBeNull();
  });

  it("exports every model to CSV with blanks for missing metrics", () => {
    seed();
    render(<ModelComparisonClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Vendor",
      "Input/1k",
      "Output/1k",
      "Context",
      "p50ms",
      "p95ms",
      "Eval",
      "Status",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["mid", "Acme", 0.5, "", "", "", "", 0.6, "evaluation"],
      ["unscored", "Acme", "", "", "", "", "", "", "evaluation"],
      ["best", "Anthropic", 0.003, 0.015, 200000, 420, 1200, 0.853, "production"],
    ]);
  });
});

describe("Model Comparison: Live Compare", () => {
  const configure = () =>
    useLlmStore.setState({
      providers: {
        openai: { apiKey: "test-openai", model: "gpt-4o" },
        anthropic: { apiKey: "test-anthropic", model: "claude-sonnet-4-6" },
        gemini: { apiKey: "", model: "gemini-2.5-pro" },
      },
    });
  const runAll = () => screen.getByRole("button", { name: /Run all/ });
  const panels = () => screen.queryAllByTestId("run-panel").map((p) => p.textContent);

  it("lists only providers with a key, alphabetically, all selected", () => {
    configure();
    render(<ModelComparisonClient />);
    expect(screen.getByText(/against 2 configured providers in parallel/)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0].closest("label")).toHaveTextContent("ClaudeClaude Sonnet 4.6");
    expect(boxes[1].closest("label")).toHaveTextContent("OpenAIGPT-4o");
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
  });

  it("enables Run all only with a prompt and at least one provider", async () => {
    configure();
    render(<ModelComparisonClient />);
    expect(runAll()).toBeDisabled();
    expect(runAll()).toHaveTextContent("Run all (2)");
    expect(screen.getByText("Add a prompt above.")).toBeInTheDocument();

    type("Prompt to test", "Summarise the release notes");
    expect(runAll()).toBeEnabled();
    expect(await screen.findAllByTestId("run-panel")).toHaveLength(2);

    const [claude, openai] = screen.getAllByRole("checkbox");
    fireEvent.click(openai);
    expect(runAll()).toHaveTextContent("Run all (1)");
    expect(panels()).toEqual(["anthropic|claude-sonnet-4-6|0|Summarise the release notes"]);

    fireEvent.click(claude);
    expect(runAll()).toBeDisabled();
    expect(screen.getByText("Select at least one provider.")).toBeInTheDocument();
    expect(panels()).toEqual([]);
  });

  it("Run all fires every selected panel at once", async () => {
    configure();
    render(<ModelComparisonClient />);
    type("Prompt to test", "Hello");
    await screen.findAllByTestId("run-panel");
    fireEvent.click(runAll());
    expect(panels()).toEqual(["anthropic|claude-sonnet-4-6|1|Hello", "openai|gpt-4o|1|Hello"]);
    expect(history.log).toHaveBeenCalledWith("model_added", {
      name: "live-compare: 2 provider(s)",
    });
    // Nothing is added to the catalog.
    expect(models()).toEqual([]);
  });

  it("drops a provider whose key is removed and selects a newly added one", () => {
    configure();
    render(<ModelComparisonClient />);
    act(() =>
      useLlmStore.setState({
        providers: {
          openai: { apiKey: "test-openai", model: "gpt-4o" },
          glm: { apiKey: "test-glm", model: "glm-4.6" },
        },
      })
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.closest("label")?.textContent?.slice(0, 6))).toEqual([
      "GLM (Z",
      "OpenAI",
    ]);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(runAll()).toHaveTextContent("Run all (2)");
  });
});
