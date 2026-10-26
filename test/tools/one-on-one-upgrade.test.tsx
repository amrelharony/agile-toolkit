import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

/**
 * The 1:1 tracker, upgraded: Done with its day (never overdue, never
 * carried), "Addressed" without the carried-over originals, a cadence per
 * report ("last 1:1 18 days ago"), set or read from the usual gap, a
 * timeline, roster people, edits in place, Undo on deletes and the reset,
 * no "growth" count, an in-memory example, and a Markdown export. Old
 * saved 1:1s still load.
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

import { OneOnOneClient } from "@/app/(tools)/one-on-one/one-on-one-client";
import { buildExample } from "@/app/(tools)/one-on-one/example";
import { oneOnOnesToMarkdown } from "@/app/(tools)/one-on-one/markdown";
import { validateStart } from "@/app/(tools)/one-on-one/start-form";
import { timelineText } from "@/app/(tools)/one-on-one/cadence-section";
import {
  CADENCE_KEY,
  STORAGE_KEY,
  addressedShare,
  cadenceByReport,
  cadenceLine,
  cadenceVerdict,
  carriedAgenda,
  normalizeCadence,
  normalizeMeetings,
  overdueActions,
  priorMeeting,
  type Meeting,
} from "@/app/(tools)/one-on-one/model";

const TODAY = todayIso();
const ago = (n: number) => addDays(TODAY, -n) as string;

const meeting = (id: string, report: string, daysAgo: number, over: Partial<Meeting> = {}) =>
  ({
    id,
    manager: "Mia",
    report,
    date: ago(daysAgo),
    agenda: [],
    ...over,
  }) as Meeting;

const seed = (meetings: unknown, cadence?: unknown) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
  if (cadence !== undefined) localStorage.setItem(CADENCE_KEY, JSON.stringify(cadence));
};
const stored = (): Meeting[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
const storedCadence = () => JSON.parse(localStorage.getItem(CADENCE_KEY) ?? "{}");

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <OneOnOneClient />
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

describe("normalizeMeetings", () => {
  it("reads the legacy array, keeps unknown fields, and is safe to run twice", () => {
    const legacy = [
      {
        id: "m1",
        manager: "Mia",
        report: "Raj",
        date: "",
        agenda: [
          { id: "a1", text: "Career", status: "weird" },
          { id: "a2", text: "CI", status: "action_required", owner: 7, future: "kept" },
          "not an item",
        ],
        extra: { kept: true },
      },
      null,
      "junk",
    ];
    const once = normalizeMeetings(legacy);
    expect(once).toHaveLength(1);
    expect(once[0].date).toBe("");
    expect(once[0].agenda.map((a) => a.status)).toEqual(["open", "action_required"]);
    expect(once[0].agenda[1]).not.toHaveProperty("owner");
    expect(once[0].agenda[1]).toHaveProperty("future", "kept");
    expect(once[0]).toHaveProperty("extra", { kept: true });
    expect(normalizeMeetings(once)).toEqual(once);
    expect(normalizeMeetings({ not: "an array" })).toEqual([]);
  });

  it("keeps only the cadences the picker offers", () => {
    expect(normalizeCadence({ raj: 14, lee: 10, kim: "7", ana: 28 })).toEqual({ raj: 14, ana: 28 });
    expect(normalizeCadence(null)).toEqual({});
  });
});

describe("Done, overdue and addressed", () => {
  const withItems = (items: Meeting["agenda"]) => [meeting("m1", "Raj", 5, { agenda: items })];

  it("never counts a done action as overdue", () => {
    const due = ago(2);
    expect(
      overdueActions(
        withItems([
          { id: "a", text: "x", status: "action_required", dueDate: due },
          { id: "b", text: "y", status: "done", dueDate: due, doneAt: ago(1) },
          { id: "c", text: "z", status: "action_required", dueDate: TODAY },
        ]),
        TODAY
      )
    ).toBe(1);
  });

  it("counts a carried-over action once, in the 1:1 it was carried to", () => {
    const list = [
      meeting("m1", "Raj", 10, {
        agenda: [{ id: "a", text: "x", status: "action_required", dueDate: ago(5) }],
      }),
      meeting("m2", "Raj", 3, {
        agenda: [
          { id: "a2", text: "x", status: "action_required", dueDate: ago(5), carriedFrom: "a" },
        ],
      }),
    ];
    expect(overdueActions(list, TODAY)).toBe(1);
  });

  it("reads Addressed over the items still standing, null with none", () => {
    expect(addressedShare([])).toBeNull();
    const list = [
      meeting("m1", "Raj", 10, {
        agenda: [
          { id: "a", text: "x", status: "open" },
          { id: "b", text: "y", status: "discussed" },
        ],
      }),
      meeting("m2", "Raj", 3, {
        agenda: [
          { id: "a2", text: "x", status: "done", carriedFrom: "a" },
          { id: "c", text: "z", status: "open" },
        ],
      }),
    ];
    // The open original "a" is superseded by its done copy: 2 of 3.
    expect(addressedShare(list)).toBeCloseTo(2 / 3);
  });

  it("carries Open and Action items, not Discussed or Done ones", () => {
    const prior = meeting("m1", "Raj", 7, {
      agenda: [
        { id: "a", text: "Open", status: "open" },
        { id: "b", text: "Act", status: "action_required", action: "Do", owner: "Raj" },
        { id: "c", text: "Talked", status: "discussed" },
        { id: "d", text: "Finished", status: "done", doneAt: ago(6) },
      ],
    });
    let n = 0;
    const carried = carriedAgenda(prior, () => `new-${n++}`);
    expect(carried).toEqual([
      { id: "new-0", text: "Open", status: "open", carriedFrom: "a" },
      {
        id: "new-1",
        text: "Act",
        status: "action_required",
        action: "Do",
        owner: "Raj",
        carriedFrom: "b",
      },
    ]);
  });

  it("follows the latest populated 1:1 of the same pair, never a later one", () => {
    const list = [
      meeting("old", "Raj", 20, { agenda: [{ id: "a", text: "x", status: "open" }] }),
      meeting("empty", "Raj", 10),
      meeting("later", "Raj", 1, { agenda: [{ id: "b", text: "y", status: "open" }] }),
      meeting("other", "Lee", 5, { agenda: [{ id: "c", text: "z", status: "open" }] }),
    ];
    const next = { id: "new", manager: "mia", report: " raj", date: ago(5) };
    expect(priorMeeting(list, next)?.id).toBe("old");
  });
});

describe("cadence per report", () => {
  it("alerts against the cadence set: 'last 1:1 18 days ago'", () => {
    const [raj] = cadenceByReport([meeting("m1", "Raj", 18)], { raj: 14 }, [], TODAY);
    expect(raj).toMatchObject({
      daysSince: 18,
      targetDays: 14,
      targetSource: "set",
      overdueBy: 4,
      medianGapDays: null,
    });
    expect(cadenceLine(raj)).toBe("Raj · last 1:1 18 days ago · every 14 days → 4 days overdue");
  });

  it("reads the usual gap from three gaps (four 1:1s), and shows only the age before that", () => {
    const four = cadenceByReport(
      [
        meeting("a", "Lee", 38),
        meeting("b", "Lee", 30),
        meeting("c", "Lee", 20),
        meeting("d", "Lee", 12),
      ],
      {},
      [],
      TODAY
    )[0];
    expect(four).toMatchObject({ medianGapDays: 8, targetSource: "history", overdueBy: 4 });
    const three = cadenceByReport(
      [meeting("a", "Lee", 30), meeting("b", "Lee", 20), meeting("c", "Lee", 12)],
      {},
      [],
      TODAY
    )[0];
    expect(three).toMatchObject({ medianGapDays: null, targetDays: null, overdueBy: null });
    expect(cadenceLine(three)).toBe("Lee · last 1:1 12 days ago");
  });

  it("never reads two gaps as a rhythm: 1:1s 7 and 21 days apart don't make a weekly one", () => {
    // Day 0, 7 and 28, the last one 8 days ago: a median of two gaps took
    // the smaller (7) and called this overdue.
    const [lee] = cadenceByReport(
      [meeting("a", "Lee", 36), meeting("b", "Lee", 29), meeting("c", "Lee", 8)],
      {},
      [],
      TODAY
    );
    expect(lee).toMatchObject({ medianGapDays: null, overdueBy: null });
  });

  it("keeps a renamed report in one row, found by the member id on their 1:1s", () => {
    const roster: TeamMember[] = [
      { id: "m-maria", name: "Maria" },
      { id: "m-sam", name: "Samuel" },
    ];
    const list = [
      meeting("a", "Sam", 20, { reportMemberId: "m-sam", managerMemberId: "m-maria" }),
      meeting("b", "Sam", 18, { reportMemberId: "m-sam", managerMemberId: "m-maria" }),
    ];
    // The cadence was set under the old name; the manager was renamed too.
    const rows = cadenceByReport(list, { sam: 14 }, roster, TODAY);
    expect(rows.map((r) => [r.key, r.name, r.memberId, r.meetings, r.aliases])).toEqual([
      ["samuel", "Samuel", "m-sam", 2, ["sam"]],
    ]);
    expect(rows[0]).toMatchObject({ targetDays: 14, targetSource: "set", overdueBy: 4 });
    expect(cadenceVerdict(rows)).toBe("1 of 1 report is past their cadence: Samuel (18 days).");
  });

  it("lists roster people with no 1:1 yet, but not the manager, and a scheduled one as next", () => {
    const roster: TeamMember[] = [
      { id: "m-mia", name: "Mia" },
      { id: "m-raj", name: "Raj" },
      { id: "m-omar", name: "Omar" },
    ];
    const rows = cadenceByReport(
      [meeting("a", "raj", 5), meeting("b", "Raj", -3)],
      {},
      roster,
      TODAY
    );
    expect(rows.map((r) => [r.name, r.memberId, r.meetings, r.nextDate])).toEqual([
      ["Raj", "m-raj", 1, ago(-3)],
      ["Omar", "m-omar", 0, null],
    ]);
  });

  it("says who is past their cadence in one sentence", () => {
    expect(cadenceVerdict([])).toBe("No 1:1s yet.");
    const rows = cadenceByReport(
      [meeting("a", "Raj", 18), meeting("b", "Lee", 35), meeting("c", "Kim", 3)],
      { raj: 14, lee: 28, kim: 7 },
      [],
      TODAY
    );
    expect(cadenceVerdict(rows)).toBe(
      "2 of 3 reports are past their cadence: Lee (35 days), Raj (18 days)."
    );
    const calm = cadenceByReport([meeting("a", "Raj", 4)], {}, [], TODAY);
    expect(cadenceVerdict(calm)).toBe(
      "1 report, set a cadence to be told when a 1:1 is late; the longest since a 1:1 is Raj (4 days)."
    );
  });

  it("puts a dot per 1:1 of the last 26 weeks in the timeline's text", () => {
    const rows = cadenceByReport(
      [meeting("a", "Raj", 400), meeting("b", "Raj", 30), meeting("c", "Raj", 2)],
      {},
      [],
      TODAY
    );
    const text = timelineText(rows, TODAY);
    expect(text.summary).toBe("1:1s in the last 26 weeks: Raj 2.");
    // The table counts the plotted span as the summary does, then all time.
    expect(text.table.columns.slice(0, 3)).toEqual([
      "Report",
      "1:1s (last 26 weeks)",
      "1:1s (all time)",
    ]);
    expect(text.table.rows[0]).toEqual(["Raj", 2, 3, ago(2), "—", 0]);
  });
});

describe("validateStart", () => {
  it("needs two different people and a real day", () => {
    expect(validateStart({ manager: "", report: " ", date: "", description: "" })).toEqual({
      ok: false,
      errors: {
        manager: "Who runs the 1:1?",
        report: "Who is the 1:1 with?",
        date: "Pick the day of the 1:1.",
      },
    });
    const same = validateStart({ manager: "Mia", report: " mia", date: TODAY, description: "" });
    expect(same.ok).toBe(false);
    expect(
      validateStart({ manager: "Mia", report: "Raj", date: "2026-02-30", description: "" }).ok
    ).toBe(false);
    expect(
      validateStart({ manager: " Mia ", report: "Raj", date: ago(40), description: " Q3 " })
    ).toEqual({
      ok: true,
      values: { manager: "Mia", report: "Raj", date: ago(40), description: "Q3" },
    });
  });
});

describe("Markdown", () => {
  it("exports the cadence table, then each 1:1 with its agenda and notes", () => {
    const list = [
      meeting("m1", "Raj", 18, {
        notes: "Wants to lead refinement",
        agenda: [
          {
            id: "a",
            text: "Flaky | CI",
            status: "done",
            action: "Pair",
            owner: "Raj",
            doneAt: ago(17),
          },
        ],
      }),
    ];
    const md = oneOnOnesToMarkdown(list, cadenceByReport(list, { raj: 14 }, [], TODAY));
    expect(md).toContain("> 1 of 1 report is past their cadence: Raj (18 days).");
    expect(md).toContain(`| Raj | 1 | ${ago(18)} | every 14 days | 4 d | 0 |`);
    expect(md).toContain(`### ${ago(18)} · Mia ↔ Raj`);
    expect(md).toContain(`- **Done** Flaky | CI → Pair · owner Raj · done ${ago(17)}`);
    expect(md).toContain("> Wants to lead refinement");
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("1:1 page", () => {
  it("drops the growth count", () => {
    seed([meeting("m1", "Raj", 3, { notes: "growth plan" })]);
    renderPage();
    expect(screen.queryByText("Growth themes")).toBeNull();
    expect(card("Addressed")).toContain("—");
  });

  it("starts nothing until both people and the day are set", async () => {
    renderPage();
    const date = screen.getByLabelText(/^Date/);
    expect(date).toHaveValue(TODAY);
    fireEvent.change(date, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    expect(await screen.findByText("Who runs the 1:1?")).toBeInTheDocument();
    expect(screen.getByText("Pick the day of the 1:1.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Manager" })).toHaveFocus());
    expect(localStorage.getItem(STORAGE_KEY) ?? "[]").toBe("[]");
  });

  it("starts a backdated 1:1 with roster people and stamps their member ids", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m-mia", name: "Mia" },
        { id: "m-raj", name: "Raj" },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByRole("combobox", { name: "Manager" }), {
      target: { value: "mia" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Report" }), {
      target: { value: "RAJ" },
    });
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: ago(9) } });
    fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    expect(stored()[0]).toMatchObject({
      manager: "Mia",
      report: "Raj",
      managerMemberId: "m-mia",
      reportMemberId: "m-raj",
      date: ago(9),
    });
    expect(screen.getByText(/last 1:1 9 days ago/)).toBeInTheDocument();
  });

  it("marks an action Done with today's day, so it's no longer overdue, and keeps no topic text in the log", () => {
    seed([
      meeting("m1", "Raj", 6, {
        agenda: [{ id: "a", text: "Flaky CI", status: "action_required", dueDate: ago(2) }],
      }),
    ]);
    renderPage();
    expect(card("Action items overdue")).toBe("Action items overdue1");
    fireEvent.click(screen.getByRole("button", { name: `Open 1:1 from ${ago(6)}` }));
    const status = screen.getByRole("radiogroup", { name: "Status of Flaky CI" });
    fireEvent.click(within(status).getByRole("radio", { name: "Done" }));
    expect(stored()[0].agenda[0]).toMatchObject({ status: "done", doneAt: TODAY });
    expect(card("Action items overdue")).toBe("Action items overdue0");
    // Backdate the done day.
    fireEvent.change(screen.getByLabelText("Flaky CI done on"), { target: { value: ago(3) } });
    expect(stored()[0].agenda[0].doneAt).toBe(ago(3));
    // Back to Action: the done day goes.
    fireEvent.click(within(status).getByRole("radio", { name: "Action" }));
    expect(stored()[0].agenda[0]).not.toHaveProperty("doneAt");
    // And back to Done (arrowing through the options does this): the
    // backdated day comes back, not today.
    fireEvent.click(within(status).getByRole("radio", { name: "Done" }));
    expect(stored()[0].agenda[0]).toMatchObject({ status: "done", doneAt: ago(3) });
    fireEvent.click(within(status).getByRole("radio", { name: "Action" }));

    fireEvent.change(screen.getByLabelText("New agenda item"), {
      target: { value: "Salary review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(stored()[0].agenda.map((a) => a.text)).toContain("Salary review");
    expect(JSON.stringify(logs)).not.toContain("Salary review");
    expect(JSON.stringify(logs)).not.toContain("Flaky CI");
  });

  it("saves an action's owner when focus leaves the picker, not per keystroke", () => {
    seed([
      meeting("m1", "Raj", 2, {
        agenda: [{ id: "a", text: "CI", status: "action_required", owner: "Raj" }],
      }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: `Open 1:1 from ${ago(2)}` }));
    const owner = screen.getByRole("combobox", { name: "Owner of CI" });
    fireEvent.change(owner, { target: { value: "Lee" } });
    expect(stored()[0].agenda[0].owner).toBe("Raj");
    fireEvent.focusOut(owner);
    expect(stored()[0].agenda[0].owner).toBe("Lee");
  });

  it("saves an owner added to the team at once (no blur follows that click)", () => {
    seed([
      meeting("m1", "Raj", 2, {
        agenda: [{ id: "a", text: "CI", status: "action_required" }],
      }),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: `Open 1:1 from ${ago(2)}` }));
    fireEvent.change(screen.getByRole("combobox", { name: "Owner of CI" }), {
      target: { value: "Kim" },
    });
    expect(stored()[0].agenda[0]).not.toHaveProperty("owner");
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    expect(useWorkspaceStore.getState().teamMembers?.map((m) => m.name)).toEqual(["Kim"]);
    expect(stored()[0].agenda[0].owner).toBe("Kim");
  });

  it("moves focus into an opened 1:1 and its details form, and back again", async () => {
    seed([meeting("m1", "Raj", 2), meeting("m2", "Lee", 9)]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: `Open 1:1 from ${ago(9)}` }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: `Mia ↔ Lee · ${ago(9)}` })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Active 1:1" })).getAllByRole("combobox")[0]
      ).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit details" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: `Open 1:1 from ${ago(9)}` })).toHaveFocus()
    );
  });

  it("clears a cadence set under a report's old name when it's changed", () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m-sam", name: "Samuel" }] });
    seed([meeting("m1", "Sam", 18, { reportMemberId: "m-sam" })], { sam: 14 });
    renderPage();
    const select = screen.getByLabelText("Cadence for Samuel");
    expect(select).toHaveValue("14");
    fireEvent.change(select, { target: { value: "" } });
    expect(storedCadence()).toEqual({});
    fireEvent.change(select, { target: { value: "7" } });
    expect(storedCadence()).toEqual({ samuel: 7 });
  });

  it("edits an agenda item's text in place, and an emptied text reverts", () => {
    seed([meeting("m1", "Raj", 2, { agenda: [{ id: "a", text: "Career", status: "open" }] })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: `Open 1:1 from ${ago(2)}` }));
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda item: Career" }));
    const field = screen.getByRole("textbox", { name: "Agenda item" });
    fireEvent.change(field, { target: { value: "Career goals" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(stored()[0].agenda[0].text).toBe("Career goals");
    fireEvent.click(screen.getByRole("button", { name: "Edit agenda item: Career goals" }));
    const again = screen.getByRole("textbox", { name: "Agenda item" });
    fireEvent.change(again, { target: { value: "  " } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(stored()[0].agenda[0].text).toBe("Career goals");
  });

  it("saves a cadence per report and alerts when a 1:1 is late", () => {
    seed([meeting("m1", "Raj", 18)]);
    renderPage();
    fireEvent.change(screen.getByLabelText("Cadence for Raj"), { target: { value: "14" } });
    expect(storedCadence()).toEqual({ raj: 14 });
    expect(screen.getByText("1 of 1 report is past their cadence: Raj (18 days).")).toBeTruthy();
    expect(card("Past their cadence")).toContain("1");
    fireEvent.change(screen.getByLabelText("Cadence for Raj"), { target: { value: "" } });
    expect(storedCadence()).toEqual({});
  });

  it("deletes a 1:1 and an agenda item with Undo", () => {
    seed([
      meeting("m1", "Raj", 9, {
        agenda: [
          { id: "a", text: "One", status: "open" },
          { id: "b", text: "Two", status: "open" },
        ],
      }),
      meeting("m2", "Lee", 3),
    ]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: `Remove 1:1 from ${ago(3)}` }));
    expect(stored().map((m) => m.id)).toEqual(["m1"]);
    undoLast();
    expect(stored().map((m) => m.id)).toEqual(["m1", "m2"]);

    fireEvent.click(screen.getByRole("button", { name: `Open 1:1 from ${ago(9)}` }));
    fireEvent.click(screen.getByRole("button", { name: "Remove agenda item: One" }));
    expect(stored()[0].agenda.map((a) => a.id)).toEqual(["b"]);
    undoLast();
    expect(stored()[0].agenda.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("clears everything only after a confirm, with Undo", async () => {
    seed([meeting("m1", "Raj", 9)], { raj: 14 });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear 1:1s" }));
    expect(stored()).toEqual([]);
    expect(storedCadence()).toEqual({});
    expect(logs.some((l) => l.action === "one_on_one_reset")).toBe(true);
    undoLast();
    expect(stored().map((m) => m.id)).toEqual(["m1"]);
    expect(storedCadence()).toEqual({ raj: 14 });
  });

  it("shows an example in memory only, and exports what's on screen", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("1 of 2 reports is past their cadence: Raj (19 days).")).toBeTruthy();
    expect(card("Action items overdue")).toBe("Action items overdue1");
    expect(screen.getByTestId("export-markdown").textContent).toContain("Keen to lead refinement");
    // Starting a 1:1 in the example writes to the example, not your 1:1s.
    fireEvent.change(screen.getByRole("combobox", { name: "Manager" }), {
      target: { value: "Mia" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Report" }), {
      target: { value: "Raj" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start meeting" }));
    // Raj's open action carried over from the example's last 1:1.
    expect(screen.getByDisplayValue("Draft the refinement agenda")).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY) ?? "[]").toBe("[]");
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("builds an example with example ids and one report past cadence", () => {
    const ex = buildExample(TODAY);
    expect(ex.meetings.every((m) => m.id.startsWith("example-"))).toBe(true);
    const rows = cadenceByReport(ex.meetings, ex.cadence, [], TODAY);
    expect(rows.filter((r) => r.overdueBy !== null).map((r) => r.name)).toEqual(["Raj"]);
    expect(overdueActions(ex.meetings, TODAY)).toBe(1);
  });
});
