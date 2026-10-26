import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";

/**
 * The Eisenhower Matrix derives its quadrant: two answers (unset until
 * picked, both needed to save) plus a due date within two days making a
 * task urgent, with the reason shown. A legacy hand-picked quadrant reads
 * as its answers; a task missing one waits under "Not sorted yet", never
 * in Do. Delegate names a person, edits move tasks, delete and reset come
 * with Undo, and the agent's list puts every task in the same pane.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const exported = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: Record<string, unknown>) => {
    exported.props = p;
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { EisenhowerClient } from "@/app/(tools)/eisenhower/eisenhower-client";
import { buildExample } from "@/app/(tools)/eisenhower/example";
import { toMarkdown } from "@/app/(tools)/eisenhower/markdown";
import { eisVerdict } from "@/app/(tools)/eisenhower/verdict";
import { eisRows, previewText, toCsv } from "@/app/(tools)/eisenhower/model";
import "@/lib/actions/tools/eisenhower";

const FW = "eisenhower" as const;
const TODAY = "2026-10-27";
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === FW);
const stored = (id: string) => rows().find((r) => r.id === id);

const task = (
  id: string,
  title: string,
  fields: Record<string, number | string> = {}
): PrioritizationItem => ({
  id,
  framework: FW,
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <EisenhowerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const IMPORTANT = "Important? (does it move a goal)";
const URGENT = "Urgent? (does waiting cause harm soon)";
const addForm = () =>
  screen.getByRole("button", { name: "Add task" }).closest("form") as HTMLElement;
const answer = (scope: HTMLElement, group: string, value: "Yes" | "No") =>
  fireEvent.click(
    within(within(scope).getByRole("radiogroup", { name: group })).getByRole("radio", {
      name: value,
    })
  );
const pane = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
const inPane = (label: string) =>
  within(pane(label))
    .queryAllByRole("listitem")
    .map((li) => li.textContent ?? "");
const lastUndo = () => {
  const call = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  return (call[1] as { action: { onClick: () => void } }).action.onClick;
};

beforeEach(() => {
  // Only the clock: the live announcer's timeout stays real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
  toastSpy.mockReset();
  exported.props = null;
  useWorkspaceStore.setState({ prioritizations: [], teamMembers: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Eisenhower: adding", () => {
  it("starts with nothing answered and refuses a task without both answers", () => {
    renderPage();
    const form = addForm();
    for (const g of [IMPORTANT, URGENT]) {
      const radios = within(within(form).getByRole("radiogroup", { name: g })).getAllByRole(
        "radio"
      );
      expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    }
    fireEvent.change(screen.getByLabelText(/^Task/), { target: { value: "Plan hiring" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Say whether it's important.")).toBeInTheDocument();
    expect(screen.getByText("Say whether it's urgent.")).toBeInTheDocument();
    const important = within(form).getByRole("radiogroup", { name: IMPORTANT });
    expect(important.contains(document.activeElement)).toBe(true);
  });

  it("refuses a blank title with focus on it", () => {
    renderPage();
    answer(addForm(), IMPORTANT, "Yes");
    answer(addForm(), URGENT, "No");
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(rows()).toHaveLength(0);
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Task/)).toHaveFocus();
  });

  it("stores the answers, never a quadrant, and says where the task went", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Task/), { target: { value: "Plan hiring" } });
    answer(addForm(), IMPORTANT, "Yes");
    answer(addForm(), URGENT, "No");
    expect(screen.getByText("Goes to Schedule.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const [r] = rows();
    expect(r.fields).toEqual({ urgent: "false", important: "true" });
    expect(r.score).toBe(3);
    expect(inPane("Schedule")).toEqual([expect.stringContaining("Plan hiring")]);
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Added “Plan hiring” to Schedule")
    );
  });

  it("makes a task due within two days urgent, with the reason, and allows a past date", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Task/), { target: { value: "Board pack" } });
    answer(addForm(), IMPORTANT, "Yes");
    answer(addForm(), URGENT, "No");
    fireEvent.change(screen.getByLabelText(/^Due/), { target: { value: "2026-10-28" } });
    expect(
      screen.getByText("Urgent because it's due tomorrow, so it goes to Do.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(rows()[0].fields).toEqual({ urgent: "false", important: "true", dueAt: "2026-10-28" });
    expect(inPane("Do")).toEqual([expect.stringContaining("Board pack")]);
    expect(within(pane("Do")).getByText("Urgent because it's due tomorrow.")).toBeInTheDocument();
    expect(within(pane("Do")).getByText("due tomorrow")).toBeInTheDocument();

    // Backdated: overdue counts as urgent too.
    fireEvent.change(screen.getByLabelText(/^Task/), { target: { value: "Late reply" } });
    answer(addForm(), IMPORTANT, "No");
    answer(addForm(), URGENT, "No");
    fireEvent.change(screen.getByLabelText(/^Due/), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(inPane("Delegate")).toEqual([expect.stringContaining("7 days overdue")]);
  });

  it("offers who takes it once the answers say Delegate, and stores the name", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Task/), { target: { value: "Book the room" } });
    expect(screen.queryByLabelText(/^Who takes it\?/)).toBeNull();
    answer(addForm(), IMPORTANT, "No");
    answer(addForm(), URGENT, "Yes");
    fireEvent.change(screen.getByLabelText(/^Who takes it\?/), { target: { value: "Priya" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(rows()[0].fields).toMatchObject({ delegateTo: "Priya" });
    expect(inPane("Delegate")).toEqual([expect.stringContaining("Priya")]);
  });
});

describe("Eisenhower: the quadrant is derived", () => {
  it("reads every pairing, legacy quadrants and agent rows into the right pane", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("do", "Agent do", { urgent: "true", important: "true" }),
        task("sch", "Agent schedule", { urgent: "false", important: "true" }),
        task("del", "Legacy delegate", { quadrant: "delegate" }),
        task("drop", "Legacy delete", { quadrant: "delete" }),
        // A stored quadrant that contradicts the answers (the old page's menu
        // moved only the quadrant): it was the old app's pane, so it wins.
        task("stale", "Moved on the old page", {
          urgent: "false",
          important: "true",
          quadrant: "do",
        }),
        // Junk and a half-answered row: never Do.
        task("junk", "Junk quadrant", { quadrant: "urgentish" }),
        task("half", "Half answered", { important: "true" }),
      ],
    });
    renderPage();
    expect(inPane("Do")).toEqual([
      expect.stringContaining("Agent do"),
      expect.stringContaining("Moved on the old page"),
    ]);
    expect(inPane("Schedule")).toEqual([expect.stringContaining("Agent schedule")]);
    expect(inPane("Delegate")).toEqual([expect.stringContaining("Legacy delegate")]);
    expect(inPane("Delete")).toEqual([expect.stringContaining("Legacy delete")]);
    expect(inPane("Not sorted yet")).toEqual([
      expect.stringContaining("Half answered"),
      expect.stringContaining("Junk quadrant"),
    ]);
    // Nothing is rewritten on read.
    expect(stored("del")?.fields).toEqual({ quadrant: "delegate" });
  });

  it("sorts a pane by due date, overdue first, undated last", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("a", "Undated", { urgent: "true", important: "true" }),
        task("b", "Next week", { urgent: "true", important: "true", dueAt: "2026-11-03" }),
        task("c", "Overdue", { urgent: "true", important: "true", dueAt: "2026-10-25" }),
      ],
    });
    renderPage();
    expect(inPane("Do").map((t) => t.split(/(?=Edit)/)[0])).toEqual([
      expect.stringContaining("Overdue"),
      expect.stringContaining("Next week"),
      expect.stringContaining("Undated"),
    ]);
  });

  it("previews what's missing before both are answered", () => {
    expect(previewText({}, TODAY)).toBe("Answer both questions to see where it goes.");
    expect(previewText({ important: "true" }, TODAY)).toBe(
      "Say whether it's urgent to see where it goes."
    );
    // The form needs the Urgent answer, so the line asks for it before naming a pane.
    expect(previewText({ important: "true", dueAt: "2026-10-27" }, TODAY)).toBe(
      "Say whether it's urgent (being due today makes it urgent anyway)."
    );
    expect(previewText({ important: "true", urgent: "false", dueAt: "2026-10-27" }, TODAY)).toBe(
      "Urgent because it's due today, so it goes to Do."
    );
  });
});

describe("Eisenhower: edit, delete and reset", () => {
  it("edits in place, moving the task by its answers and saying where", async () => {
    useWorkspaceStore.setState({
      prioritizations: [task("a", "Answer emails", { quadrant: "do" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Answer emails" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    // The legacy quadrant came in as its answers.
    const urgent = within(editor).getByRole("radiogroup", { name: URGENT });
    expect(within(urgent).getByRole("radio", { name: "Yes" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    answer(editor, IMPORTANT, "No");
    fireEvent.submit(editor);
    expect(stored("a")?.fields).toEqual({ urgent: "true", important: "false" });
    expect(inPane("Delegate")).toEqual([expect.stringContaining("Answer emails")]);
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Answer emails moved to Delegate")
    );
  });

  it("clears a due date in the editor", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("a", "Board pack", { urgent: "false", important: "true", dueAt: "2026-10-28" }),
      ],
    });
    renderPage();
    expect(inPane("Do")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit Board pack" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.change(within(editor).getByLabelText(/^Due/), { target: { value: "" } });
    fireEvent.submit(editor);
    expect(stored("a")?.fields).toEqual({ urgent: "false", important: "true" });
    expect(inPane("Schedule")).toEqual([expect.stringContaining("Board pack")]);
  });

  it("deletes with Undo", () => {
    useWorkspaceStore.setState({
      prioritizations: [task("a", "Answer emails", { urgent: "true", important: "true" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Answer emails" }));
    expect(rows()).toHaveLength(0);
    expect(toastSpy.mock.calls[0][0]).toBe("Deleted “Answer emails”");
    act(() => lastUndo()());
    expect(stored("a")?.fields).toEqual({ urgent: "true", important: "true" });
  });

  it("clears the matrix after a confirm, with Undo, and leaves other methods alone", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("a", "One", { urgent: "true", important: "true" }),
        task("b", "Two"),
        { ...task("ice", "An ICE idea"), framework: "ice" },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear matrix" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear matrix" })
    );
    expect(rows()).toHaveLength(0);
    expect(state().prioritizations?.map((r) => r.id)).toEqual(["ice"]);
    act(() => lastUndo()());
    expect(
      rows()
        .map((r) => r.id)
        .sort()
    ).toEqual(["a", "b"]);
  });
});

describe("Eisenhower: first run, verdict and export", () => {
  it("loads the example from the empty state and clears only example rows", () => {
    renderPage();
    expect(screen.getByText(/No tasks yet\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows()).toHaveLength(8);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Do “Fix the login outage for EU customers” first (2 days overdue), then 1 more; 2 to schedule, 2 to delegate (1 with nobody named), 1 to drop and 1 not sorted yet."
      )
    ).toBeInTheDocument();
    act(() => state().upsertPrioritization(task("mine", "Mine", { quadrant: "do" })));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(rows().map((r) => r.id)).toEqual(["mine"]);
  });

  it("covers every pane in the example, with example ids and dates relative to today", () => {
    const ex = buildExample(TODAY, new Date("2026-10-27T09:00:00Z"));
    expect(ex.every((r) => r.id.startsWith("example-eis-"))).toBe(true);
    expect(ex.every((r) => !("quadrant" in (r.fields ?? {})))).toBe(true);
    const buckets = eisRows(ex, TODAY).map((r) => r.result.bucket);
    for (const q of ["do", "schedule", "delegate", "delete", null]) expect(buckets).toContain(q);
    expect(ex[0].fields?.dueAt).toBe("2026-10-25");
  });

  it("says what to do with nothing urgent, nothing sorted and nothing at all", () => {
    expect(eisVerdict([], TODAY)).toBe("No tasks yet.");
    expect(eisVerdict(eisRows([task("a", "A"), task("b", "B")], TODAY), TODAY)).toBe(
      "Say whether each of the 2 tasks is urgent and important to sort them."
    );
    expect(
      eisVerdict(
        eisRows(
          [
            task("a", "Plan hiring", { urgent: "false", important: "true" }),
            task("b", "Tidy drive", { urgent: "false", important: "false" }),
          ],
          TODAY
        ),
        TODAY
      )
    ).toBe("Nothing is urgent and important: block time for “Plan hiring”; 1 to drop.");
  });

  it("exports Markdown by pane, CSV with the derived quadrant, and JSON as shown", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("a", "Board | pack", { urgent: "false", important: "true", dueAt: "2026-10-28" }),
        task("b", "Book room", { urgent: "true", important: "false", delegateTo: "Priya" }),
        task("c", "Legacy", { quadrant: "schedule" }),
        task("d", "Half", { important: "true" }),
      ],
    });
    renderPage();
    const ranked = eisRows(state().prioritizations ?? [], TODAY);
    const md = toMarkdown(ranked, TODAY, new Date("2026-10-27T09:00:00Z"));
    expect(md).toContain("# Eisenhower Matrix — 27 Oct 2026");
    expect(md).toContain("## Do (1)");
    expect(md).toContain("| Board \\| pack | 2026-10-28 (due tomorrow) | — |");
    expect(md).toContain("| Book room | — | Priya |");
    expect(md).toContain("## Delete (0)\n\nNeither: drop it.\n\nNone.");
    expect(md).toContain("## Not sorted yet (1)\n\n- Half");
    expect(md).toMatch(/\*\*Do “Board \| pack” first \(due tomorrow\);/);
    expect(exported.props?.markdown).toContain("# Eisenhower Matrix");
    expect(toCsv(ranked, TODAY).rows).toEqual(
      expect.arrayContaining([
        ["Do", "Board | pack", "No", "Yes", "2026-10-28", "", "Urgent because it's due tomorrow"],
        ["Delegate", "Book room", "Yes", "No", "", "Priya", "Marked urgent"],
        ["Schedule", "Legacy", "No", "Yes", "", "", ""],
        ["Not sorted yet", "Half", "", "Yes", "", "", ""],
      ])
    );
    const json = exported.props?.jsonData as PrioritizationItem[];
    expect(json.find((r) => r.id === "c")?.fields).toEqual({ urgent: "false", important: "true" });
  });
});

describe("Eisenhower: the agent reads what the page shows", () => {
  it("list_items puts each task in the same pane, judged against the same day", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        task("a", "Board pack", { urgent: "false", important: "true", dueAt: "2026-10-28" }),
        task("b", "Legacy", { quadrant: "delegate" }),
        task("c", "Half", { important: "true" }),
      ],
    });
    const out = (await registry.get("tool.eisenhower.list_items")!.handler({ today: TODAY }, {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    } as never)) as Record<string, { id: string; extra?: { urgentBecause?: string } }[]>;
    renderPage();
    expect(out.do.map((r) => r.id)).toEqual(["a"]);
    expect(out.do[0].extra?.urgentBecause).toBe("due");
    expect(inPane("Do")).toEqual([expect.stringContaining("Board pack")]);
    expect(out.delegate.map((r) => r.id)).toEqual(["b"]);
    expect(inPane("Delegate")).toEqual([expect.stringContaining("Legacy")]);
    expect(out.unsorted.map((r) => r.id)).toEqual(["c"]);
    expect(inPane("Not sorted yet")).toEqual([expect.stringContaining("Half")]);
  });
});

describe("Eisenhower: theme tokens only", () => {
  it("has no hex colours in its sources", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/eisenhower");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
