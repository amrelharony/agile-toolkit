import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AdkarDoc, AdkarGroup, AdkarInitiative } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import {
  ADKAR_DOC_ID,
  ADKAR_LEGACY_KEY,
  ADKAR_MOVED_KEY,
  adkarVerdict,
  advance,
  barrierPoint,
  barrierText,
  completedStages,
  daysInStage,
  initiativeBarrier,
  medianDaysInStage,
  moveDateError,
  normalizeInitiative,
  pastBarrier,
  planAdkarMove,
  stageDurations,
  stepBack,
  withStartDate,
} from "@/lib/adkar/model";
import { registry } from "@/lib/actions/registry";

/**
 * ADKAR, upgraded: the initiatives live in the workspace (moved once from
 * the old blob, which stays as the backup), the stage history starts on
 * the start date and every move is dated, forward or back, groups scored
 * per element with the barrier point named, a draft-then-save add form
 * and edit in place, Undo on deletes and moves, a confirmed clear, an
 * example in the page's memory, a verdict, Markdown, and the agent saying
 * the same.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const migrationMode = vi.hoisted(() => ({ value: "off" as string }));
const signedIn = vi.hoisted(() => ({ value: null as { user: { id: string } } | null }));
const cloudRead = vi.hoisted(() => vi.fn(async () => null as Map<string, unknown> | null));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/data/use-legacy-migration-mode", () => ({
  useLegacyMigrationMode: () => migrationMode.value,
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => signedIn.value,
}));
vi.mock("@/lib/sync/cloud-blobs", () => ({ readCloudBlobs: cloudRead }));
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
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/adkar/charts", () => ({ AdkarStageFunnelChart: () => null }));

import { AdkarTool } from "@/app/(tools)/adkar/adkar-client";
import { buildExample } from "@/app/(tools)/adkar/example";
import { adkarToMarkdown, stageChartText } from "@/app/(tools)/adkar/markdown";
import { emptyInitiative, validateInitiative } from "@/app/(tools)/adkar/initiative-form";
import { validateGroup } from "@/app/(tools)/adkar/initiative-card";
import "@/lib/actions/tools/adkar";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-26";

const initiative = (extra: Partial<AdkarInitiative> = {}): AdkarInitiative => ({
  id: "i1",
  name: "Trunk-based development",
  startDate: "2026-09-01",
  currentStage: "desire",
  stageHistory: [
    { stage: "awareness", enteredAt: "2026-09-01" },
    { stage: "desire", enteredAt: "2026-09-21" },
  ],
  ...extra,
});
const group = (id: string, name: string, scores: AdkarGroup["scores"]): AdkarGroup => ({
  id,
  name,
  scores,
});

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().adkarDocs?.find((d) => d.id === ADKAR_DOC_ID);
const seed = (initiatives: AdkarInitiative[] | null) =>
  useWorkspaceStore.setState({
    adkarDocs: initiatives ? [{ id: ADKAR_DOC_ID, initiatives }] : [],
    teamMembers: [{ id: "member_priya", name: "Priya" }],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <AdkarTool />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.adkar.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 9, 0, 0));
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  cloudRead.mockReset();
  cloudRead.mockResolvedValue(null);
  logs.length = 0;
  migrationMode.value = "off";
  signedIn.value = null;
  window.localStorage.removeItem(ADKAR_LEGACY_KEY);
  window.localStorage.removeItem(ADKAR_MOVED_KEY);
  seed(null);
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({ adkarDocs: [], teamMembers: [] });
});

/* ── The rules (lib/adkar/model) ────────────────────────────────────── */

