import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import type { RlhfPair } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * RLHF Feedback Log: win counts, logging pairs (with PII redaction on by
 * default), the newest-first list, removing, the CSV export, and the BYOK
 * pair generator that autofills A and B.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };
type PanelProps = {
  prompt: string;
  runTrigger?: number;
  providerOverride?: { provider: string; model: string; apiKey: string };
  onResult?: (r: { text: string }) => void;
};

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const panels = vi.hoisted(() => ({ props: [] as PanelProps[] }));

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
vi.mock("@/components/shared/ai-run-panel", () => ({
  default: (p: PanelProps) => {
    panels.props.push(p);
    return (
      <div data-testid="run-panel">
        {`${p.providerOverride?.provider}:${p.providerOverride?.model}|${p.runTrigger}`}
      </div>
    );
  },
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { RlhfLogClient } from "@/app/(tools)/rlhf-log/rlhf-log-client";

const pair = (
  id: string,
  winner: RlhfPair["winner"],
  loggedAt: string,
  extra: Partial<RlhfPair> = {}
): RlhfPair => ({
  id,
  prompt: `Prompt ${id}`,
  responseA: `A ${id}`,
  responseB: `B ${id}`,
  winner,
  loggedAt,
  ...extra,
});

const pairs = () => useWorkspaceStore.getState().rlhfPairs ?? [];
/** A KPI tile (its label also appears as a Winner option). */
const kpi = (label: string) =>
  screen.getByText(label, { selector: "div.tracking-wider" }).parentElement!;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const logPair = () => fireEvent.click(screen.getByRole("button", { name: "Log pair" }));
const fillPair = (prompt = "Summarise X", a = "Short answer", b = "Long answer") => {
  type("Prompt", prompt);
  type("Response A", a);
  type("Response B", b);
};

function choose(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  exported.csv = undefined;
  panels.props = [];
  history.log.mockClear();
  useWorkspaceStore.setState({ rlhfPairs: [] });
  useLlmStore.setState({ activeProvider: null, providers: {} });
  useLlmUiStore.setState({ settingsOpen: false });
});

describe("RLHF Log: empty state", () => {
  it("shows zero wins and ties, no pairs list, and a pointer to AI settings", () => {
    render(<RlhfLogClient />);
    expect(kpi("A wins")).toHaveTextContent("0");
    expect(kpi("B wins")).toHaveTextContent("0");
    expect(kpi("Ties")).toHaveTextContent("0");
    expect(screen.queryByText(/^Pairs \(/)).toBeNull();
    expect(screen.getByText("No BYOK providers configured yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(useLlmUiStore.getState().settingsOpen).toBe(true);
  });
});

describe("RLHF Log: logging a pair", () => {
  it("needs a prompt and both responses", () => {
    render(<RlhfLogClient />);
    fillPair("Summarise X", "Short", "   ");
    logPair();
    fillPair("  ", "Short", "Long");
    logPair();
    expect(pairs()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("logs a trimmed pair with A as the default winner, then resets the form", () => {
    render(<RlhfLogClient />);
    fillPair("  Summarise X ", " Short ", " Long ");
    logPair();
    const [p] = pairs();
    expect(p).toMatchObject({
      prompt: "Summarise X",
      responseA: "Short",
      responseB: "Long",
      winner: "A",
    });
    expect(p.reviewer).toBeUndefined();
    expect(p.reason).toBeUndefined();
    expect(Number.isNaN(Date.parse(p.loggedAt))).toBe(false);
    expect(history.log).toHaveBeenCalledWith("pair_logged", { winner: "A" });
    for (const label of ["Prompt", "Response A", "Response B"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
    expect(kpi("A wins")).toHaveTextContent("1");
  });

  it("logs the chosen winner, reviewer and reason, and resets the winner to A", () => {
    render(<RlhfLogClient />);
    fillPair();
    choose("Winner", "Tie");
    type("Reviewer (optional)", " Ana ");
    type("Reason (optional)", " Both fine ");
    logPair();
    expect(pairs()[0]).toMatchObject({ winner: "tie", reviewer: "Ana", reason: "Both fine" });
    expect(kpi("Ties")).toHaveTextContent("1");
    expect(screen.getByRole("combobox", { name: "Winner" })).toHaveTextContent("A wins");
    expect(screen.getByLabelText("Reviewer (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Reason (optional)")).toHaveValue("");
  });

  it("redacts emails and API keys before saving by default", () => {
    render(<RlhfLogClient />);
    fillPair(
      "Email ana@example.com about it",
      "Use key sk-ant-abcdefghijklmnopqrstuvwxyz",
      "Call +1 415 555 0100"
    );
    type("Reason (optional)", "B leaked bob@example.com");
    expect(screen.getByText("PII detected — will be redacted on save.")).toBeInTheDocument();
    logPair();
    const [p] = pairs();
    expect(p.prompt).toBe("Email [redacted:email] about it");
    expect(p.responseA).toBe("Use key [redacted:anthropic-key]");
    expect(p.responseB).not.toContain("555");
    expect(p.reason).toBe("B leaked [redacted:email]");
  });

  it("stores text as typed when redaction is turned off, and warns", () => {
    render(<RlhfLogClient />);
    fillPair("Email ana@example.com", "A", "B");
    fireEvent.click(screen.getByRole("checkbox", { name: /Redact emails/ }));
    expect(
      screen.getByText("PII detected in this entry — will be stored and exported as-is.")
    ).toBeInTheDocument();
    logPair();
    expect(pairs()[0].prompt).toBe("Email ana@example.com");
  });

  // Bug: the PII warning checked prompt and responses but not the reason,
  // although the reason is redacted (and stored as-is) like the others.
  it("warns about PII in the reason too", () => {
    render(<RlhfLogClient />);
    fillPair("Plain prompt", "A", "B");
    expect(screen.queryByText(/PII detected/)).toBeNull();
    type("Reason (optional)", "Ask ana@example.com");
    expect(screen.getByText("PII detected — will be redacted on save.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Redact emails/ }));
    expect(
      screen.getByText("PII detected in this entry — will be stored and exported as-is.")
    ).toBeInTheDocument();
  });
});

describe("RLHF Log: the pairs list", () => {
  it("counts wins and ties and lists pairs newest first", () => {
    useWorkspaceStore.setState({
      rlhfPairs: [
        pair("p1", "A", "2026-10-01T09:00:00.000Z", { reviewer: "Ana", reason: "Clearer" }),
        pair("p2", "B", "2026-10-03T09:00:00.000Z"),
        pair("p3", "A", "2026-10-02T09:00:00.000Z"),
        pair("p4", "tie", "2026-09-30T09:00:00.000Z"),
      ],
    });
    render(<RlhfLogClient />);
    expect(kpi("A wins")).toHaveTextContent("2");
    expect(kpi("B wins")).toHaveTextContent("1");
    expect(kpi("Ties")).toHaveTextContent("1");
    expect(screen.getByText("Pairs (4)")).toBeInTheDocument();
    const prompts = screen.getAllByText(/^Prompt: /).map((el) => el.textContent);
    expect(prompts).toEqual([
      "Prompt: Prompt p2",
      "Prompt: Prompt p3",
      "Prompt: Prompt p1",
      "Prompt: Prompt p4",
    ]);
    const p1 = screen.getByText("Prompt: Prompt p1").closest("li")!;
    expect(p1).toHaveTextContent("· Ana");
    expect(within(p1).getByText("Reason: Clearer")).toBeInTheDocument();
    const p2 = screen.getByText("Prompt: Prompt p2").closest("li")!;
    expect(p2).toHaveTextContent("· —");
  });

  it("clips long responses to 200 characters in the list", () => {
    useWorkspaceStore.setState({
      rlhfPairs: [
        pair("p1", "A", "2026-10-01T09:00:00.000Z", {
          responseA: "a".repeat(300),
          responseB: "b".repeat(150),
        }),
      ],
    });
    render(<RlhfLogClient />);
    expect(screen.getByText("a".repeat(200))).toBeInTheDocument();
    expect(screen.getByText("b".repeat(150))).toBeInTheDocument();
  });

  it("removes only the pair whose bin was clicked", () => {
    useWorkspaceStore.setState({
      rlhfPairs: [
        pair("p1", "A", "2026-10-01T09:00:00.000Z"),
        pair("p2", "B", "2026-10-02T09:00:00.000Z"),
      ],
    });
    render(<RlhfLogClient />);
    const row = screen.getByText("Prompt: Prompt p1").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Remove pair" }));
    expect(pairs().map((p) => p.id)).toEqual(["p2"]);
    expect(history.log).toHaveBeenCalledWith("pair_removed", { id: "p1" });
    expect(kpi("A wins")).toHaveTextContent("0");
  });

  it("exports full prompt and response text to CSV", () => {
    useWorkspaceStore.setState({
      rlhfPairs: [
        pair("p1", "B", new Date(2026, 9, 1, 12).toISOString(), {
          responseA: "a".repeat(300),
          reviewer: "Ana",
        }),
      ],
    });
    render(<RlhfLogClient />);
    expect(exported.csv?.headers).toEqual([
      "Date",
      "Prompt",
      "A",
      "B",
      "Winner",
      "Reviewer",
      "Reason",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["2026-10-01", "Prompt p1", "a".repeat(300), "B p1", "B", "Ana", ""],
    ]);
  });

  // Bug: dates were cut from the UTC timestamp, so a pair logged just after
  // local midnight (or in the evening west of UTC) showed and exported under
  // the neighbouring day.
  it("shows and exports the local calendar day the pair was logged", () => {
    const earlyMorning = new Date(2026, 9, 18, 0, 30);
    const lateEvening = new Date(2026, 9, 18, 23, 30);
    useWorkspaceStore.setState({
      rlhfPairs: [
        pair("early", "A", earlyMorning.toISOString()),
        pair("late", "B", lateEvening.toISOString()),
      ],
    });
    render(<RlhfLogClient />);
    const day = todayLocalISO(earlyMorning);
    expect(day).toBe("2026-10-18");
    expect(screen.getByText("Prompt: Prompt early").closest("li")).toHaveTextContent(day);
    expect(screen.getByText("Prompt: Prompt late").closest("li")).toHaveTextContent(day);
    expect(exported.csv?.rows.map((r) => r[0])).toEqual([day, day]);
  });
});

describe("RLHF Log: BYOK pair generator", () => {
  const generate = () => screen.getByRole("button", { name: "Generate A & B" });

  it("defaults side B to another model of the only configured provider", async () => {
    useLlmStore.setState({
      providers: { anthropic: { apiKey: "test-key", model: "claude-sonnet-4-6" } },
    });
    render(<RlhfLogClient />);
    expect(generate()).toBeDisabled();
    expect(screen.getByText("Add a prompt above.")).toBeInTheDocument();
    type("Shared prompt for A and B", "Write a haiku");
    expect(generate()).toBeEnabled();
    const shown = (await screen.findAllByTestId("run-panel")).map((p) => p.textContent);
    expect(shown[0]).toBe("anthropic:claude-sonnet-4-6|0");
    expect(shown[1]).toMatch(/^anthropic:/);
    expect(shown[1]).not.toBe("anthropic:claude-sonnet-4-6|0");
  });

  it("uses two configured providers for A and B, runs both, and autofills the form", async () => {
    useLlmStore.setState({
      providers: {
        openai: { apiKey: "test-openai", model: "gpt-4o" },
        anthropic: { apiKey: "test-anthropic", model: "claude-sonnet-4-6" },
      },
    });
    render(<RlhfLogClient />);
    type("Shared prompt for A and B", "Write a haiku");
    await screen.findAllByTestId("run-panel");
    fireEvent.click(generate());
    expect(screen.getAllByTestId("run-panel").map((p) => p.textContent)).toEqual([
      "anthropic:claude-sonnet-4-6|1",
      "openai:gpt-4o|1",
    ]);
    // The shared prompt is carried into the log form.
    expect(screen.getByLabelText("Prompt")).toHaveValue("Write a haiku");

    const latest = (provider: string) =>
      [...panels.props].reverse().find((p) => p.providerOverride?.provider === provider)!;
    act(() => {
      latest("anthropic").onResult?.({ text: "  Autumn moon  " });
      latest("openai").onResult?.({ text: "x".repeat(5000) });
    });
    expect(screen.getByLabelText("Response A")).toHaveValue("Autumn moon");
    expect((screen.getByLabelText("Response B") as HTMLTextAreaElement).value).toHaveLength(4000);
  });
});
