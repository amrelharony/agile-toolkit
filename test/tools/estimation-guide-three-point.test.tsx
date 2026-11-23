import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * The Estimation Guide's Three-point check: closed under the toolbar until
 * asked; three number fields with inline errors; a status line with the
 * expected size, its range and, on a points scale, the card it rounds up to
 * ("Pick a numeric scale" on T-shirt sizes). Nothing is saved and the
 * export doesn't change.
 */

const h = vi.hoisted(() => ({
  markdown: undefined as string | undefined,
  json: undefined as unknown,
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, jsonData }: { markdown?: string; jsonData?: unknown }) => {
    h.markdown = markdown;
    h.json = jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { EstimationGuideClient } from "@/app/(tools)/estimation-guide/estimation-guide-client";
import { initialState, useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const section = () => screen.getByRole("region", { name: "Three-point check" });
const toggle = () => within(section()).getByRole("button", { name: "Three-point check" });
const field = (name: string) => within(section()).getByLabelText(name);
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const status = () => within(section()).getByRole("status");

beforeEach(() => {
  window.localStorage.clear();
  useEstimationGuideStore.setState({ ...initialState });
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [] });
  h.markdown = undefined;
  h.json = undefined;
});

describe("the Estimation Guide's Three-point check", () => {
  it("sits closed under the toolbar until asked", () => {
    render(<EstimationGuideClient />);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(section()).queryByLabelText("Best case")).toBeNull();
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(field("Best case")).toHaveAttribute("type", "number");
  });

  it("shows the expected size, its range and the Fibonacci card it rounds up to", () => {
    render(<EstimationGuideClient />);
    fireEvent.click(toggle());
    expect(status()).toHaveTextContent("");
    type("Best case", "2");
    type("Likely", "5");
    type("Worst case", "13");
    expect(status()).toHaveTextContent(
      "Expected 5.8 points, about 4 to 7.7. On the Fibonacci scale that’s 8."
    );
    expect(status()).toHaveTextContent(/talk about the risks/);
  });

  it("reads the card on the guide's scale", () => {
    useEstimationGuideStore.setState({ selectedScale: "Powers of 2" });
    render(<EstimationGuideClient />);
    fireEvent.click(toggle());
    type("Best case", "3");
    type("Likely", "5");
    type("Worst case", "8");
    expect(status()).toHaveTextContent("On the Powers of 2 scale that’s 8.");
  });

  it("asks for a numeric scale on T-shirt sizes", () => {
    useEstimationGuideStore.setState({ selectedScale: "T-Shirt" });
    render(<EstimationGuideClient />);
    fireEvent.click(toggle());
    type("Best case", "1");
    type("Likely", "2");
    type("Worst case", "3");
    expect(status()).toHaveTextContent("Expected 2 points");
    expect(status()).toHaveTextContent("Pick a numeric scale to see the card.");
  });

  it("says what's wrong beside the field, and shows no result", () => {
    render(<EstimationGuideClient />);
    fireEvent.click(toggle());
    type("Best case", "5");
    type("Likely", "3");
    expect(field("Likely")).toHaveAttribute("aria-invalid", "true");
    expect(
      within(section()).getByText("The likely case can't be smaller than the best case.")
    ).toHaveAttribute("id", field("Likely").getAttribute("aria-describedby"));
    type("Worst case", "2000");
    expect(
      within(section()).getByText("Make the worst case a number from 0 to 1000.")
    ).toBeInTheDocument();
    expect(status()).toHaveTextContent("");
  });

  it("doesn't flag a field nobody has typed in yet", () => {
    render(<EstimationGuideClient />);
    fireEvent.click(toggle());
    type("Best case", "2");
    expect(field("Likely")).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(field("Likely"));
    expect(within(section()).getByText("Enter the likely case.")).toBeInTheDocument();
  });

  it("saves nothing and leaves the export as it was", () => {
    render(<EstimationGuideClient />);
    const before = { markdown: h.markdown, json: JSON.stringify(h.json) };
    const stored = JSON.stringify(useEstimationGuideStore.getState());
    fireEvent.click(toggle());
    type("Best case", "2");
    type("Likely", "5");
    type("Worst case", "13");
    expect(JSON.stringify(useEstimationGuideStore.getState())).toBe(stored);
    expect(h.markdown).toBe(before.markdown);
    expect(JSON.stringify(h.json)).toBe(before.json);
  });
});
