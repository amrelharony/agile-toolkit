import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BugReport, Sprint } from "@/lib/stores/workspace-types";
import { BUG_TRIAGE_ACTIONS } from "@/lib/history/event-actions";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

/**
 * Bug Triage on workspace.bugReports: the quick log (Enter logs, More
 * details, nothing blank), the queue oldest first with its quick checks and
 * the suggested placement, the triage_done milestone with Amr's cheer, the
 * grid's counts and "Check" cells, a cell's bugs and advice, sending fix now
 * as an interrupt (refused with no sprint, the backlog offered instead) and
 * next or later as a backlog story tagged bug, each with Undo, "Close as
 * fixed" once its work is done, duplicates, All bugs and its filters, a bug
 * opened from ?bug=, delete and reopen, the suggestions without AI, the
 * example (never sent) and the export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/bug-triage",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.push(args),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, csvData }: { markdown?: string; csvData?: { rows: unknown[] } }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <span data-testid="export-csv-rows">{csvData?.rows.length ?? 0}</span>
    </>
  ),
}));

import { BugTriageClient } from "@/app/(tools)/bug-triage/bug-triage-client";
import { buildExample } from "@/app/(tools)/bug-triage/example";
import { bugsCsv, toMarkdown } from "@/app/(tools)/bug-triage/markdown";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const ws = () => useWorkspaceStore.getState();
const bugs = () => ws().bugReports ?? [];
const stored = (id: string) => bugs().find((b) => b.id === id);

const bug = (over: Partial<BugReport> = {}): BugReport => ({
  id: "bug_a",
  title: "The receipt shows the wrong currency",
  status: "new",
  createdAt: ago(1),
  updatedAt: ago(1),
  ...over,
});
const placed = (over: Partial<BugReport> = {}) =>
  bug({ status: "triaged", severity: "major", priority: "next", triagedAt: ago(1), ...over });

const activeSprint = (): Sprint =>
  ({
    id: "sprint_1",
    name: "Sprint 1",
    startDate: "2026-01-01",
    endDate: "2099-01-01",
    status: "active",
  }) as Sprint;

const seed = (bugReports: BugReport[], over: Partial<ReturnType<typeof ws>> = {}) =>
  useWorkspaceStore.setState({
    bugReports,
    stories: [],
    interruptItems: [],
    sprints: [],
    ...over,
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <BugTriageClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const logged = (action: string) => logs.filter((l) => l.action === action);
/** Click Undo on the newest toast. */
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const titleField = () => screen.getByRole("textbox", { name: /^What's wrong/ });
const queueItem = (id: string) => document.querySelector(`[data-queue-bug="${id}"]`) as HTMLElement;
const queueTitle = (id: string) => queueItem(id)?.querySelector("[data-queue-title]");
/** Focus a control, then click it, as a keyboard user's Enter does. */
const press = (el: HTMLElement) => {
  act(() => el.focus());
  fireEvent.click(el);
};
const detail = () => document.querySelector("[data-bug-detail]") as HTMLElement;
const cellButton = (name: RegExp) => screen.getByRole("button", { name });
const announced = (text: string | RegExp) =>
  waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(text));

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  window.history.replaceState(null, "", "/bug-triage");
  seed([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("an empty page", () => {
  it("says what it is for and offers the example, which is never sent anywhere", async () => {
    renderPage();
    expect(await screen.findByText(/No bugs yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(bugs()).toHaveLength(8);
    expect(bugs().every((b) => b.id.startsWith("example-"))).toBe(true);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    // The critical payment bug is past its two-day target.
    fireEvent.click(cellButton(/^Critical × Now: 1 open bug/));
    const list = screen.getByTestId("cell-bugs");
    expect(within(list).getByRole("button", { name: "Log as an interrupt" })).toBeDisabled();
    expect(within(list).getByText(/Example bugs aren't sent/)).toBeInTheDocument();
    expect(logs).toEqual([]);
  });

  it("clears only the example, with Undo", async () => {
    seed([bug()]);
    renderPage();
    await screen.findAllByText("The receipt shows the wrong currency");
    act(() => ws().upsertBugReport(bug({ id: "example-x", title: "Example bug" })));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(bugs().map((b) => b.id)).toEqual(["bug_a"]);
    undoLast();
    expect(stored("example-x")).toBeDefined();
  });
});

describe("the example beside the team's own bugs", () => {
  it("counts only the team's own on the grid and in the queue's heading, as the KPIs do", async () => {
    seed([
      ...buildExample(new Date()),
      bug({ id: "bug_own", title: "Our own bug", createdAt: ago(0) }),
    ]);
    renderPage();
    await screen.findAllByText("Our own bug");
    expect(screen.getByText(/aren't counted while you have your own/)).toBeInTheDocument();
    expect(screen.getByText("To triage (1)")).toBeInTheDocument();
    // The example's waiting bugs are still listed, just not counted.
    expect(queueItem("example-bug-2")).not.toBeNull();
    // Nor are its placed bugs on the team's grid.
    const critical = cellButton(/^Critical × Now: 0 open bugs\./);
    expect(cellButton(/^Major × Next: 0 open bugs\./)).toBeInTheDocument();
    fireEvent.click(critical);
    expect(
      within(screen.getByTestId("cell-bugs")).getByText("No open bugs here.")
    ).toBeInTheDocument();
  });
});

describe("the quick log", () => {
  it("logs a new bug on Enter and keeps focus in the field", async () => {
    renderPage();
    await screen.findByText(/No bugs yet/);
    fireEvent.change(titleField(), { target: { value: "  Search misses   accents  " } });
    fireEvent.submit(titleField().closest("form")!);
    expect(bugs()).toEqual([
      expect.objectContaining({ title: "Search misses accents", status: "new" }),
    ]);
    expect(bugs()[0].id).toMatch(/^bug_/);
    expect(bugs()[0].createdAt).toBe(bugs()[0].updatedAt);
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_LOGGED)).toEqual([
      { action: "bug_logged", payload: { bugId: bugs()[0].id } },
    ]);
    expect(titleField()).toHaveValue("");
    expect(document.activeElement).toBe(titleField());
    await announced(/waits in the triage queue/);
  });

  it("saves nothing blank, and More details holds the steps, what happened and who found it", async () => {
    renderPage();
    await screen.findByText(/No bugs yet/);
    fireEvent.submit(titleField().closest("form")!);
    expect(await screen.findByText("Say what's wrong in a line.")).toBeInTheDocument();
    expect(bugs()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "More details" }));
    fireEvent.change(titleField(), { target: { value: "Pay fails" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Steps to make it happen" }), {
      target: { value: "Add a card, pay" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "What happened" }), {
      target: { value: "An error" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^Area/ }), {
      target: { value: "Checkout" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Who found it" }), {
      target: { value: "Sam" },
    });
    fireEvent.submit(titleField().closest("form")!);
    expect(bugs()[0]).toMatchObject({
      title: "Pay fails",
      steps: "Add a card, pay",
      actual: "An error",
      area: "Checkout",
      reportedBy: "Sam",
    });
  });
});

describe("the triage queue", () => {
  it("lists the oldest first, opens it, and suggests a placement from the checks", async () => {
    seed([
      bug({ id: "newer", title: "Typo on the banner", createdAt: ago(0) }),
      bug({ id: "older", title: "Something odd on the profile page", createdAt: ago(3) }),
    ]);
    renderPage();
    await screen.findAllByText("Typo on the banner");
    const items = Array.from(document.querySelectorAll("[data-queue-bug]")).map((el) =>
      el.getAttribute("data-queue-bug")
    );
    expect(items).toEqual(["older", "newer"]);
    const first = queueItem("older");
    expect(within(first).getByTestId("triage-suggestion")).toHaveTextContent(
      "Suggested: Minor × Later"
    );
    fireEvent.click(
      within(
        within(first).getByRole("radiogroup", { name: "Does it lose, damage or leak data?" })
      ).getByRole("radio", { name: "Yes" })
    );
    expect(within(first).getByTestId("triage-suggestion")).toHaveTextContent(
      "Suggested: Critical × Now. It loses, damages or leaks data."
    );
    expect(
      within(within(first).getByRole("radiogroup", { name: "Severity: how bad" })).getByRole(
        "radio",
        { name: "Critical" }
      )
    ).toHaveAttribute("aria-checked", "true");
    // Another opens on a tap.
    fireEvent.click(within(queueItem("newer")).getByRole("button", { name: /^Triage “Typo/ }));
    expect(within(queueItem("newer")).getByTestId("triage-suggestion")).toHaveTextContent(
      "Cosmetic × Some day"
    );
  });

  it("places a bug with a changed priority, then cheers once the queue is empty", async () => {
    seed([
      bug({ id: "a", createdAt: ago(2) }),
      bug({ id: "b", title: "Typo here", createdAt: ago(1) }),
    ]);
    renderPage();
    await screen.findAllByText("Typo here");
    const first = queueItem("a");
    fireEvent.click(
      within(within(first).getByRole("radiogroup", { name: "Priority: how soon" })).getByRole(
        "radio",
        { name: "Now" }
      )
    );
    press(within(first).getByRole("button", { name: "Place it" }));
    expect(stored("a")).toMatchObject({ status: "triaged", priority: "now" });
    // Its row went with the button: focus moves to the bug now open.
    expect(document.activeElement).toBe(queueTitle("b"));
    expect(stored("a")?.triagedAt).toBeDefined();
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_TRIAGED)[0].payload).toMatchObject({
      bugId: "a",
      priority: "now",
    });
    expect(cheers).toEqual([]);
    press(within(queueItem("b")).getByRole("button", { name: "Place it" }));
    expect(logged(BUG_TRIAGE_ACTIONS.TRIAGE_DONE)).toEqual([
      { action: "triage_done", payload: { count: 2 } },
    ]);
    expect(cheers).toEqual([["bug-triage", "done"]]);
    expect(screen.getByText(/Nothing waiting/)).toBeInTheDocument();
    expect(document.activeElement).toBe(document.querySelector('[data-field="queue-empty"]'));
  });

  it("says when a bug looks like an older one, and closes it as a duplicate with Undo", async () => {
    seed([
      bug({ id: "older", title: "Paying with a saved card fails", createdAt: ago(2) }),
      bug({ id: "newer", title: "Paying with a saved card fails on a phone", createdAt: ago(0) }),
    ]);
    renderPage();
    await screen.findAllByText("Paying with a saved card fails on a phone");
    const item = queueItem("newer");
    expect(
      within(item).getByText("Looks like: “Paying with a saved card fails”")
    ).toBeInTheDocument();
    expect(within(queueItem("older")).queryByText(/Looks like/)).toBeNull();
    press(within(item).getByRole("button", { name: "Close as duplicate" }));
    // The row went: focus moves to the bug in its place, here the one left.
    expect(document.activeElement).toBe(queueTitle("older"));
    expect(stored("newer")).toMatchObject({
      status: "closed",
      closeReason: "duplicate",
      duplicateOf: "older",
    });
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_CLOSED)[0].payload).toEqual({
      bugId: "newer",
      reason: "duplicate",
    });
    undoLast();
    expect(stored("newer")?.status).toBe("new");
  });

  it("suggests placements without AI, and accepting one places it with Undo", async () => {
    seed([
      bug({ id: "crash", title: "The app crashes on start", createdAt: ago(1) }),
      bug({ id: "typo", title: "Typo on the delivery page", createdAt: ago(0) }),
    ]);
    renderPage();
    await screen.findAllByText("The app crashes on start");
    fireEvent.click(screen.getByRole("button", { name: "Suggest severities without AI" }));
    expect(await screen.findByText(/Suggested without AI/)).toBeInTheDocument();
    expect(screen.getByText("The app crashes on start: Critical × Now")).toBeInTheDocument();
    const row = screen.getByText("Typo on the delivery page: Cosmetic × Some day").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /^Place/ }));
    expect(stored("typo")).toMatchObject({
      status: "triaged",
      severity: "cosmetic",
      priority: "someday",
    });
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_TRIAGED)[0].payload).toMatchObject({
      bugId: "typo",
      source: "suggestion",
    });
    undoLast();
    expect(stored("typo")?.status).toBe("new");
  });

  it("keeps focus on the page when the last suggestion placed empties the queue", async () => {
    seed([bug({ id: "crash", title: "The app crashes on start" })]);
    renderPage();
    await screen.findAllByText("The app crashes on start");
    fireEvent.click(screen.getByRole("button", { name: "Suggest severities without AI" }));
    const row = (await screen.findByText("The app crashes on start: Critical × Now")).closest(
      "li"
    )!;
    press(within(row).getByRole("button", { name: /^Place/ }));
    expect(stored("crash")?.status).toBe("triaged");
    await waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('[data-field="queue-empty"]'))
    );
  });
});

