import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type Improvement,
  type ImprovementStep,
  type RetroBoard,
  type RootCauseAnalysis,
} from "@/lib/stores/workspace-types";

/**
 * Improve: an A3 (seven sections, gap checks, countermeasures sent once to
 * Retro Actions or the backlog, a Root Cause analysis linked or opened) or
 * an Improvement Kata (target, readings, one obstacle worked on at a time,
 * experiments that need what the team expects, a coaching talk saved in one
 * write, Reached it). Every delete and accepted AI idea has Undo, and the
 * example stays an example: never sent, never logged, no AI buttons.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
const lastUndo = () => undo.all[undo.all.length - 1];
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: (...args: unknown[]) => cheers.push(args) }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/improve",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
// Recharts has nothing to measure in jsdom: the chart's sentence and table are tested.
vi.mock("@/app/(tools)/improve/readings-chart", () => ({ ReadingsChart: () => null }));

import { ImproveClient } from "@/app/(tools)/improve/improve-client";
import { CountermeasureIdeas } from "@/app/(tools)/improve/a3-view";
import { CoachWalk } from "@/app/(tools)/improve/coach-walk";
import { NextExperimentIdeas } from "@/app/(tools)/improve/kata-view";
import { buildExample } from "@/app/(tools)/improve/example";
import { improveToMarkdown } from "@/app/(tools)/improve/markdown";
import { validateStepDraft } from "@/app/(tools)/improve/step-list";
import { validateReadingDraft, readingsText } from "@/app/(tools)/improve/readings";
import { ObstacleList, validateObstacleDraft } from "@/app/(tools)/improve/obstacle-list";
import { useItemActions, type ItemActions } from "@/app/(tools)/improve/use-item-actions";
import { fallbackCountermeasures } from "@/lib/ai/tasks/root-cause.lite";
import { fallbackExperiments } from "@/lib/ai/tasks/improve.lite";
import { sendHandoff } from "@/lib/handoffs/send";
import { RETRO_BOARD_ID } from "@/lib/handoffs/targets/retro-board";
import { IMPROVE_ACTIONS } from "@/lib/history/event-actions";
import { STEP_REFUSAL_TEXT, TOO_BIG, readImprovement } from "@/lib/improve/model";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { todayIso } from "@/lib/sprints/series";
import { isExampleId } from "@/lib/utils/example-id";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().improvements ?? [];
const byId = (id: string) => stored().find((i) => i.id === id);
const actions = () => logs.map((l) => l.action);
const retroCards = () => (ws().retroBoards ?? []).find((b) => b.id === RETRO_BOARD_ID)?.cards ?? [];

const T0 = "2026-11-01T09:00:00.000Z";

function a3(over: Partial<Improvement> = {}): Improvement {
  return {
    id: "improve_a3",
    title: "Releases wait six days",
    method: "a3",
    status: "open",
    background: "",
    current: { text: "" },
    target: { text: "" },
    obstacles: [],
    steps: [],
    readings: [],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function kata(over: Partial<Improvement> = {}): Improvement {
  return {
    id: "improve_k",
    title: "Reviews wait too long",
    method: "kata",
    status: "open",
    background: "Every change reviewed within a working day.",
    current: {
      text: "Most of a day",
      metric: "First-review wait",
      value: 19,
      unit: "h",
      date: "2026-11-01",
    },
    target: {
      text: "Within a morning",
      metric: "First-review wait",
      value: 8,
      unit: "h",
      date: "2099-12-04",
    },
    obstacles: [
      { id: "o1", text: "Only one reviewer", status: "working" },
      { id: "o2", text: "Big pull requests", status: "open" },
    ],
    steps: [
      {
        id: "s1",
        text: "Review slot after standup",
        expect: "Wait drops",
        status: "running",
        obstacleId: "o1",
      },
    ],
    readings: [{ id: "r1", date: "2026-11-01", value: 19 }],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

const step = (id: string, over: Partial<ImprovementStep> = {}): ImprovementStep => ({
  id,
  text: `Step ${id}`,
  status: "planned",
  ...over,
});

function analysis(
  over: Partial<RootCauseAnalysis> & Pick<RootCauseAnalysis, "id">
): RootCauseAnalysis {
  return {
    title: "Releases rolled back",
    problem: "Two of three releases were rolled back.",
    method: "five-whys",
    whys: [],
    causes: [],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <ImproveClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** Ask Amr's ideas alone, on the stored improvement (no long step list to render). */
function StoredIdeas({ id }: { id: string }) {
  const raw = useWorkspaceStore((s) => s.improvements?.find((i) => i.id === id));
  const actions = useItemActions(id, () => undefined);
  const item = raw ? readImprovement(raw) : null;
  if (!item) return null;
  return item.method === "a3" ? (
    <CountermeasureIdeas item={item} analysis={undefined} actions={actions} />
  ) : (
    <NextExperimentIdeas item={item} actions={actions} />
  );
}

const renderIdeas = (id: string) =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <StoredIdeas id={id} />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** Blur-commit a field: type, then leave it. */
function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

function openSendTo(name: RegExp) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, pointerType: "mouse" });
}

const plusDays = (n: number) => isoFromDayNumber(isoDayNumber(todayIso())! + n);

