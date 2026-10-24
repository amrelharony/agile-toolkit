import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";

/**
 * Ceremony Timer "Load team": fills the speaking order from the roster,
 * adding only the people who are missing; speakers carry roster ids.
 */

const toastMock = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/utils/toast", () => {
  const toast = Object.assign((m: unknown) => toastMock.calls.push(m), {
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {},
    message: () => {},
    dismiss: () => {},
  });
  return { toast };
});
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/sonification/use-sonification", () => ({
  useToolSonification: () => () => {},
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { CeremonyTimerClient } from "@/app/(tools)/ceremony-timer/ceremony-timer-client";
import { rosterParticipantsToAdd } from "@/app/(tools)/ceremony-timer/roster";
import { useTimerSession, useTimerSettings } from "@/app/(tools)/ceremony-timer/store";

const ROSTER: TeamMember[] = [
  { id: "t1", name: "Ann" },
  { id: "t2", name: "Bo" },
  { id: "t3", name: " Cy " },
];

const speakers = () =>
  screen
    .getAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")!.replace(/^Remove /, ""));

const renderTimer = () =>
  render(
    <TooltipProvider>
      <CeremonyTimerClient />
    </TooltipProvider>
  );

beforeEach(() => {
  toastMock.calls = [];
  localStorage.clear();
  useTimerSession.setState({ agendaId: null, run: null });
  useTimerSettings.setState({ agendas: {}, speakers: [], chime: false });
});

describe("rosterParticipantsToAdd", () => {
  it("returns the missing members with their roster ids, matching by id or name", () => {
    expect(rosterParticipantsToAdd([], ROSTER)).toEqual([
      { id: "t1", name: "Ann" },
      { id: "t2", name: "Bo" },
      { id: "t3", name: "Cy" },
    ]);
    expect(
      rosterParticipantsToAdd(
        [
          { id: "t1", name: "Ann (facilitator)" },
          { id: "x", name: "bo" },
        ],
        ROSTER
      )
    ).toEqual([{ id: "t3", name: "Cy" }]);
  });

  it("skips unnamed members and duplicate names on the roster", () => {
    expect(
      rosterParticipantsToAdd(
        [],
        [
          { id: "a", name: "" },
          { id: "b", name: "Dee" },
          { id: "c", name: "dee" },
        ]
      )
    ).toEqual([{ id: "b", name: "Dee" }]);
  });
});

describe("Ceremony Timer — Load team", () => {
  it("links to the Team page while the roster is empty", () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    renderTimer();
    expect(screen.getByRole("link", { name: "Team page" })).toHaveAttribute("href", "/team");
    expect(screen.queryByRole("button", { name: "Load team" })).toBeNull();
  });

  it("fills an empty speaking order from the roster", () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER });
    renderTimer();
    fireEvent.click(screen.getByRole("button", { name: "Load team" }));
    expect(speakers()).toEqual(["Ann", "Bo", "Cy"]);
  });

  it("adds only the missing people, and a second load adds nobody", () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER });
    renderTimer();
    const nameInput = screen.getByRole("combobox", { name: "Speaker" });
    for (const name of ["Zoe", "bo"]) {
      fireEvent.change(nameInput, { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Add speaker" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Load team" }));
    expect(speakers()).toEqual(["Zoe", "bo", "Ann", "Cy"]);
    expect(toastMock.calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Load team" }));
    expect(speakers()).toEqual(["Zoe", "bo", "Ann", "Cy"]);
    expect(toastMock.calls).toEqual(["Everyone on the team is already in the list."]);
  });
});
