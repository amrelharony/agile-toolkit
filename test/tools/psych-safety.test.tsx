import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PsychSafetyQuestionId, PsychSafetyResponse } from "@/lib/stores/workspace-types";

/**
 * Psychological Safety Assessment (Edmondson 7-question survey): logging a
 * response with the sliders, the reversed-adjusted team score, the lowest
 * question, the half-over-half anomaly, the radar projection, removal and
 * the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
// Radix Slider measures its thumb with a ResizeObserver; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { PsychSafetyClient } from "@/app/(tools)/psych-safety/psych-safety-client";

const PS_ID = "psychSafety:current";
const Q_TEXT: Record<PsychSafetyQuestionId, string> = {
  q1: "If I make a mistake on this team, it is held against me.",
  q2: "Members of this team are able to bring up problems and tough issues.",
  q3: "People on this team sometimes reject others for being different.",
  q4: "It is safe to take a risk on this team.",
  q5: "It is difficult to ask other members of this team for help.",
  q6: "No one on this team would deliberately act in a way that undermines my efforts.",
  q7: "Working with members of this team, my unique skills and talents are valued and utilized.",
};

type Scores = Record<PsychSafetyQuestionId, number>;
const all = (v: number): Scores => ({ q1: v, q2: v, q3: v, q4: v, q5: v, q6: v, q7: v });
/** Raw answers that reverse-adjust to `v` on every question (q1/q3/q5 are reversed). */
const adjustedAll = (v: number): Scores => ({
  q1: 6 - v,
  q2: v,
  q3: 6 - v,
  q4: v,
  q5: 6 - v,
  q6: v,
  q7: v,
});

const resp = (id: string, ts: string, scores: Scores, extra: Partial<PsychSafetyResponse> = {}) =>
  ({ id, ts, scores, ...extra }) as PsychSafetyResponse;

const seed = (responses: PsychSafetyResponse[]) =>
  useWorkspaceStore.setState({ psychSafetyLogs: [{ id: PS_ID, responses }] });

const stored = () =>
  (useWorkspaceStore.getState().psychSafetyLogs ?? []).find((d) => d.id === PS_ID)?.responses ?? [];

/** Full text of the KPI card whose label is `label`. */
const card = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

const thumb = (q: PsychSafetyQuestionId) =>
  screen.getByRole("slider", { name: `Score for ${Q_TEXT[q]}` });

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ psychSafetyLogs: [] });
});

describe("Psych safety: empty state", () => {
  it("shows placeholders, the empty message and no radar", () => {
    render(<PsychSafetyClient />);
    expect(screen.getByText(/No responses yet/)).toBeInTheDocument();
    expect(card("Team score")).toBe("Team score—/5benchmark 4.0");
    expect(card("Responses")).toBe("Responses0");
    expect(card("Lowest question")).toBe("Lowest question—");
    expect(card("Anomaly")).toBe("Anomalyokneeds ≥ 4 responses");
    expect(screen.queryByRole("img", { name: "Psychological safety radar chart" })).toBeNull();
    expect(exported.csv?.rows).toEqual([]);
  });

  it("offers one 1-5 slider per question, all starting at 3", () => {
    render(<PsychSafetyClient />);
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(7);
    for (const s of sliders) {
      expect(s).toHaveAttribute("aria-valuemin", "1");
      expect(s).toHaveAttribute("aria-valuemax", "5");
      expect(s).toHaveAttribute("aria-valuenow", "3");
    }
  });
});

