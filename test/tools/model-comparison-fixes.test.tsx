import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelEntry } from "@/lib/stores/workspace-types";

/**
 * Model Comparison:
 *  - an empty latency showed as "—ms"; it shows "—";
 *  - re-adding a model by name silently replaced its row; the form now
 *    warns while the name matches, and the replace can be undone.
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

import { ModelComparisonClient } from "@/app/(tools)/model-comparison/model-comparison-client";

const gpt: ModelEntry = {
  id: "m1",
  name: "gpt-x",
  vendor: "OpenAI",
  latencyP50Ms: 420,
  evalScore: 0.8,
  status: "production",
};

const models = () => useWorkspaceStore.getState().models ?? [];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ models: [gpt] });
});

describe("Model Comparison: latency cells", () => {
  it("shows a dash, not '—ms', for a missing latency", () => {
    render(<ModelComparisonClient />);
    const row = screen.getByText("gpt-x").closest("tr")!;
    expect(within(row).getByText("420ms")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("—ms");
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("Model Comparison: re-adding a model by name", () => {
  it("warns while the name matches an existing model", () => {
    render(<ModelComparisonClient />);
    expect(screen.getByRole("button", { name: /Add model/ })).toBeInTheDocument();

    type("Model name", "gpt-x");
    expect(screen.getByRole("status")).toHaveTextContent(
      "gpt-x is already in the table. Adding it again replaces that row with these values"
    );
    expect(screen.getByRole("button", { name: /Replace model/ })).toBeInTheDocument();

    type("Model name", "gpt-y");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("replaces the row with an undo that restores the old values", () => {
    render(<ModelComparisonClient />);
    type("Model name", "gpt-x");
    type("Vendor", "OpenAI");
    type("Latency p50 (ms)", "300");
    fireEvent.click(screen.getByRole("button", { name: /Replace model/ }));

    expect(models()).toHaveLength(1);
    expect(models()[0]).toMatchObject({ id: "m1", latencyP50Ms: 300 });
    expect(undo.last?.label).toBe("Replaced gpt-x");

    undo.last!.revert();
    expect(models()).toHaveLength(1);
    expect(models()[0]).toMatchObject({ id: "m1", latencyP50Ms: 420, evalScore: 0.8 });
  });

  it("adds a new model without an undo toast", () => {
    render(<ModelComparisonClient />);
    type("Model name", "gpt-y");
    type("Vendor", "OpenAI");
    fireEvent.click(screen.getByRole("button", { name: /Add model/ }));
    expect(models()).toHaveLength(2);
    expect(undo.last).toBeNull();
  });
});
