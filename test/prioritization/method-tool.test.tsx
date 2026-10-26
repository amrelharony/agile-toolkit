import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { Scale } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The shared method-tool shell: the add form checks the method's inputs
 * (blanks are errors), rows read through to their backlog items and list
 * unscored last, an import of an item this method already scored opens
 * that row for editing, an edit writes the row and its item, delete has
 * Undo, and the example loads and clears.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import {
  MethodTool,
  exportRows,
  validateMethodDraft,
  validatePartialDraft,
  type MethodInputsSlotProps,
  type MethodToolConfig,
} from "@/components/prioritization/method-tool";
import { MethodInputControl, MethodInputs } from "@/components/prioritization/method-inputs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { RICE, WSJF } from "@/lib/prioritization/methods";
import { MOSCOW_BUCKETS, MOSCOW_LABEL } from "@/lib/prioritization/methods/moscow";
import { rankMethodRows, type RankedRow } from "@/lib/prioritization/rank";

const STAMP = "2026-10-20T09:00:00.000Z";
const CONFIG: MethodToolConfig = {
  methodId: "wsjf",
  toolId: "wsjf",
  title: "WSJF Calculator",
  description: "Weighted Shortest Job First.",
  icon: Scale,
  noun: { one: "feature", many: "features" },
  titleLabel: "Feature title",
  listLabel: "Features, highest WSJF first",
  emptyText: "No features yet.",
  history: { ITEM_ADDED: "added", ITEM_UPDATED: "updated", ITEM_REMOVED: "removed" },
  buildExample: () => [
    {
      id: "example-w1",
      framework: "wsjf",
      title: "Example fix",
      fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
      score: 4,
      status: "scored",
      updatedAt: STAMP,
    },
  ],
  toMarkdown: (rows) =>
    rows.map((r) => `${r.row.title}: ${r.result.score ?? "Not scored"}`).join("\n"),
};

const state = () => useWorkspaceStore.getState();
const rows = () => state().prioritizations ?? [];
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);

const renderTool = (config: MethodToolConfig = CONFIG) =>
  render(
    <TooltipProvider>
      <MethodTool config={config} />
    </TooltipProvider>
  );

const pick = (label: string, value: string) =>
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: label })).getByRole("radio", { name: value })
  );

