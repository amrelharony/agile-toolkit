import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hallucination } from "@/lib/stores/workspace-types";
import type { ActiveLlm } from "@/lib/llm/use-active-llm";

/**
 * Hallucination Log: KPIs, logging an incident (validation, trimming, length
 * caps, form reset), resolve / remove, chart data shaping (open-by-severity,
 * all-by-cause), the newest-first list, the BYOK "Reproduce" autofill and
 * the owner-dependent privacy note.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));
const llm = vi.hoisted(() => ({ state: { isReady: false } as ActiveLlm }));
const owner = vi.hoisted(() => ({ value: false }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const run = vi.hoisted(() => ({ text: "" }));

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
vi.mock("@/lib/signals/signal-bus", () => ({ emitSignal: signals.emit }));
vi.mock("@/lib/llm/use-active-llm", () => ({ useActiveLlm: () => llm.state }));
vi.mock("@/lib/auth/use-is-owner", () => ({ useIsOwner: () => owner.value }));
vi.mock("@/lib/utils/toast", () => ({ toast: toasts }));
vi.mock("@/components/shared/ai-run-panel", () => ({
  default: ({
    prompt,
    toolName,
    onResult,
  }: {
    prompt: string;
    toolName: string;
    onResult?: (r: { text: string }) => void;
  }) => (
    <div data-testid="ai-run-panel" data-tool={toolName}>
      <span>{prompt}</span>
      <button type="button" onClick={() => onResult?.({ text: run.text })}>
        Finish run
      </button>
    </div>
  ),
}));
// Stub recharts rather than ./charts: the page imports ./charts twice at
// once (two next/dynamic charts), and Vitest hands the second concurrent
// dynamic import of a vi.mock'ed module the REAL module. The bar data is
// what we want to see anyway.
vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const None = () => null;
  return {
    ResponsiveContainer: Pass,
    BarChart: ({ data }: { data: unknown }) => (
      <pre data-testid="bar-chart">{JSON.stringify(data)}</pre>
    ),
    Bar: None,
    XAxis: None,
    YAxis: None,
    Tooltip: None,
    CartesianGrid: None,
  };
});

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { HallucinationLogClient } from "@/app/(tools)/hallucination-log/hallucination-log-client";

const openSettings = vi.fn();
const NOT_READY: ActiveLlm = {
  isReady: false,
  provider: null,
  providerName: null,
  model: null,
  openSettings,
};
const READY: ActiveLlm = {
  isReady: true,
  provider: "anthropic",
  providerName: "Anthropic",
  model: "claude-test",
  openSettings,
};

const h = (id: string, p: Partial<Hallucination> = {}): Hallucination => ({
  id,
  input: `input ${id}`,
  actual: `actual ${id}`,
  severity: "medium",
  loggedAt: "2026-10-01T09:00:00.000Z",
  ...p,
});

const state = () => useWorkspaceStore.getState().hallucinations ?? [];
const kpi = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const field = (name: string) => screen.getByRole("textbox", { name });

function choose(select: string, option: string) {
  const trigger = screen.getByRole("combobox", { name: select });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  useWorkspaceStore.setState({ hallucinations: [] });
  llm.state = NOT_READY;
  owner.value = false;
  run.text = "";
  exported.csv = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
  toasts.success.mockClear();
  toasts.error.mockClear();
  openSettings.mockClear();
});

describe("Hallucination Log: empty state", () => {
  it("shows zero KPIs, no charts and no incident list", () => {
    render(<HallucinationLogClient />);
    expect(kpi("Total")).toBe("0");
    expect(kpi("Open")).toBe("0");
    expect(kpi("Resolved")).toBe("0");
    expect(kpi("Critical open")).toBe("0");
    expect(screen.queryByText("Open by severity")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Incidents \(/)).not.toBeInTheDocument();
  });

  it("tells visitors the log stays in this browser, and owners that it syncs", () => {
    const { unmount } = render(<HallucinationLogClient />);
    expect(screen.getByText(/^Logged in this browser\./)).toBeInTheDocument();
    expect(screen.queryByText(/synced to your cloud workspace/)).not.toBeInTheDocument();
    unmount();
    owner.value = true;
    render(<HallucinationLogClient />);
    expect(
      screen.getByText(/^Logged in this browser and synced to your cloud workspace\./)
    ).toBeInTheDocument();
  });
});

describe("Hallucination Log: logging an incident", () => {
  it("needs both an input and an actual response", () => {
    render(<HallucinationLogClient />);
    const logIt = screen.getByRole("button", { name: "Log incident" });
    fireEvent.click(logIt);
    fireEvent.change(field("Input (what was sent to the model)"), { target: { value: "Q" } });
    fireEvent.click(logIt);
    fireEvent.change(field("Actual response (the bad output)"), { target: { value: "   " } });
    fireEvent.click(logIt);
    expect(state()).toHaveLength(0);
    expect(signals.emit).not.toHaveBeenCalled();
  });

  it("stores trimmed fields with the chosen severity and cause, then clears the form", () => {
    render(<HallucinationLogClient />);
    fireEvent.change(field("Feature (optional)"), { target: { value: "  Search  " } });
    choose("Severity", "critical");
    choose("Root cause", "rag-miss");
    fireEvent.change(field("Input (what was sent to the model)"), {
      target: { value: "  Who won in 2030?\n" },
    });
    fireEvent.change(field("Actual response (the bad output)"), {
      target: { value: " Team X " },
    });
    fireEvent.change(field("Expected (optional)"), { target: { value: " It hasn't happened " } });
    fireEvent.click(screen.getByRole("button", { name: "Log incident" }));

    expect(state()).toHaveLength(1);
    expect(state()[0]).toMatchObject({
      feature: "Search",
      input: "Who won in 2030?",
      actual: "Team X",
      expected: "It hasn't happened",
      severity: "critical",
      rootCause: "rag-miss",
    });
    expect(state()[0].resolvedAt).toBeUndefined();
    expect(Number.isNaN(Date.parse(state()[0].loggedAt))).toBe(false);

    expect(field("Feature (optional)")).toHaveValue("");
    expect(field("Input (what was sent to the model)")).toHaveValue("");
    expect(field("Actual response (the bad output)")).toHaveValue("");
    expect(field("Expected (optional)")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Root cause" })).toHaveTextContent("Unknown");

    expect(signals.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "hallucination.logged", toolId: "hallucination-log" })
    );
    expect(history.log).toHaveBeenCalledWith("hallucination_logged", {
      id: state()[0].id,
      severity: "critical",
    });
    expect(kpi("Total")).toBe("1");
    expect(kpi("Critical open")).toBe("1");
  });

  it("leaves optional fields undefined when blank (root cause Unknown)", () => {
    render(<HallucinationLogClient />);
    fireEvent.change(field("Feature (optional)"), { target: { value: "   " } });
    fireEvent.change(field("Input (what was sent to the model)"), { target: { value: "in" } });
    fireEvent.change(field("Actual response (the bad output)"), { target: { value: "out" } });
    fireEvent.change(field("Expected (optional)"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Log incident" }));
    const saved = state()[0];
    expect(saved.feature).toBeUndefined();
    expect(saved.expected).toBeUndefined();
    expect(saved.rootCause).toBeUndefined();
    expect(saved.severity).toBe("medium");
  });

  it("caps the feature at 200 and the free-text fields at 8000 characters", () => {
    render(<HallucinationLogClient />);
    fireEvent.change(field("Feature (optional)"), { target: { value: "f".repeat(300) } });
    fireEvent.change(field("Input (what was sent to the model)"), {
      target: { value: "i".repeat(9000) },
    });
    fireEvent.change(field("Actual response (the bad output)"), {
      target: { value: "a".repeat(9000) },
    });
    fireEvent.change(field("Expected (optional)"), { target: { value: "e".repeat(9000) } });
    fireEvent.click(screen.getByRole("button", { name: "Log incident" }));
    const saved = state()[0];
    expect(saved.feature).toHaveLength(200);
    expect(saved.input).toHaveLength(8000);
    expect(saved.actual).toHaveLength(8000);
    expect(saved.expected).toHaveLength(8000);
  });
});

describe("Hallucination Log: incidents", () => {
  it("resolves one incident and moves it from open to resolved", () => {
    useWorkspaceStore.setState({
      hallucinations: [h("h1", { feature: "Search", severity: "critical" }), h("h2")],
    });
    render(<HallucinationLogClient />);
    expect(kpi("Critical open")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved: Search" }));

    expect(Number.isNaN(Date.parse(state().find((x) => x.id === "h1")!.resolvedAt ?? ""))).toBe(
      false
    );
    expect(state().find((x) => x.id === "h2")!.resolvedAt).toBeUndefined();
    expect(kpi("Open")).toBe("1");
    expect(kpi("Resolved")).toBe("1");
    expect(kpi("Critical open")).toBe("0");
    expect(screen.queryByRole("button", { name: "Mark resolved: Search" })).not.toBeInTheDocument();
    expect(signals.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "hallucination.resolved" })
    );
    expect(history.log).toHaveBeenCalledWith("hallucination_resolved", { id: "h1" });
  });

  it("removes exactly the clicked incident (labelled by input when there's no feature)", () => {
    useWorkspaceStore.setState({
      hallucinations: [h("h1"), h("h2", { input: "x".repeat(60) }), h("h3")],
    });
    render(<HallucinationLogClient />);
    fireEvent.click(
      screen.getByRole("button", { name: `Remove hallucination: ${"x".repeat(40)}` })
    );
    expect(state().map((x) => x.id)).toEqual(["h1", "h3"]);
    expect(history.log).toHaveBeenCalledWith("hallucination_removed", { id: "h2" });
  });

  it("lists newest first, sinks unparseable dates, and truncates long text to 200 chars", () => {
    useWorkspaceStore.setState({
      hallucinations: [
        h("old", { loggedAt: "2026-01-01T09:00:00.000Z" }),
        h("bad", { loggedAt: "not a date" }),
        h("new", { loggedAt: "2026-03-01T09:00:00.000Z", actual: "z".repeat(500) }),
      ],
    });
    render(<HallucinationLogClient />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.match(/input (new|old|bad)/)?.[1])).toEqual([
      "new",
      "old",
      "bad",
    ]);
    expect(within(items[0]).getByText("Out:").parentElement?.textContent).toBe(
      `Out: ${"z".repeat(200)}`
    );
    // Store order is untouched by the display sort.
    expect(state().map((x) => x.id)).toEqual(["old", "bad", "new"]);
  });

  it("shows feature, root cause and expected when present", () => {
    useWorkspaceStore.setState({
      hallucinations: [
        h("h1", { feature: "Summaries", rootCause: "context-window", expected: "Short answer" }),
      ],
    });
    render(<HallucinationLogClient />);
    const li = screen.getByRole("listitem");
    expect(within(li).getByText("Summaries")).toBeInTheDocument();
    expect(within(li).getByText("context-window")).toBeInTheDocument();
    expect(within(li).getByText("Expected: Short answer")).toBeInTheDocument();
  });

  it("falls back to the medium colour for an unknown persisted severity", () => {
    useWorkspaceStore.setState({
      hallucinations: [h("h1", { severity: "bogus" as Hallucination["severity"] })],
    });
    render(<HallucinationLogClient />);
    expect(screen.getByText("bogus")).toHaveStyle({ color: "#ffaa00" });
  });

  it("exports one CSV row per incident", () => {
    useWorkspaceStore.setState({
      hallucinations: [
        h("h1", {
          feature: "Search",
          rootCause: "model",
          expected: "e",
          resolvedAt: "2026-10-05T00:00:00.000Z",
        }),
        h("h2"),
      ],
    });
    render(<HallucinationLogClient />);
    expect(exported.csv?.rows).toEqual([
      [
        "2026-10-01",
        "Search",
        "medium",
        "model",
        "input h1",
        "actual h1",
        "e",
        "2026-10-05T00:00:00.000Z",
      ],
      ["2026-10-01", "", "medium", "", "input h2", "actual h2", "", ""],
    ]);
  });
});

describe("Hallucination Log: charts", () => {
  it("counts open incidents by severity and all incidents by root cause", async () => {
    useWorkspaceStore.setState({
      hallucinations: [
        h("h1", { severity: "high", rootCause: "prompt" }),
        h("h2", { severity: "high", rootCause: "prompt" }),
        h("h3", { severity: "low" }),
        h("h4", {
          severity: "critical",
          rootCause: "model",
          resolvedAt: "2026-10-02T00:00:00.000Z",
        }),
      ],
    });
    render(<HallucinationLogClient />);
    await waitFor(() => expect(screen.getAllByTestId("bar-chart")).toHaveLength(2));
    const charts = screen
      .getAllByTestId("bar-chart")
      .map((el) => JSON.parse(el.textContent ?? "") as Record<string, unknown>[]);
    const sev = charts.find((d) => "severity" in d[0]);
    const cause = charts.find((d) => "cause" in d[0]);
    expect(sev).toEqual([
      { severity: "low", count: 1 },
      { severity: "medium", count: 0 },
      { severity: "high", count: 2 },
      { severity: "critical", count: 0 },
    ]);
    expect(cause).toEqual([
      { cause: "prompt", count: 2 },
      { cause: "unknown", count: 1 },
      { cause: "model", count: 1 },
    ]);
  });

  it("hides the charts once nothing is open", () => {
    useWorkspaceStore.setState({
      hallucinations: [h("h1", { resolvedAt: "2026-10-02T00:00:00.000Z" })],
    });
    render(<HallucinationLogClient />);
    expect(screen.queryByText("Open by severity")).not.toBeInTheDocument();
    expect(screen.getByText("Incidents (1)")).toBeInTheDocument();
  });
});

describe("Hallucination Log: reproduce with BYOK", () => {
  it("is disabled without a provider and links to AI settings", () => {
    render(<HallucinationLogClient />);
    fireEvent.change(field("Input (what was sent to the model)"), { target: { value: "Q" } });
    expect(screen.getByRole("button", { name: "Reproduce with BYOK" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "AI settings →" }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("is disabled until an input is typed", () => {
    llm.state = READY;
    render(<HallucinationLogClient />);
    const btn = screen.getByRole("button", { name: "Reproduce with BYOK" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Type the Input above first");
  });

  it("autofills Actual with the trimmed, capped result", async () => {
    llm.state = READY;
    run.text = `  ${"r".repeat(9000)}  `;
    render(<HallucinationLogClient />);
    fireEvent.change(field("Input (what was sent to the model)"), {
      target: { value: "What is 2+2?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reproduce with BYOK" }));
    const panel = await screen.findByTestId("ai-run-panel");
    expect(panel).toHaveAttribute("data-tool", "Hallucination reproduce");
    expect(within(panel).getByText("What is 2+2?")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Finish run" }));
    expect(field("Actual response (the bad output)")).toHaveValue("r".repeat(8000));
    expect(toasts.success).toHaveBeenCalledWith("Auto-filled Actual response");

    fireEvent.click(screen.getByRole("button", { name: "Hide reproduce" }));
    expect(screen.queryByTestId("ai-run-panel")).not.toBeInTheDocument();
  });

  it("keeps Actual and reports an error on an empty response", async () => {
    llm.state = READY;
    run.text = "   \n ";
    render(<HallucinationLogClient />);
    fireEvent.change(field("Input (what was sent to the model)"), { target: { value: "Q" } });
    fireEvent.change(field("Actual response (the bad output)"), { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Reproduce with BYOK" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finish run" }));
    expect(toasts.error).toHaveBeenCalledWith("Provider returned an empty response");
    expect(field("Actual response (the bad output)")).toHaveValue("typed");
  });
});
