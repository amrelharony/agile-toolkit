import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Cost of quality: the callout credited the $1 prevention / $100 failure
 * rule to Crosby; it's the 1-10-100 rule usually credited to Labovitz and
 * Chang. "Detection" is the textbook appraisal category, and now says so.
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

import { QualityCostClient } from "@/app/(tools)/quality-cost/quality-cost-client";

beforeEach(() => {
  localStorage.clear();
});

describe("Cost of quality copy", () => {
  it("credits the 1-10-100 rule to Labovitz and Chang, not Crosby", () => {
    const { container } = render(<QualityCostClient />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Crosby/);
    expect(text).toMatch(/1-10-100 rule/);
    expect(text).toMatch(/Labovitz and Chang/);
  });

  it("labels Detection as the appraisal category", () => {
    render(<QualityCostClient />);
    expect(screen.getByLabelText("Detection (appraisal)")).toBeInTheDocument();
    expect(screen.getByText(/Textbooks call this appraisal/)).toBeInTheDocument();
  });
});
