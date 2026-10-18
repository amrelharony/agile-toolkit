import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";

/**
 * Ceremony Timer "Load team": fills the speaking order from the roster,
 * adding only the people who are missing; participants carry roster ids.
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

const ROSTER: TeamMember[] = [
  { id: "t1", name: "Ann" },
  { id: "t2", name: "Bo" },
  { id: "t3", name: " Cy " },
];

const speakers = () =>
  screen
    .getAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")!.replace(/^Remove /, ""));

const turnOnRotation = () => fireEvent.click(screen.getByRole("switch", { name: "Rotation mode" }));

beforeEach(() => {
  toastMock.calls = [];
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
    render(<CeremonyTimerClient />);
    turnOnRotation();
    expect(screen.getByRole("link", { name: "Set up your team" })).toHaveAttribute("href", "/team");
    expect(screen.queryByRole("button", { name: "Load team" })).toBeNull();
  });

  it("fills an empty speaking order from the roster", () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER });
    render(<CeremonyTimerClient />);
    turnOnRotation();
    fireEvent.click(screen.getByRole("button", { name: "Load team" }));
    expect(speakers()).toEqual(["Ann", "Bo", "Cy"]);
  });

  it("adds only the missing people, and a second load adds nobody", () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER });
    render(<CeremonyTimerClient />);
    turnOnRotation();
    const nameInput = screen.getByRole("textbox", { name: "Participant name" });
    for (const name of ["Zoe", "bo"]) {
      fireEvent.change(nameInput, { target: { value: name } });
      fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Load team" }));
    expect(speakers()).toEqual(["Zoe", "bo", "Ann", "Cy"]);
    expect(toastMock.calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Load team" }));
    expect(speakers()).toEqual(["Zoe", "bo", "Ann", "Cy"]);
    expect(toastMock.calls).toEqual(["Everyone on the team is already in the list."]);
  });
});
