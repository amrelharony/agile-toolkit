import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Refinement: Story History "Clear" wiped every saved story at once with no
 * confirmation. It now asks first, with the count, and offers Undo.
 */

// Three saved stories, in the tool's persisted store (read at import).
vi.hoisted(() => {
  const save = (id: string, storyName: string) => ({
    id,
    storyName,
    date: "2026-10-10",
    checks: [],
    totalCriteria: 8,
    metCount: 6,
    passRate: 75,
  });
  localStorage.setItem(
    "agile-toolkit:refinement",
    JSON.stringify({
      state: {
        history: [save("s1", "Login with SSO"), save("s2", "Export CSV"), save("s3", "Dark mode")],
      },
      version: 0,
    })
  );
});
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

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { RefinementClient } from "@/app/(tools)/refinement/refinement-client";

beforeEach(() => {
  undo.last = null;
});

const historyNames = () =>
  Array.from(document.querySelectorAll("tbody tr td:first-child")).map((td) =>
    td.textContent?.trim()
  );

describe("Refinement Story History clear", () => {
  it("asks with the count, clears on confirm, and Undo restores every story", async () => {
    render(<RefinementClient />);
    expect(await screen.findByText("Login with SSO")).toBeInTheDocument();

    // Cancel keeps everything.
    fireEvent.click(screen.getByRole("button", { name: "Clear story history" }));
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Clear story history?");
    expect(dialog).toHaveTextContent("All 3 saved stories will be removed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(historyNames()).toEqual(["Login with SSO", "Export CSV", "Dark mode"]);
    expect(undo.last).toBeNull();

    // Confirm clears, with Undo.
    fireEvent.click(screen.getByRole("button", { name: "Clear story history" }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(screen.getByText(/No stories saved yet/)).toBeInTheDocument();
    expect(undo.last?.label).toBe("Cleared 3 saved stories");

    act(() => undo.last!.revert());
    expect(historyNames()).toEqual(["Login with SSO", "Export CSV", "Dark mode"]);
  });
});
