import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

/**
 * The Onboarding Tracker, upgraded: an editable milestone template (marks
 * instead of names for the KPIs), backdated completion, a ramp curve that
 * counts each day only for the people who have reached it, averages from
 * three people, roster people (and the buddy), edits in place, Undo on
 * deletes and resets, an in-memory example, and a Markdown export. Old
 * saved people still load.
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
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
// Recharts has nothing to measure in jsdom; the curve's text is tested directly.
vi.mock("@/app/(tools)/onboarding-tracker/charts", () => ({
  RampCurveChart: () => <div data-testid="ramp-chart" />,
}));

import { OnboardingTrackerClient } from "@/app/(tools)/onboarding-tracker/onboarding-tracker-client";
import { buildExample } from "@/app/(tools)/onboarding-tracker/example";
import { onboardingToMarkdown, rampText } from "@/app/(tools)/onboarding-tracker/markdown";
import { validatePerson } from "@/app/(tools)/onboarding-tracker/person-form";
import { dayLabel } from "@/app/(tools)/onboarding-tracker/person-card";
import { validateTemplate, withMark } from "@/app/(tools)/onboarding-tracker/template-section";
import {
  BUILT_IN_TEMPLATES,
  STORAGE_KEY,
  TEMPLATES_KEY,
  markOf,
  milestonesFrom,
  normalizeOnboardees,
  normalizeTemplates,
  onboardingStats,
  onboardingVerdict,
  rampCurve,
  type Milestone,
  type MilestoneTemplate,
  type Onboardee,
} from "@/app/(tools)/onboarding-tracker/model";

const TODAY = todayIso();
const ago = (n: number) => addDays(TODAY, -n) as string;

/** A person `daysIn` days in, with milestones reached on the given days. */
const person = (
  id: string,
  daysIn: number,
  milestones: Partial<Milestone>[],
  over: Partial<Onboardee> = {}
): Onboardee => ({
  id,
  name: id,
  startDate: ago(daysIn),
  milestones: milestones.map((m, i) => ({
    id: `${id}-${i}`,
    name: `M${i}`,
    targetDays: 10,
    ...m,
  })),
  ...over,
});
const reachedOn = (startDaysAgo: number, day: number) => ago(startDaysAgo - day);

const seed = (people: unknown, templates?: unknown) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
  if (templates !== undefined) localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
};
const stored = (): Onboardee[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
const storedTemplates = (): MilestoneTemplate[] | null =>
  JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "null");

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <OnboardingTrackerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Text of the compact StatCard whose label is `label`. */
const card = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

const undoLast = () => {
  const [, opts] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  act(() => opts.action.onClick());
};

beforeEach(() => {
  localStorage.clear();
  toastSpy.mockReset();
  logs.length = 0;
  useWorkspaceStore.setState({ teamMembers: [] });
});

/* ── The model ──────────────────────────────────────────────────────── */

describe("normalize", () => {
  it("links a legacy name-only milestone to its built-in, and is safe twice", () => {
    const legacy = [
      {
        id: "p1",
        name: "Ana",
        startDate: ago(10),
        milestones: [
          { id: "a", name: "First PR", targetDays: 7, completedAt: ago(5) },
          { id: "b", name: "Pair with QA", targetDays: 5 },
          "junk",
        ],
        future: "kept",
      },
      null,
    ];
    const once = normalizeOnboardees(legacy);
    expect(once).toHaveLength(1);
    expect(once[0].milestones.map((m) => m.templateId)).toEqual(["first-pr", undefined]);
    expect(markOf(once[0].milestones[0])).toBe("first-pr");
    expect(once[0]).toHaveProperty("future", "kept");
    expect(normalizeOnboardees(once)).toEqual(once);
    expect(normalizeOnboardees("nope")).toEqual([]);
  });

  it("reads a saved template, else the built-ins, one milestone per mark", () => {
    expect(normalizeTemplates(null)).toBeNull();
    expect(normalizeTemplates({})).toBeNull();
    expect(
      normalizeTemplates([
        { id: "t1", name: "A", targetDays: 5, marks: "first-pr" },
        { id: "t2", name: "B", targetDays: 9, marks: "first-pr" },
        { id: "t3", name: "", targetDays: 5 },
        { id: "t4", name: "C", targetDays: 0 },
        { id: "t1", name: "dup", targetDays: 5 },
      ])
    ).toEqual([
      { id: "t1", name: "A", targetDays: 5, marks: "first-pr" },
      { id: "t2", name: "B", targetDays: 9 },
    ]);
    expect(withMark(BUILT_IN_TEMPLATES, "first-pr", "first-merge").map((t) => t.marks)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "productive",
      undefined,
    ]);
  });
});

