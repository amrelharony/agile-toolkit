import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KR_CHECK_IN_CAP,
  type KeyResult,
  type KeyResultCheckIn,
  type Okr,
  type Sprint,
  type SprintGoal,
} from "@/lib/stores/workspace-types";
import { blankGoal } from "@/lib/sprints/goal-doc";
import {
  confidenceTrend,
  krPercent,
  objectivePercent,
  okrVerdict,
  withCheckIn,
  withoutCheckIn,
} from "@/lib/okrs/progress";
import { isExampleId } from "@/lib/utils/example-id";
import { LEGACY_OKR, OKR } from "../stores/phase8-fixtures";

/**
 * OKR Tracker, upgraded (Phase 8): objectives with an owner and a picked
 * quarter, a quarter filter that opens on today's quarter, key results
 * that name a baseline and a direction (so a number that should fall can
 * be measured), dated check-ins with an optional 0–10 confidence that
 * starts unset, the confidence trend from those check-ins, the sprint
 * goals that link each objective, a verdict, Markdown, the example, and
 * the same numbers as tool.okrs.* for the same data.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
const sounds = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/sonification/emit", () => ({
  emit: (tool: string, event: string) => sounds.push(`${tool}:${event}`),
}));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown ?? "";
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/okrs/charts", () => ({ ConfidenceTrendChart: () => null }));

import { OkrsClient } from "@/app/(tools)/okrs/okrs-client";
import { buildExample } from "@/app/(tools)/okrs/example";
import { toMarkdown } from "@/app/(tools)/okrs/markdown";
import { CHART_MIN_DAYS, confidenceTrendText, dayLabel } from "@/app/(tools)/okrs/chart-text";
import {
  EMPTY_KEY_RESULT,
  emptyCheckIn,
  emptyObjective,
  keyResultDraft,
  newKeyResult,
  objectiveDraft,
  validateCheckIn,
  validateKeyResult,
  validateObjective,
  withKeyResultValues,
  withObjectiveValues,
} from "@/app/(tools)/okrs/forms";
import {
  ALL_QUARTERS,
  NO_QUARTER,
  defaultQuarter,
  okrsVerdict,
  quarterChips,
  quarterKey,
} from "@/app/(tools)/okrs/view";
import { OkrStep } from "@/app/(tools)/sprint-goal/okr-step";
import { TooltipProvider } from "@/components/ui/tooltip";

/** 27 Oct 2026, noon local: only Date is faked, so promises and timers run as usual. */
const NOW = new Date(2026, 9, 27, 12);
const TODAY = "2026-10-27";

const kr = (id: string, extra: Partial<KeyResult> = {}): KeyResult => ({
  id,
  title: `KR ${id}`,
  target: 100,
  current: 0,
  ...extra,
});
const okr = (id: string, extra: Partial<Okr> = {}): Okr => ({
  id,
  objective: `Objective ${id}`,
  quarter: "2026 Q4",
  keyResults: [],
  ...extra,
});
const ci = (id: string, date: string, value: number, confidence?: number): KeyResultCheckIn => ({
  id,
  date,
  value,
  ...(confidence !== undefined ? { confidence } : {}),
});

const stored = () => useWorkspaceStore.getState().okrs;
const storedKr = (okrId: string, krId: string) =>
  stored()
    .find((o) => o.id === okrId)
    ?.keyResults.find((k) => k.id === krId);
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () =>
  act(() => (lastToast()[1] as { action: { onClick: () => void } }).action.onClick());