beforeEach(() => {
  undo.all = [];
  logs.length = 0;
  cheers.length = 0;
  exported.markdown = "";
  toastSpy.mockClear();
  window.history.replaceState(null, "", "/improve");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({
    improvements: [],
    rootCauseAnalyses: [],
    retroBoards: [],
    stories: [],
    impediments: [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("empty state, example and starting one", () => {
  it("starts empty, with an example to load and a start form", () => {
    renderPage();
    expect(screen.getByText(/Nothing being improved yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("loads the example, A3 and Kata, and clears only the example", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored().filter((i) => isExampleId(i.id))).toHaveLength(2);
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Improvements" });
    expect(within(nav).getByText("Releases wait six days after merge")).toBeInTheDocument();
    expect(within(nav).getByText("Reviews wait too long")).toBeInTheDocument();
    ws().upsertImprovement(a3({ id: "improve_own", title: "Our own" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().map((i) => i.id)).toEqual(["improve_own"]);
  });

  it("shows no AI buttons and no sends on the example, and never logs its edits", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.queryByRole("button", { name: "Ideas without AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send to…/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze in Root Cause" })).not.toBeInTheDocument();
    commit(screen.getByLabelText("Why this matters now, and to whom"), "Edited");
    expect(logs).toEqual([]);
    fireEvent.click(within(screen.getByRole("navigation")).getByText("Reviews wait too long"));
    expect(screen.queryByRole("button", { name: "Suggest without AI" })).not.toBeInTheDocument();
  });

  it("validates the start form: a title and a method, nothing saved before", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("Name what you'll improve in a few words.")).toBeInTheDocument();
    expect(screen.getByText("Pick an A3 or an Improvement Kata.")).toBeInTheDocument();
    expect(stored()).toEqual([]);
    expect(screen.getByLabelText(/What you'll improve/)).toHaveAttribute(
      "maxLength",
      String(TOOL_TEXT_MAX.short)
    );
  });

  it("starts an A3, logged, and shows its seven sections in order", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/What you'll improve/), {
      target: { value: "Releases wait six days" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /^A3/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const [item] = stored();
    expect(item).toMatchObject({ title: "Releases wait six days", method: "a3", status: "open" });
    expect(item.id).toMatch(/^improve_/);
    expect(logs).toEqual([
      { action: IMPROVE_ACTIONS.ITEM_CREATED, payload: { itemId: item.id, method: "a3" } },
    ]);
    expect(screen.getAllByText(/^\d\. /).map((el) => el.textContent)).toEqual([
      "1. Why it matters",
      "2. Where we are",
      "3. Where we want to be",
      "4. Why it happens",
      "5. What we'll change",
      "6. Did it work?",
      "7. What's next",
    ]);
    expect(document.activeElement?.textContent).toBe("Releases wait six days");
  });

  it("starts a Kata, with its storyboard and Coach me", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/What you'll improve/), {
      target: { value: "Faster reviews" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /^Improvement Kata/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(stored()[0].method).toBe("kata");
    expect(screen.getByRole("button", { name: "Coach me" })).toBeInTheDocument();
    expect(screen.getByText("Next target")).toBeInTheDocument();
    expect(screen.getAllByText("Obstacles").length).toBeGreaterThan(0);
  });

  it("focuses the heading when one is picked, even again, and never later on a save", () => {
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Improvements" });
    fireEvent.click(within(nav).getByText("Releases wait six days"));
    // The one already shown, picked again: focus goes to its heading at once.
    screen.getByLabelText("Why this matters now, and to whom").focus();
    fireEvent.click(within(nav).getByText("Releases wait six days"));
    expect(document.activeElement?.textContent).toBe("Releases wait six days");
    const cause = screen.getByLabelText("The cause, in a sentence or two");
    cause.focus();
    commit(screen.getByLabelText("Why this matters now, and to whom"), "Customers wait a week.");
    expect(byId("improve_a3")!.background).toBe("Customers wait a week.");
    expect(document.activeElement).toBe(cause);
  });

  it("opens ?item= once the workspace has loaded, and drops it from the address", async () => {
    useWorkspaceStore.setState({
      improvements: [
        a3({ id: "improve_new", title: "Newest", updatedAt: "2026-11-10T09:00:00.000Z" }),
        kata({ id: "improve_old", title: "Older one" }),
      ],
    });
    window.history.replaceState(null, "", "/improve?item=improve_old");
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Older one" })).toBeInTheDocument()
    );
    expect(window.location.search).toBe("");
  });
});

describe("?from= a Root Cause analysis", () => {
  const rca = analysis({
    id: "rca_1",
    title: "Releases rolled back",
    problem: "Two of three releases were rolled back.",
    rootCause: "Migrations never run on real data",
    countermeasure:
      "Rehearse every migration on a copy of production\nCheck: no rollback in three releases",
    sentTo: [{ route: "retro-action", targetId: "card_1", at: T0 }],
  });

  it("fills the start form from it and seeds the countermeasure with its sent link", async () => {
    useWorkspaceStore.setState({
      rootCauseAnalyses: [rca],
      retroBoards: [
        { id: RETRO_BOARD_ID, cards: [{ id: "card_1", isActionItem: true }] },
      ] as unknown as RetroBoard[],
    });
    window.history.replaceState(null, "", "/improve?from=rca_1");
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText(/From the Root Cause analysis “Releases rolled back”/)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText(/its problem, root cause and countermeasure come along/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/What you'll improve/)).toHaveValue("Releases rolled back");
    expect(screen.getByRole("radio", { name: /^A3/ })).toBeChecked();
    expect(stored()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const [item] = stored();
    expect(item).toMatchObject({
      method: "a3",
      background: "Two of three releases were rolled back.",
      analysis: "Migrations never run on real data",
      rootCauseId: "rca_1",
    });
    expect(item.steps).toEqual([
      {
        id: item.steps[0].id,
        text: "Rehearse every migration on a copy of production",
        expect: "no rollback in three releases",
        status: "planned",
        sentTo: [{ route: "retro-action", targetId: "card_1", at: T0 }],
      },
    ]);
    expect(logs[0]).toEqual({
      action: IMPROVE_ACTIONS.ITEM_CREATED,
      payload: { itemId: item.id, method: "a3", analysisId: "rca_1" },
    });
    expect(window.location.search).toBe("");
  });

  it("opens the improvement already made from that analysis instead", async () => {
    useWorkspaceStore.setState({
      rootCauseAnalyses: [rca],
      improvements: [
        a3({ id: "improve_other", title: "Other", updatedAt: "2026-11-10T09:00:00.000Z" }),
        a3({ id: "improve_linked", title: "Planned from it", rootCauseId: "rca_1" }),
      ],
    });
    window.history.replaceState(null, "", "/improve?from=rca_1");
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Planned from it" })).toBeInTheDocument()
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("ignores an example analysis or one that isn't there", () => {
    useWorkspaceStore.setState({ rootCauseAnalyses: [{ ...rca, id: "example-rca" }] });
    window.history.replaceState(null, "", "/improve?from=example-rca");
    renderPage();
    expect(screen.queryByText(/From the Root Cause analysis/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/What you'll improve/)).toHaveValue("");
  });
});

describe("an A3", () => {
  it("clears each gap line as its field is filled", () => {
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    const gaps = () => within(screen.getByRole("list", { name: "What's still missing" }));
    expect(gaps().getByText("Say why this matters now.")).toBeInTheDocument();
    commit(screen.getByLabelText("Why this matters now, and to whom"), "Customers wait a week.");
    expect(gaps().queryByText("Say why this matters now.")).not.toBeInTheDocument();
    expect(gaps().getByText("Give today's state a number.")).toBeInTheDocument();
    commit(screen.getAllByLabelText("Number")[0], "6");
    expect(byId("improve_a3")!.current.value).toBe(6);
    expect(gaps().queryByText("Give today's state a number.")).not.toBeInTheDocument();
    commit(screen.getByLabelText("The cause, in a sentence or two"), "A manual pass.");
    expect(
      gaps().queryByText("Write the cause, or link a Root Cause analysis.")
    ).not.toBeInTheDocument();
    expect(logs.map((l) => l.payload?.field)).toEqual(["background", "current", "analysis"]);
  });

  it("keeps every field within the CRUD's caps and refuses a number that isn't one", () => {
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    expect(screen.getByLabelText("What you’re improving")).toHaveAttribute("maxLength", "200");
    expect(screen.getByLabelText("Why this matters now, and to whom")).toHaveAttribute(
      "maxLength",
      "1000"
    );
    expect(screen.getAllByLabelText("Unit")[0]).toHaveAttribute("maxLength", "20");
    commit(screen.getAllByLabelText("Number")[1], "lots");
    expect(screen.getByRole("alert")).toHaveTextContent("Give a number, such as 6 or 1.5.");
    expect(byId("improve_a3")!.target.value).toBeUndefined();
  });

  it("adds, edits and deletes a countermeasure with Undo, and focus moves on", () => {
    useWorkspaceStore.setState({ improvements: [a3({ steps: [step("s0")] })] });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^What you'll change/), {
      target: { value: "Automate checks" },
    });
    fireEvent.change(screen.getAllByLabelText("Owner").at(-1)!, { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Add countermeasure" }));
    const added = byId("improve_a3")!.steps[1];
    expect(added).toMatchObject({
      text: "Automate checks",
      owner: "Sam",
      due: "2026-12-01",
      status: "planned",
    });
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.STEP_ADDED,
      payload: { itemId: "improve_a3", stepId: added.id },
    });
    commit(screen.getByLabelText("Countermeasure 2: what we'll change"), "Automate the checks");
    expect(byId("improve_a3")!.steps[1].text).toBe("Automate the checks");
    fireEvent.click(screen.getByRole("button", { name: "Delete countermeasure 1: Step s0" }));
    expect(lastUndo().label).toBe("Deleted “Step s0”");
    expect(byId("improve_a3")!.steps.map((s) => s.id)).toEqual([added.id]);
    expect(document.activeElement).toBe(
      screen.getByLabelText("Countermeasure 1: what we'll change")
    );
    lastUndo().revert();
    expect(byId("improve_a3")!.steps.map((s) => s.id)).toEqual(["s0", added.id]);
  });

  it("keeps the saved words when the title or a step is left blank, and says why", () => {
    useWorkspaceStore.setState({
      improvements: [a3({ steps: [step("s0", { text: "Automate checks" })] })],
    });
    renderPage();
    commit(screen.getByLabelText("What you’re improving"), "  ");
    expect(byId("improve_a3")!.title).toBe("Releases wait six days");
    expect(screen.getByLabelText("What you’re improving")).toHaveValue("Releases wait six days");
    expect(screen.getByRole("alert")).toHaveTextContent("Name what you'll improve in a few words.");
    commit(screen.getByLabelText("Countermeasure 1: what we'll change"), "");
    expect(byId("improve_a3")!.steps[0].text).toBe("Automate checks");
    expect(screen.getByLabelText("Countermeasure 1: what we'll change")).toHaveValue(
      "Automate checks"
    );
    expect(screen.getByText(STEP_REFUSAL_TEXT.blank)).toBeInTheDocument();
    // Words again: saved, and the sentence goes.
    commit(screen.getByLabelText("What you’re improving"), "Faster releases");
    expect(byId("improve_a3")!.title).toBe("Faster releases");
    expect(screen.queryByText("Name what you'll improve in a few words.")).not.toBeInTheDocument();
    expect(logs.map((l) => l.payload?.field)).toEqual(["title"]);
  });

  it("sends a countermeasure to Retro Actions once, with its owner and date", () => {
    useWorkspaceStore.setState({
      improvements: [
        a3({ steps: [step("s1", { text: "Automate checks", owner: "Sam", due: "2026-12-01" })] }),
      ],
    });
    renderPage();
    openSendTo(/^Send to… Automate checks/);
    expect(screen.getByRole("menuitem", { name: "Backlog story" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Retro action" }));
    const [card] = retroCards();
    expect(card).toMatchObject({
      text: "Automate checks",
      isActionItem: true,
      assignee: "Sam",
      dueDate: "2026-12-01",
      sourceRef: { tool: "improve", id: "s1", doc: "improve_a3" },
    });
    expect(byId("improve_a3")!.steps[0].sentTo).toEqual([
      expect.objectContaining({ route: "retro-action", targetId: card.id }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.STEP_SENT,
      payload: { itemId: "improve_a3", stepId: "s1", route: "retro-action", targetId: card.id },
    });
    openSendTo(/^Send to… Automate checks \(sent\)/);
    expect(screen.getByRole("menuitem", { name: /Retro action.*Sent · Open/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Backlog story" })).not.toBeInTheDocument();
  });

  it("reads a countermeasure ticked in Retro Actions as done", () => {
    useWorkspaceStore.setState({
      improvements: [
        a3({
          steps: [
            step("s1", {
              text: "Automate checks",
              sentTo: [{ route: "retro-action", targetId: "card_1", at: T0 }],
            }),
          ],
        }),
      ],
      retroBoards: [
        {
          id: RETRO_BOARD_ID,
          cards: [{ id: "card_1", isActionItem: true, done: true, doneAt: T0 }],
        },
      ] as unknown as RetroBoard[],
    });
    renderPage();
    expect(screen.getByText("Done in Retro Actions")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "What's still missing" })).getByText(
        "Every countermeasure is done: measure again."
      )
    ).toBeInTheDocument();
  });

  it("links an analysis, uses its root cause with Undo, and offers Unlink once it is deleted", () => {
    useWorkspaceStore.setState({
      improvements: [a3()],
      rootCauseAnalyses: [
        analysis({ id: "rca_1", title: "Slow releases", rootCause: "A manual regression pass" }),
        analysis({ id: "example-rca", title: "The example's" }),
      ],
    });
    const { unmount } = renderPage();
    const picker = screen.getByLabelText("Link a Root Cause analysis");
    expect(within(picker).queryByText("The example's")).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "rca_1" } });
    expect(byId("improve_a3")!.rootCauseId).toBe("rca_1");
    expect(screen.getByText("Root cause: A manual regression pass")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in Root Cause/ })).toHaveAttribute(
      "href",
      "/root-cause?analysis=rca_1"
    );
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(byId("improve_a3")!.analysis).toBe("A manual regression pass");
    expect(lastUndo().label).toBe("Filled in why it happens");
    lastUndo().revert();
    expect(byId("improve_a3")!.analysis).toBeUndefined();
    unmount();
    useWorkspaceStore.setState({ rootCauseAnalyses: [] });
    renderPage();
    expect(screen.getByText("The linked analysis was deleted.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(byId("improve_a3")!.rootCauseId).toBeUndefined();
  });

  it("opens a Root Cause analysis of it, linked in the same write, and one Undo clears both", () => {
    useWorkspaceStore.setState({ improvements: [a3({ background: "Customers wait a week." })] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Analyze in Root Cause" }));
    const [made] = ws().rootCauseAnalyses ?? [];
    expect(made).toMatchObject({
      title: "Releases wait six days",
      problem: "Customers wait a week.",
      sourceRef: { tool: "improve", id: "improve_a3" },
    });
    expect(byId("improve_a3")).toMatchObject({
      rootCauseId: made.id,
      sentTo: [expect.objectContaining({ route: "root-cause", targetId: made.id })],
    });
    lastUndo().revert();
    expect(ws().rootCauseAnalyses).toEqual([]);
    expect(byId("improve_a3")!.rootCauseId).toBeUndefined();
    expect(byId("improve_a3")!.sentTo).toBeUndefined();
  });

  it("logs readings, says what's missing below two, refuses a later day, and deletes with Undo", () => {
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    expect(screen.getByText("Log 2 more readings to see the run chart.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Reading\*?$/), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Log reading" }));
    const today = todayIso();
    expect(byId("improve_a3")!.readings).toEqual([
      expect.objectContaining({ date: today, value: 6 }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.READING_LOGGED,
      payload: { itemId: "improve_a3", day: today },
    });
    expect(screen.getByText("Log 1 more reading to see the run chart.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Day\*?$/), { target: { value: "2999-01-01" } });
    fireEvent.change(screen.getByLabelText(/^Reading\*?$/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Log reading" }));
    expect(
      screen.getByText("A reading can't be for a day that hasn't come yet.")
    ).toBeInTheDocument();
    expect(byId("improve_a3")!.readings).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `Delete the reading for ${today}` }));
    expect(byId("improve_a3")!.readings).toEqual([]);
    lastUndo().revert();
    expect(byId("improve_a3")!.readings).toHaveLength(1);
  });

  it("closes, stamping closedAt and logging it", () => {
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    fireEvent.change(screen.getByLabelText("Improvement status"), { target: { value: "closed" } });
    expect(byId("improve_a3")!.closedAt).toBeTypeOf("string");
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.ITEM_CLOSED,
      payload: { itemId: "improve_a3", status: "closed" },
    });
  });

  it("refuses, and says so, a change that would grow the record past one saved row", () => {
    // 45 steps of four 1,000-character fields in 3-byte text: about 540 KB, over one row.
    // Through the page's own write (rendering 45 such rows is slow in jsdom).
    const big = "界".repeat(TOOL_TEXT_MAX.text);
    const steps = Array.from({ length: 45 }, (_, i) =>
      step(`s${i}`, { text: big, expect: big, result: big, learned: big, status: "dropped" })
    );
    useWorkspaceStore.setState({ improvements: [a3({ steps })] });
    const { result } = renderHook(() => useItemActions("improve_a3", () => undefined), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>
      ),
    });
    let why: string | null = null;
    act(() => {
      why = result.current.addStep({ text: "One more" });
    });
    expect(why).toBe(TOO_BIG);
    expect(result.current.rowError).toBe(TOO_BIG);
    expect(byId("improve_a3")!.steps).toHaveLength(45);
    // A change that doesn't grow it still saves.
    act(() => {
      result.current.setTitle("Shorter title");
    });
    expect(byId("improve_a3")!.title).toBe("Shorter title");
    expect(result.current.rowError).toBeNull();
  });
});

describe("a change the row can't hold is refused before its Undo toast", () => {
  // 45 steps of four 1,000-character fields in 3-byte text: about 540 KB, over one row.
  const big = "界".repeat(TOOL_TEXT_MAX.text);
  const giantSteps = () =>
    Array.from({ length: 45 }, (_, i) =>
      step(`s${i}`, { text: big, expect: big, result: big, learned: big, status: "dropped" })
    );
  const hook = (id: string) =>
    renderHook(() => useItemActions(id, () => undefined), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>
      ),
    });

  it("an accepted idea, a root cause used and Reached it: no toast, the refusal said", () => {
    useWorkspaceStore.setState({
      improvements: [
        a3({ steps: giantSteps() }),
        kata({ id: "improve_big_k", steps: giantSteps(), obstacles: [] }),
      ],
    });
    const { result } = hook("improve_a3");
    let why: string | null = null;
    act(() => {
      why = result.current.addStep({ text: "One more", expect: "It works" }, { fromAi: true });
    });
    expect(why).toBe(TOO_BIG);
    act(() => {
      why = result.current.applyRootCause("A manual regression pass");
    });
    expect(why).toBe(TOO_BIG);
    expect(result.current.rowError).toBe(TOO_BIG);
    expect(byId("improve_a3")!.steps).toHaveLength(45);
    expect(byId("improve_a3")!.analysis).toBeUndefined();
    const kataHook = hook("improve_big_k");
    act(() => {
      why = kataHook.result.current.reachTarget();
    });
    expect(why).toBe(TOO_BIG);
    expect(byId("improve_big_k")!.pastTargets).toBeUndefined();
    expect(undo.all).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("a coaching talk is refused as too big, saving nothing, with no toast", () => {
    useWorkspaceStore.setState({ improvements: [kata({ steps: giantSteps(), obstacles: [] })] });
    const { result } = hook("improve_k");
    let refusal: unknown = null;
    act(() => {
      refusal = result.current.saveCoaching({
        nextTry: { text: "Cap PRs at 300 lines", expect: "Reviews start sooner" },
      });
    });
    expect(refusal).toEqual({ reason: "too_big" });
    expect(byId("improve_k")!.steps).toHaveLength(45);
    expect(undo.all).toEqual([]);
  });

  it("the coaching walk stays open with its answers when the talk is too big", () => {
    const onClose = vi.fn();
    render(<CoachWalk item={kata()} onSave={() => ({ reason: "too_big" })} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("What you saw"), {
      target: { value: "It fell to 15 h" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and stop" }));
    expect(screen.getByRole("alert")).toHaveTextContent(TOO_BIG);
    expect(screen.getByLabelText("What you saw")).toHaveValue("It fell to 15 h");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes back a sent action whose link the row can't hold, so it can't be sent twice", () => {
    useWorkspaceStore.setState({ improvements: [a3({ steps: giantSteps() })] });
    const { result } = hook("improve_a3");
    act(() => {
      sendHandoff(
        "retro-action",
        { title: "Automate checks", sourceRef: { tool: "improve", id: "s0", doc: "improve_a3" } },
        {
          getLinks: () => byId("improve_a3")!.steps[0].sentTo,
          setLinks: (update) => result.current.stepLinks("s0", update),
        }
      );
    });
    expect(retroCards()).toEqual([]);
    expect(byId("improve_a3")!.steps[0].sentTo).toBeUndefined();
    expect(result.current.rowError).toBe(TOO_BIG);
  });
});

describe("a Kata", () => {
  it("works on one obstacle at a time; adds, clears and deletes obstacles with Undo", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    // The obstacle's own field (the experiments' "Works on" selects show the same words).
    const row = (text: string) =>
      screen
        .getAllByDisplayValue(text)
        .find((el) => el.tagName === "INPUT")!
        .closest("li") as HTMLElement;
    fireEvent.click(within(row("Big pull requests")).getByRole("button", { name: "Work on this" }));
    expect(byId("improve_k")!.obstacles.map((o) => o.status)).toEqual(["open", "working"]);
    fireEvent.change(screen.getByLabelText(/^What's in the way/), {
      target: { value: "Nobody owns the queue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add obstacle" }));
    const added = byId("improve_k")!.obstacles[2];
    expect(added).toMatchObject({ text: "Nobody owns the queue", status: "open" });
    expect(logs.at(-1)?.action).toBe(IMPROVE_ACTIONS.OBSTACLE_ADDED);
    fireEvent.click(within(row("Only one reviewer")).getByRole("button", { name: "Cleared" }));
    expect(byId("improve_k")!.obstacles[0].status).toBe("cleared");
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.OBSTACLE_CLEARED,
      payload: { itemId: "improve_k", obstacleId: "o1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete obstacle: Nobody owns the queue" }));
    expect(byId("improve_k")!.obstacles).toHaveLength(2);
    lastUndo().revert();
    expect(byId("improve_k")!.obstacles).toHaveLength(3);
  });

  it("keeps an obstacle's words when its box is left blank, and says why", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    const box = () =>
      screen.getAllByDisplayValue("Only one reviewer").find((el) => el.tagName === "INPUT")!;
    commit(box(), " ");
    expect(byId("improve_k")!.obstacles[0].text).toBe("Only one reviewer");
    expect(box()).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Say what's in the way.");
  });

  it("says a full obstacle list frees a place only by a delete", () => {
    const obstacles = Array.from({ length: TOOL_LIST_MAX.kataObstacles }, (_, i) => ({
      id: `o${i}`,
      text: `Obstacle ${i}`,
      status: i === 0 ? ("cleared" as const) : ("open" as const),
    }));
    render(
      <ObstacleList
        item={kata({ obstacles, steps: [] })}
        actions={{ example: true } as unknown as ItemActions}
      />
    );
    expect(screen.queryByRole("button", { name: "Add obstacle" })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "A Kata holds 30 obstacles at most. Delete one to add another: cleared ones still count."
      )
    ).toBeInTheDocument();
  });

  it("sends an obstacle outside the team's control to Impediments", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    openSendTo(/^Send to… Only one reviewer/);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Impediment/ }));
    const [imp] = ws().impediments ?? [];
    expect(imp).toMatchObject({
      title: "Only one reviewer",
      sourceRef: { tool: "improve", id: "o1", doc: "improve_k" },
    });
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.OBSTACLE_SENT,
      payload: { itemId: "improve_k", obstacleId: "o1", route: "impediment", targetId: imp.id },
    });
  });

  it("won't run an experiment that doesn't say what the team expects", () => {
    useWorkspaceStore.setState({
      improvements: [kata({ steps: [step("s1", { text: "Look closer" })] })],
    });
    renderPage();
    expect(screen.getByText("Say what you expect before you try.")).toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "running" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Say what you expect before you try.");
    expect(byId("improve_k")!.steps[0].status).toBe("planned");
    commit(screen.getByLabelText("What we expect"), "We see where it waits");
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "running" } });
    expect(byId("improve_k")!.steps[0]).toMatchObject({
      status: "running",
      expect: "We see where it waits",
    });
  });

  it("marks an experiment done, logged once", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    fireEvent.change(screen.getAllByLabelText("Status")[0], { target: { value: "done" } });
    expect(byId("improve_k")!.steps[0].doneAt).toBeTypeOf("string");
    expect(actions().filter((a) => a === IMPROVE_ACTIONS.STEP_DONE)).toHaveLength(1);
  });

  it("walks the six-step coaching talk and saves it once, with one Undo", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Coach me" }));
    const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Coaching talk · step 1 of 6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Since last time" })).toHaveFocus();
    expect(screen.getByText(/Last time you tried “Review slot after standup”/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What you saw"), {
      target: { value: "It fell to 15 h" },
    });
    fireEvent.change(screen.getByLabelText("What you know now"), {
      target: { value: "Who reviews matters" },
    });
    next();
    expect(screen.getByRole("heading", { name: "Today's number" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("First-review wait (h)"), { target: { value: "15" } });
    next();
    expect(
      screen.getByText(/Is “Within a morning” by 2099-12-04 still what you're aiming for\?/)
    ).toBeInTheDocument();
    next();
    fireEvent.click(screen.getByRole("radio", { name: "Big pull requests" }));
    next();
    fireEvent.change(screen.getByLabelText("What you’ll try next"), {
      target: { value: "Cap PRs at 300 lines" },
    });
    next();
    // A try with no expectation can't go on: the walk stays and says so.
    expect(screen.getByRole("alert")).toHaveTextContent("Say what you expect before you try.");
    expect(screen.getByRole("heading", { name: "Next try" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What you think will happen"), {
      target: { value: "Reviews start sooner" },
    });
    next();
    expect(screen.getByLabelText("Next coaching talk")).toHaveValue(plusDays(2));
    expect(undo.all).toEqual([]);
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(undo.all.map((u) => u.label)).toEqual(["Coaching talk saved"]);
    expect(logs).toEqual([
      {
        action: IMPROVE_ACTIONS.COACHING_DONE,
        payload: { itemId: "improve_k", next: plusDays(2), reading: true, experiment: true },
      },
    ]);
    const item = byId("improve_k")!;
    expect(item.steps[0]).toMatchObject({
      result: "It fell to 15 h",
      learned: "Who reviews matters",
      status: "done",
    });
    expect(item.steps[1]).toMatchObject({
      text: "Cap PRs at 300 lines",
      expect: "Reviews start sooner",
      obstacleId: "o2",
      status: "planned",
    });
    expect(item.readings.at(-1)).toMatchObject({ value: 15, date: todayIso() });
    expect(item.obstacles.map((o) => o.status)).toEqual(["open", "working"]);
    expect(item.nextCoachingAt).toBe(plusDays(2));
    expect(screen.getByRole("button", { name: "Coach me" })).toHaveFocus();
    // A reading logged while the Undo is offered isn't lost by it.
    act(() => {
      const now = byId("improve_k")!;
      ws().upsertImprovement({
        ...now,
        readings: [...now.readings, { id: "r_late", date: todayIso(), value: 14 }],
      });
    });
    lastUndo().revert();
    expect(byId("improve_k")!.steps).toHaveLength(1);
    expect(byId("improve_k")!.steps[0]).toEqual(kata().steps[0]);
    expect(byId("improve_k")!.nextCoachingAt).toBeUndefined();
    expect(byId("improve_k")!.readings.map((r) => r.id)).toEqual(["r1", "r_late"]);
    expect(byId("improve_k")!.obstacles.map((o) => o.status)).toEqual(["working", "open"]);
  });

  it("saves nothing when the talk is left midway, and what was answered with Save and stop", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Coach me" }));
    fireEvent.change(screen.getByLabelText("What you saw"), { target: { value: "Nothing new" } });
    fireEvent.click(screen.getByRole("button", { name: "Leave without saving" }));
    expect(byId("improve_k")).toEqual(kata());
    expect(undo.all).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Coach me" }));
    fireEvent.change(screen.getByLabelText("What you saw"), { target: { value: "Nothing new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and stop" }));
    expect(byId("improve_k")!.steps[0].result).toBe("Nothing new");
    expect(byId("improve_k")!.nextCoachingAt).toBeUndefined();
    expect(actions()).toEqual([IMPROVE_ACTIONS.COACHING_DONE]);
  });

  it("Reached it keeps the target as a past one, logs, cheers and can be undone", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reached it" }));
    const item = byId("improve_k")!;
    expect(item.pastTargets).toEqual([
      expect.objectContaining({ text: "Within a morning", value: 8 }),
    ]);
    expect(item.target).toEqual({ text: "", metric: "First-review wait", unit: "h" });
    expect(item.current).toMatchObject({ text: "Within a morning", value: 19 });
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.TARGET_REACHED,
      payload: { itemId: "improve_k", reached: 1 },
    });
    expect(cheers).toEqual([["improve", "milestone"]]);
    expect(screen.getByText(/reached \d{4}-\d{2}-\d{2}/)).toBeInTheDocument();
    lastUndo().revert();
    expect(byId("improve_k")!.target).toEqual(kata().target);
    expect(byId("improve_k")!.pastTargets).toBeUndefined();
  });
});

