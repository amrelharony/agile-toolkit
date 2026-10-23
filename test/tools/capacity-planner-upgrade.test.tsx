import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityMember, CapacityPlan, Sprint } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";

/**
 * Capacity Planner's upgrade to the tool UX contract: one plan per sprint
 * (started from the last plan or empty, never silently), the sprint length
 * from the sprint's dates and the team's holidays, member numbers that
 * don't save 0 when cleared, the shared totals, where the hours go, and the
 * points forecast that leads to Sprint Planning.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    dismiss: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
const cadence = vi.hoisted(() => ({ patch: {} as Record<string, unknown> }));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [{ ...DEFAULT_CADENCE, ...cadence.patch }, () => {}] };
});

import { CapacityPlannerClient } from "@/app/(tools)/capacity-planner/capacity-planner-client";
import {
  capacityForecast,
  capacityVerdict,
  countedPlan,
  validateMember,
  validateNumber,
  emptyPlan,
  forecastSentence,
  hoursBreakdown,
  interruptionLabel,
  isExampleOnly,
  isUntouchedConfig,
  lastPlanFor,
  planAsIs,
  planFromSource,
  sprintLength,
  sprintLengthText,
  usualSprintDays,
} from "@/app/(tools)/capacity-planner/model";
import { nameChange } from "@/app/(tools)/capacity-planner/member-row";
import { buildExampleMembers } from "@/app/(tools)/capacity-planner/example";
import { toMarkdown } from "@/app/(tools)/capacity-planner/markdown";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";

const GENERAL = "capacity-planner:current";
const S2_PLAN = "capacity-planner:sprint:s2";

const config = (patch: Partial<CapacityPlan["config"]> = {}): CapacityPlan["config"] => ({
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
  ...patch,
});
const member = (
  id: string,
  name: string,
  availability = 100,
  daysOff = 0,
  extra: Partial<CapacityMember> = {}
): CapacityMember => ({ id, name, role: "Developer", availability, daysOff, ...extra });
const sprint = (
  id: string,
  startDate: string,
  endDate: string,
  patch: Partial<Sprint> = {}
): Sprint => ({
  id,
  name: `Sprint ${id.slice(1)}`,
  startDate,
  endDate,
  pointsPlanned: 0,
  status: "planned",
  ...patch,
});

// Monday 5 Oct to Monday 19 Oct 2026: ten working days.
const S1 = sprint("s1", "2026-09-21", "2026-10-05", { status: "completed", pointsCompleted: 30 });
const S2 = sprint("s2", "2026-10-05", "2026-10-19");

const plans = () => useWorkspaceStore.getState().capacityPlans ?? [];
const planById = (id: string) => plans().find((p) => p.id === id);
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());

beforeEach(() => {
  toastSpy.mockClear();
  cadence.patch = {};
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [S1, S2],
    teamMembers: [],
    capacityPlans: [
      {
        id: GENERAL,
        members: [member("m1", "Ann", 80, 1), member("m2", "Bob", 100, 2)],
        config: config(),
      },
    ],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], capacityPlans: [], teamMembers: [] });
});

/* ── Pure model ──────────────────────────────────────────────────────── */

describe("sprint length", () => {
  it("counts the sprint's working days, less team holidays on working weekdays", () => {
    expect(sprintLength(S2, DEFAULT_CADENCE)).toEqual({
      workingDays: 10,
      weekdays: 10,
      holidays: [],
      source: "dates",
      calendarDays: 14,
    });
    // A Monday holiday counts; a Saturday one and one on the review day don't.
    const holidays = ["2026-10-10", "2026-10-12", "2026-10-19", "2027-01-01"];
    const withHolidays = sprintLength(S2, { ...DEFAULT_CADENCE, holidays });
    expect(withHolidays).toMatchObject({ workingDays: 9, weekdays: 10, holidays: ["2026-10-12"] });
    expect(sprintLengthText(withHolidays, "Sprint 2")).toBe(
      "Sprint 2's dates give 10 working days, less 1 team holiday (Mon 12 Oct): 9."
    );
    expect(sprintLengthText(sprintLength(S2, DEFAULT_CADENCE), "Sprint 2")).toBe(
      "Sprint 2's dates give 10 working days."
    );
  });

  it("follows the team's working week, and the cadence when there are no real dates", () => {
    const fourDays = { ...DEFAULT_CADENCE, workingDays: [1, 2, 3, 4] };
    expect(sprintLength(S2, fourDays).workingDays).toBe(8);
    const placeholder = sprint("old", "2020-01-01", "2020-01-02");
    expect(sprintLength(placeholder, DEFAULT_CADENCE)).toMatchObject({
      workingDays: 10,
      source: "cadence",
      calendarDays: 14,
    });
    expect(sprintLength(undefined, { ...DEFAULT_CADENCE, sprintLengthDays: 21 }).workingDays).toBe(
      15
    );
    expect(sprintLength(undefined, fourDays).workingDays).toBe(8);
    expect(sprintLengthText(sprintLength(undefined, DEFAULT_CADENCE))).toBe(
      "Your cadence's 14-day sprint is about 10 working days."
    );
    // A weekend-only sprint still has a length to plan with.
    expect(sprintLength(sprint("w", "2026-10-10", "2026-10-12"), DEFAULT_CADENCE).workingDays).toBe(
      1
    );
    // An end before the start falls back to the cadence.
    expect(sprintLength(sprint("x", "2026-10-19", "2026-10-05"), DEFAULT_CADENCE).source).toBe(
      "cadence"
    );
  });
});

