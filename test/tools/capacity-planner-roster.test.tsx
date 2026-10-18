import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityConfig, CapacityMember, TeamMember } from "@/lib/stores/workspace-types";

/**
 * Capacity Planner "Sync from team": a row for every roster member that has
 * none, matched by teamMemberId or name. It never deletes a row, a second
 * run changes nothing, and one Undo takes the whole sync back.
 */

const undo = vi.hoisted(() => ({
  calls: [] as { label: string; apply: () => void; revert: () => void }[],
}));
const toastMock = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.calls.push(a);
    a.apply();
  },
}));
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

import { CapacityPlannerClient } from "@/app/(tools)/capacity-planner/capacity-planner-client";
import { revertRosterSync, syncFromRoster } from "@/app/(tools)/capacity-planner/roster-sync";

const CP_ID = "capacity-planner:current";
const CONFIG: CapacityConfig = {
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
};

const row = (id: string, name: string, extra: Partial<CapacityMember> = {}): CapacityMember => ({
  id,
  name,
  role: "",
  availability: 100,
  daysOff: 0,
  ...extra,
});

const ROSTER: TeamMember[] = [
  { id: "t1", name: "Ana", role: "Developer" },
  { id: "t2", name: "Ben", capacityPct: 60 },
  { id: "t3", name: "Cy" },
];

let seq = 0;
const newId = () => `new-${++seq}`;

beforeEach(() => {
  seq = 0;
  undo.calls = [];
  toastMock.calls = [];
});

describe("syncFromRoster", () => {
  it("links a same-name row, adds the rest, keeps every row, and is a no-op the second time", () => {
    const before = [row("r1", "  ana "), row("r2", "Dee", { daysOff: 2 })];
    const first = syncFromRoster(before, ROSTER, newId);

    // No row deleted, the unmatched row kept as it was.
    expect(first.members.map((m) => m.id)).toEqual(["r1", "r2", "new-1", "new-2"]);
    expect(first.members[1]).toBe(before[1]);
    // Matched by name (trimmed, any case): linked, the typed name kept.
    expect(first.members[0]).toMatchObject({ id: "r1", name: "  ana ", teamMemberId: "t1" });
    // New rows carry the member's id, role and capacity.
    expect(first.members[2]).toEqual(row("new-1", "Ben", { availability: 60, teamMemberId: "t2" }));
    expect(first.members[3]).toEqual(row("new-2", "Cy", { teamMemberId: "t3" }));
    expect(first.added.map((m) => m.id)).toEqual(["new-1", "new-2"]);
    expect(first.changed).toEqual([
      {
        id: "r1",
        before: { name: "  ana ", role: "", availability: 100, teamMemberId: undefined },
      },
    ]);

    const second = syncFromRoster(first.members, ROSTER, newId);
    expect(second.members).toBe(first.members);
    expect(second.added).toEqual([]);
    expect(second.changed).toEqual([]);
  });

  it("prefers the teamMemberId link over a name match, and takes the roster's new name", () => {
    const before = [row("r1", "Ana"), row("r2", "Annie", { teamMemberId: "t1" })];
    const { members } = syncFromRoster(before, [{ id: "t1", name: "Ana" }], newId);
    // r2 is t1's row (renamed from the roster); r1 stays unlinked.
    expect(members).toEqual([row("r1", "Ana"), row("r2", "Ana", { teamMemberId: "t1" })]);
    expect(syncFromRoster(members, [{ id: "t1", name: "Ana" }], newId).members).toBe(members);
  });

  it("relinks a row whose member left the roster when the name matches a new member", () => {
    const before = [row("r1", "Ana", { teamMemberId: "gone" })];
    const { members } = syncFromRoster(before, [{ id: "t9", name: "Ana" }], newId);
    expect(members).toEqual([row("r1", "Ana", { teamMemberId: "t9" })]);
  });

  it("fills the blank starter row instead of leaving it above the team", () => {
    const before = [row("default:member-1", "")];
    const { members, added } = syncFromRoster(before, ROSTER, newId);
    expect(members.map((m) => [m.id, m.name])).toEqual([
      ["default:member-1", "Ana"],
      ["new-1", "Ben"],
      ["new-2", "Cy"],
    ]);
    expect(members[0]).toMatchObject({ role: "Developer", teamMemberId: "t1" });
    expect(added).toHaveLength(2);
  });

  it("skips roster members without a name", () => {
    const { members } = syncFromRoster([], [{ id: "t1", name: "  " }], newId);
    expect(members).toEqual([]);
  });

  it("revertRosterSync drops added rows and restores changed fields, keeping later edits", () => {
    const before = [row("default:member-1", ""), row("r2", "ben")];
    const sync = syncFromRoster(before, ROSTER, newId);
    // An edit after the sync, to a field the sync didn't touch.
    const edited = sync.members.map((m) => (m.id === "r2" ? { ...m, daysOff: 3 } : m));
    expect(revertRosterSync(edited, sync)).toEqual([
      row("default:member-1", ""),
      row("r2", "ben", { daysOff: 3 }),
    ]);
  });
});

describe("Capacity Planner — Sync from team", () => {
  const plan = () => useWorkspaceStore.getState().capacityPlans?.find((p) => p.id === CP_ID);
  const seed = (members: CapacityMember[], roster: TeamMember[]) =>
    useWorkspaceStore.setState({
      teamMembers: roster,
      capacityPlans: [{ id: CP_ID, members, config: CONFIG }],
    });

  it("links to the Team page while the roster is empty", () => {
    seed([row("r1", "Ana")], []);
    render(<CapacityPlannerClient />);
    expect(screen.getByRole("link", { name: /Set up team/ })).toHaveAttribute("href", "/team");
    expect(screen.queryByRole("button", { name: /Sync from team/ })).toBeNull();
  });

  it("sets teamMemberId, adds missing rows, deletes none; syncing again changes nothing", () => {
    const original = [row("r1", "ANA", { daysOff: 1 }), row("r2", "Dee")];
    seed(original, ROSTER);
    render(<CapacityPlannerClient />);

    fireEvent.click(screen.getByRole("button", { name: /Sync from team/ }));
    const synced = plan()!.members;
    expect(synced.map((m) => m.name)).toEqual(["ANA", "Dee", "Ben", "Cy"]);
    expect(synced.map((m) => m.teamMemberId)).toEqual(["t1", undefined, "t2", "t3"]);
    for (const m of original) expect(synced.some((s) => s.id === m.id)).toBe(true);
    expect(undo.calls).toHaveLength(1);
    expect(undo.calls[0].label).toBe("Synced 3 people from the team");
    expect(screen.getAllByRole("textbox", { name: "Name" })).toHaveLength(4);

    const planAfterFirst = plan();
    fireEvent.click(screen.getByRole("button", { name: /Sync from team/ }));
    expect(plan()).toBe(planAfterFirst);
    expect(undo.calls).toHaveLength(1);
    expect(toastMock.calls).toEqual(["Everyone on the team already has a row."]);
  });

  it("one Undo takes back the whole sync", () => {
    const original = [row("r1", "Ana"), row("r2", "Dee")];
    seed(original, ROSTER);
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: /Sync from team/ }));
    expect(plan()!.members).toHaveLength(4);

    act(() => undo.calls[0].revert());
    expect(plan()!.members).toEqual(original);
    expect(screen.getAllByRole("textbox", { name: "Name" })).toHaveLength(2);
  });
});
