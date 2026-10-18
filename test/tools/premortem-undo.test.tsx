import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Premortem: removing a cause offers Undo that puts it back in its ranked
 * slot, once.
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

import { PremortemClient } from "@/app/(tools)/premortem/premortem-client";

const cause = (id: string, text: string) => ({ id, text, likelihood: 3, impact: 3 });

beforeEach(() => {
  undo.last = null;
  localStorage.setItem(
    "agile-toolkit:premortem",
    JSON.stringify({
      scenario: "",
      causes: [cause("c1", "Unclear goal"), cause("c2", "Scope creep"), cause("c3", "No tests")],
    })
  );
});

const causeTexts = () =>
  screen
    .getAllByRole("textbox", { name: /^Cause of failure \d+$/ })
    .map((i) => (i as HTMLInputElement).value);

describe("Premortem undo", () => {
  it("puts a removed cause back in its slot", () => {
    render(<PremortemClient />);
    expect(causeTexts()).toEqual(["Unclear goal", "Scope creep", "No tests"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove cause 2" }));
    expect(causeTexts()).toEqual(["Unclear goal", "No tests"]);
    expect(undo.last?.label).toBe("Removed “Scope creep”");

    act(() => undo.last!.revert());
    expect(causeTexts()).toEqual(["Unclear goal", "Scope creep", "No tests"]);
    act(() => undo.last!.revert());
    expect(causeTexts()).toEqual(["Unclear goal", "Scope creep", "No tests"]);
  });
});