describe("Ask Amr, and its no-AI path", () => {
  it("suggests A3 countermeasures from the cause; several can be added, each with its check", () => {
    useWorkspaceStore.setState({ improvements: [a3({ analysis: "A manual regression pass" })] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Ideas without AI" }));
    const ideas = fallbackCountermeasures("A manual regression pass");
    expect(screen.getByText("Possible countermeasures")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Add: / })[0]);
    expect(byId("improve_a3")!.steps).toEqual([
      expect.objectContaining({ text: ideas[0].text, expect: ideas[0].check, status: "planned" }),
    ]);
    expect(lastUndo().label).toBe("Added a countermeasure");
    expect(screen.getByLabelText("How you’ll know it worked")).toHaveValue(ideas[0].check);
    fireEvent.click(screen.getAllByRole("button", { name: /^Add: / })[0]);
    expect(byId("improve_a3")!.steps).toHaveLength(2);
    lastUndo().revert();
    expect(byId("improve_a3")!.steps).toHaveLength(1);
  });

  it("waits for the cause before suggesting countermeasures", () => {
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    const ask = screen.getByRole("button", { name: "Ideas without AI" });
    expect(ask).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(ask);
    expect(screen.getAllByText("Write why it happens first.").length).toBeGreaterThan(0);
    expect(byId("improve_a3")!.steps).toEqual([]);
  });

  it("suggests a Kata's next experiment against the obstacle worked on; one is picked, with Undo", () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    const ideas = fallbackExperiments("Only one reviewer", "First-review wait", "Within a morning");
    expect(screen.queryByRole("button", { name: /^Plan all/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Plan: / })[0]);
    expect(byId("improve_k")!.steps[1]).toEqual(
      expect.objectContaining({
        text: ideas[0].step,
        expect: ideas[0].expect,
        obstacleId: "o1",
        status: "planned",
      })
    );
    expect(lastUndo().label).toBe("Added an experiment");
    expect(screen.queryByText("Possible next experiments")).not.toBeInTheDocument();
  });

  it("waits for an obstacle being worked on before suggesting an experiment", () => {
    useWorkspaceStore.setState({
      improvements: [
        kata({ obstacles: [{ id: "o1", text: "Only one reviewer", status: "open" }] }),
      ],
    });
    renderPage();
    const ask = screen.getByRole("button", { name: "Suggest without AI" });
    expect(ask).toHaveAttribute("aria-disabled", "true");
  });

  it("waits on a full list, and an idea the list can't take stays in it, saying why", () => {
    const steps = Array.from({ length: TOOL_LIST_MAX.improveSteps - 1 }, (_, i) => step(`s${i}`));
    useWorkspaceStore.setState({
      improvements: [a3({ analysis: "A manual regression pass", steps })],
    });
    renderIdeas("improve_a3");
    fireEvent.click(screen.getByRole("button", { name: "Ideas without AI" }));
    const ideas = fallbackCountermeasures("A manual regression pass");
    fireEvent.click(screen.getByRole("button", { name: `Add: ${ideas[0].text}` }));
    expect(byId("improve_a3")!.steps).toHaveLength(TOOL_LIST_MAX.improveSteps);
    const ask = screen.getByRole("button", { name: "Ideas without AI" });
    expect(ask).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: `Add: ${ideas[1].text}` }));
    expect(screen.getByRole("alert")).toHaveTextContent(STEP_REFUSAL_TEXT.list_full);
    expect(byId("improve_a3")!.steps).toHaveLength(TOOL_LIST_MAX.improveSteps);
    expect(undo.all).toHaveLength(1);
    // The refused idea is still there to add once a row is free; the added one isn't back.
    expect(screen.getByRole("button", { name: `Add: ${ideas[1].text}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Add: ${ideas[0].text}` })).not.toBeInTheDocument();
    fireEvent.click(ask);
    expect(screen.getAllByText(STEP_REFUSAL_TEXT.list_full).length).toBeGreaterThan(1);
  });

  it("keeps a Kata's ideas open, saying why, when the one picked can't be planned", () => {
    const tries = (n: number) =>
      Array.from({ length: n }, (_, i) => step(`s${i}`, { expect: "It moves" }));
    useWorkspaceStore.setState({
      improvements: [kata({ steps: tries(TOOL_LIST_MAX.improveSteps - 1) })],
    });
    renderIdeas("improve_k");
    fireEvent.click(screen.getByRole("button", { name: "Suggest without AI" }));
    // The list fills up (another tab, or Amr) before one is picked.
    act(() => {
      ws().upsertImprovement({ ...byId("improve_k")!, steps: tries(TOOL_LIST_MAX.improveSteps) });
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^Plan: / })[0]);
    expect(screen.getByRole("alert")).toHaveTextContent(STEP_REFUSAL_TEXT.list_full);
    expect(screen.getByText("Possible next experiments")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Plan: / })).toHaveLength(3);
    expect(byId("improve_k")!.steps).toHaveLength(TOOL_LIST_MAX.improveSteps);
    expect(undo.all).toEqual([]);
  });
});

