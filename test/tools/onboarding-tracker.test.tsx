import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Onboarding Speed Tracker: adding a new joiner with the default milestone
 * ladder, ticking and un-ticking milestones, notes, removal, the KPI
 * averages, the on-track / at-risk / overdue boundaries, the day counter
 * across midnight, the ramp curve and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
const logs = vi.hoisted(() => [] as string[]);

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
  useHistoryLogger: () => ({ log: (action: string) => logs.push(action) }),
}));
// The ramp curve loads through next/dynamic; a placeholder exposes its data.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic(props: Record<string, unknown>) {
      return <div data-testid="ramp-curve" data-props={JSON.stringify(props)} />;
    },
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { OnboardingTrackerClient } from "@/app/(tools)/onboarding-tracker/onboarding-tracker-client";

const KEY = "agile-toolkit:onboarding-tracker";

interface StoredMilestone {
  id: string;
  name: string;
  targetDays: number;
  completedAt?: string;
  notes?: string;
}
interface StoredPerson {
  id: string;
  name: string;
  role?: string;
  startDate: string;
  milestones: StoredMilestone[];
  description?: string;
}

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as StoredPerson[];
const seed = (people: StoredPerson[]) => localStorage.setItem(KEY, JSON.stringify(people));
const person = (
  id: string,
  name: string,
  startDate: string,
  milestones: StoredMilestone[]
): StoredPerson => ({ id, name, startDate, milestones });
const ms = (id: string, name: string, targetDays: number, completedAt?: string) => ({
  id,
  name,
  targetDays,
  completedAt,
});

/** Text of the compact StatCard labelled `label`. */
const kpi = (label: string) =>
  screen.getByText(label).parentElement!.parentElement!.textContent ?? "";

// "Today" is Sunday 18 Oct 2026, mid-morning local time.
const TODAY = "2026-10-18";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0, 0));
  localStorage.clear();
  logs.length = 0;
  exported.csv = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Onboarding Tracker: empty state", () => {
  it("shows the empty state and neutral KPIs", () => {
    render(<OnboardingTrackerClient />);
    expect(screen.getByText(/No onboardees yet/)).toBeInTheDocument();
    expect(kpi("Active onboardees")).toBe("Active onboardees0");
    expect(kpi("Avg time-to-first-PR")).toBe("Avg time-to-first-PR—");
    expect(kpi("Avg time-to-productivity")).toContain("—");
    expect(kpi("Overdue / at-risk milestones")).toContain("0 / 0");
    expect(screen.queryByText(/Consider a check-in/)).toBeNull();
    expect(screen.queryByTestId("ramp-curve")).toBeNull();
  });
});

