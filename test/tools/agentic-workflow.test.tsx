import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AgentNode, AgentWorkflow } from "@/lib/stores/workspace-types";
import type { ActiveLlm } from "@/lib/llm/use-active-llm";

/**
 * Agentic Workflow Designer: workflows + a flat list of steps per workflow,
 * the active-workflow selection, the per-step "Test" panel (agent steps only,
 * BYOK-gated) and the CSV export of the active workflow.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({
  csv: undefined as CsvData | undefined,
  filename: undefined as string | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));
const llm = vi.hoisted(() => ({ state: { isReady: false } as ActiveLlm }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData, filename }: { csvData?: CsvData; filename?: string }) => {
    exported.csv = csvData;
    exported.filename = filename;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/signals/signal-bus", () => ({ emitSignal: signals.emit }));
vi.mock("@/lib/llm/use-active-llm", () => ({ useActiveLlm: () => llm.state }));
vi.mock("@/components/shared/ai-run-panel", () => ({
  default: ({ prompt, toolName }: { prompt: string; toolName: string }) => (
    <div data-testid="ai-run-panel" data-tool={toolName}>
      {prompt}
    </div>
  ),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { AgenticWorkflowClient } from "@/app/(tools)/agentic-workflow/agentic-workflow-client";

const NOT_READY: ActiveLlm = {
  isReady: false,
  provider: null,
  providerName: null,
  model: null,
  openSettings: () => {},
};
const READY: ActiveLlm = {
  isReady: true,
  provider: "anthropic",
  providerName: "Anthropic",
  model: "claude-test",
  openSettings: () => {},
};

const wf = (id: string, name: string, description?: string): AgentWorkflow => ({
  id,
  name,
  description,
});
const node = (
  id: string,
  workflowId: string,
  label: string,
  kind: AgentNode["kind"],
  description?: string
): AgentNode => ({ id, workflowId, label, kind, description });

function seed(workflows: AgentWorkflow[], nodes: AgentNode[] = []) {
  useWorkspaceStore.setState({ agentWorkflows: workflows, agentNodes: nodes });
}

const state = () => useWorkspaceStore.getState();

function chooseKind(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Step kind" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: label }));
}

/** Visible step rows, in order, as their text content. */
function stepRows() {
  return screen.queryAllByRole("listitem").map((li) => li.textContent ?? "");
}

beforeEach(() => {
  seed([]);
  llm.state = NOT_READY;
  exported.csv = undefined;
  exported.filename = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
});

describe("Agentic Workflow: empty state", () => {
  it("shows only the create form when there are no workflows", () => {
    render(<AgenticWorkflowClient />);
    expect(screen.getByRole("textbox", { name: "Workflow name" })).toHaveValue("");
    expect(screen.queryByText(/^Steps in/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove workflow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Step label" })).not.toBeInTheDocument();
  });
});

describe("Agentic Workflow: creating workflows", () => {
  it("creates a trimmed workflow, selects it, clears the form and emits a signal", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "  RAG pipeline  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow description (optional)" }), {
      target: { value: "  answers from docs " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const wfs = state().agentWorkflows ?? [];
    expect(wfs).toHaveLength(1);
    expect(wfs[0]).toMatchObject({ name: "RAG pipeline", description: "answers from docs" });
    expect(screen.getByText('Steps in "RAG pipeline" (0)')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RAG pipeline" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("textbox", { name: "Workflow name" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Workflow description (optional)" })).toHaveValue(
      ""
    );
    expect(signals.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "agentWorkflow.created", toolId: "agentic-workflow" })
    );
    expect(history.log).toHaveBeenCalledWith("workflow_added", { name: "RAG pipeline" });
  });

  it("stores a blank description as undefined", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "Triage" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow description (optional)" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((state().agentWorkflows ?? [])[0].description).toBeUndefined();
  });

  it("ignores a blank or whitespace-only name", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workflow name" }), {
      target: { value: "    " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(state().agentWorkflows ?? []).toHaveLength(0);
    expect(signals.emit).not.toHaveBeenCalled();
  });

  it("keeps the name field typeable with inner and trailing spaces while typing", () => {
    render(<AgenticWorkflowClient />);
    const name = screen.getByRole("textbox", { name: "Workflow name" });
    fireEvent.change(name, { target: { value: "Ticket " } });
    expect(name).toHaveValue("Ticket ");
    fireEvent.change(name, { target: { value: "Ticket router" } });
    expect(name).toHaveValue("Ticket router");
  });
});

