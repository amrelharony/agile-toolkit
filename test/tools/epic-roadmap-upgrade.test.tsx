import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Epic, Story } from "@/lib/stores/workspace-types";

/**
 * Epic Roadmap against the tool UX contract: epics get real start and end
 * quarters (picked, in order), an owner and a theme colour; progress rolls
 * up from linked stories with the typed figure as a labelled fallback; the
 * projected-progress regression is gone; removing an epic offers Undo; and
 * there is an example, a verdict and a Markdown export.
 *
 * "Now" is fixed at 23 Oct 2026, so the current quarter is 2026 Q4.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { EpicRoadmapClient } from "@/app/(tools)/epic-roadmap/epic-roadmap-client";
import { EXAMPLE_STORIES, buildExample } from "@/app/(tools)/epic-roadmap/example";
import { toMarkdown } from "@/app/(tools)/epic-roadmap/markdown";
import { newEpicDraft, validateEpic } from "@/app/(tools)/epic-roadmap/epic-form";
import { EPIC_COLORS, colorName, epicColorKey, nextColor } from "@/lib/roadmap/palette";
import {
  MAX_QUARTERS_SPAN,
  currentQuarter,
  normalizeQuarter,
  quarterIndex,
  quarterLabel,
  quarterOptions,
  quartersBetween,
  shiftQuarter,
} from "@/lib/roadmap/quarters";
import { epicRollup, epicSchedule, rollupLabel, typedProgress } from "@/lib/roadmap/rollup";
import { barGeometry } from "@/app/(tools)/epic-roadmap/timeline";
import {
  epicName,
  epicViews,
  fitRange,
  placementCounts,
  roadmapVerdict,
} from "@/app/(tools)/epic-roadmap/view";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

const NOW = new Date("2026-10-23T12:00:00Z");
const ER_ID = "epicRoadmap:current";

const epic = (
  id: string,
  title: string,
  start: string,
  end: string,
  extra: Partial<Epic> = {}
): Epic => ({
  id,
  title,
  startQuarter: start,
  endQuarter: end,
  progress: 0,
  ...extra,
});
const story = (id: string, status: Story["status"], points?: number, epicId?: string): Story => ({
  id,
  title: `Story ${id}`,
  status,
  ...(points === undefined ? {} : { points }),
  ...(epicId ? { epicId } : {}),
});

const epics = () =>
  (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === ER_ID)?.epics ?? [];
const stories = () => useWorkspaceStore.getState().stories;
const setEpics = (list: Epic[]) =>
  useWorkspaceStore.setState({ epicRoadmaps: [{ id: ER_ID, epics: list }] });
const renderRoadmap = () =>
  render(
    <TooltipProvider>
      <EpicRoadmapClient />
    </TooltipProvider>
  );
const addForm = () => screen.getByRole("button", { name: "Add epic" }).closest("form")!;
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  toastSpy.mockReset();
  useWorkspaceStore.setState({
    epicRoadmaps: [],
    stories: [],
    teamMembers: [],
    pokerEstimationLogs: [],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Epic Roadmap first run", () => {
  it("loads the example around today, rolls it up from preview stories, and clears it", () => {
    renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(epics().map((e) => e.id)).toEqual([
      "example-epic-audit",
      "example-epic-onboarding",
      "example-epic-billing",
      "example-epic-offline",
    ]);
    expect(epics()[0]).toMatchObject({ startQuarter: "2026 Q2", endQuarter: "2026 Q3" });
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    // The audit log ended last quarter at 8 of 10 points.
    expect(
      screen.getByText("“Audit log for admins” is past its end quarter (2026 Q3) at 80%.")
    ).toBeInTheDocument();
    expect(screen.getByText("16 of 24 points done")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 stories done")).toBeInTheDocument();
    expect(screen.getByText("Typed: no stories linked")).toBeInTheDocument();
    // The preview stories never reach the workspace.
    expect(stories()).toEqual([]);

    // An example epic's stories are read-only.
    fireEvent.click(screen.getByRole("button", { name: /^Stories \(3\) in Audit log/ }));
    const panel = screen.getByRole("list", { name: "Stories in Audit log for admins" });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Link story" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Unlink/ })).not.toBeInTheDocument();

    act(() => setEpics([...epics(), epic("mine", "Mine", "2026 Q4", "2026 Q4")]));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(epics().map((e) => e.id)).toEqual(["mine"]);
  });

  it("drops the projected-progress regression", () => {
    setEpics([
      epic("a", "A", "2026 Q1", "2026 Q1", { progress: 70 }),
      epic("b", "B", "2026 Q2", "2026 Q2", { progress: 50 }),
    ]);
    renderRoadmap();
    expect(screen.queryByText(/Projected progress/)).not.toBeInTheDocument();
  });
});

describe("Epic Roadmap add form", () => {
  it("starts on this quarter only and saves nothing without a name", () => {
    renderRoadmap();
    const form = addForm();
    expect(within(form).getByLabelText(/^Start quarter/)).toHaveValue("2026 Q4");
    expect(within(form).getByLabelText(/^End quarter/)).toHaveValue("2026 Q4");
    expect(within(form).getByRole("radio", { name: "Blue" })).toBeChecked();

    fireEvent.click(within(form).getByRole("button", { name: "Add epic" }));
    expect(epics()).toEqual([]);
    expect(within(form).getByText("Name the epic.")).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Epic/)).toHaveFocus();

    fireEvent.change(within(form).getByLabelText(/^Epic/), { target: { value: " Billing v2 " } });
    fireEvent.click(within(form).getByRole("button", { name: "Add epic" }));
    expect(epics()).toHaveLength(1);
    expect(epics()[0]).toMatchObject({
      title: "Billing v2",
      startQuarter: "2026 Q4",
      endQuarter: "2026 Q4",
      progress: 0,
      color: "chart-1",
    });
    expect(epics()[0]).not.toHaveProperty("owner");
    // The next draft is blank again, on the next unused colour.
    expect(within(form).getByLabelText(/^Epic/)).toHaveValue("");
    expect(within(form).getByRole("radio", { name: "Pink" })).toBeChecked();
  });

  it("takes picked quarters, an owner and a colour, and rejects an end before the start", () => {
    renderRoadmap();
    const form = addForm();
    fireEvent.change(within(form).getByLabelText(/^Epic/), { target: { value: "Mobile" } });
    fireEvent.change(within(form).getByLabelText(/^Start quarter/), {
      target: { value: "2027 Q2" },
    });
    fireEvent.change(within(form).getByLabelText(/^End quarter/), { target: { value: "2027 Q1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add epic" }));
    expect(epics()).toEqual([]);
    expect(
      within(form).getByText("End on or after the start quarter (2027 Q2).")
    ).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText(/^End quarter/), { target: { value: "2027 Q3" } });
    fireEvent.change(within(form).getByLabelText(/^Owner/), { target: { value: "Priya" } });
    fireEvent.click(within(form).getByRole("radio", { name: "Green" }));
    fireEvent.click(within(form).getByRole("button", { name: "Add epic" }));
    expect(epics()[0]).toMatchObject({
      title: "Mobile",
      startQuarter: "2027 Q2",
      endQuarter: "2027 Q3",
      owner: "Priya",
      color: "chart-3",
    });
    // Typing a name never adds them to the team.
    expect(useWorkspaceStore.getState().teamMembers).toEqual([]);
  });
});

describe("Epic Roadmap editing", () => {
  it("edits quarters, owner, colour and typed progress in place", () => {
    setEpics([
      epic("a", "Alpha", "2026 Q1", "2026 Q2", { color: "#a855f7", progress: 45.5 }),
      epic("b", "Beta", "2026 Q3", "2026 Q4"),
    ]);
    renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    expect(within(editor).getByLabelText(/^Epic/)).toHaveFocus();
    // The old hex colour reads as its theme token; a stored 45.5 stays 45.5.
    expect(within(editor).getByRole("radio", { name: "Violet" })).toBeChecked();
    expect(within(editor).getByLabelText(/^Progress, typed/)).toHaveValue(45.5);

    fireEvent.change(within(editor).getByLabelText(/^Progress, typed/), {
      target: { value: "" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(within(editor).getByText("Enter the progress, 0 to 100.")).toBeInTheDocument();

    fireEvent.change(within(editor).getByLabelText(/^Progress, typed/), {
      target: { value: "60" },
    });
    fireEvent.change(within(editor).getByLabelText(/^End quarter/), {
      target: { value: "2027 Q1" },
    });
    fireEvent.change(within(editor).getByLabelText(/^Owner/), { target: { value: "Sam" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(epics()[0]).toMatchObject({
      endQuarter: "2027 Q1",
      owner: "Sam",
      progress: 60,
      color: "chart-5",
    });
    expect(screen.getByText("60%", { selector: "p" })).toBeInTheDocument();
  });

  it("makes a stored quarter it can't read be picked again before saving", () => {
    setEpics([epic("old", "Old", "next spring", "2026 Q4", { color: "javascript:alert(1)" })]);
    renderRoadmap();
    expect(screen.getByText(/1 epic has no valid quarters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Old" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    expect(within(editor).getByLabelText(/^Start quarter/)).toHaveValue("");
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(within(editor).getByText("Pick a start quarter.")).toBeInTheDocument();
    expect(epics()[0].startQuarter).toBe("next spring");
  });

  it("keeps the list in place while dates change, until Re-sort", () => {
    setEpics([epic("a", "Alpha", "2026 Q1", "2026 Q1"), epic("b", "Beta", "2026 Q2", "2026 Q2")]);
    renderRoadmap();
    const names = () =>
      within(screen.getByRole("list", { name: "Epics, earliest start first" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.change(within(editor).getByLabelText(/^Start quarter/), {
      target: { value: "2026 Q3" },
    });
    fireEvent.change(within(editor).getByLabelText(/^End quarter/), {
      target: { value: "2026 Q3" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(names()[0]).toContain("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(names()[0]).toContain("Beta");
  });
});

describe("Epic Roadmap stories", () => {
  beforeEach(() => {
    setEpics([epic("e1", "Onboarding", "2026 Q4", "2027 Q1", { progress: 90 })]);
    useWorkspaceStore.setState({
      stories: [story("s1", "done", 3), story("s2", "todo", 5), story("s3", "backlog")],
    });
  });

  it("links and unlinks backlog stories, rolling progress up from them", () => {
    renderRoadmap();
    expect(screen.getByText("90%", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Typed: no stories linked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Stories \(0\) in Onboarding/ }));
    const link = (id: string) => {
      fireEvent.change(screen.getByLabelText(/^Link a story/), { target: { value: id } });
      fireEvent.click(screen.getByRole("button", { name: "Link story" }));
    };
    // Nothing picked: an inline error, not a silent no-op.
    fireEvent.click(screen.getByRole("button", { name: "Link story" }));
    expect(screen.getByText("Pick a story to link.")).toBeInTheDocument();

    link("s1");
    link("s2");
    expect(
      stories()
        .filter((s) => s.epicId === "e1")
        .map((s) => s.id)
    ).toEqual(["s1", "s2"]);
    expect(screen.getByText("3 of 8 points done")).toBeInTheDocument();
    expect(screen.getByText("38%", { selector: "p" })).toBeInTheDocument();

    // An unestimated story switches the roll-up to story count.
    link("s3");
    expect(screen.getByText("1 of 3 stories done")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unlink Story s3" }));
    expect(stories().find((s) => s.id === "s3")).not.toHaveProperty("epicId");
    expect(lastToast()[0]).toBe("Unlinked “Story s3”");
    undoLast();
    expect(stories().find((s) => s.id === "s3")?.epicId).toBe("e1");
  });

  it("queues the epic's unestimated stories for Planning Poker, with Undo", () => {
    useWorkspaceStore.setState({
      stories: [
        story("s1", "done", 3, "e1"),
        story("s3", "backlog", undefined, "e1"),
        story("s4", "todo", undefined, "e1"),
        // Another epic's unsized story stays out of it.
        story("s5", "todo", undefined, "e9"),
      ],
      // s4 is already waiting from Sprint Planning.
      pokerEstimationLogs: [
        {
          id: POKER_LOG_ID,
          estimates: [],
          queue: [
            { id: "q0", title: "Story s4", sourceRef: { tool: "story", id: "s4" }, queuedAt: "" },
          ],
        },
      ],
    });
    const queue = () =>
      (useWorkspaceStore.getState().pokerEstimationLogs ?? []).find((d) => d.id === POKER_LOG_ID)
        ?.queue ?? [];
    renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: /^Stories \(3\) in Onboarding/ }));
    expect(screen.getByText("1 queued.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Queue 1 for Planning Poker" }));

    // Only the waiting story goes, as a story the accepted estimate writes back to.
    expect(queue().map((q) => q.sourceRef)).toEqual([
      { tool: "story", id: "s4" },
      { tool: "story", id: "s3" },
    ]);
    expect(queue()[1].title).toBe("Story s3");
    expect(lastToast()[0]).toBe("1 story queued for Planning Poker");
    expect(screen.queryByRole("button", { name: /^Queue \d+ for Planning Poker/ })).toBeNull();
    const open = screen.getByRole("link", { name: "Open Planning Poker" });
    expect(open).toHaveAttribute("href", "/planning-poker");
    expect(open).toHaveFocus();
    expect(screen.getByText(/All queued for estimation\./)).toBeInTheDocument();

    undoLast();
    expect(queue().map((q) => q.id)).toEqual(["q0"]);
    expect(screen.getByRole("button", { name: "Queue 1 for Planning Poker" })).toBeInTheDocument();
  });

  it("deletes an epic with Undo, unlinking its stories and relinking them on Undo", () => {
    useWorkspaceStore.setState({
      stories: [story("s1", "done", 3, "e1"), story("s2", "todo", 5, "e1")],
    });
    setEpics([epic("e0", "First", "2026 Q1", "2026 Q1"), ...epics()]);
    renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "Delete Onboarding" }));
    expect(epics().map((e) => e.id)).toEqual(["e0"]);
    expect(stories().every((s) => s.epicId === undefined)).toBe(true);
    const [label, opts] = lastToast();
    expect(label).toBe("Deleted “Onboarding”");
    expect(opts.description).toBe("2 linked stories unlinked; they stay where they are.");

    undoLast();
    expect(epics().map((e) => e.id)).toEqual(["e0", "e1"]);
    expect(stories().map((s) => s.epicId)).toEqual(["e1", "e1"]);
  });
});

describe("Epic Roadmap view range", () => {
  it("fits the epics, takes picked quarters, flags a reversed range, and fits again", () => {
    setEpics([epic("a", "Alpha", "2026 Q3", "2027 Q2"), epic("b", "Beta", "2028 Q1", "2028 Q2")]);
    renderRoadmap();
    expect(screen.getByLabelText(/^View from/)).toHaveValue("2026 Q3");
    expect(screen.getByLabelText(/^View to/)).toHaveValue("2028 Q2");

    fireEvent.change(screen.getByLabelText(/^View to/), { target: { value: "2027 Q4" } });
    expect(screen.getByText(/1 epic falls outside this view\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^View to/), { target: { value: "2026 Q1" } });
    expect(screen.getByText("End the view on or after its start.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fit to epics" }));
    expect(screen.getByLabelText(/^View to/)).toHaveValue("2028 Q2");
    expect(screen.queryByRole("button", { name: "Fit to epics" })).not.toBeInTheDocument();
  });
});

describe("Epic Roadmap logic", () => {
  it("round-trips quarters, Q4 included, and rejects junk", () => {
    expect(quarterLabel(quarterIndex("2026 Q4"))).toBe("2026 Q4");
    expect(normalizeQuarter("2026q1")).toBe("2026 Q1");
    expect(normalizeQuarter("0 Q1")).toBe("");
    expect(normalizeQuarter("9999 Q1")).toBe("");
    expect(normalizeQuarter(undefined)).toBe("");
    expect(currentQuarter(NOW)).toBe("2026 Q4");
    expect(shiftQuarter("2026 Q4", 1)).toBe("2027 Q1");
    expect(shiftQuarter("2026 Q1", -1)).toBe("2025 Q4");
    expect(quartersBetween("2026 Q3", "2027 Q1")).toEqual(["2026 Q3", "2026 Q4", "2027 Q1"]);
    expect(quartersBetween("2027 Q1", "2026 Q1")).toEqual([]);
    expect(quartersBetween("2000 Q1", "2100 Q4")).toHaveLength(MAX_QUARTERS_SPAN);
  });

  it("offers this year's neighbours plus the years of stored quarters, not the gap", () => {
    const options = quarterOptions(NOW, ["1990 Q2", "garbage"]);
    expect(options.slice(0, 4)).toEqual(["1990 Q1", "1990 Q2", "1990 Q3", "1990 Q4"]);
    expect(options[4]).toBe("2024 Q1");
    expect(options[options.length - 1]).toBe("2031 Q4");
    expect(options).toHaveLength(4 + 8 * 4);
  });

  it("validates a draft instead of defaulting it", () => {
    const draft = newEpicDraft("chart-1", NOW);
    expect(validateEpic(draft)).toEqual({ ok: false, errors: { title: "Name the epic." } });
    expect(
      validateEpic({ ...draft, title: "x", startQuarter: "", endQuarter: "", color: "" })
    ).toEqual({
      ok: false,
      errors: {
        startQuarter: "Pick a start quarter.",
        endQuarter: "Pick an end quarter.",
        color: "Pick a colour.",
      },
    });
    expect(
      validateEpic({ ...draft, title: "x", startQuarter: "2020 Q1", endQuarter: "2030 Q4" })
    ).toMatchObject({ ok: false, errors: { endQuarter: "An epic can span at most 10 years." } });
    expect(
      validateEpic({ ...draft, title: "x", progress: "120" }, { withProgress: true })
    ).toMatchObject({
      ok: false,
      errors: { progress: "Progress runs from 0 to 100." },
    });
    expect(
      validateEpic(
        { ...draft, title: " x ", owner: "  ", description: " d " },
        { withProgress: false }
      )
    ).toEqual({
      ok: true,
      values: {
        title: "x",
        startQuarter: "2026 Q4",
        endQuarter: "2026 Q4",
        color: "chart-1",
        description: "d",
      },
    });
  });

  it("rolls progress up by points, by count while any story is unestimated, else typed", () => {
    expect(epicRollup({ progress: 140 }, [])).toMatchObject({ source: "typed", pct: 100 });
    expect(typedProgress("junk")).toBe(0);
    expect(typedProgress(-5)).toBe(0);
    expect(
      epicRollup({ progress: 0 }, [story("a", "done", 3), story("b", "review", 5)])
    ).toMatchObject({ source: "stories", basis: "points", pct: 38, points: 8, donePoints: 3 });
    expect(
      epicRollup({ progress: 90 }, [story("a", "done", 13), story("b", "todo")])
    ).toMatchObject({ basis: "count", pct: 50, unestimated: 1 });
    // All estimated at zero points: count, never a divide by zero.
    expect(
      epicRollup({ progress: 0 }, [story("a", "done", 0), story("b", "todo", 0)])
    ).toMatchObject({ basis: "count", pct: 50 });
    expect(
      epicRollup({ progress: 0 }, [story("a", "done", 1e9), story("b", "done", 1e9)])
    ).toMatchObject({ basis: "points", pct: 100 });
  });

  it("reads Done only when the work is done, never from a rounded 100%", () => {
    // 199 of 200 points rounds to 100%; it shows 99% and stays open.
    const nearly = epicRollup({ progress: 0 }, [story("a", "done", 199), story("b", "todo", 1)]);
    expect(nearly).toMatchObject({ basis: "points", pct: 99, done: false });
    // An open 0-point chore leaves the points at 100%, but a story is still open.
    const chore = epicRollup({ progress: 0 }, [
      story("a", "done", 5),
      story("b", "done", 3),
      story("c", "todo", 0),
    ]);
    expect(chore).toMatchObject({ basis: "points", pct: 99, done: false });
    expect(rollupLabel(chore)).toBe("8 of 8 points done, 1 story still open");
    // By count, 199 of 200 stories also rounds up without being done.
    const many = [
      ...Array.from({ length: 199 }, (_, i) => story(`d${i}`, "done")),
      story("open", "todo"),
    ];
    expect(epicRollup({ progress: 0 }, many)).toMatchObject({ pct: 99, done: false });
    // Typed: the unrounded value decides.
    expect(epicRollup({ progress: 99.6 }, [])).toMatchObject({ pct: 99, done: false });
    expect(epicRollup({ progress: 100 }, [])).toMatchObject({ pct: 100, done: true });
    expect(epicRollup({ progress: "junk" as unknown as number }, [])).toMatchObject({
      pct: 0,
      done: false,
    });
    expect(epicRollup({ progress: 0 }, [story("a", "done", 2), story("b", "done")])).toMatchObject({
      pct: 100,
      done: true,
    });

    const views = epicViews(
      [epic("a", "A", "2026 Q1", "2026 Q2")],
      [story("s", "done", 5, "a"), story("t", "done", 3, "a"), story("u", "todo", 0, "a")],
      NOW
    );
    expect(views[0].schedule).toBe("overdue");
    expect(roadmapVerdict(views)).toBe("“A” is past its end quarter (2026 Q2) at 99%.");
  });

  it("knows where each epic stands against its quarters", () => {
    const e = (s: string, f: string) => ({ startQuarter: s, endQuarter: f });
    expect(epicSchedule(e("2026 Q1", "2026 Q3"), false, NOW)).toBe("overdue");
    expect(epicSchedule(e("2026 Q1", "2026 Q3"), true, NOW)).toBe("done");
    expect(epicSchedule(e("2026 Q3", "2026 Q4"), false, NOW)).toBe("ending");
    expect(epicSchedule(e("2026 Q4", "2027 Q1"), false, NOW)).toBe("in-progress");
    expect(epicSchedule(e("2027 Q1", "2027 Q2"), false, NOW)).toBe("upcoming");
    expect(epicSchedule(e("soon", "2027 Q2"), false, NOW)).toBe("unscheduled");
  });

  it("gives a one-sentence verdict", () => {
    const v = (list: Epic[], s: Story[] = []) => roadmapVerdict(epicViews(list, s, NOW));
    expect(v([])).toBe("No epics on the roadmap yet.");
    expect(v([epic("a", "A", "2026 Q1", "2026 Q2"), epic("b", "B", "2026 Q1", "2026 Q3")])).toBe(
      "2 epics are past their end quarter and not done: “A” and “B”."
    );
    expect(v([epic("a", "A", "2026 Q3", "2026 Q4", { progress: 40 })])).toBe(
      "“A” ends this quarter at 40%."
    );
    expect(
      v([
        epic("a", "A", "2027 Q1", "2027 Q3", { progress: 10 }),
        epic("b", "B", "2026 Q4", "2027 Q2", { progress: 30 }),
      ])
    ).toBe("No epic is overdue; next to finish is “B” in 2027 Q2, at 30%.");
    expect(
      v(
        [epic("a", "A", "2026 Q1", "2026 Q1"), epic("b", "B", "2026 Q2", "2026 Q2")],
        [story("s", "done", 2, "a"), story("t", "done", 2, "b")]
      )
    ).toBe("All 2 epics are done.");
    expect(v([epic("a", "A", "x", "y")])).toBe("1 epic still needs valid quarters.");
  });

  it("maps legacy hex to theme tokens and never passes a stored colour through", () => {
    expect(epicColorKey({ color: "#00F0FF" }, 3)).toBe("chart-1");
    expect(epicColorKey({ color: "chart-4" }, 0)).toBe("chart-4");
    expect(epicColorKey({ color: "red;background:url(x)" }, 1)).toBe("chart-2");
    expect(epicColorKey({}, 7)).toBe("chart-1");
    expect(nextColor([{ color: "chart-1" }, { color: "#f472b6" }])).toBe("chart-3");
  });

  it("places bars in the view and fills them along the whole epic", () => {
    const view = (s: string, f: string, pct: number) => ({
      epic: epic("x", "X", s, f),
      rollup: { ...epicRollup({ progress: pct }, []) },
    });
    const start = quarterIndex("2026 Q1");
    expect(barGeometry(view("2026 Q2", "2026 Q3", 50), start, 4)).toEqual({
      start: 1,
      span: 2,
      fill: 50,
      clippedStart: false,
      clippedEnd: false,
    });
    // Starts a year before the view at 50%: half of 8 quarters is already behind the view's start.
    expect(barGeometry(view("2025 Q1", "2026 Q4", 50), start, 4)).toMatchObject({
      start: 0,
      span: 4,
      fill: 0,
      clippedStart: true,
    });
    expect(barGeometry(view("2025 Q1", "2026 Q4", 75), start, 4)?.fill).toBe(50);
    expect(barGeometry(view("2027 Q1", "2027 Q2", 0), start, 4)).toBeNull();
    expect(barGeometry(view("junk", "2026 Q2", 0), start, 4)).toBeNull();
  });

  it("fits the view to the epics, at least a year wide", () => {
    expect(fitRange([], NOW)).toEqual({ from: "2026 Q1", to: "2026 Q4" });
    expect(fitRange([epic("a", "A", "2026 Q3", "2026 Q3")], NOW)).toEqual({
      from: "2026 Q3",
      to: "2027 Q2",
    });
    expect(
      fitRange([epic("a", "A", "2026 Q3", "2028 Q1"), epic("b", "B", "bad", "2030 Q1")], NOW)
    ).toEqual({ from: "2026 Q3", to: "2028 Q1" });
  });

  it("exports a Markdown table with progress sources and the verdict", () => {
    const md = toMarkdown(epicViews(buildExample(NOW), [], NOW), NOW);
    expect(md).toContain("# Epic Roadmap — 23 Oct 2026");
    expect(md).toContain(
      "| Audit log for admins | 2026 Q2 | 2026 Q3 | Priya | 80% | 8 of 10 points done | Past its end quarter |"
    );
    expect(md).toContain(
      "| Mobile offline mode | 2027 Q1 | 2027 Q2 | Lee | 10% | Typed | Upcoming |"
    );
    expect(md).toContain("**“Audit log for admins” is past its end quarter (2026 Q3) at 80%.**");
    expect(toMarkdown([], NOW)).toContain("No epics on the roadmap yet.");
    expect(EXAMPLE_STORIES.every((s) => s.id.startsWith("example-"))).toBe(true);
  });

  it("counts epics without valid quarters from the quarters, even when they are done", () => {
    const views = epicViews(
      [
        epic("old", "Old", "next spring", "later", { progress: 100 }),
        epic("late", "Late", "2025 Q1", "2025 Q2"),
        epic("now", "Now", "2026 Q4", "2026 Q4"),
      ],
      [],
      NOW
    );
    expect(views[0].schedule).toBe("done");
    expect(placementCounts(views, "2026 Q1", "2026 Q4")).toEqual({ outside: 1, unplaced: 1 });
    expect(placementCounts([], "2026 Q1", "2026 Q4")).toEqual({ outside: 0, unplaced: 0 });
  });
});

describe("Epic Roadmap legacy and edge cases on the page", () => {
  it("tells a finished epic with unreadable quarters to get quarters, not to change the view", () => {
    setEpics([
      epic("old", "Old", "next spring", "later", { progress: 100 }),
      epic("a", "Alpha", "2026 Q4", "2026 Q4"),
    ]);
    renderRoadmap();
    expect(screen.getByText("1 epic has no valid quarters: edit to place it.")).toBeInTheDocument();
    expect(screen.queryByText(/outside this view/)).not.toBeInTheDocument();
  });

  it("names an epic with a blank title everywhere it is shown or announced", () => {
    setEpics([epic("u", "   ", "2026 Q4", "2026 Q4")]);
    renderRoadmap();
    expect(screen.getByRole("button", { name: /^Stories \(0\) in Untitled epic/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit Untitled epic" })).toBeVisible();
    // The list row and the timeline row.
    expect(screen.getAllByText("Untitled epic")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete Untitled epic" }));
    expect(lastToast()[0]).toBe("Deleted “Untitled epic”");

    const md = toMarkdown(epicViews([epic("u", "", "2026 Q4", "2026 Q4")], [], NOW), NOW);
    expect(md).toContain("| Untitled epic | 2026 Q4 | 2026 Q4 |");
    expect(md).toContain("**“Untitled epic” ends this quarter at 0%.**");
    expect(epicName({ title: "  Billing  " })).toBe("Billing");
  });

  it("keeps bar labels under the pinned names when the timeline scrolls sideways", () => {
    setEpics([epic("a", "Alpha", "2026 Q4", "2027 Q1")]);
    renderRoadmap();
    const label = screen.getByText("0%", { selector: "span" });
    // The bar is its own stacking context, so the label's z-10 can't rise above the names.
    const bar = label.closest(".isolate");
    expect(bar).toHaveClass("relative", "overflow-hidden");
    const name = screen.getAllByText("Alpha").find((el) => el.closest(".sticky"));
    expect(name?.closest(".sticky")).toHaveClass("z-10");
  });
});

describe("Epic Roadmap colours", () => {
  // The theme blocks of globals.css: dark is :root, light and high contrast override it.
  const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
  const block = (selector: string): Record<string, string> => {
    const at = css.indexOf(`${selector} {`);
    const body = css.slice(at, css.indexOf("}", at));
    return Object.fromEntries(
      Array.from(body.matchAll(/--([\w-]+):\s*([^;]+);/g), (m) => [m[1], m[2].trim()])
    );
  };
  const dark = block(":root");
  const themes = {
    dark,
    light: { ...dark, ...block('[data-theme="light"]') },
    hc: { ...dark, ...block('[data-theme="hc"]') },
  };
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));

  it.each(Object.entries(themes))("keeps every swatch distinct in the %s theme", (_, vars) => {
    const values = EPIC_COLORS.map((c) => vars[c.key]);
    values.forEach((v) => expect(v).toMatch(/^#[0-9a-f]{6}$/i));
    // A plain RGB distance: the old "Indigo" (accent2) sat 34 from chart-3's
    // green in high contrast, and 41 from chart-5's violet in dark.
    for (let i = 0; i < values.length; i++)
      for (let j = i + 1; j < values.length; j++)
        expect(distance(values[i], values[j])).toBeGreaterThan(50);
  });

  it("maps the old indigo (and its brief accent2 key) to a colour of its own", () => {
    expect(EPIC_COLORS.map((c) => c.key)).not.toContain("accent2");
    expect(epicColorKey({ color: "#6366F1" }, 0)).toBe("sub");
    expect(epicColorKey({ color: "accent2" }, 0)).toBe("sub");
    expect(colorName("sub")).toBe("Grey");
  });
});

describe("Epic Roadmap keyboard focus", () => {
  const editButton = (name: string) => screen.getByRole("button", { name: `Edit ${name}` });

  it("returns to the row's Edit button after Save or Cancel", () => {
    setEpics([epic("a", "Alpha", "2026 Q1", "2026 Q1"), epic("b", "Beta", "2026 Q2", "2026 Q2")]);
    renderRoadmap();
    fireEvent.click(editButton("Alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(editButton("Alpha")).toHaveFocus();

    fireEvent.click(editButton("Beta"));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.keyDown(within(editor).getByLabelText(/^Epic/), { key: "Escape" });
    expect(editButton("Beta")).toHaveFocus();
  });

  it("moves to the next epic after a delete, else the add form", () => {
    setEpics([epic("a", "Alpha", "2026 Q1", "2026 Q1"), epic("b", "Beta", "2026 Q2", "2026 Q2")]);
    renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(editButton("Beta")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete Beta" }));
    expect(within(addForm()).getByLabelText(/^Epic/)).toHaveFocus();
  });

  it("after Unlink lands on the next story's Unlink, else the story picker; Link stays on it", () => {
    setEpics([epic("e1", "Onboarding", "2026 Q4", "2027 Q1")]);
    useWorkspaceStore.setState({
      stories: [story("s1", "done", 3, "e1"), story("s2", "todo", 5, "e1"), story("s3", "todo")],
    });
    renderRoadmap();
    fireEvent.click(screen.getByRole("button", { name: /^Stories \(2\) in Onboarding/ }));
    fireEvent.click(screen.getByRole("button", { name: "Unlink Story s1" }));
    expect(screen.getByRole("button", { name: "Unlink Story s2" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Unlink Story s2" }));
    expect(screen.getByLabelText(/^Link a story/)).toHaveFocus();

    fireEvent.change(screen.getByLabelText(/^Link a story/), { target: { value: "s3" } });
    fireEvent.click(screen.getByRole("button", { name: "Link story" }));
    expect(stories().find((s) => s.id === "s3")?.epicId).toBe("e1");
    expect(screen.getByLabelText(/^Link a story/)).toHaveFocus();
  });
});