describe("starting a sprint's plan", () => {
  const S3 = sprint("s3", "2026-10-19", "2026-11-02");
  const team = (id: string, sprintId?: string, members = [member("a", "Ann")]): CapacityPlan => ({
    id,
    ...(sprintId ? { sprintId } : {}),
    members,
    config: config(),
  });

  it("copies the newest earlier sprint's plan, else any other, else the general plan", () => {
    const own1 = team("capacity-planner:sprint:s1", "s1");
    const own3 = team("capacity-planner:sprint:s3", "s3");
    const general = team(GENERAL);
    expect(lastPlanFor([general, own1, own3], [S1, S2, S3], S2)).toEqual({
      plan: own1,
      label: "Sprint 1's plan",
    });
    expect(lastPlanFor([general, own3], [S1, S2, S3], S2)?.label).toBe("Sprint 3's plan");
    expect(lastPlanFor([general], [S1, S2, S3], S2)?.label).toBe("your general plan");
    // Example-only and blank plans don't count.
    const exampleOnly = team("capacity-planner:sprint:s1", "s1", buildExampleMembers());
    const blank = team(GENERAL, undefined, [member("b", "", 100, 0, { role: "" })]);
    expect(lastPlanFor([exampleOnly, blank], [S1, S2], S2)).toBeNull();
    expect(lastPlanFor([], [], S2)).toBeNull();
  });

  it("keeps people and settings, starts days off at 0 and leaves example and blank rows", () => {
    const source: CapacityPlan = {
      id: GENERAL,
      members: [
        member("a", "Ann", 50, 3),
        buildExampleMembers()[0],
        member("b", "", 100, 0, { role: "" }),
      ],
      config: config({ focusFactor: 0.7, sprintDays: 10, pointsCommitted: "30" }),
    };
    const copy = planFromSource(source, "s2", 9);
    expect(copy).toEqual({
      id: S2_PLAN,
      sprintId: "s2",
      members: [member("a", "Ann", 50, 0)],
      config: config({ focusFactor: 0.7, sprintDays: 9, pointsCommitted: "" }),
    });
    expect(planFromSource({ ...source, members: buildExampleMembers() }, "s2", 9).members).toEqual(
      []
    );
    // No blank starter row: an unnamed row at 100% counted hours nobody had.
    expect(emptyPlan(undefined, 10)).toEqual({ id: GENERAL, members: [], config: config() });
    expect(emptyPlan("s2", 9)).toEqual({
      id: S2_PLAN,
      sprintId: "s2",
      members: [],
      config: config({ sprintDays: 9 }),
    });
  });
});

describe("where the hours go", () => {
  it("adds up from full time to the shared total", () => {
    const b = hoursBreakdown({ members: buildExampleMembers(), config: config() });
    expect(b).toEqual({
      people: 5,
      sprintDays: 10,
      hoursPerDay: 8,
      fullTime: 400,
      daysOff: 8,
      daysOffHours: 64,
      availabilityHours: 54.4,
      ceremonyHours: 42.2,
      interruptionHours: 47.9,
      capacity: 191.5,
    });
    expect(
      b.daysOffHours + b.availabilityHours + b.ceremonyHours + b.interruptionHours + b.capacity
    ).toBeCloseTo(b.fullTime, 6);
    expect(capacityVerdict(b)).toBe(
      "191.5 of 400 full-time hours are left for sprint work (48%); days off take the most, 64 hours."
    );
  });

  it("handles no team, more days off than the sprint, focus 1 and huge teams", () => {
    const none = hoursBreakdown({ members: [], config: config() });
    expect(none).toMatchObject({ fullTime: 0, capacity: 0, interruptionHours: 0 });
    expect(capacityVerdict(none)).toBe("Add the team to see the sprint's capacity.");

    const away = hoursBreakdown({ members: [member("a", "A", 100, 15)], config: config() });
    expect(away).toMatchObject({
      daysOff: 10,
      daysOffHours: 80,
      capacity: 0,
      interruptionHours: 0,
    });

    const focused = hoursBreakdown({
      members: [member("a", "A")],
      config: config({ focusFactor: 1, ceremonyOverhead: 0 }),
    });
    expect(focused).toMatchObject({ interruptionHours: 0, ceremonyHours: 0, capacity: 80 });
    expect(capacityVerdict(focused)).toBe(
      "80 of 80 full-time hours are left for sprint work (100%)."
    );

    const big = hoursBreakdown({
      members: Array.from({ length: 1000 }, (_, i) => member(`m${i}`, `P${i}`, 90, 1)),
      config: config(),
    });
    expect(big.fullTime).toBe(80000);
    expect(
      big.daysOffHours +
        big.availabilityHours +
        big.ceremonyHours +
        big.interruptionHours +
        big.capacity
    ).toBeCloseTo(big.fullTime, 4);
  });
});