describe("Onboarding Tracker: adding and removing people", () => {
  it("adds a trimmed new joiner with the six default milestones, newest first", () => {
    seed([person("old", "Old Hire", "2026-09-01", [])]);
    render(<OnboardingTrackerClient />);
    expect(screen.getByLabelText("Start date")).toHaveValue(TODAY);
    fireEvent.change(screen.getByLabelText("Onboardee name"), { target: { value: "  Ana  " } });
    fireEvent.change(screen.getByLabelText("Onboardee role"), { target: { value: " SRE " } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: " Ex-Google " } });
    fireEvent.click(screen.getByRole("button", { name: "Add onboardee" }));

    const [ana, old] = stored();
    expect(old.id).toBe("old");
    expect(ana).toMatchObject({
      name: "Ana",
      role: "SRE",
      startDate: "2026-10-08",
      description: "Ex-Google",
    });
    expect(ana.milestones.map((m) => [m.name, m.targetDays])).toEqual([
      ["First commit", 3],
      ["First PR", 7],
      ["First merge", 14],
      ["First production deploy", 30],
      ["Independent feature", 60],
      ["Mentor a peer", 90],
    ]);
    expect(new Set(ana.milestones.map((m) => m.id)).size).toBe(6);
    expect(ana.milestones.every((m) => m.completedAt === undefined)).toBe(true);
    expect(logs).toContain("person_added");

    // The form is reset, the start date back to today.
    expect(screen.getByLabelText("Onboardee name")).toHaveValue("");
    expect(screen.getByLabelText("Onboardee role")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByLabelText("Start date")).toHaveValue(TODAY);

    expect(screen.getByText("Started 2026-10-08 · Day 10 · 0/6 milestones")).toBeInTheDocument();
    expect(screen.getByText("Ex-Google")).toBeInTheDocument();
  });

  it("stores no role or description when they are blank", () => {
    render(<OnboardingTrackerClient />);
    fireEvent.change(screen.getByLabelText("Onboardee name"), { target: { value: "Ben" } });
    fireEvent.change(screen.getByLabelText("Onboardee role"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add onboardee" }));
    expect(stored()[0].role).toBeUndefined();
    expect(stored()[0].description).toBeUndefined();
  });

  it("ignores a blank name", () => {
    render(<OnboardingTrackerClient />);
    fireEvent.change(screen.getByLabelText("Onboardee name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add onboardee" }));
    expect(stored()).toEqual([]);
    expect(screen.getByText(/No onboardees yet/)).toBeInTheDocument();
  });

  it("starts today when the start date was cleared", () => {
    render(<OnboardingTrackerClient />);
    fireEvent.change(screen.getByLabelText("Onboardee name"), { target: { value: "Cy" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add onboardee" }));
    expect(stored()[0].startDate).toBe(TODAY);
    expect(screen.getByText(/Day 0 ·/)).toBeInTheDocument();
  });

  it("removes only the chosen person", () => {
    seed([
      person("a", "Ana", "2026-10-01", [ms("a1", "First PR", 7)]),
      person("b", "Ben", "2026-10-01", [ms("b1", "First PR", 7)]),
    ]);
    render(<OnboardingTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ana" }));
    expect(stored().map((p) => p.id)).toEqual(["b"]);
    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.getByText("Ben")).toBeInTheDocument();
    expect(logs).toContain("person_removed");
  });
});

describe("Onboarding Tracker: milestones", () => {
  beforeEach(() =>
    seed([
      person("a", "Ana", "2026-10-08", [
        ms("a1", "First commit", 3),
        ms("a2", "First PR", 14),
        ms("a3", "Mentor a peer", 90),
      ]),
    ])
  );

  it("ticks a milestone done today and shows how many days it took", () => {
    render(<OnboardingTrackerClient />);
    const box = screen.getByRole("checkbox", { name: "First PR (Ana)" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(stored()[0].milestones[1].completedAt).toBe(TODAY);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("done in 10d")).toBeInTheDocument();
    expect(kpi("Avg time-to-first-PR")).toContain("10.0d");
    expect(screen.getByText(/Day 10 · 1\/3 milestones/)).toBeInTheDocument();
    expect(logs).toContain("milestone_logged");
  });

  it("un-ticks a milestone back to open", () => {
    render(<OnboardingTrackerClient />);
    const box = screen.getByRole("checkbox", { name: "First PR (Ana)" });
    fireEvent.click(box);
    fireEvent.click(box);
    expect(stored()[0].milestones[1].completedAt).toBeUndefined();
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(kpi("Avg time-to-first-PR")).toContain("—");
    expect(logs).toEqual(["milestone_logged", "milestone_uncompleted"]);
  });

  it("saves a trimmed note on blur and clears it when blanked", () => {
    render(<OnboardingTrackerClient />);
    const note = screen.getByLabelText("Note for First PR (Ana)");
    fireEvent.change(note, { target: { value: "  paired with Ben  " } });
    // Nothing is written while typing.
    expect(localStorage.getItem(KEY)).not.toContain("paired");
    fireEvent.blur(note);
    expect(stored()[0].milestones[1].notes).toBe("paired with Ben");
    fireEvent.change(note, { target: { value: "   " } });
    fireEvent.blur(note);
    expect(stored()[0].milestones[1].notes).toBeUndefined();
  });

  it("flags milestones by elapsed time: overdue, at risk, on track", () => {
    render(<OnboardingTrackerClient />);
    // Day 10: First commit (3d) overdue, First PR (14d) at risk, Mentor (90d) on track.
    expect(screen.getAllByText("overdue")).toHaveLength(1);
    expect(screen.getAllByText("at risk")).toHaveLength(1);
    expect(kpi("Overdue / at-risk milestones")).toContain("1 / 1");
  });

  it("finishes a person once every milestone is done", () => {
    render(<OnboardingTrackerClient />);
    for (const name of ["First commit", "First PR", "Mentor a peer"]) {
      fireEvent.click(screen.getByRole("checkbox", { name: `${name} (Ana)` }));
    }
    expect(kpi("Active onboardees")).toMatch(/^Active onboardees0/);
    expect(kpi("Active onboardees")).toContain("1 finished");
    expect(kpi("Overdue / at-risk milestones")).toContain("0 / 0");
    expect(screen.queryByText(/Consider a check-in/)).toBeNull();
  });
});

describe("Onboarding Tracker: status boundaries", () => {
  const atDay = (day: number, targetDays: number) => {
    const start = new Date(2026, 9, 18 - day);
    const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(
      start.getDate()
    ).padStart(2, "0")}`;
    seed([person("p", "Pat", iso, [ms("m", "Milestone", targetDays)])]);
    render(<OnboardingTrackerClient />);
    return kpi("Overdue / at-risk milestones");
  };

  it("is on track up to exactly half the target", () => {
    expect(atDay(5, 10)).toContain("0 / 0");
  });

  it("is at risk past half the target", () => {
    expect(atDay(6, 10)).toContain("0 / 1");
  });

  it("is still at risk (not overdue) on the target day itself", () => {
    expect(atDay(10, 10)).toContain("0 / 1");
  });

  it("is overdue the day after the target", () => {
    expect(atDay(11, 10)).toContain("1 / 0");
  });

  it("never flags a zero-day target", () => {
    expect(atDay(30, 0)).toContain("0 / 0");
  });

  it("never flags a person who hasn't started yet", () => {
    expect(atDay(-3, 1)).toContain("0 / 0");
  });

  it("words the callout in the plural for several milestones", () => {
    seed([
      person("p", "Pat", "2026-09-01", [ms("m1", "One", 3), ms("m2", "Two", 5)]),
      person("q", "Quinn", "2026-10-14", [ms("m3", "Three", 6), ms("m4", "Four", 7)]),
    ]);
    render(<OnboardingTrackerClient />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("2 milestones are overdue");
    expect(text).toContain("2 milestones are at risk");
    expect(text).toContain("Consider a check-in.");
  });
});

describe("Onboarding Tracker: day counter across midnight", () => {
  it("moves to the next day when the clock passes midnight", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 30));
    seed([person("p", "Pat", "2026-10-18", [ms("m", "Milestone", 1)])]);
    render(<OnboardingTrackerClient />);
    expect(screen.getByText(/Day 0 ·/)).toBeInTheDocument();
    expect(kpi("Overdue / at-risk milestones")).toContain("0 / 0");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/Day 1 ·/)).toBeInTheDocument();
    // Day 1 of a 1-day target: past half of it, not yet past it → at risk.
    expect(kpi("Overdue / at-risk milestones")).toContain("0 / 1");
  });
});

describe("Onboarding Tracker: averages, ramp curve and export", () => {
  beforeEach(() =>
    seed([
      person("a", "Ana", "2026-09-01", [
        ms("a1", "First PR", 7, "2026-09-05"), // 4 days
        ms("a2", "Independent feature", 60, "2026-10-01"), // 30 days
      ]),
      person("b", "Ben", "2026-09-01", [
        ms("b1", "First PR", 7, "2026-09-07"), // 6 days
        ms("b2", "Independent feature", 60), // open, day 47: at risk
      ]),
      person("c", "Cy", "2026-10-01", []), // no milestones: active, left out of the curve
    ])
  );

  it("averages time-to-first-PR and time-to-productivity over completed milestones", () => {
    render(<OnboardingTrackerClient />);
    expect(kpi("Avg time-to-first-PR")).toContain("5.0d");
    expect(kpi("Avg time-to-productivity")).toContain("30.0d");
    // Ana finished every milestone; Ben and Cy (no milestones) are still active.
    expect(kpi("Active onboardees")).toMatch(/^Active onboardees2/);
    expect(kpi("Active onboardees")).toContain("1 finished");
  });

  it("plots the average share of milestones done by each 5-day mark", () => {
    render(<OnboardingTrackerClient />);
    const { data } = JSON.parse(
      screen.getByTestId("ramp-curve").getAttribute("data-props") ?? "{}"
    ) as { data: { day: number; avgPct: number }[] };
    expect(data.map((d) => d.day)).toEqual(Array.from({ length: 19 }, (_, i) => i * 5));
    const at = (day: number) => data.find((d) => d.day === day)!.avgPct;
    expect(at(0)).toBe(0);
    // Day 5: Ana 1/2, Ben 0/2 → 25%.
    expect(at(5)).toBeCloseTo(25, 5);
    // Day 10: Ana 1/2, Ben 1/2 → 50%.
    expect(at(10)).toBeCloseTo(50, 5);
    // Day 30: Ana 2/2, Ben 1/2 → 75%.
    expect(at(30)).toBeCloseTo(75, 5);
    expect(at(90)).toBeCloseTo(75, 5);
  });

  it("exports one CSV row per milestone with its days to complete", () => {
    render(<OnboardingTrackerClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Role",
      "Start date",
      "Description",
      "Milestone",
      "Target days",
      "Completed at",
      "Days to complete",
      "Notes",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Ana", "", "2026-09-01", "", "First PR", 7, "2026-09-05", 4, ""],
      ["Ana", "", "2026-09-01", "", "Independent feature", 60, "2026-10-01", 30, ""],
      ["Ben", "", "2026-09-01", "", "First PR", 7, "2026-09-07", 6, ""],
      ["Ben", "", "2026-09-01", "", "Independent feature", 60, "", "", ""],
    ]);
  });

  it("lists each person's milestones in their own card", () => {
    render(<OnboardingTrackerClient />);
    const ben = screen.getByText("Ben").closest(".space-y-3") as HTMLElement;
    expect(within(ben).getByText("done in 6d")).toBeInTheDocument();
    expect(within(ben).getByText("at risk")).toBeInTheDocument();
    expect(within(ben).getByText(/Day 47 · 1\/2 milestones/)).toBeInTheDocument();
  });
});
