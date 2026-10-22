import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * ICE gap-filling: clamping into 1-10, the ranked table, delete, the form
 * reset, the title-only message, and how fractional scores are shown.
 * "Every score is required" lives in ice-score-fixes.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: unknown[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { IceScoreClient } from "@/app/(tools)/ice-score/ice-score-client";

const ice = (id: string, title: string, i: number, c: number, e: number): PrioritizationItem => ({
  id,
  framework: "ice",
  title,
  score: i * c * e,
  fields: { impact: i, confidence: c, ease: e },
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const iceRows = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter((r) => r.framework === "ice");
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addAndScore = () => fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
function fill(title: string, i: string, c: string, e: string) {
  type("Title", title);
  type("Impact (1–10)", i);
  type("Confidence (1–10)", c);
  type("Ease (1–10)", e);
}
const rowCells = (title: string) =>
  within(screen.getByText(title).closest("tr")!)
    .getAllByRole("cell")
    .map((c) => c.textContent);

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});
afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("ICE: adding", () => {
  it("clamps out-of-range scores into 1-10 before storing and scoring them", () => {
    render(<IceScoreClient />);
    fill("Referral bonus", "100", "0", "-3");
    addAndScore();
    expect(iceRows()[0]).toMatchObject({
      fields: { impact: 10, confidence: 1, ease: 1 },
      score: 10,
    });
  });

  it("trims the title and empties the form for the next idea", () => {
    render(<IceScoreClient />);
    fill("  Onboarding email  ", "8", "6", "4");
    addAndScore();
    expect(iceRows()[0].title).toBe("Onboarding email");
    for (const label of ["Title", "Impact (1–10)", "Confidence (1–10)", "Ease (1–10)"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    }
    // A failed attempt after a successful add starts unflagged.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Title")).not.toHaveAttribute("aria-invalid");
  });

  it("asks only for a title when the scores are filled", () => {
    render(<IceScoreClient />);
    fill("   ", "8", "6", "4");
    addAndScore();
    expect(iceRows()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a title to score this idea.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Each score runs from 1 to 10.");
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  });

  it("names two missing scores with 'and'", () => {
    render(<IceScoreClient />);
    fill("Referral bonus", "8", "", "");
    addAndScore();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter Confidence and Ease to score this idea. Each score runs from 1 to 10."
    );
  });
});

describe("ICE: table", () => {
  it("ranks ideas by score with dense ranks, only ICE rows", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        ice("a", "Referral bonus", 5, 5, 5),
        ice("b", "Onboarding email", 8, 6, 4),
        ice("c", "Price test", 5, 5, 5),
        { ...ice("r", "A RICE row", 9, 9, 9), framework: "rice" },
      ],
    });
    render(<IceScoreClient />);
    expect(screen.getByText("Ideas (3, sorted by ICE)")).toBeInTheDocument();
    expect(screen.queryByText("A RICE row")).toBeNull();
    expect(rowCells("Onboarding email").slice(2, 6)).toEqual(["8", "6", "4", "192"]);
    expect(rowCells("Onboarding email")[0]).toBe("1");
    expect(rowCells("Referral bonus")[0]).toBe("2");
    expect(rowCells("Price test")[0]).toBe("2");
    expect(exported.csv?.rows.map((r) => r[1])).toEqual([
      "Onboarding email",
      "Referral bonus",
      "Price test",
    ]);
  });

  it("removes only the row whose Remove was clicked", () => {
    useWorkspaceStore.setState({
      prioritizations: [ice("a", "Referral bonus", 5, 5, 5), ice("b", "Price test", 5, 5, 5)],
    });
    render(<IceScoreClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Price test" }));
    expect(iceRows().map((r) => r.id)).toEqual(["a"]);
    expect(screen.queryByText("Price test")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Referral bonus" }));
    expect(iceRows()).toEqual([]);
    // The table goes away with the last idea.
    expect(screen.queryByRole("table")).toBeNull();
  });

  // Bug: the raw float product was shown, e.g. 3.3 × 3 × 1 → "9.899999999999999".
  it("shows a fractional score without floating-point noise", () => {
    render(<IceScoreClient />);
    fill("Fractional idea", "3.3", "3", "1");
    addAndScore();
    expect(iceRows()[0].score).toBeCloseTo(9.9);
    expect(rowCells("Fractional idea")[5]).toBe("9.9");
    expect(exported.csv?.rows[0][5]).toBe(9.9);
  });
});