describe("points forecast and typed numbers", () => {
  it("says what the capacity means in points, or what's missing", () => {
    const p = {
      members: [member("a", "A", 100, 2), member("b", "B")],
      config: config({ ceremonyOverhead: 10 }),
    };
    expect(forecastSentence(p, 30)).toBe(
      "Capacity is 90% of a normal sprint (10 working days, everyone in, no days off), so plan about 27 points (velocity 30 × 90%)."
    );
    expect(forecastSentence(p, null)).toMatch(/^Capacity is 90% .*Finish a sprint with points/);
    expect(forecastSentence({ members: [], config: config() }, 30)).toBe(
      "Add the team to see how many points this sprint can take."
    );
    expect(forecastSentence({ members: [member("a", "A", 0)], config: config() }, 30)).toBe(
      "Nobody is available this sprint, so there is no room to plan."
    );
    // A team whose settings leave no hours isn't "no team".
    expect(
      forecastSentence({ members: [member("a", "A")], config: config({ focusFactor: 0 }) }, 30)
    ).toBe(
      "These settings leave no working hours: check the focus factor and the ceremony overhead."
    );
  });

  it("rejects blank, non-numbers and out-of-range values instead of saving 0", () => {
    const rule = { name: "availability", min: 0, max: 100, unit: "%" };
    expect(validateNumber("", rule)).toEqual({
      ok: false,
      error: "Enter the availability, 0–100%.",
    });
    expect(validateNumber("  ", rule)).toMatchObject({ ok: false });
    expect(validateNumber("abc", rule)).toEqual({
      ok: false,
      error: "The availability is a number.",
    });
    expect(validateNumber("150", rule)).toEqual({
      ok: false,
      error: "The availability runs from 0 to 100%.",
    });
    expect(validateNumber("0", rule)).toEqual({ ok: true, value: 0 });
    expect(validateNumber("62.5", rule)).toEqual({ ok: true, value: 62.5 });
  });

  it("links a typed name to the roster, and unlinks it when it no longer matches", () => {
    const roster = [{ id: "t1", name: "Ann" }];
    expect(nameChange({}, "ann", roster)).toEqual({ name: "ann", teamMemberId: "t1" });
    expect(nameChange({ teamMemberId: "t1" }, "Annie", roster)).toEqual({
      name: "Annie",
      teamMemberId: undefined,
    });
    expect(nameChange({}, "Zed", roster)).toEqual({ name: "Zed" });
    // A link to someone who left the roster goes too.
    expect(nameChange({ teamMemberId: "gone" }, "Zed", roster)).toEqual({
      name: "Zed",
      teamMemberId: undefined,
    });
  });
});

