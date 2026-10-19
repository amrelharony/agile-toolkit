import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Incident commander: Delete on an incident card removed the incident and
 * its whole timeline with no confirmation. It now offers Undo, which puts
 * the incident back where it was, once.
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
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { IncidentCommanderClient } from "@/app/(tools)/incident-commander/incident-commander-client";

const incident = (id: string, title: string) => ({
  id,
  title,
  severity: "sev2",
  status: "active",
  openedAt: "2026-10-18T10:00:00.000Z",
  timeline: [{ id: `${id}-t1`, ts: "2026-10-18T10:05:00.000Z", author: "ana", text: "Paged" }],
});

const ids = () =>
  ((useWorkspaceStore.getState().incidentCommanders ?? [])[0]?.incidents ?? []).map((i) => i.id);

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    incidentCommanders: [
      {
        id: "incidentCommander:current",
        incidents: [incident("i1", "Checkout down"), incident("i2", "Search slow")],
      },
    ] as never,
  });
});

describe("Incident commander delete", () => {
  it("deletes with an Undo that restores the incident and its timeline in place", () => {
    render(<IncidentCommanderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Checkout down" }));

    expect(undo.last?.label).toBe("Deleted “Checkout down”");
    expect(ids()).toEqual(["i2"]);
    expect(screen.queryByRole("button", { name: "Delete Checkout down" })).toBeNull();

    act(() => undo.last!.revert());
    expect(ids()).toEqual(["i1", "i2"]);
    const restored = useWorkspaceStore.getState().incidentCommanders![0].incidents[0];
    expect(restored.timeline).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Delete Checkout down" })).toBeInTheDocument();

    // A second revert can't duplicate it.
    act(() => undo.last!.revert());
    expect(ids()).toEqual(["i1", "i2"]);
  });
});