describe("KPIs and the ramp", () => {
  it("finds the first PR by its mark, through a rename", () => {
    const renamed = milestonesFrom(
      BUILT_IN_TEMPLATES.map((t) =>
        t.id === "first-pr" ? { ...t, name: "First pull request" } : t
      ),
      () => crypto.randomUUID()
    );
    expect(renamed.find((m) => m.name === "First pull request")?.marks).toBe("first-pr");
    const people = ["a", "b", "c"].map((id, i) =>
      person(id, 20, [], {
        milestones: renamed.map((m) =>
          m.marks === "first-pr" ? { ...m, completedAt: reachedOn(20, 4 + i) } : m
        ),
      })
    );
    expect(onboardingStats(people, TODAY).firstPr).toMatchObject({ n: 3, avg: 5 });
  });

  it("shows an average only from three people", () => {
    const two = ["a", "b"].map((id) =>
      person(id, 20, [{ marks: "productive", completedAt: reachedOn(20, 10) }])
    );
    expect(onboardingStats(two, TODAY).productive).toMatchObject({ n: 2, avg: null });
    expect(onboardingStats(two, TODAY).productive.values).toEqual([
      { name: "a", days: 10 },
      { name: "b", days: 10 },
    ]);
  });

  it("counts each day only for the people who have reached it", () => {
    const veterans = ["a", "b", "c"].map((id) =>
      person(id, 40, [{ completedAt: reachedOn(40, 5) }, { targetDays: 30 }])
    );
    const newcomer = person("new", 3, [{}, { targetDays: 30 }]);
    const curve = rampCurve([...veterans, newcomer], TODAY);
    expect(curve.map((p) => p.day)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    const day30 = curve.find((p) => p.day === 30)!;
    // The day-3 newcomer hasn't reached day 30: only the three count.
    expect(day30).toEqual({ day: 30, avgPct: 50, reached: 3 });
    expect(curve[0]).toEqual({ day: 0, avgPct: 0, reached: 4 });
    expect(rampCurve([newcomer, veterans[0]], TODAY).every((p) => p.avgPct === null)).toBe(true);
  });

  it("runs to the longest target, and counts a completion before the start as day 0", () => {
    const people = ["a", "b", "c"].map((id) =>
      person(id, 200, [{ targetDays: 120, completedAt: ago(205) }])
    );
    const curve = rampCurve(people, TODAY);
    expect(curve[curve.length - 1].day).toBe(120);
    expect(curve[0]).toEqual({ day: 0, avgPct: 100, reached: 3 });
    expect(rampCurve([], TODAY)).toEqual([]);
  });

  it("says who has milestones overdue in one sentence", () => {
    expect(onboardingVerdict([], TODAY)).toBe("No new joiners yet.");
    const late = person("Ana", 10, [{ targetDays: 3 }, { targetDays: 5 }]);
    const fine = person("Ben", 1, [{ targetDays: 30 }]);
    expect(onboardingVerdict([late, fine], TODAY)).toBe(
      "Ana has 2 milestones overdue; Ben is on track."
    );
    const done = person("Cleo", 10, [{ completedAt: ago(1) }]);
    expect(onboardingVerdict([done], TODAY)).toBe("Cleo has reached every milestone.");
    const risky = person("Dev", 6, [{ targetDays: 10 }]);
    expect(onboardingVerdict([risky], TODAY)).toBe("No milestone is overdue; 1 is at risk.");
  });

  it("labels a future start", () => {
    expect(dayLabel(-3)).toBe("Starts in 3 days");
    expect(dayLabel(0)).toBe("Day 0");
    expect(dayLabel(null)).toBe("No start date");
  });
});

describe("forms", () => {
  it("needs a name and a real start date, and a buddy who is someone else", () => {
    expect(
      validatePerson({ name: " ", role: "", buddy: "", startDate: "", description: "" })
    ).toEqual({
      ok: false,
      errors: { name: "Who is joining?", startDate: "Pick their start date." },
    });
    const self = validatePerson({
      name: "Ana",
      role: "",
      buddy: " ana",
      startDate: TODAY,
      description: "",
    });
    expect(self.ok).toBe(false);
  });

  it("needs a template milestone's name and a whole number of days", () => {
    expect(validateTemplate({ name: "", targetDays: "", marks: "" })).toEqual({
      ok: false,
      errors: { name: "Name the milestone.", targetDays: "Give it a target in days." },
    });
    expect(validateTemplate({ name: "On-call", targetDays: "2.5", marks: "" }).ok).toBe(false);
    expect(validateTemplate({ name: "On-call", targetDays: "45", marks: "productive" })).toEqual({
      ok: true,
      values: { name: "On-call", targetDays: 45, marks: "productive" },
    });
  });
});

describe("Markdown", () => {
  it("exports the KPIs, each person's milestones and the ramp", () => {
    const md = onboardingToMarkdown(buildExample(TODAY), TODAY);
    expect(md).toContain("> Ana has 1 milestone overdue; Ben and Cleo are on track.");
    expect(md).toContain("- Time to first PR: 5.0 days (3 people)");
    expect(md).toContain("- Time to productivity: not enough data (1 of 3 people)");
    expect(md).toContain("### Ana");
    expect(md).toContain("| First commit | 3 | — | — | overdue |");
    expect(md).toContain(`| First PR | 7 | ${addDays(ago(95), 4)} | 4 | done |`);
    expect(md).toContain("## Ramp");
    expect(md).toContain("| 20 | 3 |");
    const ramp = rampText(rampCurve(buildExample(TODAY), TODAY));
    expect(ramp.summary).toMatch(/^By day 20, the 3 people who have reached it/);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("Onboarding page", () => {
  it("adds nobody until there's a name and a start date", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add onboardee" }));
    expect(await screen.findByText("Who is joining?")).toBeInTheDocument();
    expect(screen.getByText("Pick their start date.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Name" })).toHaveFocus());
    expect(stored()).toEqual([]);
  });

  it("adds a backdated joiner from the roster, with the role filled in and the template's milestones", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m-ana", name: "Ana", role: "Frontend Engineer" },
        { id: "m-ben", name: "Ben" },
      ],
    });
    seed([], [{ id: "t1", name: "Laptop ready", targetDays: 1 }]);
    renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "Name" }), { target: { value: "ana" } });
    expect(screen.getByLabelText("Role")).toHaveValue("Frontend Engineer");
    fireEvent.change(screen.getByRole("combobox", { name: "Buddy (optional)" }), {
      target: { value: "ben" },
    });
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: ago(12) } });
    fireEvent.click(screen.getByRole("button", { name: "Add onboardee" }));
    expect(stored()[0]).toMatchObject({
      name: "Ana",
      memberId: "m-ana",
      role: "Frontend Engineer",
      buddy: "Ben",
      buddyMemberId: "m-ben",
      startDate: ago(12),
      milestones: [{ templateId: "t1", name: "Laptop ready", targetDays: 1 }],
    });
    expect(screen.getByText(/Day 12/)).toBeInTheDocument();
  });

  it("ticks a milestone today, backdates it, and unticks it", () => {
    seed([person("Ana", 10, [{ name: "First commit", targetDays: 3 }])]);
    renderPage();
    fireEvent.click(screen.getByRole("checkbox", { name: "First commit (Ana)" }));
    expect(stored()[0].milestones[0].completedAt).toBe(TODAY);
    fireEvent.change(screen.getByLabelText("Reached on"), { target: { value: ago(8) } });
    expect(stored()[0].milestones[0].completedAt).toBe(ago(8));
    expect(screen.getByText("done in 2d")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reached on"), { target: { value: ago(-2) } });
    expect(stored()[0].milestones[0].completedAt).toBe(ago(8));
    fireEvent.click(screen.getByRole("checkbox", { name: "First commit (Ana)" }));
    expect(stored()[0].milestones[0]).not.toHaveProperty("completedAt");
    expect(logs.map((l) => l.action)).toEqual(["milestone_logged", "milestone_uncompleted"]);
  });

  it("renames and retargets a person's milestone in place", () => {
    seed([person("Ana", 2, [{ name: "First commit", targetDays: 3 }])]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Rename First commit (Ana)" }));
    const field = screen.getByRole("textbox", { name: "Milestone name" });
    fireEvent.change(field, { target: { value: "First commit merged" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(stored()[0].milestones[0].name).toBe("First commit merged");
    const target = screen.getByLabelText("Target days for First commit merged (Ana)");
    fireEvent.change(target, { target: { value: "0" } });
    fireEvent.blur(target);
    expect(stored()[0].milestones[0].targetDays).toBe(3);
    fireEvent.change(target, { target: { value: "5" } });
    fireEvent.blur(target);
    expect(stored()[0].milestones[0].targetDays).toBe(5);
  });

  it("removes a person with Undo, and clears everyone only after a confirm", async () => {
    seed([person("Ana", 2, []), person("Ben", 4, [])]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Remove Ana" }));
    expect(stored().map((p) => p.id)).toEqual(["Ben"]);
    undoLast();
    expect(stored().map((p) => p.id)).toEqual(["Ana", "Ben"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove everyone" }));
    expect(stored()).toEqual([]);
    undoLast();
    expect(stored().map((p) => p.id)).toEqual(["Ana", "Ben"]);
  });

  it("edits the template: add, mark one milestone, remove with Undo, back to the built-ins", async () => {
    renderPage();
    const template = screen.getByRole("list", { name: "Milestone template" });
    expect(within(template).getAllByRole("listitem")).toHaveLength(6);
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "On-call shadow" } });
    fireEvent.change(screen.getByLabelText("Target (days)"), { target: { value: "21" } });
    fireEvent.change(screen.getByLabelText("KPI"), { target: { value: "productive" } });
    fireEvent.click(screen.getByRole("button", { name: "Add milestone" }));
    const saved = storedTemplates()!;
    expect(saved).toHaveLength(7);
    expect(saved[6]).toMatchObject({ name: "On-call shadow", targetDays: 21, marks: "productive" });
    // The mark moved: "Independent feature" no longer counts as productive.
    expect(saved.find((t) => t.id === "independent-feature")).not.toHaveProperty("marks");

    fireEvent.click(screen.getByRole("button", { name: "Remove Mentor a peer from the template" }));
    expect(storedTemplates()!.map((t) => t.id)).not.toContain("mentor-peer");
    undoLast();
    expect(storedTemplates()!.map((t) => t.id)).toContain("mentor-peer");

    fireEvent.click(screen.getByRole("button", { name: "Use the built-ins" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Use the built-ins" }));
    expect(storedTemplates()).toBeNull();
    undoLast();
    expect(storedTemplates()).toHaveLength(7);
  });

  it("shows an example in memory only, gated averages and the reached-only ramp", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(card("Avg time-to-first-PR")).toContain("5.0d");
    expect(card("Avg time-to-first-PR")).toContain("3 people");
    expect(card("Avg time-to-productivity")).toContain("—");
    expect(card("Avg time-to-productivity")).toContain("1 of 3 needed");
    // The chart loads with next/dynamic.
    expect(await screen.findByTestId("ramp-chart")).toBeInTheDocument();
    expect(screen.getByText(/^By day 20, the 3 people who have reached it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "First commit (Ana)" }));
    expect(localStorage.getItem(STORAGE_KEY) ?? "[]").toBe("[]");
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("asks for more people before drawing the ramp", () => {
    seed([person("Ana", 10, [{}]), person("Ben", 10, [{}])]);
    renderPage();
    expect(screen.queryByTestId("ramp-chart")).toBeNull();
    expect(
      screen.getByText(
        "Add 1 more new joiner to see the ramp curve (each day counts the people who have reached it)."
      )
    ).toBeInTheDocument();
  });

  it("links someone to the team on an explicit click", () => {
    seed([person("Kim", 2, [])]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Kim to the team" }));
    const member = useWorkspaceStore.getState().teamMembers?.[0];
    expect(member?.name).toBe("Kim");
    expect(stored()[0].memberId).toBe(member?.id);
    expect(screen.queryByRole("button", { name: "Add Kim to the team" })).toBeNull();
  });
});
