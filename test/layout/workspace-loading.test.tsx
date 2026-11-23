import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";

/**
 * Layout stability before hydration: the server can't read this browser's
 * saved workspace, so tools render a "Loading …" placeholder first. On
 * phones it reserves about a phone screen's height, so the tool that
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
// Sprint Planning asks for the router, which only a mounted app provides.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {} }),
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

import {
  WORKSPACE_LOADING_RESERVE,
  WORKSPACE_LOADING_RESERVE_TALL,
  WorkspaceLoading,
} from "@/components/shared/workspace-loading";
import { LoadingSprints } from "@/components/sprints/start";
import { COCKPIT_ABOUT, SprintCockpit } from "@/app/(tools)/sprint/cockpit";
import { PLANNING_ABOUT, SprintPlanning } from "@/app/(tools)/sprint-planning/planning";
import { CapacityPlannerClient } from "@/app/(tools)/capacity-planner/capacity-planner-client";
import { KanbanClient } from "@/app/(tools)/kanban/kanban-client";
import { RetroActionsTracker } from "@/app/(tools)/retro-actions/tracker";
import { TeamClient } from "@/app/(meta)/team/team-client";

/** The first HTML's status placeholder, parsed back into the DOM. */
function serverStatus(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToString(ui);
  const status = host.querySelector<HTMLElement>('[role="status"]');
  if (!status) throw new Error(`no status placeholder in: ${host.innerHTML.slice(0, 200)}`);
  return status;
}

describe("WorkspaceLoading", () => {
  it("announces itself and reserves a phone screen on phones only", () => {
    render(<WorkspaceLoading>Loading the board…</WorkspaceLoading>);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading the board…");
    // Below md only, viewport-relative so it fits short and tall phones.
    expect(WORKSPACE_LOADING_RESERVE).toBe("max-md:min-h-[60svh]");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
    // Tablets (768x1024, where the short visitor empty states would pull
    // Related tools up into view) and desktop keep the old one-line card: no
    // unprefixed or tablet-wide min-height.
    const minHeights = Array.from(status.classList).filter((c) => c.includes("min-h-"));
    expect(minHeights).toEqual(["max-md:min-h-[60svh]"]);
  });

  it("adds a full screen from md up for tall tools only", () => {
    render(<WorkspaceLoading tall>Loading the board…</WorkspaceLoading>);
    expect(WORKSPACE_LOADING_RESERVE_TALL).toBe("md:min-h-[100svh]");
    const minHeights = Array.from(screen.getByRole("status").classList).filter((c) =>
      c.includes("min-h-")
    );
    expect(minHeights).toEqual(["max-md:min-h-[60svh]", "md:min-h-[100svh]"]);
  });

  it("keeps the reserve when a caller adds its own classes", () => {
    render(<WorkspaceLoading className="mt-4">Loading…</WorkspaceLoading>);
    expect(screen.getByRole("status")).toHaveClass(WORKSPACE_LOADING_RESERVE, "mt-4");
  });

  it("can say what the page does, inside the same card and outside the status", () => {
    render(
      <WorkspaceLoading tall className="mt-4" about="This page plans a sprint.">
        Loading sprints…
      </WorkspaceLoading>
    );
    const status = screen.getByRole("status");
    // Only the loading line is the status: the sentence isn't an announcement.
    expect(status).toHaveTextContent(/^Loading sprints…$/);
    const about = screen.getByText("This page plans a sprint.");
    expect(about.tagName).toBe("P");
    expect(status).not.toContainElement(about);
    // One card holds both, and it is the card that reserves the room now.
    const card = status.parentElement!;
    expect(card).toContainElement(about);
    expect(card).toHaveClass(WORKSPACE_LOADING_RESERVE, WORKSPACE_LOADING_RESERVE_TALL, "mt-4");
    expect(Array.from(status.classList).filter((c) => c.includes("min-h-"))).toEqual([]);
    // The sentence comes first, the way it reads.
    expect(about.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("pre-hydration placeholders reserve the tool's room", () => {
  it("LoadingSprints, which every sprint tool shows while the workspace loads", () => {
    const status = serverStatus(<LoadingSprints />);
    expect(status).toHaveTextContent("Loading sprints…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
    // Short sprint tools (Sprint Planning, Burndown) keep the phone-only reserve.
    expect(status).not.toHaveClass(WORKSPACE_LOADING_RESERVE_TALL);
  });

  it("the Sprint Cockpit's home card", () => {
    const status = serverStatus(<SprintCockpit compact />);
    expect(status).toHaveTextContent("Loading sprints…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE, WORKSPACE_LOADING_RESERVE_TALL);
    // Home says what the toolkit is in its own words; the card adds none.
    expect(status.parentElement).not.toHaveTextContent(COCKPIT_ABOUT);
  });

  it("the Sprint Cockpit's page, which also says what the page does", () => {
    const status = serverStatus(<SprintCockpit />);
    expect(status).toHaveTextContent(/^Loading sprints…$/);
    // The card around the sentence and the status holds the room.
    const card = status.parentElement!;
    expect(card).toHaveTextContent(COCKPIT_ABOUT);
    expect(card).toHaveClass(WORKSPACE_LOADING_RESERVE, WORKSPACE_LOADING_RESERVE_TALL);
  });

  it("Sprint Planning, which also says what the page does", () => {
    const status = serverStatus(<SprintPlanning />);
    expect(status).toHaveTextContent(/^Loading sprints…$/);
    const card = status.parentElement!;
    expect(card).toHaveTextContent(PLANNING_ABOUT);
    // A short tool: the phone-only reserve, as before.
    expect(card).toHaveClass(WORKSPACE_LOADING_RESERVE);
    expect(card).not.toHaveClass(WORKSPACE_LOADING_RESERVE_TALL);
  });

  it("the Capacity Planner", () => {
    const status = serverStatus(<CapacityPlannerClient />);
    expect(status).toHaveTextContent("Loading the capacity plan…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE, WORKSPACE_LOADING_RESERVE_TALL);
  });

  it("the Kanban board", () => {
    const status = serverStatus(<KanbanClient />);
    expect(status).toHaveTextContent("Loading the board…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE, WORKSPACE_LOADING_RESERVE_TALL);
  });

  it("Retro Actions", () => {
    const status = serverStatus(<RetroActionsTracker />);
    expect(status).toHaveTextContent("Loading retro actions…");
    expect(status).toHaveClass(WORKSPACE_LOADING_RESERVE);
  });

  it("the Team page, capped near its empty state's height", () => {
    const status = serverStatus(<TeamClient />);
    expect(status).toHaveTextContent("Loading your team…");
    // The cap replaces the default reserve (tailwind-merge), on phones only.
    const minHeights = Array.from(status.classList).filter((c) => c.includes("min-h-"));
    expect(minHeights).toEqual(["max-md:min-h-[min(60svh,20rem)]"]);
    expect(status).not.toHaveAttribute("aria-busy");
  });
});