describe("a normal sprint is the team's usual one", () => {
  // Two people, everyone in: only the sprint's length differs from normal.
  const two = (sprintDays: number) => ({
    members: [member("a", "A"), member("b", "B")],
    config: config({ sprintDays }),
  });

  it("is the cadence's sprint length on its working week, holidays left out", () => {
    expect(usualSprintDays(DEFAULT_CADENCE)).toBe(10);
    expect(usualSprintDays({ ...DEFAULT_CADENCE, sprintLengthDays: 7 })).toBe(5);
    expect(usualSprintDays({ ...DEFAULT_CADENCE, workingDays: [1, 2, 3, 4] })).toBe(8);
    expect(usualSprintDays({ ...DEFAULT_CADENCE, holidays: ["2026-10-12"] })).toBe(10);
  });

  it("lowers the forecast for a holiday or a short sprint", () => {
    // Sprint 2 with a team holiday: 9 of the usual 10 days.
    expect(capacityForecast(two(9), 30, 10)).toEqual({ ratio: 0.9, points: 27 });
    // Measured with its own length, the holiday vanished from the ratio.
    expect(capacityForecast(two(9), 30)).toEqual({ ratio: 1, points: 30 });
    // A one-week sprint for a two-week team; a long one scales up.
    expect(capacityForecast(two(5), 30, 10)).toEqual({ ratio: 0.5, points: 15 });
    expect(capacityForecast(two(15), 30, 10)).toEqual({ ratio: 1.5, points: 45 });
    // No usable usual length falls back to the plan's own.
    expect(capacityForecast(two(9), 30, 0)).toEqual({ ratio: 1, points: 30 });
    expect(capacityForecast(two(9), 30, Number.NaN)).toEqual({ ratio: 1, points: 30 });
    expect(capacityForecast(undefined, 30, 10)).toEqual({ ratio: null, points: null });
    expect(capacityForecast({ members: [], config: config() }, 30, 10)).toEqual({
      ratio: null,
      points: null,
    });
    expect(capacityForecast(two(9), null, 10)).toEqual({ ratio: 0.9, points: null });
    expect(forecastSentence(two(9), 30, 10)).toBe(
      "Capacity is 90% of a normal sprint (10 working days, everyone in, no days off), so plan about 27 points (velocity 30 × 90%)."
    );
  });

  it("counts a blank row as nobody, and a plan of examples as no real team", () => {
    const blank = member("default:member-1", "", 100, 0, { role: "" });
    const withBlank = { members: [blank, member("a", "Ann")], config: config() };
    expect(countedPlan(withBlank).members.map((m) => m.id)).toEqual(["a"]);
    const noBlank = { members: [member("a", "Ann")], config: config() };
    expect(countedPlan(noBlank)).toBe(noBlank);
    expect(forecastSentence({ members: [blank], config: config() }, 30, 10)).toBe(
      "Add the team to see how many points this sprint can take."
    );
    expect(isExampleOnly({ members: buildExampleMembers() })).toBe(true);
    expect(isExampleOnly({ members: [...buildExampleMembers(), blank] })).toBe(true);
    expect(isExampleOnly({ members: [...buildExampleMembers(), member("a", "Ann")] })).toBe(false);
    expect(isExampleOnly({ members: [] })).toBe(false);
  });

  it("keeps the general plan as is, days off, length and commitment included", () => {
    const general: CapacityPlan = {
      id: GENERAL,
      members: [
        member("a", "Ann", 50, 3),
        buildExampleMembers()[0],
        member("b", "", 100, 0, { role: "" }),
      ],
      config: config({ sprintDays: 8, pointsCommitted: "24" }),
    };
    expect(planAsIs(general, "s2")).toEqual({
      id: S2_PLAN,
      sprintId: "s2",
      members: [member("a", "Ann", 50, 3)],
      config: config({ sprintDays: 8, pointsCommitted: "24" }),
    });
  });

  it("knows settings nobody has changed yet", () => {
    expect(isUntouchedConfig(config({ sprintDays: 9 }), 9)).toBe(true);
    expect(isUntouchedConfig(config({ sprintDays: 9 }), 10)).toBe(false);
    expect(isUntouchedConfig(config({ focusFactor: 0.7 }), 10)).toBe(false);
    expect(isUntouchedConfig(config({ pointsCommitted: "20" }), 10)).toBe(false);
  });

  it("names the interruptions by what they take", () => {
    expect(interruptionLabel(0.8)).toBe(
      "Other interruptions (20% of what's left; focus factor 0.8)"
    );
    expect(interruptionLabel(0.85)).toBe(
      "Other interruptions (15% of what's left; focus factor 0.85)"
    );
    expect(interruptionLabel(1)).toBe("Other interruptions (0% of what's left; focus factor 1)");
  });
});

describe("adding a member", () => {
  it("needs a name and numbers in range, and keeps what was typed", () => {
    const draft = { name: "  Lee   Ann ", role: " QA ", availability: "60", daysOff: "2.5" };
    expect(validateMember(draft, 10)).toEqual({
      ok: true,
      values: { name: "Lee Ann", role: "QA", availability: 60, daysOff: 2.5 },
    });
    expect(validateMember({ ...draft, name: " " }, 10)).toEqual({
      ok: false,
      errors: { name: "Enter the person's name." },
    });
    expect(validateMember({ ...draft, availability: "", daysOff: "11" }, 10)).toEqual({
      ok: false,
      errors: {
        availability: "Enter the availability, 0–100%.",
        daysOff: "The number of days off runs from 0 to 10 days.",
      },
    });
  });
});