describe("the triage form's advice", () => {
  it("gives each placement its cell's advice, and says Check where the two clash", async () => {
    seed([bug({ title: "Typo on the banner" })]);
    renderPage();
    await screen.findAllByText("Typo on the banner");
    const item = queueItem("bug_a");
    expect(within(item).getByText(/Close it if nobody will fix it/)).toBeInTheDocument();
    fireEvent.click(
      within(within(item).getByRole("radiogroup", { name: "Priority: how soon" })).getByRole(
        "radio",
        { name: "Now" }
      )
    );
    expect(within(item).getByText("Check:")).toBeInTheDocument();
    expect(within(item).getByText(/A cosmetic bug before planned work/)).toBeInTheDocument();
  });
});

describe("the grid", () => {
  it("counts open bugs per cell as numbers and says Check where the two clash", async () => {
    seed([
      placed({ id: "1" }),
      placed({ id: "2" }),
      placed({ id: "3", severity: "cosmetic", priority: "now" }),
      placed({ id: "4", status: "closed" }),
    ]);
    renderPage();
    await screen.findByText("The grid");
    expect(cellButton(/^Major × Next: 2 open bugs\./)).toHaveTextContent("2");
    const clash = cellButton(/^Cosmetic × Now: 1 open bug, check\./);
    expect(clash).toHaveTextContent("Check");
    expect(cellButton(/^Critical × Later: 0 open bugs\./)).not.toHaveTextContent("Check");
    for (const label of [
      "Now",
      "Next",
      "Later",
      "Some day",
      "Critical",
      "Major",
      "Minor",
      "Cosmetic",
    ]) {
      expect(screen.getAllByText(label, { selector: "span" }).length).toBeGreaterThan(0);
    }
  });

  it("lists a cell's bugs with its advice when tapped, and again to close it", async () => {
    seed([placed({ id: "1", title: "Delivery dates wrong" })]);
    renderPage();
    await screen.findByText("The grid");
    const major = cellButton(/^Major × Next/);
    fireEvent.click(major);
    expect(major).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByTestId("cell-bugs");
    expect(within(list).getByText(/Add it to the backlog for the next sprint/)).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Delivery dates wrong" })).toBeInTheDocument();
    fireEvent.click(major);
    expect(screen.queryByTestId("cell-bugs")).toBeNull();
  });
});

