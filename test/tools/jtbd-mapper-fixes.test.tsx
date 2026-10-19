import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Job Story Mapper: removing a job also removes everything nested under it,
 * with no warning and no way back. A job with children now asks first (with
 * the count), and every removal offers Undo that puts the stories back in
 * place.
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

import { JtbdMapperClient } from "@/app/(tools)/jtbd-mapper/jtbd-mapper-client";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const job = (id: string, situation: string, parentJobId?: string) => ({
  id,
  situation,
  motivation: "m",
  outcome: "o",
  parentJobId,
});
const JOBS = [
  job("a", "onboarding"),
  job("b", "first login", "a"),
  job("c", "inviting a teammate", "b"),
  job("d", "paying an invoice"),
];

const ids = () => (useWorkspaceStore.getState().jobStories ?? []).map((j) => j.id);
const removeButton = (situation: string) =>
  screen.getByRole("button", { name: `Remove job story: when ${situation}` });

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ jobStories: JOBS });
});

describe("Job Story Mapper remove", () => {
  it("removes a job without children straight away, with Undo", () => {
    render(<JtbdMapperClient />);
    fireEvent.click(removeButton("paying an invoice"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(undo.last?.label).toBe("Removed a job story");

    act(() => undo.last!.revert());
    expect(ids()).toEqual(["a", "b", "c", "d"]);
  });

  it("asks before removing a job with nested stories, and Undo restores them in place", () => {
    render(<JtbdMapperClient />);

    // Cancel removes nothing.
    fireEvent.click(removeButton("onboarding"));
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove this job and everything under it?");
    expect(dialog).toHaveTextContent("and the 2 job stories nested under it will be removed.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(ids()).toEqual(["a", "b", "c", "d"]);
    expect(undo.last).toBeNull();

    // Confirm removes the job and both descendants.
    fireEvent.click(removeButton("onboarding"));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove 3 job stories" }));
    expect(ids()).toEqual(["d"]);
    expect(undo.last?.label).toBe("Removed a job story and 2 nested stories");

    act(() => undo.last!.revert());
    expect(ids()).toEqual(["a", "b", "c", "d"]);
    expect(screen.getByText("inviting a teammate")).toBeInTheDocument();
  });
});