const actions = () => logs.map((l) => l.action);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  logs.length = 0;
  sounds.length = 0;
  toastSpy.mockClear();
  toastSpy.error.mockClear();
  exported.markdown = "";
  useWorkspaceStore.setState({ okrs: [], sprintGoals: [], sprints: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

/* ── The forms ──────────────────────────────────────────────────────── */

describe("validateObjective", () => {
  it("needs words and a quarter; nothing is defaulted", () => {
    const r = validateObjective(emptyObjective());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.objective).toMatch(/achieve/);
      expect(r.errors.quarter).toMatch(/quarter/);
      expect(r.errors.owner).toBeUndefined();
    }
  });

  it("stores the canonical quarter and leaves a blank owner out", () => {
    const r = validateObjective({
      objective: "  Grow   repeat\norders ",
      quarter: "Q4 2026",
      owner: " ",
      description: "",
    });
    expect(r).toEqual({
      ok: true,
      values: { objective: "Grow repeat orders", quarter: "2026 Q4" },
    });
  });

  it("refuses over-long text", () => {
    const r = validateObjective({
      objective: "x".repeat(201),
      quarter: "2026 Q4",
      owner: "y".repeat(121),
      description: "z".repeat(2001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["description", "objective", "owner"]);
  });

  it("reads a legacy quarter for the edit form, and text that isn't one as none", () => {
    expect(objectiveDraft(LEGACY_OKR).quarter).toBe("2026 Q4");
    expect(objectiveDraft(okr("o", { quarter: "next spring" })).quarter).toBe("");
  });

  it("removes an emptied owner or description on save, keeping the key results", () => {
    const before = okr("o", { owner: "Sam", description: "Why", keyResults: [kr("k")] });
    const next = withObjectiveValues(before, { objective: "Renamed", quarter: "2027 Q1" });
    expect(next).toEqual({
      id: "o",
      objective: "Renamed",
      quarter: "2027 Q1",
      keyResults: [kr("k")],
    });
  });
});

describe("validateKeyResult", () => {
  const draft = (patch: Partial<typeof EMPTY_KEY_RESULT>) => ({ ...EMPTY_KEY_RESULT, ...patch });

  it("needs a title, a direction, a baseline and a target: no silent increase, no 0 baseline", () => {
    const r = validateKeyResult(EMPTY_KEY_RESULT);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual(["baseline", "direction", "target", "title"]);
  });

  it("checks the target against the baseline for the direction", () => {
    const up = validateKeyResult(
      draft({ title: "t", direction: "increase", baseline: "50", target: "40" })
    );
    expect(!up.ok && up.errors.target).toMatch(/above the baseline \(50\)/);
    const down = validateKeyResult(
      draft({ title: "t", direction: "decrease", baseline: "8", target: "9" })
    );
    expect(!down.ok && down.errors.target).toMatch(/below the baseline \(8\)/);
    const same = validateKeyResult(
      draft({ title: "t", direction: "decrease", baseline: "8", target: "8" })
    );
    expect(!same.ok && same.errors.target).toMatch(/differ/);
  });

  it("accepts a decreasing key result, with negative and decimal numbers", () => {
    const r = validateKeyResult(
      draft({
        title: "Payment errors",
        direction: "decrease",
        baseline: "8.5",
        target: "-0.5",
        unit: "%",
      })
    );
    expect(r).toEqual({
      ok: true,
      values: {
        title: "Payment errors",
        direction: "decrease",
        baseline: 8.5,
        target: -0.5,
        unit: "%",
      },
    });
  });

  it("refuses text where a number goes", () => {
    const r = validateKeyResult(
      draft({ title: "t", direction: "increase", baseline: "abc", target: "1e400" })
    );
    expect(!r.ok && r.errors.baseline).toBe("Enter a number.");
    expect(!r.ok && r.errors.target).toBe("Enter a number.");
  });

  it("lets a key result saved before baselines keep none when edited", () => {
    const d = keyResultDraft(LEGACY_OKR.keyResults[0]);
    expect(d).toMatchObject({ baseline: "", direction: "increase", target: "100" });
    expect(validateKeyResult(d).ok).toBe(false);
    const r = validateKeyResult(d, { requireBaseline: false });
    expect(r.ok && r.values.baseline).toBeUndefined();
  });

  it("starts a new key result at its baseline, unscored and with no check-ins", () => {
    const k = newKeyResult({ title: "Churn", direction: "decrease", baseline: 22, target: 15 });
    expect(k.id).toMatch(/^kr_/);
    expect(k).toMatchObject({ current: 22, baseline: 22, direction: "decrease", checkIns: [] });
    expect("confidence" in k).toBe(false);
    expect(krPercent(k)).toBe(0);
  });

  it("moves an untouched key result to a new baseline, but never one with check-ins or a typed value", () => {
    const fresh = newKeyResult({ title: "a", direction: "increase", baseline: 10, target: 50 });
    expect(
      withKeyResultValues(fresh, { title: "a", direction: "increase", baseline: 20, target: 50 })
        .current
    ).toBe(20);
    const checked = withCheckIn(fresh, ci("c1", "2026-10-20", 15));
    expect(
      withKeyResultValues(checked, { title: "a", direction: "increase", baseline: 5, target: 50 })
        .current
    ).toBe(15);
    // A key result from before Phase 8: its typed current is the latest known.
    const legacy = LEGACY_OKR.keyResults[0];
    const set = withKeyResultValues(legacy, {
      title: "Beta testers",
      direction: "increase",
      baseline: 10,
      target: 100,
    });
    expect(set).toMatchObject({ current: 40, baseline: 10, confidence: 5 });
  });
});

describe("validateCheckIn", () => {
  it("needs a value; the day defaults to today and confidence to not scored", () => {
    const d = emptyCheckIn(TODAY);
    expect(d).toEqual({ date: TODAY, value: "", confidence: null, note: "" });
    const r = validateCheckIn(d, TODAY);
    expect(!r.ok && r.errors.value).toMatch(/value/);
  });

  it("can be backdated but never in the future, and must be a real day", () => {
    expect(validateCheckIn({ ...emptyCheckIn("2026-09-01"), value: "3" }, TODAY).ok).toBe(true);
    const future = validateCheckIn({ ...emptyCheckIn("2026-10-28"), value: "3" }, TODAY);
    expect(!future.ok && future.errors.date).toMatch(/future/);
    const bad = validateCheckIn({ ...emptyCheckIn("2026-02-30"), value: "3" }, TODAY);
    expect(!bad.ok && bad.errors.date).toMatch(/calendar/);
  });

  it("keeps a zero value and a zero confidence (both real readings)", () => {
    const r = validateCheckIn({ date: TODAY, value: "0", confidence: 0, note: " " }, TODAY);
    expect(r).toEqual({ ok: true, values: { date: TODAY, value: 0, confidence: 0 } });
  });

  it("refuses a day older than a full history keeps, instead of dropping it on save", () => {
    const full = Array.from({ length: KR_CHECK_IN_CAP }, (_, i) =>
      ci(`c${i}`, `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`, i)
    );
    const old = validateCheckIn({ ...emptyCheckIn("2025-12-31"), value: "1" }, TODAY, {
      checkIns: full,
    });
    expect(!old.ok && old.errors.date).toMatch(/52 newest/);
    expect(
      validateCheckIn({ ...emptyCheckIn(TODAY), value: "1" }, TODAY, { checkIns: full }).ok
    ).toBe(true);
  });

  it("refuses a note over 500 characters", () => {
    const r = validateCheckIn(
      { date: TODAY, value: "1", confidence: null, note: "n".repeat(501) },
      TODAY
    );
    expect(!r.ok && r.errors.note).toMatch(/500/);
  });
});

/* ── The quarter filter and the verdict ─────────────────────────────── */

describe("quarters", () => {
  it("groups however the quarter was written", () => {
    expect(quarterKey("Q4 2026")).toBe("2026 Q4");
    expect(quarterKey("2026-Q4")).toBe("2026 Q4");
    expect(quarterKey("next spring")).toBe("next spring");
    expect(quarterKey("")).toBe(NO_QUARTER);
  });

  it("lists real quarters newest first, then free text", () => {
    const chips = quarterChips(
      [
        okr("a", { quarter: "2026 Q3" }),
        okr("b"),
        okr("c", { quarter: "Q4 2026" }),
        okr("d", { quarter: "someday" }),
      ],
      NOW
    );
    expect(chips).toEqual([
      { key: "2026 Q4", count: 2, current: true },
      { key: "2026 Q3", count: 1, current: false },
      { key: "someday", count: 1, current: false },
    ]);
  });

  it("opens on today's quarter when it has objectives, else on every quarter", () => {
    expect(defaultQuarter([okr("a"), okr("b", { quarter: "2026 Q3" })], NOW)).toBe("2026 Q4");
    expect(defaultQuarter([okr("b", { quarter: "2026 Q3" })], NOW)).toBe(ALL_QUARTERS);
    expect(defaultQuarter([], NOW)).toBe(ALL_QUARTERS);
  });
});

describe("okrsVerdict", () => {
  it("says what's on screen when nothing is measured yet", () => {
    expect(okrsVerdict([], ALL_QUARTERS, TODAY)).toBe("No objectives yet.");
    expect(okrsVerdict([okr("a")], "2026 Q4", TODAY)).toBe(
      "1 objective for 2026 Q4 is 0% of the way; add key results to measure them."
    );
  });

  it("counts key results by confidence band and the ones gone stale", () => {
    const okrs = [
      okr("a", {
        keyResults: [
          kr("k1", { current: 50, confidence: 2, checkIns: [ci("c", "2026-10-01", 50, 2)] }),
          kr("k2", { current: 100, confidence: 5, checkIns: [ci("d", "2026-10-25", 100, 5)] }),
        ],
      }),
      okr("b", { keyResults: [kr("k3", { current: 0 })] }),
    ];
    expect(okrsVerdict(okrs, ALL_QUARTERS, TODAY)).toBe(
      "2 objectives are 38% of the way on average; 1 off track and 1 at risk by confidence; 1 key result without a check-in for 14+ days."
    );
  });

  it("never reads an unscored key result as mid-confident", () => {
    expect(okrsVerdict([okr("a", { keyResults: [kr("k")] })], ALL_QUARTERS, TODAY)).toBe(
      "1 objective is 0% of the way; no key result's confidence is scored yet; none checked in yet."
    );
  });
});

describe("confidenceTrendText", () => {
  it("says how confidence moved over the check-in days, with the n behind each", () => {
    const t = confidenceTrendText(confidenceTrend(OKR));
    expect(t.summary).toBe("Confidence was 6/10 on 2 Oct 2026.");
    const many = confidenceTrendText([
      { date: "2026-10-01", confidence: 8, scored: 2 },
      { date: "2026-10-08", confidence: 6.5, scored: 2 },
      { date: "2026-10-15", confidence: 6, scored: 3 },
    ]);
    expect(many.summary).toBe(
      "Confidence fell from 8/10 to 6/10 over 3 check-in days, 1 Oct 2026 to 15 Oct 2026."
    );
    expect(many.table.columns).toEqual(["Day", "Confidence (0–10)", "Key results scored"]);
    expect(many.table.rows[1]).toEqual(["8 Oct 2026", 6.5, 2]);
    expect(confidenceTrendText([]).summary).toMatch(/No confidence/);
  });

  it("draws from three check-in days", () => {
    expect(CHART_MIN_DAYS).toBe(3);
    expect(dayLabel("2026-01-05")).toBe("5 Jan 2026");
  });
});

/* ── Markdown and the example ───────────────────────────────────────── */

describe("toMarkdown", () => {
  const SPRINT: Sprint = {
    id: "s14",
    name: "Sprint 14",
    startDate: "2026-10-12",
    endDate: "2026-10-25",
    pointsPlanned: 20,
    status: "completed",
  };
  const GOAL: SprintGoal = {
    ...blankGoal("s14"),
    goal: "Win back churned teams",
    okrIds: [OKR.id],
    outcome: { met: "met", decidedAt: "2026-10-25" },
  };

  it("shows each key result from its start, its confidence or Not scored, the verdict and the sprint goals", () => {
    const md = toMarkdown([OKR, LEGACY_OKR], NOW, { sprintGoals: [GOAL], sprints: [SPRINT] });
    const lines = md.split("\n");
    expect(lines[0]).toBe("# OKRs — 27 Oct 2026");
    expect(lines).toContain(`## Customers stay with us (2026 Q4) — ${objectivePercent(OKR)}%`);
    expect(lines).toContain("Owner: Sam. Churn has crept up since the price change.");
    expect(lines).toContain(okrVerdict(OKR, NOW));
    expect(lines).toContain(
      "| Key result | Start → target | Now | Progress | Confidence | Last check-in |"
    );
    expect(lines).toContain(
      `| Monthly churn | ↓ 22% → 15% | 18% (from 22%, target 15%) | ${krPercent(OKR.keyResults[0])}% | 6/10 (At risk) | 3 Oct 2026 |`
    );
    expect(lines).toContain(
      `| Onboarding NPS | ↑ 20 → 40 | 31 (from 20, target 40) | 55% | Not scored | None yet |`
    );
    expect(lines).toContain("Moved by: Sprint 14 (Met).");
    // Legacy quarter text reads canonically; a key result with no baseline says so.
    expect(lines).toContain("## Ship the mobile app (2026 Q4) — 40%");
    expect(md).toContain(
      "| Beta testers | ↑ to 100 (no baseline) | 40 of 100 | 40% | 5/10 (At risk) | None yet |"
    );
  });

  it("escapes pipes and says there's nothing yet when empty", () => {
    const md = toMarkdown(
      [okr("o", { keyResults: [kr("k", { title: "API | web\nparity" })] })],
      NOW
    );
    expect(md).toContain("| API \\| web parity |");
    expect(toMarkdown([], NOW)).toBe("# OKRs — 27 Oct 2026\n\nNo objectives yet.\n");
  });
});

describe("the example", () => {
  it("is deterministic, example ids all the way down, with dated check-ins it mirrors", () => {
    const a = buildExample(NOW);
    expect(buildExample(NOW)).toEqual(a);
    for (const o of a) {
      expect(isExampleId(o.id)).toBe(true);
      expect(o.quarter).toBe("2026 Q4");
      expect(o.owner).toBeTruthy();
      for (const k of o.keyResults) {
        expect(isExampleId(k.id)).toBe(true);
        expect(k.baseline).toBeTypeOf("number");
        const ins = k.checkIns ?? [];
        expect(ins.length).toBeGreaterThan(0);
        expect(ins.every((c) => isExampleId(c.id) && c.date <= TODAY)).toBe(true);
        expect([...ins].map((c) => c.date)).toEqual([...ins].map((c) => c.date).sort());
        expect(k.current).toBe(ins[ins.length - 1].value);
        // withCheckIn would leave it exactly so.
        const replayed = ins.reduce((acc, c) => withCheckIn(acc, c), {
          ...k,
          checkIns: [],
          current: k.baseline ?? 0,
          confidence: undefined,
        } as KeyResult);
        expect(replayed.current).toBe(k.current);
        expect(replayed.confidence).toBe(k.confidence);
      }
    }
    // One decreasing key result, and a stale one (16 days without a check-in).
    expect(a.flatMap((o) => o.keyResults).some((k) => k.direction === "decrease")).toBe(true);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

const renderPage = () => render(<OkrsClient />);
const submit = (el: HTMLElement) => fireEvent.submit(el.closest("form") as HTMLFormElement);

describe("New objective", () => {
  it("saves nothing until it has words and a quarter, then saves with the owner", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "New objective" }));
    const objective = screen.getByLabelText(/^Objective/);
    submit(objective);
    expect(stored()).toHaveLength(0);
    expect(screen.getByText("Say what the team wants to achieve.")).toBeInTheDocument();
    expect(screen.getByText("Pick the quarter it's for.")).toBeInTheDocument();
    expect(objective).toHaveFocus();

    fireEvent.change(objective, { target: { value: "Grow repeat orders" } });
    fireEvent.change(screen.getByLabelText(/^Quarter/), { target: { value: "2027 Q1" } });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Priya" } });
    submit(objective);

    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      objective: "Grow repeat orders",
      quarter: "2027 Q1",
      owner: "Priya",
      keyResults: [],
    });
    expect(stored()[0].id).toMatch(/^okr_/);
    expect(actions()).toEqual(["objective_added"]);
    // It stays in view, under its own quarter.
    expect(screen.getByRole("heading", { name: "Grow repeat orders" })).toBeInTheDocument();
  });
});