beforeEach(() => {
  undo.last = null;
  window.history.replaceState({}, "", "/wsjf");
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("MethodTool", () => {
  it("refuses a blank add with each missing input named, then adds a scored row", () => {
    renderTool();
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()).toEqual([]);
    expect(screen.getByText("Enter a title.")).toBeInTheDocument();
    expect(screen.getByText("Pick a job size.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Feature title/)).toHaveFocus();

    fireEvent.change(screen.getByLabelText(/Feature title/), {
      target: { value: "Guest checkout" },
    });
    pick("Business value", "8");
    pick("Time criticality", "5");
    pick("Risk reduction / opportunity enablement", "3");
    pick("Job size", "2");
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ title: "Guest checkout", score: 8, status: "scored" });
    const list = screen.getByRole("list", { name: "Features, highest WSJF first" });
    expect(within(list).getByText("8.00")).toBeInTheDocument();
  });

  it("lists rows read through to their items, unscored last as Not scored", () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Item",
      businessValue: 20,
      timeCriticality: 20,
      riskReduction: 20,
      jobSize: 1,
      updatedAt: STAMP,
    };
    useWorkspaceStore.setState({
      backlogItems: [item],
      prioritizations: [
        {
          id: "x",
          framework: "wsjf",
          title: "Title only",
          fields: {},
          status: "open",
          updatedAt: STAMP,
        },
        {
          id: "y",
          framework: "wsjf",
          title: "Linked",
          fields: {},
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    renderTool();
    const items = within(screen.getByRole("list", { name: /Features/ })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Linked");
    expect(items[0]).toHaveTextContent("60.00");
    expect(items[1]).toHaveTextContent("Title only");
    expect(items[1]).toHaveTextContent("Not scored");
  });

  it("opens the existing row instead of a duplicate for an item already scored here", () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Passkeys",
      businessValue: 3,
      timeCriticality: 3,
      riskReduction: 3,
      jobSize: 3,
      updatedAt: STAMP,
    };
    useWorkspaceStore.setState({
      backlogItems: [item],
      prioritizations: [
        {
          id: "w1",
          framework: "wsjf",
          title: "Passkeys",
          fields: {},
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    window.history.replaceState({}, "", "/wsjf?backlogItem=b1");
    renderTool();
    // The row's editor is open (a Save button), not a second linked row.
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    expect(within(editor).getByLabelText(/Feature title/)).toHaveValue("Passkeys");
    fireEvent.click(
      within(within(editor).getByRole("radiogroup", { name: "Job size" })).getByRole("radio", {
        name: "1",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows()).toHaveLength(1);
    // The edit wrote through to the backlog item, in one undoable.
    expect(storedItem("b1")?.jobSize).toBe(1);
    expect(undo.last?.label).toBe("Updated “Passkeys” in the backlog");
    act(() => undo.last!.revert());
    expect(storedItem("b1")?.jobSize).toBe(3);
  });

  it("deletes with Undo", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "w1",
          framework: "wsjf",
          title: "Fix",
          fields: { businessValue: 1, timeCriticality: 1, rrOe: 1, jobSize: 1 },
          score: 3,
          updatedAt: STAMP,
        },
      ],
    });
    renderTool();
    fireEvent.click(screen.getByRole("button", { name: "Delete Fix" }));
    expect(rows()).toEqual([]);
    expect(undo.last?.label).toBe("Deleted “Fix”");
    act(() => undo.last!.revert());
    expect(rows()).toHaveLength(1);
  });

  it("starts empty with an example to load and clear", () => {
    renderTool();
    expect(screen.getByText("No features yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows().map((r) => r.id)).toEqual(["example-w1"]);
    expect(screen.getByTestId("markdown")).toHaveTextContent("Example fix: 4");
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(rows()).toEqual([]);
  });

  it("clears an optional input in the editor, never bringing the old value back", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "m1",
          framework: "moscow",
          title: "Passkeys",
          fields: { bucket: "must", effort: 3 },
          updatedAt: STAMP,
        },
      ],
    });
    renderTool({ ...CONFIG, methodId: "moscow", toolId: "moscow", listLabel: "Items" });
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.change(within(editor).getByLabelText(/^Effort/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows()[0].fields).toEqual({ bucket: "must" });
  });

  it("clears both Value/Effort inputs on a linked row: back to Not placed yet, item too", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        { id: "b1", name: "Dark mode", businessValue: 13, matrixEffort: 2, updatedAt: STAMP },
      ],
      prioritizations: [
        {
          id: "v1",
          framework: "value-effort",
          title: "Dark mode",
          fields: { businessValue: 5, effort: 2 },
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    renderTool({
      ...CONFIG,
      methodId: "value-effort",
      toolId: "value-effort-matrix",
      listLabel: "Items",
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit Dark mode" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Value" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Effort" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(storedItem("b1")).not.toHaveProperty("businessValue");
    expect(storedItem("b1")).not.toHaveProperty("matrixEffort");
    expect(rows()[0].fields).toEqual({});
    const list = screen.getByRole("list", { name: "Items" });
    expect(within(list).getByText("Not scored")).toBeInTheDocument();
    act(() => undo.last!.revert());
    expect(storedItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 2 });
  });

  it("moves focus into the editor when the import menu opens a scored row, and says so", async () => {
    useWorkspaceStore.setState({
      backlogItems: [
        {
          id: "b1",
          name: "Passkeys",
          businessValue: 3,
          timeCriticality: 3,
          riskReduction: 3,
          jobSize: 3,
          updatedAt: STAMP,
        },
      ],
      prioritizations: [
        {
          id: "w1",
          framework: "wsjf",
          title: "Passkeys",
          fields: {},
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    render(
      <LiveAnnouncerProvider>
        <TooltipProvider>
          <MethodTool config={CONFIG} />
        </TooltipProvider>
      </LiveAnnouncerProvider>
    );
    const trigger = screen.getByRole("button", { name: "Import from backlog" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Passkeys/ }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
    const title = within(editor).getByLabelText(/Feature title/);
    await waitFor(() => expect(title).toHaveFocus());
    expect(trigger).not.toHaveFocus();
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Editing “Passkeys”: already scored with WSJF."
      )
    );
    expect(rows()).toHaveLength(1);
  });

  it("starts the add form from initialDraft, then the last value picked", () => {
    renderTool({
      ...CONFIG,
      methodId: "rice",
      toolId: "rice-scoring",
      listLabel: "Items",
      initialDraft: { reachPeriod: "quarter" },
      remember: ["reachPeriod"],
    });
    const period = () => screen.getByRole("radiogroup", { name: "Reach period" });
    // Shown, never hidden: the period starts on "per quarter".
    expect(within(period()).getByRole("radio", { name: "per quarter" })).toBeChecked();
    fireEvent.change(screen.getByLabelText(/Feature title/), { target: { value: "Search" } });
    fireEvent.change(screen.getByLabelText(/^Reach \(people\)/), { target: { value: "300" } });
    fireEvent.click(within(period()).getByRole("radio", { name: "per month" }));
    for (const group of ["Impact", "Confidence"]) {
      fireEvent.click(
        within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", {
          name: /Medium/,
        })
      );
    }
    fireEvent.change(screen.getByLabelText(/^Effort/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()[0]).toMatchObject({ fields: { reachPeriod: "month", reach: 300 } });
    // The next add starts on the period just used.
    expect(within(period()).getByRole("radio", { name: "per month" })).toBeChecked();
    expect(screen.getByLabelText(/Feature title/)).toHaveValue("");
  });

  it("exports JSON as the screen reads it, read through to the item", () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Item",
      businessValue: 20,
      timeCriticality: 20,
      riskReduction: 20,
      jobSize: 1,
      updatedAt: STAMP,
    };
    const stored: PrioritizationItem = {
      id: "y",
      framework: "wsjf",
      title: "Linked",
      fields: { businessValue: 1, timeCriticality: 1, rrOe: 1, jobSize: 1, note: "keep" },
      score: 3,
      status: "scored",
      backlogItemId: "b1",
      updatedAt: STAMP,
    };
    const [out] = exportRows(WSJF, rankMethodRows("wsjf", [stored], [item]));
    expect(out).toMatchObject({
      id: "y",
      backlogItemId: "b1",
      fields: { businessValue: 20, timeCriticality: 20, rrOe: 20, jobSize: 1, note: "keep" },
      score: 60,
      status: "scored",
    });
    const [blank] = exportRows(
      WSJF,
      rankMethodRows("wsjf", [{ ...stored, backlogItemId: undefined, fields: {} }], [])
    );
    expect(blank).toMatchObject({ status: "open" });
    expect(blank).not.toHaveProperty("score");
  });

  it("saves a title-only row when the tool allows it", () => {
    renderTool({ ...CONFIG, allowTitleOnly: true });
    fireEvent.change(screen.getByLabelText(/Feature title/), { target: { value: "Later" } });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()[0]).toMatchObject({ title: "Later", status: "open", fields: {} });
    expect((rows()[0] as PrioritizationItem).score).toBeUndefined();
  });
});

/* ── Focus, groups, partial rows, slots ─────────────────────────────── */

const wsjfRow = (
  id: string,
  title: string,
  fields: Record<string, number>,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "wsjf",
  title,
  fields,
  status: "scored",
  updatedAt: STAMP,
  ...extra,
});
const full = (bv: number) => ({ businessValue: bv, timeCriticality: 1, rrOe: 1, jobSize: 1 });
const moscowRow = (id: string, title: string, bucket: string): PrioritizationItem => ({
  id,
  framework: "moscow",
  title,
  fields: { bucket },
  status: "scored",
  updatedAt: STAMP,
});
/** MoSCoW-style groups: one per bucket, in bucket order. */
const byBucket = (list: readonly RankedRow[]) =>
  MOSCOW_BUCKETS.map((b) => ({
    id: b,
    label: MOSCOW_LABEL[b],
    rows: list.filter((r) => r.result.bucket === b),
  }));