describe("Agentic Workflow: selecting and listing steps", () => {
  beforeEach(() => {
    seed(
      [wf("w1", "Support bot"), wf("w2", "Research agent")],
      [
        node("n1", "w1", "Classify ticket", "agent", "Pick a queue"),
        node("n2", "w1", "Lookup CRM", "tool"),
        node("n3", "w1", "Escalate", "human"),
        node("n4", "w2", "Search web", "tool"),
      ]
    );
  });

  it("auto-selects the first workflow and lists only its steps, numbered in order", () => {
    render(<AgenticWorkflowClient />);
    expect(screen.getByText('Steps in "Support bot" (3)')).toBeInTheDocument();
    const rows = stepRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("#1");
    expect(rows[0]).toContain("agent");
    expect(rows[0]).toContain("Classify ticket");
    expect(rows[0]).toContain("Pick a queue");
    expect(rows[1]).toContain("#2");
    expect(rows[1]).toContain("Lookup CRM");
    expect(rows[2]).toContain("#3");
    expect(rows[2]).toContain("human");
    expect(screen.queryByText("Search web")).not.toBeInTheDocument();
  });

  it("switches the step list when another workflow chip is clicked", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Research agent" }));
    expect(screen.getByText('Steps in "Research agent" (1)')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Research agent" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Support bot" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByText("Search web")).toBeInTheDocument();
    expect(screen.queryByText("Classify ticket")).not.toBeInTheDocument();
  });

  it("shows an empty step list for a workflow without steps", () => {
    seed([wf("w1", "Fresh")]);
    render(<AgenticWorkflowClient />);
    expect(screen.getByText('Steps in "Fresh" (0)')).toBeInTheDocument();
    expect(stepRows()).toHaveLength(0);
  });

  it("exports the active workflow's steps as CSV rows", () => {
    render(<AgenticWorkflowClient />);
    expect(exported.filename).toBe("workflow-Support bot");
    expect(exported.csv?.headers).toEqual(["Workflow", "Step", "Kind", "Description"]);
    expect(exported.csv?.rows).toEqual([
      ["Support bot", "Classify ticket", "agent", "Pick a queue"],
      ["Support bot", "Lookup CRM", "tool", ""],
      ["Support bot", "Escalate", "human", ""],
    ]);
  });
});

