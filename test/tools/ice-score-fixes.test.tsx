import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * ICE: an empty Impact, Confidence or Ease used to become 5 without a word.
 * All three are required, and each missing one is named next to its scale.
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
const renderIce = () =>
  render(
    <TooltipProvider>
      <IceScoreClient />
    </TooltipProvider>
  );
/** Pick `value` on the scale named `label` (the add form's, the first on screen). */
const pick = (label: string, value: number) =>
  fireEvent.click(
    screen
      .getAllByRole("radiogroup", { name: label })[0]
      .querySelector(`[role="radio"]:nth-child(${value})`)!
  );
const addAndScore = () => fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent);

beforeEach(() => {
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("ICE: scores are required", () => {
  it("doesn't add an idea with an empty score, and names the empty field", () => {
    renderIce();
    fireEvent.change(screen.getByLabelText(/Idea or experiment/), {
      target: { value: "Onboarding email" },
    });
    pick("Impact", 8);
    pick("Confidence", 6);
    addAndScore();

    expect(iceRows()).toHaveLength(0);
    expect(alerts()).toEqual(["Pick an ease score."]);
  });

  it("adds the idea with the picked scores once every field is filled", () => {
    renderIce();
    fireEvent.change(screen.getByLabelText(/Idea or experiment/), {
      target: { value: "Onboarding email" },
    });
    pick("Impact", 8);
    pick("Confidence", 6);
    addAndScore();
    pick("Ease", 4);
    expect(alerts()).toEqual([]);
    addAndScore();

    expect(iceRows()).toHaveLength(1);
    expect(iceRows()[0]).toMatchObject({
      title: "Onboarding email",
      fields: { impact: 8, confidence: 6, ease: 4 },
      score: 192,
    });
  });

  it("lists every missing field when nothing is filled in", () => {
    renderIce();
    addAndScore();
    expect(iceRows()).toHaveLength(0);
    expect(alerts()).toEqual([
      "Enter a title.",
      "Pick an impact score.",
      "Pick a confidence score.",
      "Pick an ease score.",
    ]);
  });
});
