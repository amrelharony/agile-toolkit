/**
 * The Release Planner's "count items" mode: the mode switch (points stay
 * the default), weekly throughput from the Sprint board or typed with a
 * check, the "not enough history" guard, the items left from the backlog
 * or typed, the answers and their histogram, the features in order with
 * the cut line (typed or counted from an epic, moved, removed with Undo),
 * the export, the example, and the stored config read back safely.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    markdown,
    csvData,
  }: {
    markdown?: string;
    csvData?: { headers: string[]; rows: unknown[][] };
  }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <pre data-testid="export-csv">{JSON.stringify(csvData)}</pre>
    </>
  ),
}));
const logs = vi.hoisted(() => [] as { action: string; payload: unknown }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: unknown) => logs.push({ action, payload }),
  }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { ReleasePlannerClient } from "@/app/(tools)/release-planner/release-planner-client";
import {
  EMPTY_CONFIG,
  isEmptyConfig,
  normalizeConfig,
  useReleasePlannerStore,
} from "@/app/(tools)/release-planner/store";
import {
  buildExample,
  clearedExample,
  EXAMPLE_FEATURES,
} from "@/app/(tools)/release-planner/example";
import {
  featureRows,
  movedFeature,
  openStoriesByEpic,
  validateFeatureDraft,
} from "@/app/(tools)/release-planner/throughput";
import { validateItemCount } from "@/app/(tools)/release-planner/validate";

const config = () => useReleasePlannerStore.getState().config;
const renderPlanner = () => render(<ReleasePlannerClient />);
const itemsMode = () => fireEvent.click(screen.getByRole("radio", { name: "Item count" }));

/** A story finished on `day` (noon UTC), in no sprint. */
const doneStory = (id: string, day: string): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  startedAt: `${day}T09:00:00.000Z`,
  doneAt: `${day}T12:00:00.000Z`,
});
const open = (id: string, extra: Partial<Story> = {}): Story => ({
  id,
  title: `Open ${id}`,
  status: "backlog",
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 12, 9, 0, 0)); // Thu 12 Nov 2026 (2026-W46)
  toastSpy.mockReset();
  logs.length = 0;
  useReleasePlannerStore.setState({ config: EMPTY_CONFIG });
  useWorkspaceStore.setState({
    sprints: [],
    stories: [],
    storyMaps: [],
    ceremonyCadences: [],
    kanbanBoards: [],
    epicRoadmaps: [],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the mode", () => {
  it("keeps story points as the default and switches to items and back", () => {
    renderPlanner();
    // The switch carries a visible caption, the words the guide points to.
    expect(document.querySelector("[data-forecast-by]")).toHaveTextContent(
      /^Forecast byStory pointsItem count$/
    );
    expect(screen.getByRole("radiogroup", { name: "Forecast by" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Story points" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    itemsMode();
    expect(config().mode).toBe("items");
    expect(screen.getByRole("heading", { name: "Items left" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Throughput" })).toBeInTheDocument();
    // Weeks, not sprints: no sprint length here.
    expect(screen.queryByLabelText("Sprint length")).toBeNull();
    expect(
      screen.getByText(/Set the items left and the weekly throughput above/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Story points" }));
    expect(config().mode).toBeUndefined();
    expect(screen.getByLabelText("Sprint length")).toBeInTheDocument();
  });
});

describe("the example", () => {
  it("forecasts 48 items from typed weeks and draws the cut line", () => {
    renderPlanner();
    itemsMode();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(config()).toMatchObject({
      mode: "items",
      throughputSource: "typed",
      itemsSource: "typed",
      itemsCount: 48,
      features: EXAMPLE_FEATURES,
    });
    expect(screen.getByTestId("items-verdict").textContent).toMatch(
      /^48 items are done by .+ in 85% of runs; the chance by .+ is \d+%\.$/
    );
    expect(
      screen.getByRole("heading", { name: "When will 48 items be done?" })
    ).toBeInTheDocument();
    expect(document.querySelector("[data-weeks-histogram]")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(
        /^Weeks needed across 10,000 runs: from \d+ weeks to \d+ weeks, half within/
      )
    );
    const list = screen.getByRole("list", { name: "Features in order" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(document.querySelector("[data-cut-line]")).toHaveTextContent(/^Cut line: /);
    expect(useWorkspaceStore.getState().stories).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(config()).toMatchObject({ mode: "items", itemsCount: undefined, features: undefined });
  });

  it("clears every field it set, keeping what was there before", () => {
    const cleared = clearedExample({ ...EMPTY_CONFIG, ...buildExample("2026-11-12") });
    expect(cleared).toMatchObject({
      throughputSource: undefined,
      throughputInput: undefined,
      itemsSource: undefined,
      itemsCount: undefined,
      features: undefined,
    });
  });
});

describe("throughput", () => {
  it("reads the Sprint board's finished stories by complete week", () => {
    useWorkspaceStore.setState({
      stories: [
        doneStory("a", "2026-10-13"), // W42
        doneStory("b", "2026-10-14"), // W42
        doneStory("c", "2026-10-21"), // W43
        doneStory("d", "2026-10-28"), // W44
        doneStory("e", "2026-11-04"), // W45
        doneStory("f", "2026-11-11"), // this week: waits
        open("o1"),
        open("o2"),
      ],
    });
    renderPlanner();
    itemsMode();
    expect(screen.getByRole("radio", { name: "Sprint board" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(
      screen.getByText(/^4 complete weeks of the Sprint board, oldest first:/)
    ).toHaveTextContent("2, 1, 1, 1");
    expect(screen.getByText("About 1.3 items a week.")).toBeInTheDocument();
    // The items left are the open backlog stories.
    expect(screen.getByRole("radio", { name: "Open backlog stories" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByText("2 open stories")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "When will 2 items be done?" })).toBeInTheDocument();
  });

  it("waits for four weeks of history", () => {
    useWorkspaceStore.setState({
      stories: [doneStory("a", "2026-10-28"), doneStory("b", "2026-11-04"), open("o")],
    });
    renderPlanner();
    itemsMode();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finish work over 2 more weeks of throughput to see an item forecast."
    );
    expect(screen.queryByTestId("items-verdict")).toBeNull();
  });

  it("checks typed weekly counts and saves only a valid list", () => {
    renderPlanner();
    itemsMode();
    fireEvent.click(screen.getByRole("radio", { name: "Type them" }));
    const box = screen.getByLabelText("Items finished per week, oldest first");
    fireEvent.change(box, { target: { value: "3, 4, x" } });
    expect(
      screen.getByText("Each week is a whole number of items, 0 or more (not “x”).")
    ).toBeInTheDocument();
    expect(config().throughputInput).toBeUndefined();
    fireEvent.change(box, { target: { value: "3, 4, 0, 5" } });
    fireEvent.blur(box);
    expect(config().throughputInput).toBe("3, 4, 0, 5");
    expect(screen.getByText("4 weeks, about 3 items a week.")).toBeInTheDocument();
  });

  it("follows the history window picked", () => {
    useWorkspaceStore.setState({
      stories: [doneStory("a", "2026-01-06"), doneStory("b", "2026-11-03")],
    });
    renderPlanner();
    itemsMode();
    expect(
      screen.getByText(/^12 complete weeks of the Sprint board \(the last 12\)/)
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Weeks of history"), { target: { value: "26" } });
    expect(config().throughputWeeks).toBe(26);
    expect(
      screen.getByText(/^26 complete weeks of the Sprint board \(the last 26\)/)
    ).toBeInTheDocument();
  });
});

describe("items left", () => {
  it("checks a typed count", () => {
    expect(validateItemCount("40")).toEqual({ ok: true, values: 40 });
    expect(validateItemCount("")).toEqual({ ok: true, values: null });
    expect(validateItemCount("2.5").ok).toBe(false);
    expect(validateItemCount("0").ok).toBe(false);
    expect(validateItemCount("200000").ok).toBe(false);
  });

  it("answers how many items fit by the target date", () => {
    useReleasePlannerStore.setState({
      config: {
        ...EMPTY_CONFIG,
        mode: "items",
        throughputSource: "typed",
        throughputInput: "4, 4, 4, 4",
        startDate: "2026-11-16",
        targetDate: "2026-12-14",
      },
    });
    renderPlanner();
    expect(
      screen.getByRole("heading", { name: "How many items by Dec 14, 2026?" })
    ).toBeInTheDocument();
    expect(screen.getByText("4 whole weeks from the start.")).toBeInTheDocument();
    // Two across on a phone, as the When cards are: three across left a
    // three-digit count running over its card at 375 px.
    const cards = document.querySelector<HTMLElement>("[data-how-many]")!;
    expect(cards.className.split(" ")).toEqual(
      expect.arrayContaining(["grid-cols-2", "lg:grid-cols-4"])
    );
    expect(cards.className).not.toContain("grid-cols-3");
    expect(cards).toHaveTextContent("Coin flip (P50)16items");
    expect(cards).toHaveTextContent("Commit (P85)16items");
    expect(cards).toHaveTextContent("Safe (P95)16items");
    expect(screen.getByTestId("items-verdict")).toHaveTextContent(
      "By Dec 14, 2026 the team finishes at least 16 items in 85% of runs."
    );
  });

  it("names each percentile the same way in the cards, the feature rows and the export", () => {
    useReleasePlannerStore.setState({
      config: {
        ...EMPTY_CONFIG,
        mode: "items",
        throughputSource: "typed",
        throughputInput: "4, 4, 4, 4",
        itemsSource: "typed",
        itemsCount: 20,
        startDate: "2026-11-16",
        targetDate: "2026-12-28",
        features: [{ id: "f1", name: "Saved cards", items: 8 }],
      },
    });
    renderPlanner();
    // The When cards and the How-many cards: Coin flip, Commit, Safe, each twice.
    for (const label of ["Coin flip (P50)", "Commit (P85)", "Safe (P95)"]) {
      expect(screen.getAllByText(label)).toHaveLength(2);
    }
    const row = within(screen.getByRole("list", { name: "Features in order" })).getByRole(
      "listitem"
    );
    expect(row).toHaveTextContent(/coin flip .+, commit /);
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain(
      "| # | Feature | Items | Coin flip (P50) | Commit (P85) | By the target |"
    );
    expect(md).toContain("- Commit (P85): at least 24 items in 85% of runs");
    // "Likely" and "to promise" no longer stand for a percentile anywhere here.
    expect(document.body.textContent).not.toMatch(/likely|promise/i);
    expect(md).not.toMatch(/likely|promise/i);
  });
});

describe("the cut line", () => {
  const base = {
    ...EMPTY_CONFIG,
    mode: "items" as const,
    throughputSource: "typed" as const,
    throughputInput: "4, 4, 4, 4",
    startDate: "2026-11-16",
    targetDate: "2026-12-28", // 6 weeks: 24 items
  };

  it("adds features with a check, and dates each one counting those before it", () => {
    useReleasePlannerStore.setState({ config: base });
    renderPlanner();
    const form = screen.getByRole("form", { name: "Add a feature" });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(within(form).getByText("Name the feature, or pick an epic.")).toBeInTheDocument();
    expect(
      within(form).getByText("Use a whole number of items from 1 to 1000.")
    ).toBeInTheDocument();
    expect(config().features).toBeUndefined();

    const add = (name: string, items: string) => {
      fireEvent.change(within(form).getByLabelText("Feature"), { target: { value: name } });
      fireEvent.change(within(form).getByLabelText("Items"), { target: { value: items } });
      fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    };
    add("Saved cards", "8");
    add("Refunds", "12");
    add("Receipts", "6");
    expect(config().features?.map((f) => [f.name, f.items])).toEqual([
      ["Saved cards", 8],
      ["Refunds", 12],
      ["Receipts", 6],
    ]);
    const items = within(screen.getByRole("list", { name: "Features in order" })).getAllByRole(
      "listitem"
    );
    expect(items[0]).toHaveTextContent(
      "1. Saved cards8 items · coin flip Nov 30, 2026, commit Nov 30, 2026"
    );
    expect(items[2]).toHaveTextContent("below the line");
    // The line sits above the first feature past the date.
    expect(items[2].querySelector("[data-cut-line]")).toHaveTextContent("Cut line: Dec 28, 2026");
    expect(items[1].querySelector("[data-cut-line]")).toBeNull();
  });

  it("moves a feature and removes one with Undo", () => {
    useReleasePlannerStore.setState({
      config: {
        ...base,
        features: [
          { id: "f1", name: "Saved cards", items: 8 },
          { id: "f2", name: "Refunds", items: 12 },
        ],
      },
    });
    renderPlanner();
    expect(screen.getByRole("button", { name: "Move Saved cards up" })).toBeDisabled();
    const down = screen.getByRole("button", { name: "Move Saved cards down" });
    down.focus();
    fireEvent.click(down);
    expect(config().features?.map((f) => f.id)).toEqual(["f2", "f1"]);
    // Now last, its Move down is disabled: focus stays on the feature, on Move up.
    expect(screen.getByRole("button", { name: "Move Saved cards down" })).toBeDisabled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move Saved cards up" })
    );

    const remove = screen.getByRole("button", { name: "Remove Refunds" });
    remove.focus();
    fireEvent.click(remove);
    expect(config().features?.map((f) => f.id)).toEqual(["f1"]);
    // Focus goes to the next feature's Remove, not to the page.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove Saved cards" }));
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Removed “Refunds” from the features");
    act(() => opts.action.onClick());
    expect(config().features?.map((f) => f.id)).toEqual(["f2", "f1"]);
  });

  it("keeps focus on a feature moved up, and on the name box once the last one is removed", () => {
    useReleasePlannerStore.setState({
      config: {
        ...base,
        features: [
          { id: "f1", name: "Saved cards", items: 8 },
          { id: "f2", name: "Refunds", items: 12 },
          { id: "f3", name: "Receipts", items: 6 },
        ],
      },
    });
    renderPlanner();
    fireEvent.click(screen.getByRole("button", { name: "Move Receipts up" }));
    expect(config().features?.map((f) => f.id)).toEqual(["f1", "f3", "f2"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Receipts up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Receipts up" }));
    // First now: its Move up is disabled, so focus takes its Move down.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Receipts down" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove Refunds" }));
    // The last one: the one before it takes focus.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove Saved cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Saved cards" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Receipts" }));
    expect(config().features).toEqual([]);
    expect(document.activeElement).toBe(
      within(screen.getByRole("form", { name: "Add a feature" })).getByLabelText("Feature")
    );
  });

  it("dates each feature by its own row when an epic before it has nothing left", () => {
    useWorkspaceStore.setState({
      epicRoadmaps: [
        {
          id: "epicRoadmap:current",
          epics: [
            { id: "e1", title: "Wallets", startQuarter: "Q1", endQuarter: "Q2", progress: 100 },
          ],
        },
      ],
      // Every story in the epic is done.
      stories: [{ ...open("w1", { epicId: "e1" }), status: "done" }],
    });
    useReleasePlannerStore.setState({
      config: {
        ...base,
        features: [
          { id: "fA", name: "", epicId: "e1" },
          { id: "fB", name: "Typed", items: 10 },
        ],
      },
    });
    renderPlanner();
    const items = within(screen.getByRole("list", { name: "Features in order" })).getAllByRole(
      "listitem"
    );
    expect(items[0]).toHaveTextContent(
      "1. Wallets0 items · open stories in the epic · nothing left to count"
    );
    expect(items[0]).not.toHaveTextContent("coin flip");
    expect(items[1]).toHaveTextContent(
      "2. Typed10 items · coin flip Dec 7, 2026, commit Dec 7, 2026"
    );
    // Both fit by Dec 28: no line between them, one after the list.
    expect(items[1].querySelector("[data-cut-line]")).toBeNull();
    expect(items[1]).not.toHaveTextContent("below the line");
    const lines = document.querySelectorAll("[data-cut-line]");
    expect(lines).toHaveLength(1);
    expect(items[1].contains(lines[0])).toBe(false);
    // The export lists both, each with its own dates.
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("| 1 | Wallets | 0 | Nothing left | — | Above the line |");
    expect(md).toContain("| 2 | Typed | 10 | Dec 7, 2026 | Dec 7, 2026 | Above the line |");
  });

  it("counts nothing for an epic taken off the roadmap, and says so", () => {
    const roadmap = (epics: { id: string; title: string }[]) => ({
      epicRoadmaps: [
        {
          id: "epicRoadmap:current",
          epics: epics.map((e) => ({ ...e, startQuarter: "Q1", endQuarter: "Q2", progress: 0 })),
        },
      ],
    });
    useWorkspaceStore.setState({
      ...roadmap([{ id: "e1", title: "Wallets" }]),
      stories: [open("w1", { epicId: "e1" }), open("w2", { epicId: "e1" })],
    });
    useReleasePlannerStore.setState({
      config: { ...base, features: [{ id: "fB", name: "Refunds", items: 23 }] },
    });
    renderPlanner();
    const form = screen.getByRole("form", { name: "Add a feature" });
    fireEvent.change(within(form).getByLabelText("Or an epic"), { target: { value: "e1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Wallets up" }));
    expect(config().features?.map((f) => f.name)).toEqual(["Wallets", "Refunds"]);
    let items = within(screen.getByRole("list", { name: "Features in order" })).getAllByRole(
      "listitem"
    );
    expect(items[0]).toHaveTextContent(
      "1. Wallets2 items · open stories in the epic · coin flip Nov 23, 2026"
    );
    // 25 items take 7 weeks: past the target.
    expect(items[1]).toHaveTextContent("2. Refunds23 items · coin flip Jan 4, 2027");
    expect(items[1]).toHaveTextContent("below the line");

    act(() => useWorkspaceStore.setState(roadmap([])));
    items = within(screen.getByRole("list", { name: "Features in order" })).getAllByRole(
      "listitem"
    );
    expect(items[0]).toHaveTextContent(
      "1. Wallets0 items · its epic is no longer on the roadmap, so nothing is counted · nothing left to count"
    );
    // Refunds' 23 items alone fit in the 6 weeks: its own dates, above the line.
    expect(items[1]).toHaveTextContent(
      "2. Refunds23 items · coin flip Dec 28, 2026, commit Dec 28, 2026"
    );
    expect(items[1]).not.toHaveTextContent("below the line");
    expect(items[1].querySelector("[data-cut-line]")).toBeNull();
  });

  it("counts an epic's open stories live", () => {
    useWorkspaceStore.setState({
      epicRoadmaps: [
        {
          id: "epicRoadmap:current",
          epics: [
            { id: "e1", title: "Wallets", startQuarter: "Q1", endQuarter: "Q2", progress: 0 },
          ],
        },
      ],
      stories: [
        open("w1", { epicId: "e1" }),
        open("w2", { epicId: "e1" }),
        { ...open("w3", { epicId: "e1" }), status: "done" },
      ],
    });
    useReleasePlannerStore.setState({ config: base });
    renderPlanner();
    const form = screen.getByRole("form", { name: "Add a feature" });
    fireEvent.change(within(form).getByLabelText("Or an epic"), { target: { value: "e1" } });
    expect(within(form).getByLabelText("Items")).toBeDisabled();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(config().features).toEqual([expect.objectContaining({ name: "Wallets", epicId: "e1" })]);
    expect(
      within(screen.getByRole("list", { name: "Features in order" })).getByText(
        /2 items · open stories in the epic/
      )
    ).toBeInTheDocument();
  });

  it("puts the forecast and the features in the export", () => {
    useReleasePlannerStore.setState({
      config: {
        ...base,
        itemsSource: "typed",
        itemsCount: 20,
        features: [
          { id: "f1", name: "Saved cards", items: 8 },
          { id: "f2", name: "Refunds", items: 20 },
        ],
      },
    });
    renderPlanner();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toMatch(/^# Release forecast by items — /);
    expect(md).toContain("| Items left | 20 (type a number) |");
    expect(md).toContain("| Weekly counts | 4, 4, 4, 4 |");
    expect(md).toContain("## When 20 items are done (10,000 simulated runs)");
    expect(md).toContain("| 85% | 5 | Dec 21, 2026 |");
    expect(md).toContain("The cut line at Dec 28, 2026: 1 feature done by then in 85% of runs.");
    expect(md).toContain("| 2 | Refunds | 20 | Jan 4, 2027 | Jan 4, 2027 | Below the line |");
    expect(JSON.parse(screen.getByTestId("export-csv").textContent ?? "{}")).toEqual({
      headers: ["Confidence", "Weeks", "Done by"],
      rows: [
        ["50%", 5, "Dec 21, 2026"],
        ["85%", 5, "Dec 21, 2026"],
        ["95%", 5, "Dec 21, 2026"],
      ],
    });
  });
});

describe("the pure parts", () => {
  it("checks a feature to add", () => {
    const epics = [{ id: "e1", title: "Wallets" }];
    expect(validateFeatureDraft({ name: " Cards ", items: "5", epicId: "" }, epics, 0)).toEqual({
      ok: true,
      values: { name: "Cards", items: 5 },
    });
    expect(validateFeatureDraft({ name: "", items: "", epicId: "e1" }, epics, 0)).toEqual({
      ok: true,
      values: { name: "Wallets", epicId: "e1" },
    });
    const full = validateFeatureDraft({ name: "X", items: "1", epicId: "" }, epics, 30);
    expect(full).toEqual({ ok: false, errors: { name: "The cut line holds up to 30 features." } });
  });

  it("reads features: an epic gone from the roadmap counts nothing", () => {
    expect(
      featureRows(
        [
          { id: "a", name: "", epicId: "gone" },
          { id: "b", name: "Typed", items: 4 },
        ],
        [open("s", { epicId: "gone" })],
        []
      )
    ).toEqual([
      { id: "a", name: "Epic", items: 0, epicId: "gone", epicMissing: true },
      { id: "b", name: "Typed", items: 4, epicMissing: false },
    ]);
    expect(movedFeature([{ id: "a", name: "A", items: 1 }], "a", -1)).toEqual([
      { id: "a", name: "A", items: 1 },
    ]);
  });

  it("counts an epic's open stories as Items left counts the backlog", () => {
    const stories: Story[] = [
      open("a", { epicId: "e" }),
      open("b", { epicId: "e", sprintId: "closed" }), // a completed sprint's leftover
      open("c", { epicId: "e", sprintId: "running" }), // the sprint the forecast starts after
      open("d", { epicId: "e", sprintId: "next" }),
      open("example-e", { epicId: "e" }),
      { ...open("f", { epicId: "e" }), status: "done" },
    ];
    const sprints = [
      { id: "closed", status: "completed" as const },
      { id: "running", status: "active" as const },
      { id: "next", status: "planned" as const },
    ];
    expect(openStoriesByEpic(stories).get("e")).toBe(4);
    expect(openStoriesByEpic(stories, { sprints }).get("e")).toBe(3);
    expect(openStoriesByEpic(stories, { sprints, skipSprintId: "running" }).get("e")).toBe(2);
    expect(
      featureRows([{ id: "x", name: "", epicId: "e" }], stories, [{ id: "e", title: "E" }], {
        sprints,
        skipSprintId: "running",
      })[0].items
    ).toBe(2);
  });

  it("reads the stored item fields back safely", () => {
    expect(normalizeConfig({ mode: "points", throughputWeeks: 9, itemsCount: 2.5 })).toEqual(
      EMPTY_CONFIG
    );
    const stored = normalizeConfig({
      mode: "items",
      throughputSource: "cards",
      throughputInput: "1, 2",
      throughputWeeks: 26,
      itemsSource: "typed",
      itemsCount: 30,
      features: [
        { id: "f1", name: "A", items: 3 },
        { id: "f1", name: "Duplicate", items: 3 },
        { id: "f2", name: "B" },
        { id: "f3", name: "C", epicId: "e" },
        "junk",
      ],
    });
    expect(stored).toMatchObject({
      mode: "items",
      throughputSource: "cards",
      throughputInput: "1, 2",
      throughputWeeks: 26,
      itemsSource: "typed",
      itemsCount: 30,
      features: [
        { id: "f1", name: "A", items: 3 },
        { id: "f3", name: "C", epicId: "e" },
      ],
    });
    expect(isEmptyConfig(stored)).toBe(false);
    expect(isEmptyConfig({ ...EMPTY_CONFIG, features: [] })).toBe(true);
  });
});