describe("the barrier point", () => {
  it("is the first element at 3 or lower, in A-D-K-A-R order", () => {
    expect(barrierPoint({ awareness: 4, desire: 2, knowledge: 1 })).toEqual({
      element: "desire",
      score: 2,
    });
    expect(barrierPoint({ awareness: 3 })).toEqual({ element: "awareness", score: 3 });
    expect(
      barrierPoint({ awareness: 5, desire: 4, knowledge: 4, ability: 4, reinforcement: 4 })
    ).toEqual({ element: null });
  });

  it("is unknown when an earlier element is unscored, never assumed fine", () => {
    expect(barrierPoint({ desire: 1 })).toEqual({ element: null, unscoredBefore: "awareness" });
    expect(barrierPoint({ awareness: 5, knowledge: 1 })).toEqual({
      element: null,
      unscoredBefore: "desire",
    });
    expect(barrierPoint(undefined)).toEqual({ element: null, unscoredBefore: "awareness" });
    expect(barrierText(group("g", "Ops", { desire: 2 }))).toBe(
      "Barrier unknown: score Awareness first"
    );
    expect(barrierText(group("g", "Ops", {}))).toBe("Not scored yet");
    expect(barrierText(group("g", "Ops", { awareness: 2 }))).toBe("Barrier: Awareness (2/5)");
  });

  it("takes the earliest across groups, and flags groups the initiative moved past", () => {
    const i = initiative({
      currentStage: "knowledge",
      groups: [
        group("a", "Devs", { awareness: 5, desire: 4, knowledge: 3 }),
        group("b", "Support", { awareness: 4, desire: 2 }),
        group("c", "Ops", { awareness: 4, desire: 1 }),
      ],
    });
    expect(initiativeBarrier(i)).toEqual({
      element: "desire",
      groupId: "c",
      groupName: "Ops",
      score: 1,
    });
    expect(pastBarrier(i).map((p) => p.group.name)).toEqual(["Support", "Ops"]);
    expect(initiativeBarrier(initiative())).toBeNull();
  });
});

describe("dated stages", () => {
  it("counts days per stage from the start date, the current one to today", () => {
    expect(stageDurations(initiative(), TODAY)).toEqual([
      { stage: "awareness", from: "2026-09-01", to: "2026-09-21", days: 20 },
      { stage: "desire", from: "2026-09-21", to: null, days: 35 },
    ]);
    expect(daysInStage(initiative(), TODAY)).toBe(35);
    expect(completedStages(initiative())).toEqual(["awareness"]);
  });

  it("moves forward and back on a day not before the last move nor after today", () => {
    const i = initiative({ stagesCompleted: ["awareness"] });
    expect(moveDateError(i, "2026-09-20", TODAY)).toMatch(/pick that day or later/);
    expect(moveDateError(i, "2026-10-27", TODAY)).toBe("It can't move in the future.");
    expect(advance(i, "2026-09-20", TODAY)).toBeNull();
    const on = advance(i, "2026-10-01", TODAY)!;
    expect(on.currentStage).toBe("knowledge");
    expect(on.stageHistory.at(-1)).toEqual({ stage: "knowledge", enteredAt: "2026-10-01" });
    expect(on.stagesCompleted).toBeUndefined();
    const back = stepBack(on, "2026-10-01", TODAY)!;
    expect(back.currentStage).toBe("desire");
    expect(back.stageHistory).toHaveLength(4);
    expect(
      stepBack(
        initiative({
          currentStage: "awareness",
          stageHistory: [{ stage: "awareness", enteredAt: "2026-09-01" }],
        }),
        TODAY,
        TODAY
      )
    ).toBeNull();
    const last = initiative({
      currentStage: "reinforcement",
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-09-01" },
        { stage: "reinforcement", enteredAt: "2026-09-02" },
      ],
    });
    expect(advance(last, TODAY, TODAY)).toBeNull();
  });

  it("moves the start date with entry 0, never after the first move or today", () => {
    expect(withStartDate(initiative(), "2026-08-15", TODAY)?.stageHistory[0]).toEqual({
      stage: "awareness",
      enteredAt: "2026-08-15",
    });
    expect(withStartDate(initiative(), "2026-09-22", TODAY)).toBeNull();
    expect(
      withStartDate(
        initiative({
          stageHistory: [{ stage: "awareness", enteredAt: "2026-09-01" }],
          currentStage: "awareness",
        }),
        "2026-10-27",
        TODAY
      )
    ).toBeNull();
  });
});

