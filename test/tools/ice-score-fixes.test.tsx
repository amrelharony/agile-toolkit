import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * ICE: an empty Impact, Confidence or Ease used to become 5 without a word.
 * All three are now required, with a message naming what's missing.
 */

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

import { IceScoreClient } from "@/app/(tools)/ice-score/ice-score-client";

const iceRows = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter((r) => r.framework === "ice");
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addAndScore = () => fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

beforeEach(() => {
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("ICE: scores are required", () => {
  it("doesn't add an idea with an empty score, and names the empty field", () => {
    render(<IceScoreClient />);
    type("Title", "Onboarding email");
    type("Impact (1–10)", "8");
    type("Confidence (1–10)", "6");
    addAndScore();

    expect(iceRows()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter Ease to score this idea. Each score runs from 1 to 10."
    );
    expect(screen.getByLabelText("Ease (1–10)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Impact (1–10)")).not.toHaveAttribute("aria-invalid");
  });

  it("adds the idea with the typed scores once every field is filled", () => {
    render(<IceScoreClient />);
    type("Title", "Onboarding email");
    type("Impact (1–10)", "8");
    type("Confidence (1–10)", "6");
    addAndScore();
    type("Ease (1–10)", "4");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    addAndScore();

    expect(iceRows()).toHaveLength(1);
    expect(iceRows()[0]).toMatchObject({
      title: "Onboarding email",
      fields: { impact: 8, confidence: 6, ease: 4 },
      score: 192,
    });
  });

  it("lists every missing field when nothing is filled in", () => {
    render(<IceScoreClient />);
    addAndScore();
    expect(iceRows()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a title, Impact, Confidence and Ease to score this idea."
    );
  });
});
