import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";

/**
 * Layout stability before hydration: the server can't read this browser's
 * saved workspace, so tools render a "Loading …" placeholder first. Below
 * desktop width it reserves about a phone screen's height, so the tool that
 * replaces it doesn't push Related tools down after the first paint (CLS up
 * to 0.46 on phones). These render on the server, where no effect runs and
 * the workspace never counts as loaded, exactly as the first HTML does.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { WORKSPACE_LOADING_RESERVE, WorkspaceLoading } from "@/components/shared/workspace-loading";
import { LoadingSprints } from "@/components/sprints/start";
import { SprintCockpit } from "@/app/(tools)/sprint/cockpit";
import { CapacityPlannerClient } from "@/app/(tools)/capacity-planner/capacity-planner-client";
import { KanbanClient } from "@/app/(tools)/kanban/kanban-client";

/** The first HTML's status placeholder, parsed back into the DOM. */
function serverStatus(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToString(ui);
  const status = host.querySelector<HTMLElement>('[role="status"]');
  if (!status) throw new Error(`no status placeholder in: ${host.innerHTML.slice(0, 200)}`);
  return status;
}

describe("WorkspaceLoading", () => {
  it("announces itself and reserves a phone screen below desktop width only", () => {
    render(<WorkspaceLoading>Loading the board…</WorkspaceLoading>);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading the board…");
    // Below lg only, viewport-relative so it fits short and tall phones.
    expect(WORKSPACE_LOADING_RESERVE).toBe("max-lg:min-h-[60svh]");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
    // Desktop keeps the old one-line card: no unprefixed min-height.
    expect(Array.from(status.classList).filter((c) => c.startsWith("min-h-"))).toEqual([]);
  });

  it("keeps the reserve when a caller adds its own classes", () => {
    render(<WorkspaceLoading className="mt-4">Loading…</WorkspaceLoading>);
    expect(screen.getByRole("status")).toHaveClass(WORKSPACE_LOADING_RESERVE, "mt-4");
  });
});

describe("pre-hydration placeholders reserve the tool's room", () => {
  it("LoadingSprints, which every sprint tool shows while the workspace loads", () => {
    const status = serverStatus(<LoadingSprints />);
    expect(status).toHaveTextContent("Loading sprints…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
  });

  it("the Sprint Cockpit (the /sprint page and the home card)", () => {
    for (const ui of [<SprintCockpit key="full" />, <SprintCockpit key="compact" compact />]) {
      const status = serverStatus(ui);
      expect(status).toHaveTextContent("Loading sprints…");
      expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
    }
  });

  it("the Capacity Planner", () => {
    const status = serverStatus(<CapacityPlannerClient />);
    expect(status).toHaveTextContent("Loading the capacity plan…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
  });

  it("the Kanban board", () => {
    const status = serverStatus(<KanbanClient />);
    expect(status).toHaveTextContent("Loading the board…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
  });
});