describe("Psych safety: logging a response", () => {
  it("submits the default all-3 response as a neutral 3.00 team score", () => {
    render(<PsychSafetyClient />);
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));

    const [r] = stored();
    expect(stored()).toHaveLength(1);
    expect(r.scores).toEqual(all(3));
    expect(r.respondent).toBeUndefined();
    expect(r.description).toBeUndefined();
    expect(Number.isNaN(Date.parse(r.ts))).toBe(false);

    expect(card("Team score")).toBe("Team score3.00/5benchmark 4.0");
    expect(card("Responses")).toBe("Responses1");
    expect(screen.queryByText(/No responses yet/)).toBeNull();
  });

  it("stores slider scores raw and reverse-adjusts q1/q3/q5 in the team score", () => {
    render(<PsychSafetyClient />);
    // q1 is reversed: a raw 1 ("mistakes are never held against me") adjusts to 5.
    fireEvent.keyDown(thumb("q1"), { key: "Home" });
    // q4 is not reversed: a raw 5 stays 5.
    fireEvent.keyDown(thumb("q4"), { key: "End" });
    expect(thumb("q1")).toHaveAttribute("aria-valuenow", "1");
    expect(thumb("q4")).toHaveAttribute("aria-valuenow", "5");

    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(stored()[0].scores).toEqual({ ...all(3), q1: 1, q4: 5 });

    // Adjusted: [5, 3, 3, 5, 3, 3, 3] -> 25/7.
    expect(card("Team score")).toBe(`Team score${(25 / 7).toFixed(2)}/5benchmark 4.0`);
    // Ties at 3.00 resolve to the first such question (q2).
    expect(card("Lowest question")).toBe("Lowest questionQ23.00/5");
  });

  it("trims the respondent and description, and drops blank ones", () => {
    render(<PsychSafetyClient />);
    fireEvent.change(screen.getByRole("textbox", { name: "Respondent" }), {
      target: { value: "  Ana  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "  after the outage  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(stored()[0]).toMatchObject({ respondent: "Ana", description: "after the outage" });

    fireEvent.change(screen.getByRole("textbox", { name: "Respondent" }), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: " \n " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(stored()[1].respondent).toBeUndefined();
    expect(stored()[1].description).toBeUndefined();
  });

  it("resets the form after submitting", () => {
    render(<PsychSafetyClient />);
    fireEvent.keyDown(thumb("q2"), { key: "End" });
    fireEvent.change(screen.getByRole("textbox", { name: "Respondent" }), {
      target: { value: "Ana" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));

    expect(thumb("q2")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByRole("textbox", { name: "Respondent" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
  });

  it("appends to existing responses instead of replacing them", () => {
    seed([resp("r1", "2026-10-01T09:00:00.000Z", all(4))]);
    render(<PsychSafetyClient />);
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(stored().map((r) => r.id)[0]).toBe("r1");
    expect(stored()).toHaveLength(2);
  });
});

describe("Psych safety: derived values", () => {
  it("averages per question, reverse-adjusts, and names the lowest question", () => {
    // Raw [2,4,1,3,4,5,4] -> adjusted [4,4,5,3,2,5,4] (sum 27).
    seed([
      resp(
        "r1",
        "2026-10-01T09:00:00.000Z",
        { q1: 2, q2: 4, q3: 1, q4: 3, q5: 4, q6: 5, q7: 4 },
        { respondent: "Ana", description: "Line one\nLine two" }
      ),
    ]);
    render(<PsychSafetyClient />);

    expect(card("Team score")).toBe(`Team score${(27 / 7).toFixed(2)}/5benchmark 4.0`);
    expect(card("Lowest question")).toBe("Lowest questionQ52.00/5");

    const averages = screen.getByText("Per-question averages").nextElementSibling!;
    const shown = Array.from(averages.querySelectorAll(".font-data")).map((e) => e.textContent);
    expect(shown).toEqual(["4.00", "4.00", "5.00", "3.00", "2.00", "5.00", "4.00"]);

    // The response row shows the raw answers, respondent and description.
    expect(screen.getByText("Q1=2 · Q2=4 · Q3=1 · Q4=3 · Q5=4 · Q6=5 · Q7=4")).toBeInTheDocument();
    expect(screen.getByText(/· Ana$/)).toBeInTheDocument();
    expect(screen.getByText(/Line one/)).toHaveTextContent("Line one Line two");
  });

  it("averages raw answers across responses before reverse-adjusting", () => {
    // Two opposite responses average to 3 on every question.
    seed([
      resp("r1", "2026-10-01T09:00:00.000Z", adjustedAll(5)),
      resp("r2", "2026-10-02T09:00:00.000Z", adjustedAll(1)),
    ]);
    render(<PsychSafetyClient />);
    expect(card("Team score")).toBe("Team score3.00/5benchmark 4.0");
    expect(card("Responses")).toBe("Responses2");
  });

  it("projects the radar from the reverse-adjusted scores (no NaN)", () => {
    seed([resp("r1", "2026-10-01T09:00:00.000Z", adjustedAll(5))]);
    render(<PsychSafetyClient />);
    const radar = screen.getByRole("img", { name: "Psychological safety radar chart" });
    const [bench, team] = Array.from(radar.querySelectorAll("polygon")).map(
      (p) => p.getAttribute("points")!
    );
    expect(bench).not.toMatch(/NaN|Infinity/);
    expect(team).not.toMatch(/NaN|Infinity/);
    // 300px box, radius 117. Q1 sits straight up: a 5 is the outer ring
    // (y = 150 - 117), the 4.0 benchmark three quarters of the way out.
    expect(team.split(" ")[0]).toBe("150,33");
    expect(bench.split(" ")[0]).toBe("150,62.25");
    expect(team.split(" ")).toHaveLength(7);
  });

  it("clamps the per-question bars to 0-100%", () => {
    seed([resp("r1", "2026-10-01T09:00:00.000Z", adjustedAll(5))]);
    render(<PsychSafetyClient />);
    const averages = screen.getByText("Per-question averages").nextElementSibling!;
    const bars = Array.from(averages.querySelectorAll<HTMLElement>(".h-full")).map(
      (b) => b.style.width
    );
    expect(bars).toEqual(Array(7).fill("100%"));
  });
});

describe("Psych safety: anomaly (half over half)", () => {
  it("needs at least 4 responses", () => {
    seed([
      resp("r1", "2026-10-01T09:00:00.000Z", adjustedAll(5)),
      resp("r2", "2026-10-02T09:00:00.000Z", adjustedAll(1)),
      resp("r3", "2026-10-03T09:00:00.000Z", adjustedAll(1)),
    ]);
    render(<PsychSafetyClient />);
    expect(card("Anomaly")).toBe("Anomalyokneeds ≥ 4 responses");
    expect(screen.queryByText(/Score dropped/)).toBeNull();
  });

  it("flags a > 0.5 drop, splitting by timestamp rather than insertion order", () => {
    // Inserted out of order; chronologically the first half is all-5, the second all-1.
    seed([
      resp("r3", "2026-10-03T09:00:00.000Z", all(1)),
      resp("r1", "2026-10-01T09:00:00.000Z", all(5)),
      resp("r4", "2026-10-04T09:00:00.000Z", all(1)),
      resp("r2", "2026-10-02T09:00:00.000Z", all(5)),
    ]);
    render(<PsychSafetyClient />);
    // Prior half 23/7, recent half 19/7 -> delta -4/7.
    expect(card("Anomaly")).toBe(`Anomalydrop${(-4 / 7).toFixed(2)} vs prior half`);
    expect(screen.getByText("Score dropped > 0.5")).toBeInTheDocument();
  });

  it("reports an improvement as ok with a signed delta", () => {
    seed([
      resp("r1", "2026-10-01T09:00:00.000Z", all(1)),
      resp("r2", "2026-10-02T09:00:00.000Z", all(1)),
      resp("r3", "2026-10-03T09:00:00.000Z", all(5)),
      resp("r4", "2026-10-04T09:00:00.000Z", all(5)),
    ]);
    render(<PsychSafetyClient />);
    expect(card("Anomaly")).toBe("Anomalyok+0.57 vs prior half");
    expect(screen.queryByText(/Score dropped/)).toBeNull();
  });

  it("does not flag a drop of exactly 0.5 or less", () => {
    // Adjusted 4 then adjusted 3.5 -> delta -0.5 exactly.
    seed([
      resp("r1", "2026-10-01T09:00:00.000Z", adjustedAll(4)),
      resp("r2", "2026-10-02T09:00:00.000Z", adjustedAll(4)),
      resp("r3", "2026-10-03T09:00:00.000Z", adjustedAll(3)),
      resp("r4", "2026-10-04T09:00:00.000Z", adjustedAll(4)),
    ]);
    render(<PsychSafetyClient />);
    expect(card("Anomaly")).toBe("Anomalyok-0.50 vs prior half");
  });
});

describe("Psych safety: removing and exporting", () => {
  const r1 = resp("r1", "2026-10-01T09:00:00.000Z", all(2), { respondent: "Ana" });
  const r2 = resp("r2", "2026-10-02T09:00:00.000Z", all(4), { description: "a, b" });

  it("removes exactly the clicked response", () => {
    seed([r1, r2]);
    render(<PsychSafetyClient />);
    const label = `Remove response from ${new Date(r2.ts).toLocaleString()}`;
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(stored().map((r) => r.id)).toEqual(["r1"]);
    expect(card("Responses")).toBe("Responses1");
  });

  it("returns to the empty state after removing the last response", () => {
    seed([r1]);
    render(<PsychSafetyClient />);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove response from ${new Date(r1.ts).toLocaleString()}`,
      })
    );
    expect(stored()).toEqual([]);
    expect(screen.getByText(/No responses yet/)).toBeInTheDocument();
    expect(card("Team score")).toBe("Team score—/5benchmark 4.0");
  });

  it("exports one CSV row per response with blank optional fields", () => {
    seed([r1, r2]);
    render(<PsychSafetyClient />);
    expect(exported.csv?.headers).toEqual([
      "Timestamp",
      "Respondent",
      "q1",
      "q2",
      "q3",
      "q4",
      "q5",
      "q6",
      "q7",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      [r1.ts, "Ana", 2, 2, 2, 2, 2, 2, 2, ""],
      [r2.ts, "", 4, 4, 4, 4, 4, 4, 4, "a, b"],
    ]);
  });
});