const MOSCOW_CONFIG: MethodToolConfig = {
  ...CONFIG,
  methodId: "moscow",
  toolId: "moscow",
  listLabel: "Items",
  groups: byBucket,
};
const editorForm = () =>
  screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;
const renderAnnounced = (config: MethodToolConfig) =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <MethodTool config={config} />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

describe("MethodTool focus", () => {
  it("hands focus back to the row's Edit button after Save and after Cancel", () => {
    useWorkspaceStore.setState({ prioritizations: [wsjfRow("w1", "Fix", full(3))] });
    renderTool();
    fireEvent.click(screen.getByRole("button", { name: "Edit Fix" }));
    fireEvent.change(within(editorForm()).getByLabelText(/Feature title/), {
      target: { value: "Fix login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows()[0].title).toBe("Fix login");
    expect(screen.getByRole("button", { name: "Edit Fix login" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Edit Fix login" }));
    fireEvent.keyDown(within(editorForm()).getByLabelText(/Feature title/), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Fix login" })).toHaveFocus();
  });

  it("moves focus after a delete to the next row, else the one before, else the add form", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        wsjfRow("a", "Alpha", full(13)),
        wsjfRow("b", "Beta", full(8)),
        wsjfRow("c", "Gamma", full(3)),
      ],
    });
    renderTool();
    fireEvent.click(screen.getByRole("button", { name: "Delete Beta" }));
    expect(screen.getByRole("button", { name: "Edit Gamma" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete Gamma" }));
    expect(screen.getByRole("button", { name: "Edit Alpha" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(rows()).toEqual([]);
    expect(screen.getByLabelText(/Feature title/)).toHaveFocus();
  });

  it("skips the row open in the editor when it picks where focus goes after a delete", () => {
    useWorkspaceStore.setState({
      prioritizations: [wsjfRow("a", "Alpha", full(13)), wsjfRow("b", "Beta", full(8))],
    });
    renderTool();
    fireEvent.click(screen.getByRole("button", { name: "Edit Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    // Beta's Edit button isn't on screen (its editor is): the add form's title takes focus.
    const [addTitle, editorTitle] = screen.getAllByLabelText(/Feature title/);
    expect(editorTitle.closest("li")).not.toBeNull();
    expect(addTitle).toHaveFocus();
  });
});

describe("MethodTool groups", () => {
  it("announces an editor save that moves a row to another group, and follows it there", async () => {
    useWorkspaceStore.setState({
      prioritizations: [moscowRow("m1", "Passkeys", "must"), moscowRow("m2", "SSO", "should")],
    });
    renderAnnounced(MOSCOW_CONFIG);
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    fireEvent.click(within(editorForm()).getByRole("radio", { name: "Could have" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows().find((r) => r.id === "m1")?.fields).toEqual({ bucket: "could" });
    const could = screen.getByRole("region", { name: "Could have" });
    expect(within(could).getByRole("button", { name: "Edit Passkeys" })).toHaveFocus();
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Moved “Passkeys” to Could have.")
    );
  });

  it("says nothing when the save keeps the row in its group", async () => {
    useWorkspaceStore.setState({ prioritizations: [moscowRow("m1", "Passkeys", "must")] });
    renderAnnounced(MOSCOW_CONFIG);
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    fireEvent.change(within(editorForm()).getByLabelText(/Feature title/), {
      target: { value: "Passkeys login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(rows()[0].title).toBe("Passkeys login");
    expect(screen.getByRole("button", { name: "Edit Passkeys login" })).toHaveFocus();
    // Past the announcer's 50 ms delay.
    await act(() => new Promise((done) => setTimeout(done, 120)));
    expect(screen.getByTestId("live-polite")).not.toHaveTextContent(/Moved/);
  });

  it("rowScore: false shows no rank or score on a row and never offers Re-sort", () => {
    const start = [moscowRow("a", "Alpha", "should"), moscowRow("b", "Beta", "must")];
    // The default: a rank and a score on each row, and a move leaves the order stale.
    useWorkspaceStore.setState({ prioritizations: start });
    const first = renderTool(MOSCOW_CONFIG);
    expect(screen.getByLabelText("Rank 1")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    fireEvent.click(within(editorForm()).getByRole("radio", { name: "Must have" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Re-sort" })).toBeInTheDocument();
    first.unmount();

    useWorkspaceStore.setState({ prioritizations: start });
    renderTool({ ...MOSCOW_CONFIG, rowScore: false });
    expect(screen.queryByLabelText(/^Rank \d/)).toBeNull();
    expect(screen.queryByLabelText("Not ranked")).toBeNull();
    expect(screen.queryByText("4")).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
    // (The default verdict over the list still names the method; the rows don't.)
    for (const g of ["Must have", "Should have"]) {
      expect(within(screen.getByRole("region", { name: g })).queryByText(/MoSCoW/)).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    fireEvent.click(within(editorForm()).getByRole("radio", { name: "Must have" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      within(screen.getByRole("region", { name: "Must have" })).getByText("Alpha")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-sort" })).toBeNull();
  });
});

describe("MethodTool validate hook", () => {
  const partialConfig: MethodToolConfig = {
    ...CONFIG,
    allowTitleOnly: true,
    validate: (d, { editing, keep }) =>
      editing ? validatePartialDraft(WSJF, d, keep) : validateMethodDraft(WSJF, d, true, keep),
  };

  it("lets a partial row be renamed and re-scored in place, and tells the hook which row", () => {
    const spy = vi.fn(partialConfig.validate!);
    useWorkspaceStore.setState({
      prioritizations: [
        wsjfRow("w1", "Later", { businessValue: 8, jobSize: 2 }, { status: "open" }),
      ],
    });
    renderTool({ ...partialConfig, validate: spy });
    fireEvent.click(screen.getByRole("button", { name: "Edit Later" }));
    const editor = editorForm();
    fireEvent.change(within(editor).getByLabelText(/Feature title/), {
      target: { value: "Later, sooner" },
    });
    fireEvent.click(
      within(within(editor).getByRole("radiogroup", { name: "Job size" })).getByRole("radio", {
        name: "3",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(rows()[0]).toMatchObject({
      title: "Later, sooner",
      status: "open",
      fields: { businessValue: 8, jobSize: 3 },
    });
    // The editor's checks name its row and what it holds; the add form's name none.
    const contexts = spy.mock.calls.map(([, ctx]) => ctx);
    const editing = contexts.filter((ctx) => ctx.editing);
    expect(editing.length).toBeGreaterThan(0);
    expect(editing.every((ctx) => ctx.editing?.row.id === "w1")).toBe(true);
    expect(editing[0].keep).toEqual(expect.objectContaining({ businessValue: 8, jobSize: 2 }));
    expect(contexts.some((ctx) => ctx.editing === undefined)).toBe(true);
  });

  it("still refuses a partial add (the hook gets no row)", () => {
    renderTool(partialConfig);
    fireEvent.change(screen.getByLabelText(/Feature title/), { target: { value: "Half" } });
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Business value" })).getByRole("radio", {
        name: "8",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()).toEqual([]);
    expect(screen.getByText("Pick a job size.")).toBeInTheDocument();
  });

  it("validatePartialDraft checks only the set inputs, and a full or title-only draft as usual", () => {
    expect(validatePartialDraft(WSJF, { title: "  A  b ", businessValue: 8 })).toEqual({
      ok: true,
      values: { title: "A b", businessValue: 8 },
    });
    // A set value off the scale is still an error; a blank one isn't.
    const off = validatePartialDraft(WSJF, { title: "A", businessValue: 4 });
    expect(off.ok).toBe(false);
    if (!off.ok) {
      expect(Object.keys(off.errors)).toEqual(["businessValue"]);
    }
    // …unless the row already held it ("Custom").
    expect(
      validatePartialDraft(WSJF, { title: "A", businessValue: 4 }, { businessValue: 4 })
    ).toMatchObject({ ok: true });
    const untitled = validatePartialDraft(WSJF, { title: " ", businessValue: 8 });
    expect(untitled.ok).toBe(false);
    if (!untitled.ok) expect(untitled.errors.title).toBe("Enter a title.");
    expect(validatePartialDraft(WSJF, { title: "A" })).toEqual({
      ok: true,
      values: { title: "A" },
    });
    expect(validatePartialDraft(WSJF, { title: "A", ...full(5) })).toEqual(
      validateMethodDraft(WSJF, { title: "A", ...full(5) })
    );
  });
});

describe("MethodTool slots", () => {
  it("tells the Inputs slot the edited row and its linked item, and the add form's import", () => {
    const seen: { row?: string; item?: string }[] = [];
    function Spy(props: MethodInputsSlotProps) {
      seen.push({ row: props.row?.id, item: props.item?.id });
      return <MethodInputs {...props} />;
    }
    useWorkspaceStore.setState({
      backlogItems: [
        { id: "b1", name: "Passkeys", jobSize: 3, updatedAt: STAMP },
        { id: "b2", name: "Dark mode", updatedAt: STAMP },
      ],
      prioritizations: [wsjfRow("w1", "Passkeys", full(3), { backlogItemId: "b1" })],
    });
    window.history.replaceState({}, "", "/wsjf?backlogItem=b2");
    renderTool({ ...CONFIG, Inputs: Spy });
    // The add form, filled from the "Score with…" link: no row, the import's item.
    expect(screen.getByLabelText(/Feature title/)).toHaveValue("Dark mode");
    expect(seen[seen.length - 1]).toEqual({ row: undefined, item: "b2" });

    seen.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Edit Passkeys" }));
    expect(seen).toContainEqual({ row: "w1", item: "b1" });
  });

  it("renders BeforeList between the add form and the list, once there are rows", () => {
    function Before({ rows: shown }: { rows: readonly RankedRow[] }) {
      return <p>Before the list: {shown.length}</p>;
    }
    const config = { ...CONFIG, BeforeList: Before };
    const empty = renderTool(config);
    expect(screen.queryByText(/Before the list/)).toBeNull();
    empty.unmount();

    useWorkspaceStore.setState({ prioritizations: [wsjfRow("w1", "Fix", full(3))] });
    renderTool(config);
    const before = screen.getByText("Before the list: 1");
    const list = screen.getByRole("list", { name: "Features, highest WSJF first" });
    const add = screen.getByRole("button", { name: /Add & score/ });
    expect(add.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(before.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Choice inputs", () => {
  const choice = {
    key: "bucket",
    kind: "choice" as const,
    label: "Bucket",
    hint: "Pick one.",
    missing: "Pick a bucket.",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  };

  it("marks a required choice as Field does, and leaves an optional one unmarked", () => {
    const { container, rerender } = render(
      <MethodInputControl input={choice} value={undefined} onChange={() => {}} />
    );
    expect(screen.getByRole("radiogroup", { name: "Bucket" })).toHaveAttribute(
      "aria-required",
      "true"
    );
    expect(container).toHaveTextContent("Bucket*");

    rerender(
      <MethodInputControl
        input={{ ...choice, optional: true }}
        value={undefined}
        onChange={() => {}}
      />
    );
    expect(screen.getByRole("radiogroup", { name: "Bucket" })).not.toHaveAttribute("aria-required");
    expect(container).not.toHaveTextContent("Bucket*");
  });

  it("marks MoSCoW's bucket required in the tool's add form", () => {
    renderTool(MOSCOW_CONFIG);
    expect(screen.getByRole("radiogroup", { name: "Bucket" })).toHaveAttribute(
      "aria-required",
      "true"
    );
  });

  it("marks nothing required in a form where every input may be blank (requiredCue false)", () => {
    const { container } = render(
      <MethodInputs
        method={RICE}
        draft={{}}
        update={() => {}}
        errors={{}}
        only={["reach", "reachPeriod", "effort"]}
        requiredCue={false}
      />
    );
    expect(screen.getByRole("radiogroup", { name: "Reach period" })).not.toHaveAttribute(
      "aria-required"
    );
    expect(screen.getByLabelText(/^Reach/, { selector: "input" })).not.toHaveAttribute(
      "aria-required"
    );
    expect(screen.getByLabelText(/^Effort/, { selector: "input" })).not.toHaveAttribute(
      "aria-required"
    );
    expect(container).not.toHaveTextContent("*");
  });
});
