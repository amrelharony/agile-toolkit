import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelCard } from "@/lib/stores/workspace-types";
import { MODEL_CARD_ACTIONS } from "@/lib/history/event-actions";

/**
 * Model Card Builder: the draft form saves a card (and clears itself), the
 * list shows every documented field, remove deletes the right card, and the
 * CSV export carries one row per card.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({
  csv: undefined as CsvData | undefined,
  json: undefined as unknown,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData, jsonData }: { csvData?: CsvData; jsonData?: unknown }) => {
    exported.csv = csvData;
    exported.json = jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/signals/signal-bus", async (orig) => ({
  ...(await orig<typeof import("@/lib/signals/signal-bus")>()),
  emitSignal: signals.emit,
}));

import { ModelCardClient } from "@/app/(tools)/model-card/model-card-client";

const card = (id: string, over: Partial<ModelCard> = {}): ModelCard => ({
  id,
  modelName: `model-${id}`,
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

const cards = () => useWorkspaceStore.getState().modelCards ?? [];

const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

function type(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } });
}

beforeEach(() => {
  exported.csv = undefined;
  exported.json = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
  useWorkspaceStore.setState({ modelCards: [] });
});

describe("Model Card Builder: empty state", () => {
  it("shows only the draft form when no cards exist", () => {
    render(<ModelCardClient />);
    expect(screen.getByRole("button", { name: /Save card/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Cards \(/)).not.toBeInTheDocument();
    expect(exported.csv).toBeUndefined();
  });

  it("refuses to save without a model name (blank or whitespace)", () => {
    render(<ModelCardClient />);
    fireEvent.click(screen.getByRole("button", { name: /Save card/ }));
    type("Model name", "   ");
    type("Intended use", "Summaries");
    fireEvent.click(screen.getByRole("button", { name: /Save card/ }));
    expect(cards()).toHaveLength(0);
    expect(history.log).not.toHaveBeenCalled();
    expect(signals.emit).not.toHaveBeenCalled();
    // The draft is kept so the user can finish it.
    expect(field("Intended use").value).toBe("Summaries");
  });
});

describe("Model Card Builder: saving a card", () => {
  it("stores every field, logs, publishes a signal and clears the draft", () => {
    render(<ModelCardClient />);
    type("Model name", "support-bot-v2");
    type("Intended use", "Tier-1 support replies");
    type("Training data", "2025 ticket archive");
    type("Evaluation results", "92% helpfulness");
    type("Limitations & biases", "English only");
    type("License", "Internal");
    fireEvent.click(screen.getByRole("button", { name: /Save card/ }));

    expect(cards()).toHaveLength(1);
    const saved = cards()[0];
    expect(saved).toMatchObject({
      modelName: "support-bot-v2",
      intendedUse: "Tier-1 support replies",
      trainingData: "2025 ticket archive",
      evaluation: "92% helpfulness",
      limitations: "English only",
      license: "Internal",
    });
    expect(saved.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false);

    expect(history.log).toHaveBeenCalledWith(MODEL_CARD_ACTIONS.CARD_SAVED, {
      modelName: "support-bot-v2",
    });
    expect(signals.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "modelCard.published",
        toolId: "model-card",
        at: saved.updatedAt,
        payload: saved,
      })
    );

    for (const name of [
      "Model name",
      "Intended use",
      "Training data",
      "Evaluation results",
      "Limitations & biases",
      "License",
    ]) {
      expect(field(name).value).toBe("");
    }
    expect(screen.getByText("Cards (1)")).toBeInTheDocument();
  });

  // Bug: fields were saved untrimmed, so a blank-but-spaced field rendered an empty "Use:" line.
  it("trims the saved fields and leaves whitespace-only ones unset", () => {
    render(<ModelCardClient />);
    type("Model name", "  ranker  ");
    type("Intended use", "   ");
    type("License", " MIT ");
    fireEvent.click(screen.getByRole("button", { name: /Save card/ }));
    const saved = cards()[0];
    expect(saved.modelName).toBe("ranker");
    expect(saved.license).toBe("MIT");
    expect(saved.intendedUse).toBeUndefined();
    const item = screen.getByText("ranker").closest("li")!;
    expect(item).not.toHaveTextContent("Use:");
    expect(item).toHaveTextContent("License: MIT");
  });

  it("keeps every keystroke while typing (no trimming on change)", () => {
    render(<ModelCardClient />);
    type("Model name", "gpt ");
    expect(field("Model name").value).toBe("gpt ");
    type("Intended use", "line one\n");
    expect(field("Intended use").value).toBe("line one\n");
  });

  it("saves a second card alongside the first rather than replacing it", () => {
    render(<ModelCardClient />);
    type("Model name", "a");
    fireEvent.click(screen.getByRole("button", { name: /Save card/ }));
    type("Model name", "b");
    fireEvent.click(screen.getByRole("button", { name: /Save card/ }));
    expect(cards().map((c) => c.modelName)).toEqual(["a", "b"]);
    expect(new Set(cards().map((c) => c.id)).size).toBe(2);
    expect(screen.getByText("Cards (2)")).toBeInTheDocument();
  });
});

describe("Model Card Builder: card list", () => {
  it("shows each documented field on its card", () => {
    useWorkspaceStore.setState({
      modelCards: [
        card("1", {
          modelName: "ranker",
          intendedUse: "Search ranking",
          trainingData: "Click logs 2025",
          evaluation: "NDCG 0.71",
          limitations: "Cold-start items",
          license: "Apache-2.0",
        }),
      ],
    });
    render(<ModelCardClient />);
    const item = screen.getByText("ranker").closest("li")!;
    expect(item).toHaveTextContent("Use: Search ranking");
    expect(item).toHaveTextContent("Eval: NDCG 0.71");
    expect(item).toHaveTextContent("Limits: Cold-start items");
    expect(item).toHaveTextContent("License: Apache-2.0");
    // Bug: training data was saved and exported but never shown on the card.
    expect(item).toHaveTextContent("Data: Click logs 2025");
  });

  it("omits the lines for fields a card leaves blank", () => {
    useWorkspaceStore.setState({ modelCards: [card("1", { modelName: "bare" })] });
    render(<ModelCardClient />);
    const item = screen.getByText("bare").closest("li")!;
    expect(item.textContent).toBe("bare");
    expect(item.querySelectorAll("p")).toHaveLength(0);
    expect(within(item).getByRole("button", { name: "Remove model card bare" })).toBeVisible();
  });

  it("removes only the chosen card and logs it", () => {
    useWorkspaceStore.setState({
      modelCards: [card("1", { modelName: "keep" }), card("2", { modelName: "drop" })],
    });
    render(<ModelCardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove model card drop" }));
    expect(cards().map((c) => c.id)).toEqual(["1"]);
    expect(history.log).toHaveBeenCalledWith(MODEL_CARD_ACTIONS.CARD_REMOVED, { id: "2" });
    expect(screen.getByText("Cards (1)")).toBeInTheDocument();
  });

  it("hides the list again when the last card is removed", () => {
    useWorkspaceStore.setState({ modelCards: [card("1", { modelName: "only" })] });
    render(<ModelCardClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove model card only" }));
    expect(cards()).toEqual([]);
    expect(screen.queryByText(/^Cards \(/)).not.toBeInTheDocument();
  });
});

describe("Model Card Builder: export", () => {
  it("exports one CSV row per card, blanks for missing fields", () => {
    useWorkspaceStore.setState({
      modelCards: [
        card("1", {
          modelName: "ranker",
          intendedUse: "Search",
          trainingData: "Clicks",
          evaluation: "NDCG",
          limitations: "Cold start",
          license: "MIT",
        }),
        card("2", { modelName: "bare", updatedAt: "2026-10-02T00:00:00.000Z" }),
      ],
    });
    render(<ModelCardClient />);
    expect(exported.csv?.headers).toEqual([
      "Model",
      "Intended use",
      "Training data",
      "Evaluation",
      "Limitations",
      "License",
      "Updated",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["ranker", "Search", "Clicks", "NDCG", "Cold start", "MIT", "2026-10-01T09:00:00.000Z"],
      ["bare", "", "", "", "", "", "2026-10-02T00:00:00.000Z"],
    ]);
    expect(exported.json).toEqual(cards());
  });
});