describe("Markdown", () => {
  it("names the sprint and adds where the hours go and the forecast", () => {
    const md = toMarkdown(
      { members: buildExampleMembers(), config: config(), sprintName: "Sprint 2", velocity: 30 },
      new Date(2026, 9, 18)
    );
    expect(md).toMatch(/^# Sprint Capacity — 18 Oct 2026\n\n\*\*For:\*\* Sprint 2\n/);
    expect(md).toContain("**Total capacity:** 191.5 hours across 5 members");
    expect(md).toContain("days off take the most, 64 hours.");
    expect(md).toContain("**Points forecast:** Capacity is 70% of a normal sprint");
    expect(md).toContain("| Full time (5 × 10 days × 8 h) | 400 |");
    expect(md).toContain("| Other interruptions (20% of what's left; focus factor 0.8) | −47.9 |");
    expect(md).toContain("| **Capacity** | **191.5** |");
  });

  it("reports the sprint's commitment and the usual length, and leaves blank rows out", () => {
    const blank = member("default:member-1", "", 100, 0, { role: "" });
    const md = toMarkdown(
      {
        members: [blank, member("a", "Ann"), member("b", "Bob")],
        config: config({ sprintDays: 9, pointsCommitted: "99" }),
        sprintName: "Sprint 2",
        velocity: 30,
        usualDays: 10,
        committed: "",
      },
      new Date(2026, 9, 18)
    );
    expect(md).toContain("**Total capacity:** 98 hours across 2 members");
    expect(md).toContain("Capacity is 90% of a normal sprint (10 working days");
    // The sprint has no commitment yet; the plan's own number isn't reported.
    expect(md).not.toContain("Points committed");
    expect(md).not.toContain("(unnamed)");
    expect(
      toMarkdown({ members: [member("a", "Ann")], config: config(), committed: "24" })
    ).toContain("**Points committed:** 24");
  });
});

/* ── The page ────────────────────────────────────────────────────────── */

describe("one plan per sprint", () => {
  it("asks how to start a sprint's plan and creates nothing until asked", () => {
    render(<CapacityPlannerClient />);
    expect(
      screen.getByRole("heading", { name: "Sprint 2 has no capacity plan yet" })
    ).toBeInTheDocument();
    expect(plans().map((p) => p.id)).toEqual([GENERAL]);
    expect(
      screen.getByText(/Sprint Planning uses your general plan \(82\.7 hours\)/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start from your last plan" }));
    expect(planById(S2_PLAN)).toEqual({
      id: S2_PLAN,
      sprintId: "s2",
      members: [member("m1", "Ann", 80, 0), member("m2", "Bob", 100, 0)],
      config: config(),
    });
    // The general plan is untouched.
    expect(planById(GENERAL)?.members[1].daysOff).toBe(2);
    expect(lastToast()[0]).toBe("Started Sprint 2's capacity plan");
    expect(screen.getAllByRole("combobox", { name: "Name" })).toHaveLength(2);

    undoLast();
    expect(planById(S2_PLAN)).toBeUndefined();
    expect(
      screen.getByRole("heading", { name: "Sprint 2 has no capacity plan yet" })
    ).toBeInTheDocument();
  });

  it("starts empty with the length from the sprint's dates and the team's holidays", () => {
    cadence.patch = { holidays: ["2026-10-12"] };
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Start empty" }));
    const created = planById(S2_PLAN)!;
    expect(created.sprintId).toBe("s2");
    expect(created.config.sprintDays).toBe(9);
    expect(created.members).toEqual([]);
    expect(screen.getByText(/No team yet/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Sprint 2's dates give 10 working days, less 1 team holiday (Mon 12 Oct): 9."
      )
    ).toBeInTheDocument();
  });

  it("offers the example when there is no earlier plan to copy", () => {
    useWorkspaceStore.setState({ capacityPlans: [] });
    render(<CapacityPlannerClient />);
    expect(screen.queryByRole("button", { name: "Start from your last plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(planById(S2_PLAN)?.members.every((m) => m.id.startsWith("example-"))).toBe(true);
    expect(screen.getByText("Example data.")).toBeInTheDocument();
  });

  it("offers the dates' length when a stored plan says otherwise", () => {
    cadence.patch = { holidays: ["2026-10-12"] };
    useWorkspaceStore.setState({
      capacityPlans: [
        { id: S2_PLAN, sprintId: "s2", members: [member("a", "Ann")], config: config() },
      ],
    });
    render(<CapacityPlannerClient />);
    // Saved numbers aren't changed on load.
    expect(planById(S2_PLAN)?.config.sprintDays).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "Use 9 days" }));
    expect(planById(S2_PLAN)?.config.sprintDays).toBe(9);
    expect(screen.queryByRole("button", { name: "Use 9 days" })).toBeNull();
  });

  it("resets a sprint's plan to blank, keeping it the sprint's, with Undo", () => {
    const original: CapacityPlan = {
      id: S2_PLAN,
      sprintId: "s2",
      members: [member("a", "Ann"), member("b", "Bob")],
      config: config({ focusFactor: 0.6 }),
    };
    useWorkspaceStore.setState({ capacityPlans: [original] });
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("All 2 team members are removed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset plan" }));
    expect(planById(S2_PLAN)).toMatchObject({ sprintId: "s2", config: config() });
    expect(planById(S2_PLAN)?.members).toEqual([]);
    undoLast();
    expect(planById(S2_PLAN)).toEqual(original);
  });

  it("keeps the general plan one click away once sprints exist, and edits it there", () => {
    render(<CapacityPlannerClient />);
    // Sprint Planning falls back to it for Sprint 2, so it opens from here.
    fireEvent.click(screen.getByRole("button", { name: "Open the general plan" }));
    expect(screen.getByRole("button", { name: "General plan" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByText(/Sprint Planning uses it for any sprint without its own plan/)
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("combobox", { name: "Name" }).map((i) => (i as HTMLInputElement).value)
    ).toEqual(["Ann", "Bob"]);
    const hours = screen.getByLabelText("Hours per day");
    fireEvent.change(hours, { target: { value: "7" } });
    fireEvent.blur(hours);
    expect(planById(GENERAL)?.config.hoursPerDay).toBe(7);
    expect(plans().map((p) => p.id)).toEqual([GENERAL]);
    // The general plan's own commitment is still typed here.
    expect(screen.getByLabelText(/Points committed \(next sprint\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "General plan" }));
    expect(
      screen.getByRole("heading", { name: "Sprint 2 has no capacity plan yet" })
    ).toBeInTheDocument();
  });

  it("offers the general plan as is for the first sprint plan, days off included", () => {
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Use your general plan as is" }));
    expect(planById(S2_PLAN)).toEqual({
      id: S2_PLAN,
      sprintId: "s2",
      members: [member("m1", "Ann", 80, 1), member("m2", "Bob", 100, 2)],
      config: config(),
    });
    expect(lastToast()[1].description).toBe("Your general plan, as it was");
    undoLast();
    expect(planById(S2_PLAN)).toBeUndefined();
  });

  it("doesn't offer it once a sprint has a plan of its own, or for a closed sprint", () => {
    useWorkspaceStore.setState({
      capacityPlans: [
        ...plans(),
        {
          id: "capacity-planner:sprint:s1",
          sprintId: "s1",
          members: [member("a", "Ann")],
          config: config(),
        },
      ],
    });
    const { unmount } = render(<CapacityPlannerClient />);
    expect(screen.getByRole("button", { name: "Start from your last plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use your general plan as is" })).toBeNull();
    unmount();

    useWorkspaceStore.setState({
      sprints: [S1, { ...S2, status: "completed", pointsCompleted: 0 }],
      capacityPlans: plans().filter((p) => p.id === GENERAL),
    });
    render(<CapacityPlannerClient />);
    expect(screen.getByRole("button", { name: "Start from your last plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use your general plan as is" })).toBeNull();
  });

  it("clears an example that started a sprint's plan back to no plan, with Undo", () => {
    useWorkspaceStore.setState({ capacityPlans: [] });
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const loaded = planById(S2_PLAN);
    expect(loaded?.members).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(planById(S2_PLAN)).toBeUndefined();
    expect(
      screen.getByRole("heading", { name: "Sprint 2 has no capacity plan yet" })
    ).toBeInTheDocument();
    undoLast();
    expect(planById(S2_PLAN)).toEqual(loaded);
  });

  it("keeps the sprint's plan when the user changed it before clearing the example", () => {
    useWorkspaceStore.setState({ capacityPlans: [] });
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const focus = screen.getByLabelText("Focus factor");
    fireEvent.change(focus, { target: { value: "0.7" } });
    fireEvent.blur(focus);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(planById(S2_PLAN)).toMatchObject({ members: [], config: { focusFactor: 0.7 } });
    expect(screen.getByText(/No team yet/)).toBeInTheDocument();
  });

  it("shows the sprint's commitment from Sprint Planning instead of typing a second one", () => {
    useWorkspaceStore.setState({
      capacityPlans: [
        {
          id: S2_PLAN,
          sprintId: "s2",
          members: [member("a", "Ann")],
          config: config({ pointsCommitted: "99" }),
        },
      ],
    });
    const { container } = render(<CapacityPlannerClient />);
    const commitment = () => container.querySelector('[data-field="commitment"]');
    expect(commitment()?.textContent).toBe(
      "Sprint 2 isn't committed yet. Commit in Sprint Planning"
    );
    expect(screen.getByRole("link", { name: "Commit in Sprint Planning" })).toHaveAttribute(
      "href",
      "/sprint-planning?sprint=s2"
    );
    expect(screen.queryByLabelText(/Points committed/)).toBeNull();
    expect(screen.getByTestId("export-markdown").textContent).not.toContain("Points committed");

    act(() =>
      useWorkspaceStore.setState({
        sprints: [S1, { ...S2, status: "active", pointsPlanned: 24 }],
      })
    );
    expect(commitment()?.textContent).toBe(
      "24 points committed to Sprint 2. Change it in Sprint Planning"
    );
    expect(screen.getByTestId("export-markdown").textContent).toContain("**Points committed:** 24");
  });

  it("forecasts fewer points for a sprint with a team holiday", () => {
    cadence.patch = { holidays: ["2026-10-12"] };
    useWorkspaceStore.setState({
      capacityPlans: [
        {
          id: S2_PLAN,
          sprintId: "s2",
          members: [member("a", "Ann"), member("b", "Bob")],
          config: config({ sprintDays: 9 }),
        },
      ],
    });
    const { container } = render(<CapacityPlannerClient />);
    expect(container.querySelector('[data-field="forecast"]')?.textContent).toBe(
      "Capacity is 90% of a normal sprint (10 working days, everyone in, no days off), so plan about 27 points (velocity 30 × 90%)."
    );
  });
});

describe("the plan in view", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      capacityPlans: [
        {
          id: S2_PLAN,
          sprintId: "s2",
          members: [member("a", "Ann", 80, 1), member("b", "Bob", 80, 1)],
          config: config(),
        },
      ],
    });
  });

  it("totals with the shared maths, which round each person first", () => {
    render(<CapacityPlannerClient />);
    // 39.168 h each: 39.2 + 39.2 = 78.4 (summing first would show 78.3).
    expect(screen.getByText("Sprint Total").parentElement).toHaveTextContent("78.4hours");
    expect(screen.getAllByText("39.2")).toHaveLength(2);
  });

  it("never saves a cleared availability or days off as 0", () => {
    render(<CapacityPlannerClient />);
    const availability = screen.getAllByLabelText("Availability")[0];
    fireEvent.change(availability, { target: { value: "" } });
    fireEvent.blur(availability);
    expect(planById(S2_PLAN)?.members[0].availability).toBe(80);
    expect(
      screen.getByText("Enter the availability, 0–100%. Still counting 80%.")
    ).toBeInTheDocument();

    fireEvent.change(availability, { target: { value: "150" } });
    fireEvent.keyDown(availability, { key: "Enter" });
    expect(planById(S2_PLAN)?.members[0].availability).toBe(80);
    expect(
      screen.getByText("The availability runs from 0 to 100%. Still counting 80%.")
    ).toBeInTheDocument();

    fireEvent.change(availability, { target: { value: "60" } });
    fireEvent.blur(availability);
    expect(planById(S2_PLAN)?.members[0].availability).toBe(60);
    expect(screen.queryByText(/Still counting/)).toBeNull();

    const daysOff = screen.getAllByLabelText("Days off")[1];
    fireEvent.change(daysOff, { target: { value: "" } });
    fireEvent.blur(daysOff);
    expect(planById(S2_PLAN)?.members[1].daysOff).toBe(1);
    fireEvent.change(daysOff, { target: { value: "12" } });
    fireEvent.blur(daysOff);
    expect(screen.getByText(/The number of days off runs from 0 to 10 days/)).toBeInTheDocument();
    expect(planById(S2_PLAN)?.members[1].daysOff).toBe(1);
  });

  it("keeps a cleared setting instead of zeroing it", () => {
    render(<CapacityPlannerClient />);
    const focus = screen.getByLabelText("Focus factor");
    fireEvent.change(focus, { target: { value: "" } });
    fireEvent.blur(focus);
    expect(planById(S2_PLAN)?.config.focusFactor).toBe(0.8);
    expect(
      screen.getByText(/Enter the focus factor, 0–1\. Still counting 0\.8\./)
    ).toBeInTheDocument();
  });

  it("explains where the hours go and forecasts points for Sprint Planning", () => {
    const { container } = render(<CapacityPlannerClient />);
    expect(container.querySelector('[data-field="verdict"]')?.textContent).toBe(
      "78.4 of 160 full-time hours are left for sprint work (49%); time away from the team (availability) takes the most, 28.8 hours."
    );
    expect(
      screen.getByText(/applies to the hours left after the Scrum events/)
    ).toBeInTheDocument();
    // 78.4 of a normal 108.8 hours is 72%; velocity 30 → 22 points.
    expect(container.querySelector('[data-field="forecast"]')?.textContent).toBe(
      "Capacity is 72% of a normal sprint (10 working days, everyone in, no days off), so plan about 22 points (velocity 30 × 72%)."
    );
    // The interruptions line names what it takes: 1 − the focus factor.
    expect(
      screen.getByRole("rowheader", {
        name: "− Other interruptions (20% of what's left; focus factor 0.8)",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Plan Sprint 2 in Sprint Planning/ })).toHaveAttribute(
      "href",
      "/sprint-planning?sprint=s2"
    );
  });

  it("keeps the velocity statistics behind a minimum sample", () => {
    render(<CapacityPlannerClient />);
    expect(
      screen.getByText("Finish 3 more finished sprints to see how steady the forecast is.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Forecast confidence")).toBeNull();

    const done = (i: number, pts: number) =>
      sprint(`d${i}`, `2026-0${i}-01`, `2026-0${i}-15`, {
        status: "completed",
        pointsCompleted: pts,
      });
    act(() =>
      useWorkspaceStore.setState({ sprints: [done(1, 28), done(2, 30), done(3, 31), S1, S2] })
    );
    const chip = screen.getByText("Forecast confidence").nextElementSibling as HTMLElement;
    expect(chip.className).toMatch(/border-(success|warning|border)/);
    expect(chip.getAttribute("style")).toBeNull();
  });

  it("adds a member only once the form is valid, linked to the roster", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "t1", name: "Cleo" }] });
    render(<CapacityPlannerClient />);
    const add = screen.getByRole("button", { name: "Add member" });
    fireEvent.click(add);
    expect(screen.getByText("Enter the person's name.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /New member/ })).toHaveFocus();
    expect(planById(S2_PLAN)?.members).toHaveLength(2);

    fireEvent.change(screen.getByRole("combobox", { name: /New member/ }), {
      target: { value: "cleo" },
    });
    fireEvent.change(screen.getByLabelText("Availability %"), { target: { value: "150" } });
    fireEvent.click(add);
    expect(planById(S2_PLAN)?.members).toHaveLength(2);
    expect(screen.getByText("The availability runs from 0 to 100%.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Availability %"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Days off this sprint"), { target: { value: "1" } });
    fireEvent.click(add);
    expect(planById(S2_PLAN)?.members[2]).toMatchObject({
      name: "cleo",
      availability: 50,
      daysOff: 1,
      teamMemberId: "t1",
    });
    // The form starts again, and the new row has its hours: 9 × 0.5 × 8 × 0.68.
    expect(screen.getByRole("combobox", { name: /New member/ })).toHaveValue("");
    expect(screen.getByText("24.5")).toBeInTheDocument();
  });

  it("removes the last member too, with Undo", () => {
    useWorkspaceStore.setState({
      capacityPlans: [
        { id: S2_PLAN, sprintId: "s2", members: [member("a", "Ann")], config: config() },
      ],
    });
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove member Ann" }));
    expect(planById(S2_PLAN)?.members).toEqual([]);
    expect(screen.getByText(/No team yet/)).toBeInTheDocument();
    undoLast();
    expect(planById(S2_PLAN)?.members.map((m) => m.name)).toEqual(["Ann"]);
  });

  it("links a picked name to the roster", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "t1", name: "Cleo" }] });
    render(<CapacityPlannerClient />);
    fireEvent.change(screen.getAllByRole("combobox", { name: "Name" })[1], {
      target: { value: "Cleo" },
    });
    expect(planById(S2_PLAN)?.members[1]).toMatchObject({ name: "Cleo", teamMemberId: "t1" });
    const name = screen.getAllByRole("combobox", { name: "Name" })[1];
    fireEvent.change(name, { target: { value: "Cleopatra" } });
    // A typed name is saved on blur, like the role beside it.
    expect(planById(S2_PLAN)?.members[1].name).toBe("Cleo");
    fireEvent.blur(name);
    expect(planById(S2_PLAN)?.members[1]).toMatchObject({ name: "Cleopatra" });
    expect(planById(S2_PLAN)?.members[1]).not.toHaveProperty("teamMemberId");
  });

  it("saves a retyped name on blur or Enter, and never swaps the only member for 'No team yet'", () => {
    useWorkspaceStore.setState({
      capacityPlans: [
        {
          id: S2_PLAN,
          sprintId: "s2",
          members: [member("a", "Ann", 80, 1, { role: "" })],
          config: config(),
        },
      ],
    });
    render(<CapacityPlannerClient />);
    const name = screen.getByRole("combobox", { name: "Name" });
    fireEvent.change(name, { target: { value: "" } });
    // Mid-retype: nothing is saved, so the hours and the row stay put.
    expect(planById(S2_PLAN)?.members[0].name).toBe("Ann");
    expect(screen.getByText("Sprint Total").parentElement).toHaveTextContent("39.2hours");
    expect(screen.queryByText(/No team yet/)).toBeNull();
    fireEvent.change(name, { target: { value: "Annie" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(planById(S2_PLAN)?.members[0].name).toBe("Annie");

    // Emptied on purpose, the row is nobody: not counted, but still there to
    // fill in, with no "No team yet" above it and no example to replace it.
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.blur(name);
    expect(planById(S2_PLAN)?.members[0]).toMatchObject({ name: "", availability: 80 });
    expect(screen.getByText("Sprint Total").parentElement).toHaveTextContent("0hours");
    expect(
      screen.getByText(/Not counted in the totals until the row has a name/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/No team yet/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("names each row's fields by whose they are", () => {
    render(<CapacityPlannerClient />);
    const ann = screen.getByRole("group", { name: "Ann" });
    expect(within(ann).getByLabelText("Availability")).toHaveValue(80);
    expect(within(ann).getByRole("combobox", { name: "Name" })).toHaveValue("Ann");
    expect(
      within(screen.getByRole("group", { name: "Bob" })).getByLabelText("Days off")
    ).toHaveValue(1);
  });

  it("exports the sprint's plan as Markdown", () => {
    render(<CapacityPlannerClient />);
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("**For:** Sprint 2");
    expect(md).toContain("**Total capacity:** 78.4 hours across 2 members");
    expect(md).toContain("## Where the hours go");
  });
});

describe("legacy plans", () => {
  it("still opens the general plan for a team without sprints, and edits keep it general", () => {
    useWorkspaceStore.setState({ sprints: [] });
    render(<CapacityPlannerClient />);
    expect(screen.getByText(/Your general plan, not tied to a sprint/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("combobox", { name: "Name" }).map((i) => (i as HTMLInputElement).value)
    ).toEqual(["Ann", "Bob"]);
    const hours = screen.getByLabelText("Hours per day");
    fireEvent.change(hours, { target: { value: "7.5" } });
    fireEvent.blur(hours);
    expect(planById(GENERAL)?.config.hoursPerDay).toBe(7.5);
    expect(planById(GENERAL)).not.toHaveProperty("sprintId");
    expect(plans()).toHaveLength(1);
  });

  it("doesn't count an older plan's blank row in the totals", () => {
    useWorkspaceStore.setState({
      sprints: [],
      capacityPlans: [
        {
          id: GENERAL,
          members: [member("default:member-1", "", 100, 0, { role: "" }), member("a", "Ann")],
          config: config(),
        },
      ],
    });
    render(<CapacityPlannerClient />);
    // Ann alone: 10 × 8 × 0.8 × 0.85 = 54.4 hours; the blank row adds nothing.
    expect(screen.getByText("Sprint Total").parentElement).toHaveTextContent("54.4hours");
    expect(screen.getByText("Team Size").closest("div")?.parentElement).toHaveTextContent(
      "1member"
    );
    const blank = screen.getByRole("group", { name: "Unnamed member" });
    expect(within(blank).getByText("Not counted")).toBeInTheDocument();
    // The row is still there to fill in; with a name it counts.
    expect(planById(GENERAL)?.members).toHaveLength(2);
  });
});