describe("sending a bug on", () => {
  it("logs fix now as an interrupt in the running sprint, linked back, with Undo", async () => {
    seed([placed({ severity: "critical", priority: "now" })], { sprints: [activeSprint()] });
    renderPage();
    await screen.findByText("The grid");
    fireEvent.click(cellButton(/^Critical × Now/));
    fireEvent.click(
      within(screen.getByTestId("cell-bugs")).getByRole("button", { name: "Log as an interrupt" })
    );
    const item = (ws().interruptItems ?? [])[0];
    expect(item).toMatchObject({
      sprintId: "sprint_1",
      kind: "bug",
      emergency: true,
      sourceRef: { tool: "bug-triage", id: "bug_a" },
    });
    expect(stored("bug_a")?.sentTo?.[0]).toMatchObject({ route: "interrupt", targetId: item.id });
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_SENT)[0].payload).toEqual({
      bugId: "bug_a",
      route: "interrupt",
    });
    expect(
      within(screen.getByTestId("cell-bugs")).getByText(/Logged as an interrupt/)
    ).toBeInTheDocument();
    undoLast();
    expect(ws().interruptItems ?? []).toEqual([]);
    expect(stored("bug_a")?.sentTo ?? []).toEqual([]);
  });

  it("says no sprint is running, and offers the backlog instead", async () => {
    seed([placed({ severity: "critical", priority: "now", steps: "Pay" })]);
    renderPage();
    await screen.findByText("The grid");
    fireEvent.click(cellButton(/^Critical × Now/));
    const list = screen.getByTestId("cell-bugs");
    expect(within(list).getByRole("button", { name: "Log as an interrupt" })).toBeDisabled();
    expect(within(list).getByText(/No sprint is running/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Add to the backlog instead" }));
    const story = ws().stories[0];
    expect(story).toMatchObject({
      status: "backlog",
      tags: ["bug"],
      sourceRef: { tool: "bug-triage", id: "bug_a" },
    });
    expect(story.notes).toContain("Steps: Pay");
  });

  it("plans next or later as a backlog story tagged bug, then offers Close as fixed once it's done", async () => {
    seed([placed({ priority: "later" })]);
    renderPage();
    await screen.findByText("The grid");
    fireEvent.click(cellButton(/^Major × Later/));
    press(
      within(screen.getByTestId("cell-bugs")).getByRole("button", { name: "Add to the backlog" })
    );
    const story = ws().stories[0];
    expect(story.tags).toEqual(["bug"]);
    // The send button gave way to where it went: focus is on the row's title.
    expect(document.activeElement).toBe(
      within(screen.getByTestId("cell-bugs")).getByRole("button", {
        name: "The receipt shows the wrong currency",
      })
    );
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_SENT)[0].payload).toMatchObject({
      route: "backlog-story",
    });
    act(() => ws().upsertStory({ ...story, status: "done" }));
    const list = screen.getByTestId("cell-bugs");
    expect(within(list).getByText("Fixed? Its work is done.")).toBeInTheDocument();
    press(within(list).getByRole("button", { name: "Close as fixed" }));
    expect(stored("bug_a")).toMatchObject({ status: "closed", closeReason: "fixed" });
    // Its row went and none is left: focus is on the cell.
    expect(document.activeElement).toBe(cellButton(/^Major × Later/));
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_CLOSED)[0].payload).toEqual({
      bugId: "bug_a",
      reason: "fixed",
    });
    undoLast();
    expect(stored("bug_a")?.status).toBe("triaged");
  });
});

