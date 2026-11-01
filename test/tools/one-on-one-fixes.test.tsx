import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * 1:1 tracker: starting the next 1:1 with the same person carries over
 * unfinished Actions (with their action, owner and due date), not only Open
 * items. The carried-over action is counted once in "Action items overdue".
 */

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

import { OneOnOneClient } from "@/app/(tools)/one-on-one/one-on-one-client";

beforeEach(() => {
  localStorage.setItem(
    "agile-toolkit:one-on-one",
    JSON.stringify([
      {
        id: "m-prev",
        manager: "Mia",
        report: "Raj",
        date: "2000-01-05",
        agenda: [
          { id: "i-open", text: "Career goals", status: "open" },
          {
            id: "i-action",
            text: "Flaky CI",
            status: "action_required",
            action: "Pair on the flaky tests",
            owner: "Raj",
            dueDate: "2000-01-10",
          },
          { id: "i-done", text: "Holiday plans", status: "discussed" },
        ],
      },
    ])
  );
});

const card = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

describe("1:1 carry-over", () => {
  it("carries Open items and unfinished Actions into the next 1:1", () => {
    render(
      <TooltipProvider>
        <OneOnOneClient />
      </TooltipProvider>
    );
    expect(card("Action items overdue")).toBe("Action items overdue1");

    // Manager and Report are roster pickers (an input with suggestions).
    fireEvent.change(screen.getByRole("combobox", { name: "Manager" }), {
      target: { value: "mia" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Report" }), {
      target: { value: "Raj" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));

    expect(screen.getByText("Career goals")).toBeInTheDocument();
    expect(screen.getByText("Flaky CI")).toBeInTheDocument();
    expect(screen.queryByText("Holiday plans")).toBeNull();

    // The carried item keeps its status: Action, picked in its status group.
    const status = screen.getByRole("radiogroup", { name: "Status of Flaky CI" });
    expect(within(status).getByRole("radio", { name: "Action" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    // Each field names its item.
    expect(screen.getByRole("textbox", { name: "Action for Flaky CI" })).toHaveValue(
      "Pair on the flaky tests"
    );
    expect(screen.getByRole("combobox", { name: "Owner of Flaky CI" })).toHaveValue("Raj");
    expect(screen.getByLabelText("Due date of Flaky CI")).toHaveValue("2000-01-10");

    // Still one overdue action: the old copy is superseded by the new one.
    expect(card("Action items overdue")).toBe("Action items overdue1");

    const stored = JSON.parse(localStorage.getItem("agile-toolkit:one-on-one")!) as {
      id: string;
      agenda: { text: string; carriedFrom?: string }[];
    }[];
    const next = stored.find((m) => m.id !== "m-prev")!;
    expect(next.agenda.map((a) => [a.text, a.carriedFrom])).toEqual([
      ["Career goals", "i-open"],
      ["Flaky CI", "i-action"],
    ]);
  });
});
