import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  DesignSprintDay,
  DesignSprintOutput,
  DesignSprintPlan,
} from "@/lib/stores/workspace-types";
import { normalizeCadence } from "@/lib/sprints/cadence";
import { cadenceDoc } from "@/lib/sprints/use-ceremony-cadence";
import { designSprintToday } from "@/lib/design-sprint/day";
import {
  DEFAULT_DESIGN_SPRINT_TASKS,
  buildDesignSprintDays,
  newDesignSprintPlan,
} from "@/lib/design-sprint/plan";

/**
 * Design Sprint, Phase 4 of the tool upgrade: today's day worked out from
 * the start date and the team's working days (looking at a day never moves
 * the sprint on); typed outputs per day, added through forms, edited in
 * place and deleted with Undo; the old free-text artifacts read as notes
 * and moved into outputs once; Test-day findings sent to the Hypothesis
 * Tracker or the backlog; answers to the sprint questions; a confirmed,
 * undoable reset and an undoable Complete; an example on Test day; a
 * verdict and a Markdown export.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn() }));
const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { DesignSprintClient } from "@/app/(tools)/design-sprint/design-sprint-client";
import {
  DS_ID,
  dayOutputs,
  legacyNoteId,
  planDays,
  updateDay,
  withLegacyNotes,
} from "@/app/(tools)/design-sprint/doc";
import {
  EXAMPLE_PLAN_ID,
  buildExample,
  exampleStartDate,
} from "@/app/(tools)/design-sprint/example";
import { toMarkdown } from "@/app/(tools)/design-sprint/markdown";
import { DAY_SLOTS, EMPTY_OUTPUT_DRAFT, validateOutput } from "@/app/(tools)/design-sprint/outputs";
import { emptyDetails, validateDetails } from "@/app/(tools)/design-sprint/start-form";
import { withShownDay } from "@/app/(tools)/design-sprint/use-design-sprint";
import { designSprintVerdict } from "@/app/(tools)/design-sprint/verdict";

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Local dates in October 2026: Mon 19 … Fri 23, Sat 24, Mon 26. */
const at = (day: number, hour = 10, minute = 0) => new Date(2026, 9, day, hour, minute);

function setToday(day: number, hour = 10, minute = 0) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(day, hour, minute));
}