describe("legacy rows", () => {
  it("starts an old initiative's history on its start date, keeping its stage", () => {
    // The old tracker stamped entry 0 "today" even when the start was backdated.
    const old = {
      id: "o1",
      name: " Pairing ",
      currentStage: "knowledge",
      stagesCompleted: ["awareness", "desire"],
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-10-01" },
        { stage: "desire", enteredAt: "2026-10-05" },
        { stage: "knowledge", enteredAt: "2026-10-09" },
      ],
      startDate: "2026-08-01",
    };
    const n = normalizeInitiative(old, TODAY)!;
    expect(n).toEqual({
      id: "o1",
      name: "Pairing",
      startDate: "2026-08-01",
      currentStage: "knowledge",
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-08-01" },
        { stage: "desire", enteredAt: "2026-10-05" },
        { stage: "knowledge", enteredAt: "2026-10-09" },
      ],
    });
    expect(normalizeInitiative(n, TODAY)).toEqual(n);
  });

  it("keeps the stage of one with no history, reads an unknown stage as Awareness, drops nameless rows", () => {
    expect(
      normalizeInitiative(
        { id: "x", name: "X", currentStage: "ability", startDate: "2026-05-01" },
        TODAY
      )
    ).toMatchObject({
      currentStage: "ability",
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-05-01" },
        { stage: "ability", enteredAt: "2026-05-01" },
      ],
    });
    expect(
      normalizeInitiative(
        { id: "y", name: "Y", currentStage: "panic", startDate: "2026-05-01" },
        TODAY
      )?.currentStage
    ).toBe("awareness");
    expect(normalizeInitiative({ id: "z", name: "  " }, TODAY)).toBeNull();
    expect(normalizeInitiative("junk", TODAY)).toBeNull();
  });

  it("plans the move by id, records it, and never brings back one deleted since", () => {
    const blob = [
      { id: "a", name: "A", currentStage: "awareness", startDate: "2026-09-01" },
      { id: "b", name: "B", currentStage: "desire", startDate: "2026-09-02" },
    ];
    const first = planAdkarMove(blob, [], [], TODAY);
    expect(first.toMove.map((i) => i.id)).toEqual(["a", "b"]);
    expect(first).toMatchObject({ moved: ["a", "b"], changed: true });
    // Run again after the move: nothing to do.
    expect(planAdkarMove(blob, first.toMove, first.moved, TODAY)).toMatchObject({
      toMove: [],
      changed: false,
    });
    // "a" deleted since: not moved again.
    expect(planAdkarMove(blob, [first.toMove[1]], first.moved, TODAY).toMove).toEqual([]);
    // Moved on another device (no record here): nothing moves.
    expect(planAdkarMove(blob, [first.toMove[0]], [], TODAY).toMove).toEqual([]);
    expect(planAdkarMove(null, [], [], TODAY)).toEqual({ toMove: [], moved: [], changed: false });
  });
});

describe("numbers and the verdict", () => {
  it("quotes a median only from three finished stages", () => {
    expect(medianDaysInStage([initiative()], TODAY)).toEqual({ median: null, periods: 1 });
    const ex = buildExample(new Date(2026, 9, 26));
    expect(medianDaysInStage(ex.doc.initiatives, TODAY)).toEqual({ median: 20, periods: 11 });
  });

  it("names what's held up and by whom, or what to score", () => {
    expect(adkarVerdict([], TODAY)).toBe("No change initiatives yet.");
    expect(adkarVerdict([initiative()], TODAY)).toBe(
      "Score each group on the five elements to find where adoption is stuck. 1 initiative has been in the same stage 30+ days."
    );
    const ex = buildExample(new Date(2026, 9, 26));
    expect(adkarVerdict(ex.doc.initiatives, TODAY)).toBe(
      "2 of 3 initiatives are held up: Trunk-based development at Desire (Support scored 2); New incident process at Knowledge (On-call engineers scored 2). 1 initiative has been in the same stage 30+ days."
    );
    const fine = initiative({
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-09-01" },
        { stage: "desire", enteredAt: "2026-10-20" },
      ],
      groups: [group("g", "Devs", { awareness: 5, desire: 4 })],
    });
    expect(adkarVerdict([fine], TODAY)).toBe(
      "No initiative is held at a barrier: every scored group is above 3 as far as it is scored."
    );
  });
});

