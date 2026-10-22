import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * NPS / CSAT client: the KPI cards (NPS, CSAT average, anomalies), adding a
 * response (score draft, clamping per survey type, form reset), the
 * response list (order, category, text, delete) and the trend card.
 * buildScoreTrend and the chart text are covered in nps-csat-fixes and
 * chart-text.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { NpsCsatClient } from "@/app/(tools)/nps-csat/nps-csat-client";

const resp = (
  id: string,
  kind: "nps" | "csat",
  score: number,
  date: string,
  extra: Partial<NpsResponse> = {}
): NpsResponse => ({ id, kind, score, date, ...extra });

const responses = () => useWorkspaceStore.getState().npsResponses ?? [];
const kpi = (label: string) => {
  const head = screen.getByText(label, { selector: "span.truncate" }).parentElement!;
  return {
    value: head.nextElementSibling!.textContent,
    hint: head.parentElement!.lastChild!.textContent,
  };
};
const scoreInput = () => screen.getByLabelText(/^Score \(/) as HTMLInputElement;
const commitScore = (value: string) => {
  fireEvent.change(scoreInput(), { target: { value } });
  fireEvent.blur(scoreInput());
};
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));
function chooseKind(option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Survey type" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}
/** The response rows, newest first, as their visible text. */
const listed = () =>
  screen
    .queryAllByRole("button", { name: /^Remove (NPS|CSAT) response from / })
    .map((b) => b.parentElement!.textContent);

beforeEach(() => {
  useWorkspaceStore.setState({ npsResponses: [] });
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NPS / CSAT: KPI cards", () => {
  it("shows dashes, not zeros, before any response", () => {
    render(<NpsCsatClient />);
    expect(kpi("NPS")).toEqual({ value: "—", hint: "0 responses" });
    expect(kpi("CSAT")).toEqual({ value: "—", hint: "0 responses (1-5)" });
    expect(kpi("Anomalies").value).toBe("0");
    expect(screen.queryByText("Score Trend")).toBeNull();
    expect(listed()).toEqual([]);
  });

  it("computes NPS as % promoters − % detractors and CSAT as a one-decimal average", () => {
    useWorkspaceStore.setState({
      npsResponses: [
        resp("n1", "nps", 10, "2026-10-01"),
        resp("n2", "nps", 9, "2026-10-01"),
        resp("n3", "nps", 7, "2026-10-01"),
        resp("n4", "nps", 3, "2026-10-01"),
        resp("c1", "csat", 4, "2026-10-01"),
        resp("c2", "csat", 5, "2026-10-01"),
        resp("c3", "csat", 4, "2026-10-01"),
      ],
    });
    render(<NpsCsatClient />);
    expect(kpi("NPS")).toEqual({ value: "25", hint: "4 responses" });
    expect(kpi("CSAT")).toEqual({ value: "4.3", hint: "3 responses (1-5)" });
  });

  it("shows a real NPS of 0 as 0, and a negative NPS", () => {
    useWorkspaceStore.setState({
      npsResponses: [resp("n1", "nps", 9, "2026-10-01"), resp("n2", "nps", 2, "2026-10-01")],
    });
    const { unmount } = render(<NpsCsatClient />);
    expect(kpi("NPS").value).toBe("0");
    unmount();
    useWorkspaceStore.setState({
      npsResponses: [resp("n1", "nps", 8, "2026-10-01"), resp("n2", "nps", 2, "2026-10-01")],
    });
    render(<NpsCsatClient />);
    expect(kpi("NPS").value).toBe("-50");
  });

  it("counts NPS scores more than two standard deviations out as anomalies", () => {
    useWorkspaceStore.setState({
      npsResponses: [
        ...Array.from({ length: 9 }, (_, i) => resp(`n${i}`, "nps", 9, "2026-10-01")),
        resp("low", "nps", 0, "2026-10-02"),
        // CSAT scores never count.
        resp("c1", "csat", 1, "2026-10-02"),
      ],
    });
    render(<NpsCsatClient />);
    expect(kpi("Anomalies").value).toBe("1");
  });
});

describe("NPS / CSAT: adding a response", () => {
  it("adds an NPS 8 dated today by default, then resets the form", () => {
    render(<NpsCsatClient />);
    fireEvent.change(screen.getByLabelText("Respondent (optional)"), {
      target: { value: "Dana" },
    });
    fireEvent.change(screen.getByLabelText("Verbatim comment (optional)"), {
      target: { value: "Love it" },
    });
    add();
    expect(responses()).toHaveLength(1);
    expect(responses()[0]).toMatchObject({
      kind: "nps",
      score: 8,
      date: todayLocalISO(),
      respondent: "Dana",
      verbatim: "Love it",
    });
    expect(screen.getByLabelText("Respondent (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Verbatim comment (optional)")).toHaveValue("");
    expect(scoreInput().value).toBe("8");
    expect(kpi("NPS")).toEqual({ value: "0", hint: "1 responses" });
  });

  it("gives every response its own id", () => {
    render(<NpsCsatClient />);
    add();
    add();
    const ids = responses().map((r) => r.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("clamps the score to 0-10 on blur and to 1-5 for CSAT", () => {
    render(<NpsCsatClient />);
    commitScore("15");
    expect(scoreInput().value).toBe("10");
    commitScore("-3");
    expect(scoreInput().value).toBe("0");
    add();
    expect(responses()[0].score).toBe(0);

    chooseKind("CSAT (1-5)");
    expect(screen.getByLabelText("Score (1–5)")).toBeInTheDocument();
    commitScore("0");
    expect(scoreInput().value).toBe("1");
    commitScore("9");
    expect(scoreInput().value).toBe("5");
    add();
    expect(responses()[1]).toMatchObject({ kind: "csat", score: 5 });
    // The next CSAT draft starts at 4.
    expect(scoreInput().value).toBe("4");
  });

  it("re-clamps the draft when switching survey type without touching the score", () => {
    render(<NpsCsatClient />);
    chooseKind("CSAT (1-5)");
    expect(scoreInput().value).toBe("5");
    add();
    expect(responses()[0]).toMatchObject({ kind: "csat", score: 5 });
    expect(kpi("CSAT").value).toBe("5.0");
  });

  it("commits the score on Enter", () => {
    render(<NpsCsatClient />);
    fireEvent.change(scoreInput(), { target: { value: "10" } });
    scoreInput().focus();
    fireEvent.keyDown(scoreInput(), { key: "Enter" });
    add();
    expect(responses()[0].score).toBe(10);
  });

  // Bug: Number("") is 0, so clearing the score and leaving it recorded a 0
  // (a detractor) instead of keeping the last score, as other unreadable input does.
  it("keeps the last score when the field is left blank", () => {
    render(<NpsCsatClient />);
    commitScore("");
    expect(scoreInput().value).toBe("8");
    add();
    expect(responses()[0].score).toBe(8);
  });

  it("records the date picked", () => {
    render(<NpsCsatClient />);
    fireEvent.change(screen.getByLabelText("Response date"), { target: { value: "2026-09-30" } });
    add();
    expect(responses()[0].date).toBe("2026-09-30");
  });
});

describe("NPS / CSAT: response list", () => {
  it("lists responses newest first with their category and text", () => {
    useWorkspaceStore.setState({
      npsResponses: [
        resp("a", "nps", 10, "2026-10-01", { respondent: "Dana", verbatim: "Great" }),
        resp("b", "nps", 7, "2026-10-03", { respondent: "Lee" }),
        resp("c", "nps", 6, "2026-10-02"),
        resp("d", "csat", 2, "2026-10-04"),
      ],
    });
    render(<NpsCsatClient />);
    expect(listed()).toEqual([
      "2026-10-04csat2—",
      "2026-10-03nps7passiveLee",
      "2026-10-02nps6detractor—",
      "2026-10-01nps10promoterGreat",
    ]);
    expect(screen.getByText("Score Trend")).toBeInTheDocument();
  });

  it("removes only the response whose Remove was clicked", () => {
    useWorkspaceStore.setState({
      npsResponses: [resp("a", "nps", 10, "2026-10-01"), resp("b", "csat", 3, "2026-10-01")],
    });
    render(<NpsCsatClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove CSAT response from 2026-10-01" }));
    expect(responses().map((r) => r.id)).toEqual(["a"]);
    expect(kpi("CSAT").value).toBe("—");
    expect(kpi("NPS").value).toBe("100");
  });
});