function seq(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function makePlan(over: Partial<DesignSprintPlan> = {}): DesignSprintPlan {
  return {
    ...newDesignSprintPlan(
      { name: "Checkout", startDate: "2026-10-19" },
      { id: "p1", newId: seq("t") }
    ),
    ...over,
  };
}

/** The plan with `outputs` on `day`. */
function withOutputs(
  plan: DesignSprintPlan,
  day: DesignSprintDay["day"],
  outputs: DesignSprintOutput[]
): DesignSprintPlan {
  return { ...plan, days: plan.days.map((d) => (d.day === day ? { ...d, outputs } : d)) };
}

const ws = () => useWorkspaceStore.getState();
const stored = () => (ws().designSprints ?? []).find((d) => d.id === DS_ID)?.sprint ?? null;
const storedDay = (day: number) => stored()!.days.find((d) => d.day === day)!;
const store = (plan: DesignSprintPlan | null) =>
  useWorkspaceStore.setState({ designSprints: [{ id: DS_ID, sprint: plan }] });

const renderPage = () =>
  render(
    <TooltipProvider>
      <DesignSprintClient />
    </TooltipProvider>
  );

const timeline = () => screen.getByRole("group", { name: "Sprint days" });
const dayButton = (n: number) =>
  within(timeline()).getByRole("button", { name: new RegExp(`^Day ${n}`) });

/** The last toast's label and its Undo. */
function lastToast() {
  const [label, opts] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return { label: label as string, undo: () => act(() => opts.action.onClick()) };
}

const logged = (action: string) =>
  history.log.mock.calls.filter(([a]) => a === action).map(([, payload]) => payload);

beforeEach(() => {
  toastSpy.mockReset();
  history.log.mockReset();
  exported.markdown = undefined;
  useWorkspaceStore.setState({
    designSprints: [],
    ceremonyCadences: [],
    hypothesisTrackers: [],
    stories: [],
    teamMembers: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Today's day ────────────────────────────────────────────────────────────

describe("Design Sprint: today's day comes from the start date", () => {
  it("shows the day, marks it on the timeline and says what's missing", () => {
    setToday(21); // Wednesday
    store(makePlan());
    renderPage();
    expect(
      screen.getByText("Day 3 of 5 (Decide): 0 of 5 tasks done, no decision recorded yet.")
    ).toBeInTheDocument();
    expect(screen.getByText("Day 3 of 5 · Decide")).toBeInTheDocument();
    expect(dayButton(3)).toHaveAttribute("aria-current", "date");
    expect(dayButton(3)).toHaveAttribute("aria-pressed", "true");
    expect(dayButton(1)).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { name: /Day 3 · Decide/ })).toBeInTheDocument();
    expect(within(timeline()).getByText("Wed 21 Oct")).toBeInTheDocument();
  });

  it("starts on the Monday after a weekend start date, and says when before it starts", () => {
    setToday(21);
    store(makePlan({ startDate: "2026-10-24" })); // a Saturday
    renderPage();
    expect(screen.getByText("Upcoming: starts in 3 working days")).toBeInTheDocument();
    expect(screen.getByText("Starts Monday 26 Oct, in 3 working days.")).toBeInTheDocument();
    expect(dayButton(1)).toHaveAttribute("aria-pressed", "true");
    expect(within(timeline()).getByText("Mon 26 Oct")).toBeInTheDocument();
    expect(within(timeline()).queryByText("Today")).not.toBeInTheDocument();
  });

  it("on a weekend mid-sprint shows the last day worked without calling it today", () => {
    setToday(24); // Saturday
    store(makePlan({ startDate: "2026-10-22" })); // Thu, Fri, Mon, Tue, Wed
    renderPage();
    expect(screen.getByText("Day 2 of 5 · Sketch")).toBeInTheDocument();
    expect(screen.getByText("Sketch · a day off today")).toBeInTheDocument();
    expect(dayButton(2)).toHaveAttribute("aria-pressed", "true");
    expect(dayButton(2)).not.toHaveAttribute("aria-current");
    expect(within(timeline()).queryByText("Today")).not.toBeInTheDocument();
    expect(within(timeline()).getByText("Mon 26 Oct")).toBeInTheDocument();
  });

  it("skips a team holiday", () => {
    setToday(21);
    useWorkspaceStore.setState({
      ceremonyCadences: [cadenceDoc(normalizeCadence({ holidays: ["2026-10-20"] }))],
    });
    store(makePlan());
    renderPage();
    expect(screen.getByText("Day 2 of 5 · Sketch")).toBeInTheDocument();
    expect(within(timeline()).getByText("Mon 26 Oct")).toBeInTheDocument();
  });

  it("is over after day 5, opening Test day", () => {
    setToday(26);
    store(makePlan());
    renderPage();
    // The status line and the Today tile.
    expect(screen.getAllByText("Over")).toHaveLength(2);
    expect(screen.getByText("All five days are past")).toBeInTheDocument();
    expect(dayButton(5)).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText("All five days are over, with no findings recorded yet.")
    ).toBeInTheDocument();
  });

  it("reads today's local date, late in the evening too", () => {
    setToday(23, 23, 30);
    store(makePlan());
    renderPage();
    expect(screen.getByText("Day 5 of 5 · Test")).toBeInTheDocument();
  });

  it("opening another day never moves the sprint on; writes keep currentDay at today's", () => {
    setToday(21);
    store(makePlan({ currentDay: 1 }));
    renderPage();
    fireEvent.click(dayButton(1));
    expect(dayButton(1)).toHaveAttribute("aria-pressed", "true");
    expect(dayButton(3)).toHaveAttribute("aria-current", "date");
    expect(stored()!.currentDay).toBe(1); // looking wrote nothing
    expect(screen.getByText(/^Day 3 of 5 \(Decide\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Set the long-term goal" }));
    expect(storedDay(1).tasks[0].done).toBe(true);
    // Older readers get today's day, not the day being looked at.
    expect(stored()!.currentDay).toBe(3);
  });

  it("withShownDay stamps the derived day and leaves an up-to-date plan alone", () => {
    const plan = makePlan({ currentDay: 1 });
    expect(withShownDay(plan, "2026-10-22").currentDay).toBe(4);
    expect(withShownDay(plan, "2026-10-01").currentDay).toBe(1);
    expect(withShownDay(plan, "2026-11-30").currentDay).toBe(5);
    const current = makePlan({ currentDay: 4 });
    expect(withShownDay(current, "2026-10-22")).toBe(current);
  });
});

// ─── Starting ───────────────────────────────────────────────────────────────

describe("Design Sprint: starting a sprint", () => {
  it("saves nothing without a name or with a cleared date, then starts with the default tasks", () => {
    setToday(21);
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Ben" }] });
    renderPage();
    const date = screen.getByLabelText(/Start date/);
    expect(date).toHaveValue("2026-10-21");

    fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));
    expect(screen.getByText("Name the sprint.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Sprint name/)).toHaveFocus();
    expect(stored()).toBeNull();

    fireEvent.change(screen.getByLabelText(/Sprint name/), { target: { value: " Onboarding " } });
    fireEvent.change(date, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));
    expect(screen.getByText("Pick the day the sprint starts.")).toBeInTheDocument();
    expect(stored()).toBeNull();

    fireEvent.change(date, { target: { value: "2026-10-19" } });
    expect(screen.getByText(/Runs Mon 19 Oct – Fri 23 Oct 2026/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Decider"), { target: { value: "Amira" } });
    expect(screen.getByText("“Amira” isn’t on the team.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Facilitator"), { target: { value: "Ben" } });
    fireEvent.click(screen.getByRole("button", { name: "Start sprint" }));

    const plan = stored()!;
    expect(plan).toMatchObject({
      name: "Onboarding",
      startDate: "2026-10-19",
      currentDay: 3,
      decider: "Amira",
      facilitator: "Ben",
    });
    expect(plan.days.map((d) => d.dayName)).toEqual([
      "Map",
      "Sketch",
      "Decide",
      "Prototype",
      "Test",
    ]);
    expect(plan.days[0].tasks.map((t) => t.text)).toEqual(DEFAULT_DESIGN_SPRINT_TASKS[1]);
    // Typing a name never adds it to the team.
    expect(ws().teamMembers).toEqual([{ id: "m1", name: "Ben" }]);
    expect(logged("sprint_started")).toHaveLength(1);
    expect(screen.getByText(/^Day 3 of 5 \(Decide\)/)).toBeInTheDocument();
  });

  it("validates the details without defaulting the date", () => {
    expect(validateDetails(emptyDetails("2026-10-21"))).toEqual({
      ok: false,
      errors: { name: "Name the sprint." },
    });
    expect(
      validateDetails({ ...emptyDetails(""), name: "x", startDate: "2026-02-30" })
    ).toMatchObject({ ok: false, errors: { startDate: "Enter a real date." } });
    expect(validateDetails({ ...emptyDetails("2026-10-19"), name: "x".repeat(201) })).toMatchObject(
      { ok: false, errors: { name: expect.stringContaining("200") } }
    );
    expect(
      validateDetails({
        name: " A ",
        startDate: "2026-10-19",
        description: "  ",
        decider: " Amira ",
        facilitator: "",
      })
    ).toEqual({ ok: true, values: { name: "A", startDate: "2026-10-19", decider: "Amira" } });
  });

  it("edits the details in place; a backdated start date moves today's day", () => {
    setToday(21);
    store(makePlan());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit sprint details" }));
    expect(screen.getByLabelText(/Sprint name/)).toHaveFocus();
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: "2026-10-16" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(stored()).toMatchObject({ startDate: "2026-10-16", currentDay: 4 });
    expect(screen.getByText("Day 4 of 5 · Prototype")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit sprint details" })).toHaveFocus();
  });
});

// ─── Outputs ────────────────────────────────────────────────────────────────

describe("Design Sprint: each day's outputs", () => {
  it("adds one through a form, edits it in place and deletes it with Undo", () => {
    setToday(21);
    store(makePlan());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Record the decision" }));
    const field = screen.getByRole("textbox", { name: /^Decision/ });
    expect(field).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Describe the decision.")).toBeInTheDocument();
    expect(storedDay(3).outputs).toEqual([]);

    fireEvent.change(field, { target: { value: "Build the starter basket" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(storedDay(3).outputs).toEqual([
      expect.objectContaining({ kind: "decision", text: "Build the starter basket" }),
    ]);
    // One decision: the add button is gone, focus is on the new item.
    expect(screen.queryByRole("button", { name: "Record the decision" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit decision: Build the starter basket" })
    ).toHaveFocus();
    expect(logged("output_added")).toEqual([
      expect.objectContaining({ sprintId: "p1", day: 3, kind: "decision" }),
    ]);
    expect(
      screen.getByText("Day 3 of 5 (Decide): 0 of 5 tasks done, decision recorded.")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit decision: Build the starter basket" })
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Decision/ }), {
      target: { value: "Build the starter basket, with a slot picker" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(storedDay(3).outputs![0].text).toBe("Build the starter basket, with a slot picker");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete decision: Build the starter basket, with a slot picker",
      })
    );
    expect(storedDay(3).outputs).toEqual([]);
    const toast = lastToast();
    expect(toast.label).toBe("Deleted the decision “Build the starter basket, with a slot p…”");
    toast.undo();
    expect(storedDay(3).outputs![0].text).toBe("Build the starter basket, with a slot picker");
    expect(logged("output_removed")).toHaveLength(1);
  });

  it("keeps a list slot's form open for the next item, and checks links", () => {
    setToday(20); // Sketch day
    store(makePlan());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add a sketch" }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Sketch/ }), {
      target: { value: "Starter basket" },
    });
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Add sketch" }));
    expect(screen.getByText("Enter a full link, starting with https://")).toBeInTheDocument();
    expect(storedDay(2).outputs).toEqual([]);

    fireEvent.change(screen.getByLabelText("Link"), {
      target: { value: "https://example.com/s1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add sketch" }));
    expect(storedDay(2).outputs![0]).toMatchObject({
      kind: "sketch",
      text: "Starter basket",
      url: "https://example.com/s1",
    });
    // Still open, and empty, for the next sketch.
    expect(screen.getByRole("textbox", { name: /^Sketch/ })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Add a sketch" })).toHaveFocus();
    expect(screen.getByRole("link", { name: /https:\/\/example.com\/s1/ })).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
  });

  it("validates outputs: text required, web links only, a 0–5 interview count", () => {
    const finding = DAY_SLOTS[5].find((s) => s.kind === "finding")!;
    const sketch = DAY_SLOTS[2].find((s) => s.kind === "sketch")!;
    expect(validateOutput(finding, EMPTY_OUTPUT_DRAFT)).toEqual({
      ok: false,
      errors: { text: "Describe the finding." },
    });
    expect(
      validateOutput(finding, { ...EMPTY_OUTPUT_DRAFT, text: "x", seenIn: "6" })
    ).toMatchObject({ ok: false, errors: { seenIn: expect.any(String) } });
    expect(
      validateOutput(finding, { ...EMPTY_OUTPUT_DRAFT, text: "x", seenIn: "2.5" })
    ).toMatchObject({ ok: false });
    expect(validateOutput(finding, { text: " x ", url: "", signal: "mixed", seenIn: "0" })).toEqual(
      { ok: true, values: { text: "x", signal: "mixed", seenIn: 0 } }
    );
    // "Not judged" and an empty count leave both unset.
    expect(validateOutput(finding, { ...EMPTY_OUTPUT_DRAFT, text: "x" })).toEqual({
      ok: true,
      values: { text: "x" },
    });
    expect(
      validateOutput(sketch, { ...EMPTY_OUTPUT_DRAFT, text: "x", url: "ftp://example.com" })
    ).toMatchObject({ ok: false, errors: { url: expect.any(String) } });
    // A slot without a link ignores whatever the draft holds.
    const goal = DAY_SLOTS[1][0];
    expect(validateOutput(goal, { ...EMPTY_OUTPUT_DRAFT, text: "g", url: "nope" })).toEqual({
      ok: true,
      values: { text: "g" },
    });
  });
});

// ─── Old artifacts ──────────────────────────────────────────────────────────

describe("Design Sprint: old free-text artifacts", () => {
  const legacy = () =>
    makePlan({
      days: makePlan().days.map((d) => {
        const { outputs: _outputs, ...rest } = d;
        void _outputs;
        return d.day === 1
          ? { ...rest, artifacts: ["Journey map photo", "https://miro.com/app/board/x"] }
          : rest;
      }),
    });

  it("show as notes and move into outputs once, on the first edit of that day", () => {
    setToday(21);
    store(legacy());
    renderPage();
    fireEvent.click(dayButton(1));
    const notes = screen.getByRole("region", { name: "Notes" });
    expect(within(notes).getByText("Journey map photo")).toBeInTheDocument();
    expect(within(notes).getByRole("link", { name: /miro\.com/ })).toHaveAttribute(
      "href",
      "https://miro.com/app/board/x"
    );
    expect(storedDay(1).artifacts).toHaveLength(2); // reading writes nothing

    fireEvent.click(screen.getByRole("checkbox", { name: "Set the long-term goal" }));
    const ids = [
      legacyNoteId(1, 0, "Journey map photo"),
      legacyNoteId(1, 1, "https://miro.com/app/board/x"),
    ];
    expect(storedDay(1).artifacts).toEqual([]);
    expect(storedDay(1).outputs).toEqual([
      { id: ids[0], kind: "note", text: "Journey map photo" },
      {
        id: ids[1],
        kind: "note",
        text: "https://miro.com/app/board/x",
        url: "https://miro.com/app/board/x",
      },
    ]);
    // Another edit converts nothing twice.
    fireEvent.click(screen.getByRole("checkbox", { name: "Set the long-term goal" }));
    expect(storedDay(1).outputs!.map((o) => o.id)).toEqual(ids);
  });

  it("are deleted by id, and Undo puts the note back in its place", () => {
    setToday(21);
    store(legacy());
    renderPage();
    fireEvent.click(dayButton(1));
    fireEvent.click(screen.getByRole("button", { name: "Delete note: Journey map photo" }));
    expect(storedDay(1).artifacts).toEqual([]);
    expect(storedDay(1).outputs!.map((o) => o.text)).toEqual(["https://miro.com/app/board/x"]);
    lastToast().undo();
    expect(storedDay(1).outputs!.map((o) => o.text)).toEqual([
      "Journey map photo",
      "https://miro.com/app/board/x",
    ]);
  });

  it("convert idempotently, even when a copy was already moved", () => {
    const day = legacy().days[0];
    const once = withLegacyNotes(day);
    expect(withLegacyNotes(once)).toBe(once);
    // Artifacts written again by an older client next to their converted copies.
    const raced = { ...once, artifacts: day.artifacts };
    expect(dayOutputs(raced).map((o) => o.id)).toEqual(once.outputs!.map((o) => o.id));
    // Blank artifacts are dropped.
    expect(dayOutputs({ ...day, artifacts: ["  ", "x"] })).toHaveLength(1);
  });
});

// ─── Findings ───────────────────────────────────────────────────────────────

const finding = (over: Partial<DesignSprintOutput> = {}): DesignSprintOutput => ({
  id: "f1",
  kind: "finding",
  text: "Customers kept the starter basket",
  signal: "positive",
  seenIn: 4,
  ...over,
});

function openSendTo(name: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

const hypotheses = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === "hypothesisTracker:current")?.hypotheses ??
  [];

describe("Design Sprint: findings go on to hypotheses or the backlog", () => {
  it("sends a finding to the Hypothesis Tracker with a link back; Undo removes both", () => {
    setToday(23);
    store(withOutputs(makePlan(), 5, [finding()]));
    renderPage();
    openSendTo(/^Send to… Customers kept the starter basket/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Hypothesis to test" }));

    expect(hypotheses()).toEqual([
      expect.objectContaining({
        believe: "Customers kept the starter basket",
        toLearn: "Positive · seen in 4 of 5 interviews",
        status: "drafted",
        sourceRef: { tool: "design-sprint", id: "f1", doc: "p1" },
      }),
    ]);
    const [link] = storedDay(5).outputs![0].sentTo!;
    expect(link).toMatchObject({ route: "hypothesis", targetId: hypotheses()[0].id });
    expect(logged("finding_sent")).toEqual([
      expect.objectContaining({ sprintId: "p1", findingId: "f1", route: "hypothesis" }),
    ]);
    expect(screen.getByRole("link", { name: /Sent to the Hypothesis Tracker/ })).toHaveAttribute(
      "href",
      "/hypothesis-tracker"
    );
    expect(
      screen.getByText("Day 5 of 5 (Test): 0 of 4 tasks done, 1 finding.")
    ).toBeInTheDocument();

    const toast = lastToast();
    expect(toast.label).toBe("Added as a hypothesis");
    toast.undo();
    expect(hypotheses()).toEqual([]);
    expect(storedDay(5).outputs![0].sentTo).toEqual([]);
  });

  it("sends a finding to the backlog as a story", () => {
    setToday(23);
    store(withOutputs(makePlan(), 5, [finding({ signal: undefined, seenIn: undefined })]));
    renderPage();
    openSendTo(/^Send to… Customers kept the starter basket/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    expect(ws().stories).toEqual([
      expect.objectContaining({
        title: "Customers kept the starter basket",
        status: "backlog",
        sourceRef: { tool: "design-sprint", id: "f1", doc: "p1" },
      }),
    ]);
    expect(storedDay(5).outputs![0].sentTo).toEqual([
      expect.objectContaining({ route: "backlog-story", targetId: ws().stories[0].id }),
    ]);
  });

  it("adds a finding with an explicit 'Not judged' and an optional interview count", () => {
    setToday(23);
    store(makePlan());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add a finding" }));
    expect(screen.getByRole("radio", { name: "Not judged" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Finding/ }), {
      target: { value: "Fee came too late" },
    });
    fireEvent.change(screen.getByLabelText("Seen in"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Add finding" }));
    expect(screen.getByText(/whole number from 0 to 5/)).toBeInTheDocument();
    expect(storedDay(5).outputs).toEqual([]);

    fireEvent.change(screen.getByLabelText("Seen in"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "Negative" }));
    fireEvent.click(screen.getByRole("button", { name: "Add finding" }));
    const [saved] = storedDay(5).outputs!;
    expect(saved).toMatchObject({ kind: "finding", text: "Fee came too late", signal: "negative" });
    expect(saved).not.toHaveProperty("seenIn");
  });

  it("never sends the example's findings", () => {
    setToday(23);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getAllByText(/Customers/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Send to…/ })).not.toBeInTheDocument();
  });
});

// ─── Sprint questions ───────────────────────────────────────────────────────

describe("Design Sprint: Test day answers the sprint questions", () => {
  it("stores the answer on the Map day's question; Not answered clears it", () => {
    setToday(23);
    const q: DesignSprintOutput = {
      id: "q1",
      kind: "sprint-question",
      text: "Will they trust it?",
    };
    store(withOutputs(makePlan(), 1, [q]));
    renderPage();
    const group = screen.getByRole("radiogroup", { name: "Answer: Will they trust it?" });
    expect(within(group).getByRole("radio", { name: "Not answered" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(within(group).getByRole("radio", { name: "No" }));
    expect(storedDay(1).outputs![0].answer).toBe("no");
    fireEvent.click(within(group).getByRole("radio", { name: "Not answered" }));
    expect(storedDay(1).outputs![0]).not.toHaveProperty("answer");
  });

  it("points to Map day when there are no questions", () => {
    setToday(23);
    store(makePlan());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Open Map day" }));
    expect(dayButton(1)).toHaveAttribute("aria-pressed", "true");
  });
});

// ─── Tasks ──────────────────────────────────────────────────────────────────

describe("Design Sprint: tasks", () => {
  it("picks the owner from the roster and edits the text in place; adding to the team is a click", () => {
    setToday(21);
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Dev" }] });
    store(makePlan());
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit task: Art museum: post all sketches on the wall" })
    );
    expect(screen.getByRole("textbox", { name: /^Task/ })).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "Zed" } });
    expect(screen.getByText("“Zed” isn’t on the team.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /^Task/ }), {
      target: { value: "Art museum" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(storedDay(3).tasks[0]).toMatchObject({ text: "Art museum", owner: "Zed" });
    expect(ws().teamMembers).toEqual([{ id: "m1", name: "Dev" }]);
    expect(screen.getByRole("button", { name: "Edit task: Art museum" })).toHaveFocus();
    expect(logged("task_owner_assigned")).toEqual([
      expect.objectContaining({ day: 3, owner: "Zed" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Edit task: Art museum" }));
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Task/ }), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Describe the task.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /^Task/ }), {
      target: { value: "Art museum" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(storedDay(3).tasks[0]).not.toHaveProperty("owner");
  });

  it("adds a task only with text, and deletes one with Undo in its place", () => {
    setToday(21);
    store(makePlan());
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(screen.getByText("Describe the task.")).toBeInTheDocument();
    expect(storedDay(3).tasks).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("New task"), { target: { value: "Book the room" } });
    fireEvent.submit(screen.getByLabelText("New task").closest("form")!);
    expect(
      storedDay(3)
        .tasks.map((t) => t.text)
        .at(-1)
    ).toBe("Book the room");

    fireEvent.click(
      screen.getByRole("button", { name: "Delete task: Heat map: silent dot voting" })
    );
    expect(storedDay(3).tasks).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "Edit task: Speed critique of top sketches" })
    ).toHaveFocus();
    lastToast().undo();
    expect(storedDay(3).tasks[1].text).toBe("Heat map: silent dot voting");
  });
});

// ─── Reset, complete ────────────────────────────────────────────────────────

describe("Design Sprint: reset and complete", () => {
  it("asks before a reset and still offers Undo", () => {
    setToday(21);
    const plan = makePlan();
    store(plan);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("dialog", { name: "Reset the design sprint?" })).toBeVisible();
    expect(stored()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset sprint" }));
    expect(stored()).toBeNull();
    expect(screen.getByRole("button", { name: "Start sprint" })).toBeInTheDocument();
    const toast = lastToast();
    expect(toast.label).toBe("Reset the design sprint");
    toast.undo();
    expect(stored()).toEqual(plan);
    expect(logged("sprint_reset")).toHaveLength(1);
  });

  it("Complete can be undone, and Reopen clears it later", () => {
    setToday(23);
    store(withOutputs(makePlan(), 5, [finding({ sentTo: [] })]));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Complete sprint" }));
    expect(stored()!.completedAt).toEqual(expect.any(String));
    expect(screen.getByText("Finished: 1 finding, none sent on yet.")).toBeInTheDocument();
    lastToast().undo();
    expect(stored()).not.toHaveProperty("completedAt");

    fireEvent.click(screen.getByRole("button", { name: "Complete sprint" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(stored()).not.toHaveProperty("completedAt");
    expect(logged("sprint_completed")).toHaveLength(2);
  });
});

// ─── Example ────────────────────────────────────────────────────────────────

describe("Design Sprint: the example", () => {
  it("loads on Test day from the empty state and clears with Undo", () => {
    setToday(23);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored()!.id).toBe(EXAMPLE_PLAN_ID);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText("Day 5 of 5 (Test): 3 of 4 tasks done, 4 findings.")
    ).toBeInTheDocument();
    // Its names are never offered for the team.
    fireEvent.click(screen.getByRole("button", { name: "Edit sprint details" }));
    expect(screen.queryByRole("button", { name: /Add to the team/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored()).toBeNull();
    lastToast().undo();
    expect(stored()!.id).toBe(EXAMPLE_PLAN_ID);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("starts four working days before today, so today is Test day (or over on a day off)", () => {
    expect(exampleStartDate("2026-10-23")).toBe("2026-10-19");
    expect(exampleStartDate("2026-10-21")).toBe("2026-10-15");
    expect(designSprintToday(exampleStartDate("2026-10-21"), "2026-10-21").day).toBe(5);
    expect(designSprintToday(exampleStartDate("2026-10-24"), "2026-10-24").status).toBe("over");
    const plan = buildExample("2026-10-23");
    const ids = [
      plan.id,
      ...plan.days.flatMap((d) => [...d.tasks.map((t) => t.id), ...d.outputs!.map((o) => o.id)]),
    ];
    expect(ids.every((id) => id.startsWith("example-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Verdict, Markdown ──────────────────────────────────────────────────────

describe("Design Sprint: verdict and Markdown", () => {
  const t = (start: string, today: string) => designSprintToday(start, today);

  it("says where the sprint stands in one sentence", () => {
    const plan = makePlan();
    expect(designSprintVerdict(plan, t("2026-10-19", "2026-10-19"))).toBe(
      "Day 1 of 5 (Map): 0 of 6 tasks done, no long-term goal yet."
    );
    const goal = withOutputs(plan, 1, [{ id: "g", kind: "long-term-goal", text: "g" }]);
    expect(designSprintVerdict(goal, t("2026-10-19", "2026-10-19"))).toBe(
      "Day 1 of 5 (Map): 0 of 6 tasks done, goal set, no target picked yet."
    );
    expect(designSprintVerdict(plan, t("2026-10-26", "2026-10-23"))).toBe(
      "Starts Monday 26 Oct, the next working day."
    );
    expect(designSprintVerdict(plan, t("not a date", "2026-10-23"))).toBe(
      "Set a valid start date to place the five days."
    );
    const sent = withOutputs(plan, 5, [
      finding({ sentTo: [{ route: "hypothesis", targetId: "h", at: "" }] }),
      finding({ id: "f2", sentTo: [{ route: "backlog-story", targetId: "s", at: "" }] }),
      finding({ id: "f3" }),
    ]);
    expect(designSprintVerdict({ ...sent, completedAt: "x" }, t("2026-10-19", "2026-10-30"))).toBe(
      "Finished: 3 findings, 1 sent to the Hypothesis Tracker and 1 to the backlog."
    );
    expect(designSprintVerdict(sent, t("2026-10-19", "2026-10-30"))).toBe(
      "All five days are over: 3 findings, 1 sent to the Hypothesis Tracker and 1 to the backlog."
    );
    expect(designSprintVerdict({ ...plan, completedAt: "x" }, t("2026-10-19", "2026-10-30"))).toBe(
      "Finished, with no findings recorded."
    );
  });

  it("exports the days, tasks, outputs, findings and answers", () => {
    const plan = buildExample("2026-10-23");
    const md = toMarkdown(plan, t(plan.startDate, "2026-10-23"));
    expect(md).toContain("# Design sprint: Faster first order");
    expect(md).toContain("Mon 19 Oct – Fri 23 Oct 2026 · Day 5 of 5 · Test");
    expect(md).toContain("Decider: Amira · Facilitator: Ben");
    expect(md).toContain("**Day 5 of 5 (Test): 3 of 4 tasks done, 4 findings.**");
    expect(md).toContain("## Day 1 · Map — Mon 19 Oct");
    expect(md).toContain("- [x] Set the long-term goal — Amira");
    expect(md).toContain(
      "- Clickable prototype: starter basket to checkout — <https://example.com/prototypes/starter-basket>"
    );
    expect(md).toContain("| Finding | Signal | Seen in | Sent to |");
    expect(md).toContain(
      "| Customers looked for the delivery fee before they would enter card details. | Negative | 5 of 5 | — |"
    );
    expect(md).toContain("| Will they enter card details before they see the delivery fee? | No |");
    // A day's empty notes are left out; an empty slot says so.
    expect(md).not.toContain("**Notes**");
    const blank = toMarkdown(makePlan(), t("2026-10-19", "2026-10-21"));
    expect(blank).toContain("_Not decided yet._");
    expect(blank).toContain("_No findings yet._");
  });

  it("hands the export the Markdown for the plan on screen", () => {
    setToday(21);
    store(makePlan());
    renderPage();
    expect(exported.markdown).toContain("# Design sprint: Checkout");
    expect(exported.markdown).toContain("**Day 3 of 5 (Decide)");
  });
});

// ─── Older and odd data ─────────────────────────────────────────────────────

describe("Design Sprint: older and partial data", () => {
  it("loads a sprint an agent started (empty days, no outputs, no description)", () => {
    setToday(21);
    store({
      id: "agent",
      name: "From an agent",
      startDate: "2026-10-19",
      currentDay: 1,
      days: (["Map", "Sketch", "Decide", "Prototype", "Test"] as const).map((dayName, i) => ({
        day: (i + 1) as DesignSprintDay["day"],
        dayName,
        tasks: [],
        artifacts: [],
      })),
    });
    renderPage();
    expect(
      screen.getByText("Day 3 of 5 (Decide): no tasks, no decision recorded yet.")
    ).toBeInTheDocument();
    expect(screen.getByText("No tasks for this day.")).toBeInTheDocument();
  });

  it("fills in a missing day for reading and adds it on write", () => {
    const plan = makePlan();
    const gappy = { ...plan, days: plan.days.filter((d) => d.day !== 4) };
    expect(planDays(gappy).map((d) => d.dayName)).toEqual([
      "Map",
      "Sketch",
      "Decide",
      "Prototype",
      "Test",
    ]);
    const written = updateDay(gappy, 4, (d) => ({
      ...d,
      outputs: [{ id: "x", kind: "prototype", text: "p" }],
    }));
    expect(written.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
    expect(written.days[3].outputs).toHaveLength(1);
  });

  it("builds the shared default days for the page and the agent", () => {
    const days = buildDesignSprintDays(seq("x"));
    expect(days.map((d) => d.tasks.length)).toEqual([6, 4, 5, 4, 4]);
    expect(days.every((d) => d.artifacts.length === 0 && d.outputs!.length === 0)).toBe(true);
    const plan = newDesignSprintPlan({ name: "N", startDate: "2026-10-19", description: "" });
    expect(plan).not.toHaveProperty("description");
    expect(plan.currentDay).toBe(1);
  });
});
