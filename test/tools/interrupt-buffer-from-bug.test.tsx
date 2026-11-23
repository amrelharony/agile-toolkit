/**
 * Interrupt Buffer's "From bug triage" back-link: an interrupt Bug Triage
 * sent (fix now) links back to that bug, an interrupt logged here has no
 * link, and an edit or a resolve keeps the sourceRef. Amr's list_state
 * returns the raw items, sourceRef included, and says so.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { InterruptItem, Sprint } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/interrupt-buffer",
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "t" }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));

import { InterruptBufferClient } from "@/app/(tools)/interrupt-buffer/interrupt-buffer-client";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/interrupt-buffer";

const sprint: Sprint = {
  id: "s1",
  name: "Sprint 7",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  pointsPlanned: 30,
  status: "active",
};

const item = (over: Partial<InterruptItem> = {}): InterruptItem => ({
  id: "i1",
  sprintId: "s1",
  title: "Card payments over 1,000 fail",
  kind: "bug",
  emergency: true,
  loggedAt: "2026-11-04T09:00:00.000Z",
  sourceRef: { tool: "bug-triage", id: "bug_abc" },
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) => (ws().interruptItems ?? []).find((i) => i.id === id);
const row = (id: string) => document.querySelector(`[data-interrupt="${id}"]`) as HTMLElement;

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <InterruptBufferClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

beforeEach(() => {
  toastSpy.mockReset();
  localStorage.clear();
  resetSelectedSprint();
  useWorkspaceStore.setState({
    sprints: [sprint],
    interruptItems: [item(), item({ id: "i2", title: "Printer jam", sourceRef: undefined })],
  });
});

describe("the back-link", () => {
  it("links an interrupt sent from Bug Triage back to its bug, and no other", async () => {
    renderPage();
    await screen.findByText("Card payments over 1,000 fail");
    expect(within(row("i1")).getByRole("link", { name: /From bug triage/ })).toHaveAttribute(
      "href",
      "/bug-triage?bug=bug_abc"
    );
    expect(within(row("i2")).queryByRole("link", { name: /From/ })).toBeNull();
  });

  it("keeps the sourceRef through an edit and a resolve", async () => {
    renderPage();
    await screen.findByText("Card payments over 1,000 fail");
    fireEvent.click(within(row("i1")).getByRole("button", { name: /^Resolve/ }));
    expect(stored("i1")?.resolvedAt).toBeDefined();
    expect(stored("i1")?.sourceRef).toEqual({ tool: "bug-triage", id: "bug_abc" });
    fireEvent.click(within(row("i1")).getByRole("button", { name: /^Edit/ }));
    const title = within(row("i1")).getByDisplayValue("Card payments over 1,000 fail");
    fireEvent.change(title, { target: { value: "Card payments fail" } });
    fireEvent.submit(title.closest("form")!);
    expect(stored("i1")).toMatchObject({
      title: "Card payments fail",
      sourceRef: { tool: "bug-triage", id: "bug_abc" },
    });
    expect(within(row("i1")).getByRole("link", { name: /From bug triage/ })).toBeInTheDocument();
  });
});

describe("Amr's list_state", () => {
  it("returns the sourceRef with the raw items, and its description names it", async () => {
    const action = registry.get("tool.interrupt_buffer.list_state")!;
    expect(action.description).toContain("sourceRef");
    const out = (await action.handler(action.paramsSchema.parse({ sprintId: "s1" }), {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    })) as { interrupts: InterruptItem[] };
    expect(out.interrupts.find((i) => i.id === "i1")?.sourceRef).toEqual({
      tool: "bug-triage",
      id: "bug_abc",
    });
  });
});
