/**
 * The Canvas's "Jira → Kanban" paste box (canvas/components/import-modal.tsx)
 * reads through the one Jira reader, so a row it refuses is left out: the
 * box says how many rows and why, instead of dropping them without a word.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test" }),
}));

import { ImportModal } from "@/app/(tools)/canvas/components/import-modal";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardCard } from "@/lib/stores/workspace-types";

const box = () => screen.getByLabelText("Jira → Kanban");

beforeEach(() => {
  useWorkspaceStore.setState({ stories: [], risks: [], okrs: [], whiteboardObjects: [] });
});

afterEach(() => {
  useWorkspaceStore.setState({ whiteboardObjects: [] });
});

describe("the Canvas's Jira paste box", () => {
  it("says which rows it leaves out and why, and imports the rest", () => {
    render(<ImportModal boardId="b1" onClose={() => {}} />);
    fireEvent.change(box(), {
      target: { value: "Issue key,Summary,Story Points\nA-1,One,TBD\nA-2,Two,3" },
    });
    expect(screen.getByText("1 issue detected")).toBeInTheDocument();
    const note = screen.getByText(
      "1 row can't be imported. Line 2: the story points “TBD” aren't a number, 0 or more."
    );
    expect(box().getAttribute("aria-describedby")?.split(" ")).toContain(note.id);

    fireEvent.click(screen.getByRole("button", { name: "Import 1 issue" }));
    const cards = (useWorkspaceStore.getState().whiteboardObjects ?? [])
      .filter((o): o is WhiteboardCard => o.type === "card")
      .map((o) => o.title);
    expect(cards).toEqual(["A-2: Two"]);
  });

  it("says nothing more when every row reads, and why when none can", () => {
    render(<ImportModal boardId="b1" onClose={() => {}} />);
    fireEvent.change(box(), { target: { value: "Issue key,Summary\nA-1,One" } });
    expect(screen.queryByText(/can't be imported/)).toBeNull();
    fireEvent.change(box(), { target: { value: "Summary,Status\nOne,To Do" } });
    expect(screen.getByText(/^No issue key column found\./)).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "" } });
    expect(screen.queryByText(/column found/)).toBeNull();
  });
});