describe("a bug's panel", () => {
  it("opens from ?bug= with its details, age, fix-by target and where it came from", async () => {
    seed([
      placed({
        severity: "critical",
        priority: "now",
        createdAt: ago(3),
        steps: "Pay with a card",
        sourceRef: { tool: "test-sessions", id: "n1", doc: "tsess_1" },
      }),
    ]);
    window.history.replaceState(null, "", "/bug-triage?bug=bug_a");
    renderPage();
    await waitFor(() => expect(detail()).not.toBeNull());
    const panel = detail();
    expect(
      within(panel).getByRole("heading", { name: "The receipt shows the wrong currency" })
    ).toBeInTheDocument();
    expect(within(panel).getByText(/logged 3 days ago/)).toBeInTheDocument();
    expect(within(panel).getByText(/over target/)).toBeInTheDocument();
    expect(within(panel).getByText("Pay with a card")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /From test sessions/ })).toHaveAttribute(
      "href",
      "/test-sessions?session=tsess_1"
    );
    expect(window.location.search).toBe("");
  });

  it("closes with a reason, checks a duplicate names a bug, reopens and deletes with Undo", async () => {
    seed([placed(), bug({ id: "bug_b", title: "Second bug", createdAt: ago(0) })]);
    renderPage();
    await screen.findAllByText("Second bug");
    fireEvent.click(within(queueItem("bug_b")).getByRole("button", { name: "Details" }));
    let panel = detail();
    fireEvent.change(within(panel).getByRole("combobox", { name: "Close as" }), {
      target: { value: "duplicate" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Close bug" }));
    expect(within(panel).getByText("Pick the bug it repeats.")).toBeInTheDocument();
    expect(stored("bug_b")?.status).toBe("new");
    fireEvent.change(within(panel).getByRole("combobox", { name: "Of the bug" }), {
      target: { value: "bug_a" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Close bug" }));
    expect(stored("bug_b")).toMatchObject({ status: "closed", duplicateOf: "bug_a" });
    panel = detail();
    expect(within(panel).getByText(/closed as duplicate/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Reopen" }));
    expect(stored("bug_b")?.status).toBe("new");
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_REOPENED)).toHaveLength(1);
    fireEvent.click(within(detail()).getByRole("button", { name: "Delete bug" }));
    expect(stored("bug_b")).toBeUndefined();
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_REMOVED)).toHaveLength(1);
    undoLast();
    expect(stored("bug_b")).toBeDefined();
  });

  it("places a bug from its panel and keeps focus on the panel's heading", async () => {
    seed([bug()]);
    renderPage();
    await screen.findAllByText("The receipt shows the wrong currency");
    fireEvent.click(within(queueItem("bug_a")).getByRole("button", { name: "Details" }));
    press(within(detail()).getByRole("button", { name: "Place it" }));
    expect(stored("bug_a")?.status).toBe("triaged");
    // The panel's triage form went; its heading stays and holds focus.
    expect(within(detail()).queryByRole("button", { name: "Place it" })).toBeNull();
    expect(document.activeElement).toBe(within(detail()).getByRole("heading"));
  });

  it("edits a bug's details, and moves a placed bug to another cell", async () => {
    seed([placed()]);
    renderPage();
    await screen.findByText("The grid");
    fireEvent.click(cellButton(/^Major × Next/));
    fireEvent.click(
      within(screen.getByTestId("cell-bugs")).getByRole("button", {
        name: "The receipt shows the wrong currency",
      })
    );
    const panel = detail();
    fireEvent.click(within(panel).getByRole("button", { name: "Edit details" }));
    fireEvent.change(within(panel).getByRole("textbox", { name: /^What's wrong/ }), {
      target: { value: "Receipts show pounds" },
    });
    fireEvent.submit(
      within(panel)
        .getByRole("textbox", { name: /^What's wrong/ })
        .closest("form")!
    );
    expect(stored("bug_a")?.title).toBe("Receipts show pounds");
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_UPDATED)).toHaveLength(1);
    fireEvent.click(within(detail()).getByRole("button", { name: "Change severity or priority" }));
    fireEvent.click(
      within(
        within(detail()).getAllByRole("radiogroup", { name: "Priority: how soon" })[0]
      ).getByRole("radio", { name: "Later" })
    );
    fireEvent.click(within(detail()).getByRole("button", { name: "Move it" }));
    expect(stored("bug_a")?.priority).toBe("later");
    // A move is an update, not a triage: no milestone, no cheer.
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_UPDATED).at(-1)?.payload).toEqual({
      bugId: "bug_a",
      severity: "major",
      priority: "later",
    });
    expect(logged(BUG_TRIAGE_ACTIONS.BUG_TRIAGED)).toEqual([]);
    expect(logged(BUG_TRIAGE_ACTIONS.TRIAGE_DONE)).toEqual([]);
    expect(cheers).toEqual([]);
  });
});

describe("all bugs", () => {
  it("filters by status and severity, and a row opens the bug", async () => {
    seed([
      placed({ id: "a", title: "Open major" }),
      placed({ id: "b", title: "Closed one", status: "closed", closeReason: "wont-fix" }),
      placed({ id: "c", title: "Minor one", severity: "minor" }),
    ]);
    renderPage();
    await screen.findAllByText("Open major");
    const table = screen.getByRole("table", { name: "All bugs" });
    expect(within(table).queryByText("Closed one")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "closed" },
    });
    expect(within(table).getByText("Closed one")).toBeInTheDocument();
    expect(within(table).queryByText("Open major")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Severity" }), {
      target: { value: "minor" },
    });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    fireEvent.click(within(table).getByText("Minor one"));
    expect(within(detail()).getByRole("heading", { name: "Minor one" })).toBeInTheDocument();
  });
});

