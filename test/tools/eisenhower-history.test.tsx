import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Eisenhower Matrix's history: an edit that puts a task in another
 * pane logs a move, any other edit an update, once per save.
 */

const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));

import { EisenhowerClient } from "@/app/(tools)/eisenhower/eisenhower-client";

const IMPORTANT = "Important? (does it move a goal)";

const task = (id: string, title: string, fields: Record<string, string>): PrioritizationItem => ({
  id,
  framework: "eisenhower",
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <EisenhowerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const openEditor = (title: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Edit ${title}` }));
  return screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
};
const edits = () => logs.filter((l) => l.action === "task_moved" || l.action === "task_updated");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
  logs.length = 0;
  useWorkspaceStore.setState({
    prioritizations: [task("a", "Board pack", { urgent: "false", important: "true" })],
    teamMembers: [],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Eisenhower: what an edit logs", () => {
  it("logs an update for an edit that leaves the task in its pane", () => {
    renderPage();
    const editor = openEditor("Board pack");
    fireEvent.change(within(editor).getByLabelText(/^Task/), {
      target: { value: "Board pack for Q4" },
    });
    fireEvent.submit(editor);
    expect(edits()).toEqual([
      { action: "task_updated", payload: expect.objectContaining({ id: "a" }) },
    ]);
  });

  it("logs a move for an edit that puts the task in another pane", () => {
    renderPage();
    const editor = openEditor("Board pack");
    fireEvent.click(
      within(within(editor).getByRole("radiogroup", { name: IMPORTANT })).getByRole("radio", {
        name: "No",
      })
    );
    fireEvent.submit(editor);
    expect(edits()).toEqual([
      { action: "task_moved", payload: expect.objectContaining({ id: "a" }) },
    ]);
  });

  it("logs a move when a due date makes the task urgent", () => {
    renderPage();
    const editor = openEditor("Board pack");
    fireEvent.change(within(editor).getByLabelText(/^Due/), { target: { value: "2026-10-28" } });
    fireEvent.submit(editor);
    expect(edits().map((l) => l.action)).toEqual(["task_moved"]);
  });
});
