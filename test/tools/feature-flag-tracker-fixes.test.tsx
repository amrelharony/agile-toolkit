import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Feature Flag Tracker: retiring a flag records the day it was retired (so
 * it counts toward "Retired this quarter"), and bringing it back clears the
 * day again. Retiring used to be either the Retire button or the
 * "Deprecated" status; it is now one action, with a day, and the flags live
 * in the workspace (workspace.featureFlags) rather than the page's own key.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
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
});

import { FeatureFlagTrackerClient } from "@/app/(tools)/feature-flag-tracker/feature-flag-tracker-client";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FeatureFlag } from "@/lib/stores/workspace-types";
import { todayIso } from "@/lib/sprints/series";

const FLAG: FeatureFlag = {
  id: "f1",
  name: "new-checkout",
  status: "on",
  createdAt: "2026-09-01",
  environment: "prod",
  purpose: "rollout",
};

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ featureFlags: [FLAG] });
});

const saved = () => useWorkspaceStore.getState().featureFlags?.[0];
const renderPage = () =>
  render(
    <TooltipProvider>
      <FeatureFlagTrackerClient />
    </TooltipProvider>
  );

describe("Feature Flag Tracker retiring", () => {
  it("records the retired day (today unless moved back)", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "new-checkout" });
    fireEvent.click(within(card).getByRole("button", { name: "Retire new-checkout" }));
    fireEvent.click(within(card).getByRole("button", { name: "Retire flag" }));

    expect(saved()).toMatchObject({ status: "retired", retiredAt: todayIso() });
    // Retired, so no Retire button: Bring back instead.
    const after = screen.getByRole("article", { name: "new-checkout" });
    expect(
      within(after).queryByRole("button", { name: "Retire new-checkout" })
    ).not.toBeInTheDocument();
    expect(
      within(after).getByRole("button", { name: "Bring back new-checkout" })
    ).toBeInTheDocument();
  });

  it("clears the retired day when a retired flag is brought back", async () => {
    useWorkspaceStore.setState({
      featureFlags: [{ ...FLAG, status: "retired", retiredAt: "2026-10-01" }],
    });
    renderPage();
    const card = await screen.findByRole("article", { name: "new-checkout" });
    expect(within(card).getByText(/1 Oct 2026/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Bring back new-checkout" }));

    expect(saved()?.status).toBe("on");
    expect(saved()?.retiredAt).toBeUndefined();
  });
});