describe("Agentic Workflow: adding and removing steps", () => {
  beforeEach(() => {
    seed([wf("w1", "Support bot"), wf("w2", "Research agent")]);
  });

  it("adds a trimmed step of the chosen kind to the active workflow", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Research agent" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Step label" }), {
      target: { value: "  Call search API " },
    });
    chooseKind("tool");
    fireEvent.change(screen.getByRole("textbox", { name: "Step description (optional)" }), {
      target: { value: " Bing, top 5 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));

    const nodes = state().agentNodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      workflowId: "w2",
      label: "Call search API",
      kind: "tool",
      description: "Bing, top 5",
    });
    expect(screen.getByText('Steps in "Research agent" (1)')).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Step label" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Step description (optional)" })).toHaveValue("");
    expect(history.log).toHaveBeenCalledWith("node_added", {
      label: "Call search API",
      kind: "tool",
    });
  });

  it("resets the kind to agent after adding, so a one-off kind doesn't stick", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "Step label" }), {
      target: { value: "Fallback answer" },
    });
    chooseKind("fallback");
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(screen.getByRole("combobox", { name: "Step kind" })).toHaveTextContent("agent");

    fireEvent.change(screen.getByRole("textbox", { name: "Step label" }), {
      target: { value: "Draft reply" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect((state().agentNodes ?? []).map((n) => [n.label, n.kind])).toEqual([
      ["Fallback answer", "fallback"],
      ["Draft reply", "agent"],
    ]);
  });

  it("stores a blank step description as undefined and ignores a blank label", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Step label" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(state().agentNodes ?? []).toHaveLength(0);

    fireEvent.change(screen.getByRole("textbox", { name: "Step label" }), {
      target: { value: "Route" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Step description (optional)" }), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect((state().agentNodes ?? [])[0].description).toBeUndefined();
  });

  it("removes exactly the clicked step", () => {
    seed(
      [wf("w1", "Support bot")],
      [
        node("n1", "w1", "Classify", "agent"),
        node("n2", "w1", "Lookup", "tool"),
        node("n3", "w1", "Escalate", "human"),
      ]
    );
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove step: Lookup" }));
    expect((state().agentNodes ?? []).map((n) => n.id)).toEqual(["n1", "n3"]);
    expect(screen.getByText('Steps in "Support bot" (2)')).toBeInTheDocument();
    const rows = stepRows();
    expect(rows[1]).toContain("#2");
    expect(rows[1]).toContain("Escalate");
    expect(history.log).toHaveBeenCalledWith("node_removed", { id: "n2" });
  });
});

describe("Agentic Workflow: removing workflows", () => {
  beforeEach(() => {
    seed(
      [wf("w1", "Support bot"), wf("w2", "Research agent")],
      [node("n1", "w1", "Classify", "agent"), node("n2", "w2", "Search", "tool")]
    );
  });

  it("removing the active workflow drops its steps and selects the next one", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove workflow Support bot" }));
    expect((state().agentWorkflows ?? []).map((w) => w.id)).toEqual(["w2"]);
    expect((state().agentNodes ?? []).map((n) => n.id)).toEqual(["n2"]);
    expect(screen.getByText('Steps in "Research agent" (1)')).toBeInTheDocument();
  });

  it("removing an inactive workflow keeps the current selection", () => {
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove workflow Research agent" }));
    expect((state().agentWorkflows ?? []).map((w) => w.id)).toEqual(["w1"]);
    expect(screen.getByText('Steps in "Support bot" (1)')).toBeInTheDocument();
  });

  it("removing the last workflow returns to the empty state", () => {
    seed([wf("w1", "Only")]);
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove workflow Only" }));
    expect(state().agentWorkflows ?? []).toHaveLength(0);
    expect(screen.queryByText(/^Steps in/)).not.toBeInTheDocument();
  });

  // Bug: a selection pointing at a workflow deleted elsewhere (agent/MCP, another
  // device) left the page with no workflow selected even though others remained.
  it("re-selects a remaining workflow when the active one is deleted outside the page", () => {
    render(<AgenticWorkflowClient />);
    expect(screen.getByText('Steps in "Support bot" (1)')).toBeInTheDocument();
    act(() => state().removeAgentWorkflow("w1"));
    expect(screen.getByText('Steps in "Research agent" (1)')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Research agent" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("Agentic Workflow: per-step test panel", () => {
  beforeEach(() => {
    seed(
      [wf("w1", "Support bot")],
      [
        node("n1", "w1", "Classify ticket", "agent", "  Pick a queue  "),
        node("n2", "w1", "Lookup CRM", "tool"),
        node("n3", "w1", "Draft reply", "agent"),
      ]
    );
  });

  it("offers Test only on agent steps, disabled until a provider is configured", () => {
    render(<AgenticWorkflowClient />);
    const tests = screen.getAllByRole("button", { name: "Test step" });
    expect(tests).toHaveLength(2);
    for (const b of tests) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute("title", "Configure an AI provider in settings to test this step");
    }
  });

  it("opens one panel at a time with the step's label + trimmed description as the prompt", async () => {
    llm.state = READY;
    render(<AgenticWorkflowClient />);
    const [first, second] = screen.getAllByRole("button", { name: "Test step" });
    expect(first).toBeEnabled();

    fireEvent.click(first);
    const panel = await screen.findByTestId("ai-run-panel");
    expect(panel.textContent).toBe("Classify ticket\n\nPick a queue");
    expect(panel).toHaveAttribute("data-tool", "Agentic step: Classify ticket");
    expect(screen.getByRole("button", { name: "Hide test panel" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    fireEvent.click(second);
    const panels = await screen.findAllByTestId("ai-run-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toBe("Draft reply");

    fireEvent.click(screen.getByRole("button", { name: "Hide test panel" }));
    expect(screen.queryByTestId("ai-run-panel")).not.toBeInTheDocument();
  });

  it("closes the panel when the step under test is removed", async () => {
    llm.state = READY;
    render(<AgenticWorkflowClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Test step" })[0]);
    await screen.findByTestId("ai-run-panel");
    fireEvent.click(screen.getByRole("button", { name: "Remove step: Classify ticket" }));
    expect(screen.queryByTestId("ai-run-panel")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Test step" })).toHaveLength(1);
  });
});