describe("the forms", () => {
  it("refuses a blank name, a cleared or future start, and keeps a backdated one", () => {
    expect(validateInitiative(emptyInitiative(TODAY), TODAY)).toEqual({
      ok: false,
      errors: { name: "Name the change." },
    });
    expect(
      validateInitiative({ ...emptyInitiative(TODAY), name: "X", startDate: "" }, TODAY)
    ).toMatchObject({
      ok: false,
      errors: { startDate: "Pick the day it started." },
    });
    expect(
      validateInitiative({ ...emptyInitiative(TODAY), name: "X", startDate: "2026-11-01" }, TODAY)
    ).toMatchObject({
      ok: false,
      errors: { startDate: "It can't start in the future." },
    });
    expect(
      validateInitiative(
        { name: " X ", owner: " Priya ", startDate: "2026-01-02", description: "" },
        TODAY
      )
    ).toEqual({ ok: true, values: { name: "X", owner: "Priya", startDate: "2026-01-02" } });
    // Editing: not after its first move.
    expect(
      validateInitiative(
        { name: "X", owner: "", startDate: "2026-10-01", description: "" },
        TODAY,
        initiative()
      )
    ).toMatchObject({
      ok: false,
      errors: { startDate: expect.stringMatching(/start on or before that/) },
    });
  });

  it("needs a group name the initiative doesn't have yet", () => {
    const groups = [group("g", "Support", {})];
    expect(validateGroup({ name: " " }, groups)).toEqual({
      ok: false,
      errors: { name: "Name the group." },
    });
    expect(validateGroup({ name: "support" }, groups)).toEqual({
      ok: false,
      errors: { name: "“support” is already a group here." },
    });
    expect(validateGroup({ name: "Ops" }, groups)).toEqual({ ok: true, values: { name: "Ops" } });
  });
});

