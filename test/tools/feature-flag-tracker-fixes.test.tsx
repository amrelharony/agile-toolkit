import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Feature Flag Tracker: choosing Deprecated from the status dropdown retires
 * the flag like the Retire button does (records today's date, so it counts
 * toward "Retired this quarter"); moving it back to a live status clears the
 * date again.
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

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { FeatureFlagTrackerClient } from "@/app/(tools)/feature-flag-tracker/feature-flag-tracker-client";
import { todayLocalISO } from "@/lib/utils/formatters";

const KEY = "agile-toolkit:feature-flag-tracker";

beforeEach(() => {
  localStorage.setItem(
    KEY,
    JSON.stringify([
      {
        id: "f1",
        name: "new-checkout",
        status: "on",
        createdAt: "2026-09-01",
        environment: "prod",
        purpose: "rollout",
      },
    ])
  );
});

const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "[]")[0];

function chooseStatus(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Status for new-checkout" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: label }));
}

describe("Feature Flag Tracker status", () => {
  it("records a retired date when the status is set to Deprecated", async () => {
    render(<FeatureFlagTrackerClient />);
    await screen.findByText("new-checkout");
    expect(screen.getByRole("button", { name: /Retire/ })).toBeInTheDocument();

    chooseStatus("Deprecated");

    expect(await screen.findByText(`retired ${todayLocalISO()}`)).toBeInTheDocument();
    expect(saved()).toMatchObject({ status: "deprecated", retiredAt: todayLocalISO() });
    // Already retired, so no Retire button.
    expect(screen.queryByRole("button", { name: /Retire/ })).not.toBeInTheDocument();
  });

  it("clears the retired date when a deprecated flag goes back to a live status", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ ...saved(), status: "deprecated", retiredAt: "2026-10-01" }])
    );
    render(<FeatureFlagTrackerClient />);
    expect(await screen.findByText("retired 2026-10-01")).toBeInTheDocument();

    chooseStatus("Active");

    expect(screen.queryByText(/^retired /)).not.toBeInTheDocument();
    expect(saved().status).toBe("active");
    expect(saved().retiredAt).toBeUndefined();
  });
});