describe("delete, export and the forms' checks", () => {
  it("deletes an improvement with Undo", () => {
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(stored()).toEqual([]);
    expect(logs.at(-1)).toEqual({
      action: IMPROVE_ACTIONS.ITEM_REMOVED,
      payload: { itemId: "improve_a3", method: "a3" },
    });
    lastUndo().revert();
    expect(stored().map((i) => i.id)).toEqual(["improve_a3"]);
  });

  it("exports both methods as Markdown, pipes escaped", () => {
    const now = new Date("2026-11-20T09:00:00Z");
    const md = improveToMarkdown(buildExample(now), { verdict: "One line." });
    expect(md).toContain("# Improvements");
    expect(md).toContain("> One line.");
    expect(md).toContain("## Releases wait six days after merge");
    expect(md).toContain("A3 · Open");
    expect(md).toContain("| What | Owner | Due | Status |");
    expect(md).toContain("Improvement Kata · Open");
    expect(md).toContain("| Try | Expect | Happened | Learned | Status |");
    expect(md).toContain("- ~~Nobody sees a new review request until the afternoon~~ (cleared)");
    const piped = improveToMarkdown([a3({ steps: [step("s1", { text: "A | B" })] })]);
    expect(piped).toContain("| A \\| B |");
    useWorkspaceStore.setState({ improvements: [a3()] });
    renderPage();
    expect(exported.markdown).toContain("## Releases wait six days");
  });

  it("checks each form's draft before saving", () => {
    expect(
      validateStepDraft({ text: " ", owner: "", due: "", expect: "", obstacleId: "" })
    ).toEqual({
      ok: false,
      errors: { text: "Say what you'll do." },
    });
    expect(
      validateStepDraft({ text: "Try", owner: "", due: "2026-02-30", expect: "", obstacleId: "" })
        .ok
    ).toBe(false);
    expect(
      validateReadingDraft({ date: "2026-11-21", value: "3", note: "" }, "2026-11-20")
    ).toEqual({
      ok: false,
      errors: { date: "A reading can't be for a day that hasn't come yet." },
    });
    expect(
      validateReadingDraft({ date: "2026-11-20", value: "x", note: "" }, "2026-11-20").ok
    ).toBe(false);
    expect(
      validateReadingDraft({ date: "2026-11-20", value: "2,5", note: "" }, "2026-11-20")
    ).toEqual({
      ok: true,
      values: { date: "2026-11-20", value: 2.5, note: "" },
    });
    expect(validateObstacleDraft({ text: "" }).ok).toBe(false);
    expect(readingsText(kata()).summary).toBe(
      "One reading: 19 h on 2026-11-01. The target is 8 h: 0% of the way."
    );
  });
});