describe("key results", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({ okrs: [okr("o1", { objective: "Cut support load" })] })
  );

  it("adds one only with a direction and a target on the right side of its baseline", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add key result to Cut support load" }));
    const title = screen.getByLabelText(/^Key result\*?$/);
    fireEvent.change(title, { target: { value: "Tickets a week" } });
    fireEvent.change(screen.getByLabelText(/^Baseline/), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText(/^Target/), { target: { value: "50" } });
    submit(title);
    expect(stored()[0].keyResults).toHaveLength(0);
    expect(screen.getByText("Pick whether the number should go up or down.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Go up" }));
    expect(
      screen.getByText("To go up, the target must be above the baseline (80).")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Go down" }));
    submit(title);

    const saved = stored()[0].keyResults[0];
    expect(saved).toMatchObject({
      title: "Tickets a week",
      direction: "decrease",
      baseline: 80,
      target: 50,
      current: 80,
      checkIns: [],
    });
    expect(saved.confidence).toBeUndefined();
    // The key result and its objective: neither is scored.
    expect(screen.getAllByText("Confidence not scored")).toHaveLength(2);
    expect(screen.getByText("80 (from 80, target 50)")).toBeInTheDocument();
    expect(actions()).toEqual(["key_result_added"]);
  });

  it("edits a key result in place, logging what changed", () => {
    useWorkspaceStore.setState({
      okrs: [
        okr("o1", {
          keyResults: [
            kr("k1", {
              title: "Sign-ups",
              baseline: 0,
              direction: "increase",
              target: 100,
              current: 0,
              checkIns: [],
            }),
          ],
        }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit key result: Sign-ups" }));
    fireEvent.change(screen.getByLabelText(/^Target/), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key result" }));
    expect(storedKr("o1", "k1")?.target).toBe(120);
    expect(actions()).toEqual(["key_result_updated", "progress_updated"]);
    expect(logs[0].payload).toMatchObject({ fields: ["target"] });
    expect(screen.getByRole("button", { name: "Edit key result: Sign-ups" })).toHaveFocus();
  });

  it("says a legacy key result has no baseline, and lets its edit keep none", () => {
    useWorkspaceStore.setState({ okrs: [LEGACY_OKR] });
    renderPage();
    expect(screen.getByText(/No baseline: progress counts from 0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit key result: Beta testers" }));
    fireEvent.click(screen.getByRole("button", { name: "Save key result" }));
    expect(storedKr(LEGACY_OKR.id, "kr_a")).toMatchObject({
      current: 40,
      target: 100,
      direction: "increase",
      confidence: 5,
    });
    expect(storedKr(LEGACY_OKR.id, "kr_a")?.baseline).toBeUndefined();
  });
});

describe("check-ins", () => {
  const setup = (k: KeyResult) => {
    useWorkspaceStore.setState({
      okrs: [okr("o1", { objective: "Customers stay", keyResults: [k] })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Check in on / }));
  };

  it("records a dated value with an optional confidence that starts unscored", () => {
    setup(
      kr("k1", {
        title: "Churn",
        baseline: 22,
        direction: "decrease",
        target: 15,
        current: 22,
        unit: "%",
        checkIns: [],
      })
    );
    const value = screen.getByLabelText("Value for Churn");
    expect(screen.getByRole("radiogroup", { name: "Confidence" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { checked: true })).toBeNull();
    submit(value);
    expect(storedKr("o1", "k1")?.checkIns).toEqual([]);
    expect(screen.getByText("Enter the value on that day.")).toBeInTheDocument();

    fireEvent.change(value, { target: { value: "19" } });
    fireEvent.click(screen.getByRole("radio", { name: "6" }));
    submit(value);

    const saved = storedKr("o1", "k1")!;
    expect(saved.current).toBe(19);
    expect(saved.confidence).toBe(6);
    expect(saved.checkIns).toEqual([
      { id: expect.stringMatching(/^ci_/), date: TODAY, value: 19, confidence: 6 },
    ]);
    expect(actions()).toEqual(["check_in_recorded", "progress_updated"]);
    expect(sounds).toEqual(["okrs:kr-updated"]);
    // The key result and its objective (the mean of one scored key result).
    expect(screen.getAllByText("Confidence 6/10 · At risk")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /^Check in on / })).toHaveFocus();
  });

  it("refuses a future day inline", () => {
    setup(kr("k1", { title: "Churn", baseline: 22, target: 15, current: 22, checkIns: [] }));
    fireEvent.change(screen.getByLabelText(/^Day/), { target: { value: "2026-10-28" } });
    fireEvent.change(screen.getByLabelText("Value for Churn"), { target: { value: "19" } });
    submit(screen.getByLabelText("Value for Churn"));
    expect(storedKr("o1", "k1")?.checkIns).toEqual([]);
    expect(screen.getByText("A check-in can't be in the future.")).toBeInTheDocument();
  });

  it("a backdated first check-in says what typed value it replaced, and Undo brings that back", () => {
    setup(LEGACY_OKR.keyResults[0]);
    fireEvent.change(screen.getByLabelText(/^Day/), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Value for Beta testers"), { target: { value: "30" } });
    submit(screen.getByLabelText("Value for Beta testers"));
    expect(storedKr("o1", "kr_a")?.current).toBe(30);
    expect(lastToast()[0]).toBe("Checked in “Beta testers”");
    expect((lastToast()[1] as { description?: string }).description).toMatch(
      /replaced the current value 40/
    );

    undoLast();
    expect(storedKr("o1", "kr_a")).toEqual(LEGACY_OKR.keyResults[0]);
  });

  it("an objective reaching its target plays okr-achieved once", () => {
    setup(
      kr("k1", {
        title: "Ship",
        baseline: 0,
        direction: "increase",
        target: 1,
        current: 0,
        checkIns: [],
      })
    );
    fireEvent.change(screen.getByLabelText("Value for Ship"), { target: { value: "1" } });
    submit(screen.getByLabelText("Value for Ship"));
    expect(sounds).toEqual(["okrs:kr-updated", "okrs:okr-achieved"]);
  });

  it("deletes a check-in with Undo, re-mirroring current from the rest", () => {
    const k = [ci("a", "2026-10-01", 20, 8), ci("b", "2026-10-15", 18, 5)].reduce(
      (acc, c) => withCheckIn(acc, c),
      kr("k1", {
        title: "Churn",
        baseline: 22,
        direction: "decrease",
        target: 15,
        current: 22,
        checkIns: [],
      })
    );
    useWorkspaceStore.setState({ okrs: [okr("o1", { keyResults: [k] })] });
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete the check-in of 15 Oct 2026 on Churn" })
    );
    expect(storedKr("o1", "k1")).toMatchObject({ current: 20, confidence: 8 });
    expect(storedKr("o1", "k1")?.checkIns?.map((c) => c.id)).toEqual(["a"]);
    expect(actions()).toEqual(["check_in_removed"]);
    undoLast();
    expect(storedKr("o1", "k1")).toEqual(k);
  });

  it("flags a key result not checked in for 14 days", () => {
    useWorkspaceStore.setState({
      okrs: [
        okr("o1", {
          keyResults: [
            kr("k1", { title: "Churn", checkIns: [ci("a", "2026-10-11", 4)], current: 4 }),
          ],
        }),
      ],
    });
    renderPage();
    expect(screen.getByText("No check-in for 16 days")).toBeInTheDocument();
  });
});

describe("the objective card", () => {
  it("shows a confidence trend from three check-in days, and asks for more before", () => {
    const base = kr("k1", {
      title: "Churn",
      baseline: 22,
      direction: "decrease",
      target: 15,
      current: 22,
      checkIns: [],
    });
    const two = [ci("a", "2026-10-01", 21, 8), ci("b", "2026-10-08", 20, 7)].reduce(
      (acc, c) => withCheckIn(acc, c),
      base
    );
    useWorkspaceStore.setState({ okrs: [okr("o1", { keyResults: [two] })] });
    const { unmount } = renderPage();
    expect(
      screen.getByText("Check in on 1 more day with a scored check-in to see how confidence moves.")
    ).toBeInTheDocument();
    unmount();
    const three = withCheckIn(two, ci("c", "2026-10-15", 19, 6));
    useWorkspaceStore.setState({ okrs: [okr("o1", { keyResults: [three] })] });
    renderPage();
    expect(
      screen.getByText(
        "Confidence fell from 8/10 to 6/10 over 3 check-in days, 1 Oct 2026 to 15 Oct 2026."
      )
    ).toBeInTheDocument();
    // Mann-Kendall waits for six days, inside the closed advanced section.
    expect(screen.queryByText(/Advanced analysis/)).toBeNull();
  });

  it("lists the sprint goals that link it, each opening Sprint Goal", () => {
    const sprint: Sprint = {
      id: "s14",
      name: "Sprint 14",
      startDate: "2026-10-12",
      endDate: "2026-10-25",
      pointsPlanned: 20,
      status: "completed",
    };
    useWorkspaceStore.setState({
      okrs: [okr("o1", { objective: "Customers stay" }), okr("o2", { objective: "Unlinked" })],
      sprints: [sprint],
      sprintGoals: [
        {
          ...blankGoal("s14"),
          goal: "Win back churned teams",
          okrIds: ["o1"],
          outcome: { met: "partly", decidedAt: "2026-10-25" },
        },
        { ...blankGoal(null), goal: "", okrIds: ["o1"] },
      ],
    });
    renderPage();
    const linked = within(
      screen.getByRole("region", { name: "Sprint goals that move Customers stay" })
    );
    expect(linked.getByRole("link", { name: /Sprint 14/ })).toHaveAttribute(
      "href",
      "/sprint-goal?sprint=s14"
    );
    expect(linked.getByText("Partly met")).toBeInTheDocument();
    expect(linked.getByRole("link", { name: /Draft goal/ })).toHaveAttribute(
      "href",
      "/sprint-goal"
    );
    const none = within(screen.getByRole("region", { name: "Sprint goals that move Unlinked" }));
    expect(none.getByText(/No sprint goal moves this objective yet/)).toBeInTheDocument();
  });

  it("edits an objective in place, owner included", () => {
    useWorkspaceStore.setState({ okrs: [okr("o1", { objective: "Customers stay" })] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit objective: Customers stay" }));
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
    expect(stored()[0].owner).toBe("Sam");
    expect(actions()).toEqual(["objective_updated"]);
    expect(logs[0].payload).toMatchObject({ fields: ["owner"] });
    expect(screen.getByText("Sam")).toBeInTheDocument();
  });

  it("restores a deleted objective at its old place", () => {
    useWorkspaceStore.setState({
      okrs: [
        okr("a", { objective: "First" }),
        okr("b", { objective: "Second" }),
        okr("c", { objective: "Third" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete objective: Second" }));
    expect(stored().map((o) => o.id)).toEqual(["a", "c"]);
    undoLast();
    expect(stored().map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the quarter filter", () => {
  it("opens on today's quarter, with chips for the others and All", () => {
    useWorkspaceStore.setState({
      okrs: [
        okr("a", { objective: "This quarter" }),
        okr("b", { objective: "Last quarter", quarter: "2026 Q3" }),
      ],
    });
    renderPage();
    expect(screen.getByRole("heading", { name: "This quarter" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Last quarter" })).toBeNull();
    expect(screen.getByRole("button", { name: /2026 Q4/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getByRole("heading", { name: "Last quarter" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2026 Q3/ }));
    expect(screen.queryByRole("heading", { name: "This quarter" })).toBeNull();
    expect(exported.markdown).toContain("## Last quarter (2026 Q3)");
    expect(exported.markdown).not.toContain("This quarter");
  });

  it("shows every quarter when today's has none", () => {
    useWorkspaceStore.setState({
      okrs: [okr("b", { objective: "Last quarter", quarter: "2026 Q3" })],
    });
    renderPage();
    expect(screen.getByRole("heading", { name: "Last quarter" })).toBeInTheDocument();
  });
});

describe("the example on the page", () => {
  it("loads without logging, and Clear example removes only its rows", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored().length).toBe(2);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Make checkout effortless on mobile" })
    ).toBeInTheDocument();
    // An edit to an example row isn't the team's history.
    fireEvent.click(screen.getAllByRole("button", { name: /^Check in on / })[0]);
    const value = screen.getAllByLabelText(/^Value for/)[0];
    fireEvent.change(value, { target: { value: "100" } });
    submit(value);
    expect(logs).toEqual([]);
    expect(sounds).toEqual([]);

    useWorkspaceStore.getState().upsertOkr(okr("mine", { objective: "Grow repeat orders" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((o) => o.objective)).toEqual(["Grow repeat orders"]);
  });

  it("offers the example only while the tracker is empty", () => {
    useWorkspaceStore.setState({ okrs: [okr("o")] });
    renderPage();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });
});

/* ── The page and the agent read the same numbers ───────────────────── */

describe("page and agent parity", () => {
  it("list_state's progress, confidence and verdict are the page's", async () => {
    await import("@/lib/actions/tools/okrs");
    const { registry } = await import("@/lib/actions/registry");
    useWorkspaceStore.setState({ okrs: [OKR, LEGACY_OKR, ...buildExample(NOW)] });
    renderPage();
    const action = registry.get("tool.okrs.list_state")!;
    const state = (await action.handler!(action.paramsSchema.parse({}), {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    })) as { total: number; items: { id: string; progressPct: number; verdict: string }[] };
    // Example rows are the page's preview, not the team's data.
    expect(state.total).toBe(2);
    for (const item of state.items) {
      const o = [OKR, LEGACY_OKR].find((x) => x.id === item.id)!;
      expect(item.progressPct).toBe(objectivePercent(o));
      expect(screen.getByText(item.verdict)).toBeInTheDocument();
    }
  });

  it("remove_check_in re-mirrors as the page's delete does", async () => {
    await import("@/lib/actions/tools/okrs");
    const { registry } = await import("@/lib/actions/registry");
    useWorkspaceStore.setState({ okrs: [OKR] });
    const action = registry.get("tool.okrs.remove_check_in")!;
    const r = await action.handler!(
      action.paramsSchema.parse({
        okrId: OKR.id,
        keyResultId: "kr_churn",
        checkInId: OKR.keyResults[0].checkIns![2].id,
      }),
      { userId: "u", source: "agent", squadProfileIds: [] }
    );
    const expected = withoutCheckIn(OKR.keyResults[0], OKR.keyResults[0].checkIns![2].id);
    expect(storedKr(OKR.id, "kr_churn")).toEqual(expected);
    expect(r).toMatchObject({ removed: true, current: expected.current, checkInCount: 2 });
  });
});

/* ── Sprint Goal reads the same OKR text ────────────────────────────── */

describe("Sprint Goal's linked OKRs", () => {
  it("read a decreasing key result from its baseline, and a legacy quarter canonically", () => {
    render(
      <TooltipProvider>
        <OkrStep
          okrs={[OKR, LEGACY_OKR]}
          okrIds={[OKR.id, LEGACY_OKR.id]}
          notes={[]}
          onToggle={() => undefined}
          onUnlink={() => undefined}
          onEditNote={() => undefined}
          onRemoveNote={() => undefined}
        />
      </TooltipProvider>
    );
    // "18% of 15%" read as more than done before Phase 8.
    expect(screen.getByText(": 18% (from 22%, target 15%)", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(`2026 Q4 · ${objectivePercent(OKR)}% of the way`)).toBeInTheDocument();
    // Stored as "Q4 2026" by the old intent.
    expect(screen.getByText("2026 Q4 · 40% of the way")).toBeInTheDocument();
  });
});
