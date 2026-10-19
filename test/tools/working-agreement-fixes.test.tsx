import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Working Agreement: once a rule was checked in, its status only flipped
 * between Working and Not working, so a new check-in round could never start
 * from "Check in". "New check-in round" resets every status, with Undo.
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

import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";

const rule = (id: string, text: string, stillWorking?: boolean) => ({
  id,
  category: "work" as const,
  text,
  agreedBy: [],
  stillWorking,
});

const statuses = () =>
  (useWorkspaceStore.getState().workingAgreements ?? [])[0].rules.map((r) => r.stillWorking);

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    workingAgreements: [
      {
        id: "workingAgreement:current",
        rules: [
          rule("r1", "PRs reviewed within a day", true),
          rule("r2", "No meetings on Friday", false),
          rule("r3", "Pair on hard bugs"),
        ],
        meta: { version: 1 },
      },
    ],
  });
});

describe("Working Agreement check-in rounds", () => {
  it("resets every status to Check in, with Undo", () => {
    render(<WorkingAgreementClient />);
    expect(screen.getByText(/2 of 3 rules checked in this round/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New check-in round" }));
    expect(statuses()).toEqual([undefined, undefined, undefined]);
    expect(undo.last?.label).toBe("Started a new check-in round");
    expect(
      screen.getAllByRole("button", { name: /^Check in \(still-working status for / })
    ).toHaveLength(3);
    expect(screen.getByRole("button", { name: "New check-in round" })).toBeDisabled();

    act(() => undo.last!.revert());
    expect(statuses()).toEqual([true, false, undefined]);
  });
});
