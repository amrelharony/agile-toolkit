import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * SLO builder: "Add SLO" and "Log burn" used to return silently on blank
 * or invalid input (and a blank target / blank minutes parsed as 0). They
 * now say what's wrong and save nothing until it's fixed.
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
vi.mock("@/components/shared/smart-input", () => ({
  SmartInput: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SloBuilderClient } from "@/app/(tools)/slo-builder/slo-builder-client";

const doc = () => (useWorkspaceStore.getState().sloBuilders ?? [])[0];

/** NumericField commits on blur, like a real user tabbing out. */
function typeNumber(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

beforeEach(() => {
  useWorkspaceStore.setState({ sloBuilders: [] });
});

describe("SLO builder validation", () => {
  it("explains why a blank SLO can't be added, then clears once fixed", () => {
    render(<SloBuilderClient />);
    typeNumber("Target (%)", "");
    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Name is required.");
    expect(alert).toHaveTextContent("SLI description is required.");
    expect(alert).toHaveTextContent(/Target must be a percentage from 0 to 100/);
    expect(doc()?.slos ?? []).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "checkout" } });
    fireEvent.change(screen.getByLabelText("SLI description"), {
      target: { value: "2xx on /checkout" },
    });
    typeNumber("Target (%)", "99.9");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));
    expect(doc()?.slos).toHaveLength(1);
    expect(doc()?.slos[0].target).toBeCloseTo(0.999);
  });

  it("rejects a window under one day with a message", () => {
    render(<SloBuilderClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.change(screen.getByLabelText("SLI description"), { target: { value: "2xx" } });
    typeNumber("Window (days)", "0");
    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Window must be at least 1 day.");
    expect(doc()?.slos ?? []).toHaveLength(0);
  });

  it("refuses a blank or negative burn instead of logging 0 minutes", () => {
    useWorkspaceStore.setState({
      sloBuilders: [
        {
          id: "sloBuilder:current",
          slos: [{ id: "s1", name: "api", sliDescription: "2xx", target: 0.999, windowDays: 30 }],
          burns: [],
        },
      ] as never,
    });
    render(<SloBuilderClient />);

    fireEvent.click(screen.getByRole("button", { name: /Log burn/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Error minutes must be a number/);
    expect(doc()?.burns).toHaveLength(0);

    typeNumber("Error minutes", "-3");
    fireEvent.click(screen.getByRole("button", { name: /Log burn/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Error minutes must be a number/);
    expect(doc()?.burns).toHaveLength(0);

    typeNumber("Error minutes", "4.5");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Log burn/ }));
    expect(doc()?.burns).toHaveLength(1);
    expect(doc()?.burns[0].errorMinutes).toBe(4.5);
  });
});
