import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Polarity Map: "Create polarity" used to do nothing, with no message,
 * when the title or a pole label was empty.
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

import { PolarityMapClient } from "@/app/(tools)/polarity-map/polarity-map-client";

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const create = () => fireEvent.click(screen.getByRole("button", { name: "Create polarity" }));
const polarities = () => useWorkspaceStore.getState().polarities ?? [];

beforeEach(() => {
  useWorkspaceStore.setState({ polarities: [], polarityPoles: [] });
});

describe("Polarity Map: Create polarity validation", () => {
  it("names the empty pole labels instead of doing nothing", () => {
    render(<PolarityMapClient />);
    type("Polarity title", "Autonomy and standardization");
    create();

    expect(polarities()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a left pole label and a right pole label to create the polarity."
    );
    expect(screen.getByLabelText("Left pole label")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Right pole label")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Polarity title")).not.toHaveAttribute("aria-invalid");
  });

  it("asks for all three when the form is empty", () => {
    render(<PolarityMapClient />);
    create();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a polarity title, a left pole label and a right pole label to create the polarity."
    );
  });

  it("creates the polarity and clears the message once the fields are filled", () => {
    render(<PolarityMapClient />);
    type("Polarity title", "Autonomy and standardization");
    create();
    type("Left pole label", "Autonomy");
    type("Right pole label", "Standardization");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    create();

    expect(polarities()).toHaveLength(1);
    expect(useWorkspaceStore.getState().polarityPoles).toHaveLength(2);
  });
});
