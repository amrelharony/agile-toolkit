import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Standup: an open blocker can be raised as an impediment from the Blockers
 * tab. The impediment links back to the entry, the entry records where its
 * blocker went (and keeps it across a re-submit of the same blocker), and
 * Undo removes both.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
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

import { StandupClient } from "@/app/(tools)/standup/standup-client";

function entry(id: string, member: string, blockers: string, extra: Partial<StandupEntry> = {}) {
  return {
    id,
    member,
    date: todayLocalISO(),
    yesterday: "y",
    today: "t",
    blockers,
    timestamp: Date.now(),
    ...extra,
  } satisfies StandupEntry;
}

const ws = () => useWorkspaceStore.getState();
const renderStandup = () =>
  render(
    <TooltipProvider>
      <StandupClient />
    </TooltipProvider>
  );
const entryById = (id: string) => (ws().standupEntries ?? []).find((e) => e.id === id)!;

function openBlockersTab() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Blockers/ }), { button: 0 });
}
function openSendTo(name: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({
    teamMembers: [
      { id: "m1", name: "Alice" },
      { id: "m2", name: "Bo" },
    ],
    standupEntries: [
      entry("e1", "Alice", "Waiting on the API keys"),
      entry("e2", "Bo", "Staging is down", { blockerResolved: true }),
      entry("e3", "Bo", ""),
    ],
    impediments: [],
  });
});

describe("Standup Send to", () => {
  it("is offered on open blockers only", () => {
    renderStandup();
    openBlockersTab();
    expect(screen.getAllByRole("button", { name: /^Send to…/ })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Send to… Waiting on the API keys" })
    ).toBeInTheDocument();
  });

  it("raises the blocker as an impediment in the workspace, linked both ways", () => {
    renderStandup();
    openBlockersTab();
    openSendTo(/^Send to… Waiting on the API keys/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));

    const [local] = ws().impediments;
    expect(ws().impediments).toHaveLength(1);
    expect(local).toMatchObject({
      title: "Waiting on the API keys",
      raisedBy: "Alice",
      source: "standup",
      sourceRef: { tool: "standup", id: "e1" },
    });
    expect(local.resolvedAt).toBeUndefined();
    expect(entryById("e1").sentTo).toEqual([
      { route: "impediment", targetId: local.id, at: expect.any(String) },
    ]);
    expect(undo.last!.label).toBe("Raised as an impediment");

    // Sent: the menu now links to the Impediments tool instead.
    openSendTo(/^Send to… Waiting on the API keys \(sent\)/);
    expect(screen.getByRole("menuitem", { name: /Impediment.*Sent · Open/ })).toHaveAttribute(
      "href",
      "/impediments"
    );
  });

  it("Undo removes the impediment and the link", () => {
    renderStandup();
    openBlockersTab();
    openSendTo(/^Send to… Waiting on the API keys/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));

    act(() => undo.last!.revert());
    expect(ws().impediments).toEqual([]);
    expect(entryById("e1").sentTo).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Send to… Waiting on the API keys" })
    ).toBeInTheDocument();
  });

  it("keeps the link when the entry is re-submitted with the same blocker, not a new one", () => {
    const link = { route: "impediment" as const, targetId: "imp-1", at: "2026-10-19T09:00:00Z" };
    useWorkspaceStore.setState({
      standupEntries: [entry("e1", "Alice", "Waiting on the API keys", { sentTo: [link] })],
    });
    renderStandup();
    const resubmit = (blockers: string) => {
      fireEvent.change(screen.getByLabelText(/^Team member/), { target: { value: "Alice" } });
      fireEvent.change(screen.getByPlaceholderText("What will you work on today?"), {
        target: { value: "New plan" },
      });
      fireEvent.change(screen.getByLabelText("Blockers"), { target: { value: blockers } });
      fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
      fireEvent.click(screen.getByRole("button", { name: "Replace entry" }));
    };

    resubmit("Waiting on the API keys");
    expect(entryById("e1")).toMatchObject({ today: "New plan", sentTo: [link] });

    resubmit("Now the build is red");
    expect(entryById("e1").sentTo).toBeUndefined();
  });

  it("offers a second send when the impediment was deleted", () => {
    renderStandup();
    openBlockersTab();
    openSendTo(/^Send to… Waiting on the API keys/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));
    const [first] = ws().impediments;
    act(() => ws().removeImpediment(first.id));

    openSendTo(/^Send to… Waiting on the API keys/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));
    const [second] = ws().impediments;
    expect(second.id).not.toBe(first.id);
    expect(entryById("e1").sentTo).toEqual([
      { route: "impediment", targetId: second.id, at: expect.any(String) },
    ]);
  });
});
