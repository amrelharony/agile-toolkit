import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Premortem: removing a cause offers Undo that puts it back in its slot,
 * once.
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
import type { PremortemState } from "@/app/(tools)/premortem/model";

const KEY = "agile-toolkit:premortem";
const cause = (id: string, text: string) => ({ id, text, likelihood: 3, impact: 3 });

beforeEach(() => {
  undo.last = null;
  window.history.replaceState(null, "", "/premortem");
  localStorage.setItem(
    KEY,
    JSON.stringify({
      scenario: "",
      causes: [cause("c1", "Unclear goal"), cause("c2", "Scope creep"), cause("c3", "No tests")],
    })
  );
});

const storedTexts = () =>
  (JSON.parse(localStorage.getItem(KEY) ?? "{}") as PremortemState).premortems[0].causes.map(
    (c) => c.text
  );
const shownTexts = () =>
  within(screen.getByRole("list", { name: /^Causes, most votes first/ }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")?.textContent);

describe("Premortem undo", () => {
  it("puts a removed cause back in its slot", () => {
    render(
      <TooltipProvider>
        <PremortemClient />
      </TooltipProvider>
    );
    // Equal votes and scores: the text decides the order on screen.
    expect(shownTexts()).toEqual(["No tests", "Scope creep", "Unclear goal"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete “Scope creep”" }));
    expect(shownTexts()).toEqual(["No tests", "Unclear goal"]);
    expect(undo.last?.label).toBe("Removed “Scope creep”");

    act(() => undo.last!.revert());
    expect(storedTexts()).toEqual(["Unclear goal", "Scope creep", "No tests"]);
    act(() => undo.last!.revert());
    expect(storedTexts()).toEqual(["Unclear goal", "Scope creep", "No tests"]);
    expect(shownTexts()).toEqual(["No tests", "Scope creep", "Unclear goal"]);
  });
});
