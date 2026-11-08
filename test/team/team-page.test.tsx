import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story, TeamMember } from "@/lib/stores/workspace-types";
import { TOUCH_ROW, TOUCH_ROW_LINK } from "@/components/ui/touch-target";

/**
 * Team page: one roster for every tool. Add, edit and remove members, with
 * Undo on remove that brings the member back but leaves the owner links the
 * store cleared.
 */

const undo = vi.hoisted(() => ({
  calls: [] as { label: string; description?: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; description?: string; apply: () => void; revert: () => void }) => {
    undo.calls.push(a);
    a.apply();
  },
}));

import { TeamClient } from "@/app/(meta)/team/team-client";

const roster = () => useWorkspaceStore.getState().teamMembers;
const field = (name: string) => screen.getByRole("textbox", { name: new RegExp(`^${name}`) });

beforeEach(() => {
  undo.calls = [];
  useWorkspaceStore.setState({ teamMembers: [], stories: [], standupEntries: [] });
});

describe("Team page — empty state", () => {
  it("explains the roster and opens the form from “Add your first member”", () => {
    render(<TeamClient />);
    expect(screen.getByText("No one on your team yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Team members" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add your first member" }));
    expect(screen.getByRole("form", { name: "Add a team member" })).toBeInTheDocument();
    expect(field("Name")).toHaveFocus();
  });

  it("lists the tools that use the roster, with links", () => {
    render(<TeamClient />);
    expect(screen.getByRole("link", { name: "Standup Tracker" })).toHaveAttribute(
      "href",
      "/standup"
    );
    expect(screen.getByRole("link", { name: "Sprint Capacity Planner" })).toHaveAttribute(
      "href",
      "/capacity-planner"
    );
    expect(screen.getByRole("link", { name: "Ceremony Timer" })).toHaveAttribute(
      "href",
      "/ceremony-timer"
    );
  });

  it("makes each tool row a 44px touch target that opens the tool", () => {
    render(<TeamClient />);
    const link = screen.getByRole("link", { name: "Standup Tracker" });
    // On touch the link's ::after stretches over its row; the row is the
    // positioned box and at least 44px tall. Nothing changes with a mouse.
    expect(link).toHaveClass(...TOUCH_ROW_LINK.split(" "), "hover:underline");
    const row = link.closest("li")!;
    expect(row).toHaveClass(...TOUCH_ROW.split(" "), "flex", "items-start");
    expect(row).toHaveTextContent(/^Standup Tracker.+/);
  });
});

describe("Team page — add", () => {
  it("adds a member with role, capacity and skills, and keeps the form open for the next", () => {
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add your first member" }));

    fireEvent.change(field("Name"), { target: { value: "  Ana  " } });
    fireEvent.change(field("Role"), { target: { value: "Developer" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Capacity/ }), {
      target: { value: "80" },
    });
    fireEvent.change(field("Skills"), { target: { value: "React, testing, react, " } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));

    expect(roster()).toHaveLength(1);
    const [ana] = roster();
    expect(ana.id).toMatch(/^member_/);
    expect(ana).toMatchObject({
      name: "Ana",
      role: "Developer",
      capacityPct: 80,
      skills: ["React", "testing"],
    });
    expect(screen.getByRole("list", { name: "Team members" })).toHaveTextContent("Ana");

    // Cleared and focused for the next person.
    expect(field("Name")).toHaveValue("");
    expect(field("Name")).toHaveFocus();
  });

  it("leaves optional fields off when blank", () => {
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add your first member" }));
    fireEvent.change(field("Name"), { target: { value: "Ben" } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(Object.keys(roster()[0]).sort()).toEqual(["id", "name"]);
  });

  it("asks for a name, refuses a duplicate in any case, and checks capacity", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const form = screen.getByRole("form", { name: "Add a team member" });
    const submit = within(form).getByRole("button", { name: "Add member" });

    fireEvent.click(submit);
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();

    fireEvent.change(field("Name"), { target: { value: "ana" } });
    fireEvent.click(submit);
    expect(screen.getByText("ana is already on the team.")).toBeInTheDocument();

    fireEvent.change(field("Name"), { target: { value: "Ben" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^Capacity/ }), {
      target: { value: "150" },
    });
    fireEvent.click(submit);
    expect(screen.getByText("Use a number from 0 to 100.")).toBeInTheDocument();
    expect(roster()).toHaveLength(1);
  });
});

describe("Team page — edit", () => {
  it("saves changes in place and drops a cleared role", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana", role: "Developer", skills: ["React"] },
        { id: "m2", name: "Ben" },
      ],
    });
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana" }));
    const form = screen.getByRole("form", { name: "Edit Ana" });
    expect(field("Name")).toHaveFocus();

    fireEvent.change(field("Name"), { target: { value: "Anna" } });
    fireEvent.change(field("Role"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(roster()).toEqual([
      { id: "m1", name: "Anna", skills: ["React"] },
      { id: "m2", name: "Ben" },
    ]);
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Anna" })).toHaveFocus();
  });

  it("Escape cancels without saving", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana" }));
    fireEvent.change(field("Name"), { target: { value: "Zed" } });
    fireEvent.keyDown(field("Name"), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(roster()).toEqual([{ id: "m1", name: "Ana" }]);
    expect(screen.getByRole("button", { name: "Edit Ana" })).toHaveFocus();
  });

  it("warns that past standup updates stay under the old name", () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "m1", name: "Ana" }],
      standupEntries: [
        {
          id: "e1",
          member: "Ana",
          date: "2026-10-19",
          yesterday: "",
          today: "",
          blockers: "",
          timestamp: 1,
        },
      ],
    });
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana" }));
    expect(screen.queryByText(/past standup update/)).toBeNull();
    fireEvent.change(field("Name"), { target: { value: "Anna" } });
    expect(screen.getByText("1 past standup update stays under “Ana”.")).toBeInTheDocument();
  });
});

describe("Team page — remove with Undo", () => {
  const story: Story = {
    id: "s1",
    title: "Checkout",
    status: "todo",
    owner: "m1",
  };

  it("removes the member; Undo brings them back once, but their owner links stay cleared", () => {
    const ana: TeamMember = { id: "m1", name: "Ana", role: "Developer", capacityPct: 50 };
    useWorkspaceStore.setState({
      teamMembers: [ana, { id: "m2", name: "Ben" }],
      stories: [story],
    });
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ana" }));

    expect(roster().map((m) => m.id)).toEqual(["m2"]);
    expect(useWorkspaceStore.getState().stories[0].owner).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Remove Ana" })).toBeNull();
    expect(undo.calls).toHaveLength(1);
    expect(undo.calls[0].label).toBe("Removed “Ana”");
    expect(undo.calls[0].description).toMatch(/stay unassigned/);

    act(() => undo.calls[0].revert());
    expect(roster()).toEqual([{ id: "m2", name: "Ben" }, ana]);
    expect(useWorkspaceStore.getState().stories[0].owner).toBeUndefined();
    expect(screen.getByRole("button", { name: "Remove Ana" })).toBeInTheDocument();

    act(() => undo.calls[0].revert());
    expect(roster()).toHaveLength(2);
  });

  it("has no owner-link note when the member owned nothing", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ana" }] });
    render(<TeamClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ana" }));
    expect(undo.calls[0].description).toBeUndefined();
    // The last member gone: back to the empty state.
    expect(screen.getByRole("button", { name: "Add your first member" })).toBeInTheDocument();
  });
});