describe("the example and the export", () => {
  it("is all example- ids with backdated history", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    for (const i of ex.doc.initiatives) {
      expect(isExampleId(i.id)).toBe(true);
      for (const g of i.groups ?? []) expect(isExampleId(g.id)).toBe(true);
      expect(i.stageHistory[0]).toEqual({ stage: "awareness", enteredAt: i.startDate });
    }
  });

  it("exports the verdict, each initiative's stage, barrier, groups and history", () => {
    const ex = buildExample(new Date(2026, 9, 26));
    const md = adkarToMarkdown(ex.doc.initiatives, TODAY);
    expect(md).toContain("# ADKAR change initiatives");
    expect(md).toContain("> 2 of 3 initiatives are held up");
    expect(md).toContain("Stage: Ability (12 days) · Owner: Priya · Started Aug 12, 2026");
    expect(md).toContain("Barrier: Desire (Support scored 2/5)");
    expect(md).toContain("| Support | 4 | 2 | — | — | — | Barrier: Desire (2/5) |");
    expect(md).toContain("- Ability: since 2026-10-14 (12 days so far)");
    expect(stageChartText(ex.doc.initiatives)).toMatchObject({
      summary: "3 initiatives: 1 at Knowledge, 1 at Ability, 1 at Reinforcement.",
      table: { columns: ["Stage", "Initiatives"] },
    });
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("starts empty with an example on offer, writing nothing", () => {
    renderPage();
    expect(screen.getByText(/No initiatives yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    expect(ws().adkarDocs).toEqual([]);
  });

  it("adds through the form: errors inline, a backdated start becomes the first stage's day", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add initiative" }));
    expect(screen.getByText("Name the change.")).toBeInTheDocument();
    expect(stored()).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/^Initiative/), { target: { value: "Pairing" } });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "priya" } });
    fireEvent.change(screen.getByLabelText(/^Start date/), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Add initiative" }));
    expect(stored()?.initiatives).toEqual([
      expect.objectContaining({
        name: "Pairing",
        owner: "priya",
        startDate: "2026-09-01",
        currentStage: "awareness",
        stageHistory: [{ stage: "awareness", enteredAt: "2026-09-01" }],
      }),
    ]);
    expect(logs.map((l) => l.action)).toContain("initiative_added");
  });

  it("advances on a backdated day, refuses one before the last move, steps back, with Undo", () => {
    seed([initiative()]);
    renderPage();
    const day = screen.getByLabelText("Moved on");
    fireEvent.change(day, { target: { value: "2026-09-10" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Advance Trunk-based development to Knowledge" })
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/pick that day or later/);
    expect(stored()?.initiatives[0].currentStage).toBe("desire");
    fireEvent.change(day, { target: { value: "2026-10-05" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Advance Trunk-based development to Knowledge" })
    );
    expect(stored()?.initiatives[0]).toMatchObject({
      currentStage: "knowledge",
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-09-01" },
        { stage: "desire", enteredAt: "2026-09-21" },
        { stage: "knowledge", enteredAt: "2026-10-05" },
      ],
    });
    expect(screen.getByText(/Stage 3 of 5:/)).toBeInTheDocument();
    undoLast();
    expect(stored()?.initiatives[0].currentStage).toBe("desire");
    expect(stored()?.initiatives[0].stageHistory).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Step Trunk-based development back to Awareness" })
    );
    expect(stored()?.initiatives[0].currentStage).toBe("awareness");
    expect(logs.map((l) => l.action)).toEqual(["stage_advanced", "stage_stepped_back"]);
  });

  it("scores groups, names the barrier, and warns when the stage is past it", async () => {
    seed([
      initiative({
        currentStage: "knowledge",
        stageHistory: [
          ...initiative().stageHistory,
          { stage: "knowledge", enteredAt: "2026-10-10" },
        ],
      }),
    ]);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Group affected/), { target: { value: "Support" } });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    const g = stored()?.initiatives[0].groups?.[0];
    expect(g).toMatchObject({ name: "Support", scores: {} });
    expect(screen.getByText("Not scored yet")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Support: Awareness" })).getByRole("radio", {
        name: "4",
      })
    );
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Support: Desire" })).getByRole("radio", {
        name: "2",
      })
    );
    expect(stored()?.initiatives[0].groups?.[0]).toMatchObject({
      scores: { awareness: 4, desire: 2 },
      assessedAt: TODAY,
    });
    expect(screen.getByText("Barrier: Desire (2/5)")).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Support: Desire (barrier)" })
    ).toBeInTheDocument();
    expect(screen.getByText(/At Knowledge, but Support's barrier is Desire/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear Support: Desire (barrier)" }));
    expect(stored()?.initiatives[0].groups?.[0].scores).toEqual({ awareness: 4 });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete the group Support from Trunk-based development" })
    );
    expect(stored()?.initiatives[0].groups).toEqual([]);
    undoLast();
    expect(stored()?.initiatives[0].groups?.map((x) => x.name)).toEqual(["Support"]);
  });

  it("edits in place, the start date moving the first stage's day", () => {
    seed([initiative()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Trunk-based development" }));
    // The edit form comes after the add form.
    fireEvent.change(screen.getAllByLabelText(/^Initiative\*?$/).at(-1)!, {
      target: { value: "Trunk-based dev" },
    });
    const starts = screen.getAllByLabelText(/^Start date/);
    fireEvent.change(starts[starts.length - 1], { target: { value: "2026-08-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()?.initiatives[0]).toMatchObject({
      name: "Trunk-based dev",
      startDate: "2026-08-20",
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-08-20" },
        { stage: "desire", enteredAt: "2026-09-21" },
      ],
    });
  });

  it("deletes with Undo back in place, and clears all only after confirming", async () => {
    seed([initiative(), initiative({ id: "i2", name: "Pairing" })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Trunk-based development" }));
    expect(stored()?.initiatives.map((i) => i.id)).toEqual(["i2"]);
    undoLast();
    expect(stored()?.initiatives.map((i) => i.id)).toEqual(["i1", "i2"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear initiatives" }));
    expect(stored()?.initiatives).toEqual([]);
    expect(logs.map((l) => l.action)).toContain("adkar_reset");
    undoLast();
    expect(stored()?.initiatives.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("shows the example without touching the workspace, and clears it", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/^2 of 3 initiatives are held up/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Advance New incident process to Ability" })
    );
    expect(screen.getAllByText(/Stage 4 of 5:/)).toHaveLength(2);
    expect(ws().adkarDocs).toEqual([]);
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    await waitFor(() => expect(screen.getByText(/No initiatives yet/)).toBeInTheDocument());
  });

  it("moves the old blob in once, keeping it as the backup, and never brings back a deleted one", async () => {
    const blob = [
      {
        id: "old1",
        name: "Pairing",
        currentStage: "desire",
        stagesCompleted: ["awareness"],
        stageHistory: [
          { stage: "awareness", enteredAt: "2026-10-01" },
          { stage: "desire", enteredAt: "2026-10-04" },
        ],
        startDate: "2026-09-15",
      },
      {
        id: "old2",
        name: "Mobbing",
        currentStage: "awareness",
        stagesCompleted: [],
        stageHistory: [],
        startDate: "2026-10-02",
      },
    ];
    window.localStorage.setItem(ADKAR_LEGACY_KEY, JSON.stringify(blob));
    migrationMode.value = "local";
    const first = renderPage();
    expect(stored()?.initiatives.map((i) => i.id)).toEqual(["old1", "old2"]);
    expect(stored()?.initiatives[0].stageHistory[0]).toEqual({
      stage: "awareness",
      enteredAt: "2026-09-15",
    });
    expect(screen.getByRole("heading", { name: "Pairing" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(ADKAR_LEGACY_KEY)!)).toEqual(blob);
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(ADKAR_MOVED_KEY) ?? "[]")).toEqual([
        "old1",
        "old2",
      ])
    );
    first.unmount();

    act(() =>
      ws().upsertAdkarDoc({
        id: ADKAR_DOC_ID,
        initiatives: (stored() as AdkarDoc).initiatives.slice(1),
      })
    );
    renderPage();
    expect(stored()?.initiatives.map((i) => i.id)).toEqual(["old2"]);
  });

  it("plans the owner's move on the cloud's copy once the first pull is done", async () => {
    const local = [{ id: "a", name: "Stale", currentStage: "awareness", startDate: "2026-09-01" }];
    const cloud = [
      { id: "a", name: "Renamed", currentStage: "desire", startDate: "2026-09-01" },
      { id: "c", name: "Added elsewhere", currentStage: "awareness", startDate: "2026-10-01" },
    ];
    window.localStorage.setItem(ADKAR_LEGACY_KEY, JSON.stringify(local));
    cloudRead.mockResolvedValue(new Map<string, unknown>([[ADKAR_LEGACY_KEY, cloud]]));
    migrationMode.value = "cloud";
    signedIn.value = { user: { id: "owner" } };
    const ready = vi.spyOn(syncEngine, "whenReady").mockResolvedValue(undefined);
    try {
      renderPage();
      await waitFor(() =>
        expect(stored()?.initiatives.map((i) => i.name)).toEqual(["Renamed", "Added elsewhere"])
      );
      expect(cloudRead).toHaveBeenCalledWith("owner", [ADKAR_LEGACY_KEY, ADKAR_MOVED_KEY]);
    } finally {
      ready.mockRestore();
    }
  });

  it("says the same as the agent for the same data", async () => {
    seed(
      buildExample(new Date(2026, 9, 26)).doc.initiatives.map((i) => ({
        ...i,
        id: i.id.replace("example-", ""),
      }))
    );
    renderPage();
    const state = await run<{ verdict: string; held: number }>("list_state");
    expect(screen.getByText(state.verdict)).toBeInTheDocument();
    expect(state.held).toBe(2);
    expect(screen.getByTestId("export-markdown").textContent).toContain(`> ${state.verdict}`);
  });
});