describe("Amr's severities", () => {
  it("shows the AI's answer as his, dropping bugs not asked about and duplicates it can't name", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              suggestions: [
                {
                  id: "a",
                  severity: "major",
                  priority: "next",
                  reason: "A main path is wrong.",
                  duplicateOf: "a",
                },
                {
                  id: "b",
                  severity: "minor",
                  priority: "later",
                  reason: "Annoying only.",
                  duplicateOf: "a",
                },
                { id: "made-up", severity: "critical", priority: "now", reason: "Not a bug here." },
                {
                  id: "placed",
                  severity: "critical",
                  priority: "now",
                  reason: "Already on the grid.",
                },
              ],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed([
      bug({ id: "a", title: "Receipts show pounds", createdAt: ago(2) }),
      bug({ id: "b", title: "Receipt symbol wrong", createdAt: ago(1) }),
      placed({ id: "placed", title: "Placed already" }),
    ]);
    renderPage();
    await screen.findAllByText("Receipts show pounds");
    fireEvent.click(await screen.findByRole("button", { name: "Ask Amr for severities" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(within(list).getByText(/Suggested by Amr's AI/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only the queue is asked about (the placed bug goes as another open one),
    // and who reported a bug never goes in the ask.
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const sent = String(init.body);
    expect(JSON.parse(sent).input.bugs.map((b: { id: string }) => b.id)).toEqual(["a", "b"]);
    expect(sent).not.toContain("reportedBy");
    expect(within(list).queryByText(/Not a bug here/)).toBeNull();
    expect(within(list).queryByText(/Already on the grid/)).toBeNull();
    // A duplicate of itself is dropped; one of another bug is named.
    expect(within(list).getByText("A main path is wrong.")).toBeInTheDocument();
    expect(
      within(list).getByText("Annoying only. Looks like “Receipts show pounds”.")
    ).toBeInTheDocument();
    expect(stored("a")?.status).toBe("new");
    fireEvent.click(within(list).getAllByRole("button", { name: /^Place/ })[0]);
    expect(stored("a")).toMatchObject({ status: "triaged", severity: "major", priority: "next" });
  });
});

describe("the export", () => {
  it("has the grid as a table of counts and the open bugs, counting the team's own", async () => {
    seed([
      placed({ severity: "critical", priority: "now", createdAt: ago(3) }),
      bug({ id: "example-1" }),
    ]);
    renderPage();
    const md = (await screen.findByTestId("export-markdown")).textContent ?? "";
    expect(md).toMatch(/^# Bug triage — \d{4}-\d{2}-\d{2}/);
    expect(md).toContain("| Critical | 1 | 0 | 0 | 0 |");
    expect(md).toContain("over target");
    expect(md).not.toContain("example");
    expect(screen.getByTestId("export-csv-rows")).toHaveTextContent("1");
  });

  it("dates a send and the CSV's Logged column by the local day, not the UTC one", async () => {
    // Pinned east of UTC so this holds on a UTC runner too: 20:30 UTC on
    // the 20th is early on the 21st in Tokyo, where a UTC slice says the 20th.
    const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "Asia/Tokyo";
    try {
      const at = "2026-10-20T20:30:00.000Z";
      expect(new Date(at).getDate()).toBe(21);
      const sent = placed({
        createdAt: at,
        sentTo: [{ route: "backlog-story", targetId: "story_gone", at }],
      });
      const csv = bugsCsv([sent], { stories: [], interrupts: [] }, "2026-10-22");
      expect(csv.rows[0][csv.headers.indexOf("Logged")]).toBe("2026-10-21");
      seed([sent]);
      window.history.replaceState(null, "", "/bug-triage?bug=bug_a");
      renderPage();
      await waitFor(() => expect(detail()).not.toBeNull());
      const panel = detail();
      expect(within(panel).getByText(/^Sent to the backlog 21 Oct/)).toBeInTheDocument();
      expect(within(panel).queryByText(/20 Oct/)).toBeNull();
    } finally {
      process.env.TZ = zone;
    }
  });

  it("caps the open bugs it lists at 100, counting the rest", () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      placed({ id: `b${i}`, title: `Bug ${i}`, createdAt: ago(i % 5) })
    );
    const md = toMarkdown({
      bugs: many,
      slices: { stories: [], interrupts: [] },
      today: "2026-11-20",
    });
    expect(md.match(/^- Bug /gm)).toHaveLength(100);
    expect(md).toContain("And 30 more open bugs.");
  });
});
