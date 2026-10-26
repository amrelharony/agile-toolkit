import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DefinitionOfDone, DodCriterion, Sprint, Story } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { syncEngine } from "@/lib/sync/engine";
import {
  DOD_DOC_ID,
  DOD_LEGACY_KEY,
  adherenceBySprint,
  dodAdherence,
  dodVerdict,
  meetsDod,
  normalizeDefinitionOfDone,
  openCriteria,
  withStoryDodCheck,
} from "@/lib/dod/model";
import { checkDodGate, releaseChecks } from "@/lib/releases/auto-gates";
import { setStoryDodCheck } from "@/lib/sprints/store";

/**
 * The DoD Builder, upgraded: the DoD is a workspace document (the old blob
 * moves in once and stays as the backup), new criteria start Required,
 * adherence is the share of done stories meeting it (ticked on their
 * Sprint board cards), statistics sit behind their minimum samples, the
 * common criteria are an explicit choice, the example stays in memory,
 * and Release Readiness checks a release's linked stories against it.
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
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/app/(tools)/dod-builder/charts", () => ({
  DodAdherenceChart: () => null,
  DodControlChart: () => null,
}));

import { DodBuilderClient } from "@/app/(tools)/dod-builder/dod-builder-client";
import { buildExample } from "@/app/(tools)/dod-builder/example";
import { dodMarkdown } from "@/app/(tools)/dod-builder/markdown";
import { EMPTY_CRITERION, validateCriterion } from "@/app/(tools)/dod-builder/form";
import {
  adherenceChartText,
  adherenceControl,
  adherencePoints,
  adherenceTrend,
} from "@/app/(tools)/dod-builder/adherence";
import { COMMON_CRITERIA } from "@/app/(tools)/dod-builder/starter";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-22";

const crit = (id: string, label: string, required = true, extra: Partial<DodCriterion> = {}) =>
  ({ id, label, category: "code", required, ...extra }) as DodCriterion;
const DOD: DefinitionOfDone = {
  id: DOD_DOC_ID,
  items: [crit("rev", "Code reviewed"), crit("ci", "Tests pass in CI"), crit("doc", "Docs", false)],
  history: [],
};
const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  sprintId: "s1",
  ...patch,
});
const ticked = (...ids: string[]) => ({ dodChecks: { checked: ids, updatedAt: "t" } });
const sprint = (id: string, n: number, patch: Partial<Sprint> = {}): Sprint => ({
  id,
  name: `Sprint ${n}`,
  startDate: `2026-0${n}-01`,
  endDate: `2026-0${n}-14`,
  pointsPlanned: 0,
  status: "completed",
  ...patch,
});

const ws = () => useWorkspaceStore.getState();
const stored = () => (ws().definitionsOfDone ?? []).find((d) => d.id === DOD_DOC_ID);
const seed = (patch: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    definitionsOfDone: [],
    stories: [],
    sprints: [],
    teamMembers: [],
    ...patch,
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <DodBuilderClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 22, 9, 0, 0));
  toastSpy.mockReset();
  migrationMode.value = "off";
  signedIn.value = null;
  cloudRead.mockReset();
  cloudRead.mockResolvedValue(null);
  window.localStorage.clear();
  resetSelectedSprint();
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  seed();
});

/* ── The model ──────────────────────────────────────────────────────── */

describe("reading a stored DoD", () => {
  it("reads the old blob and the workspace document alike, dropping what can't be read", () => {
    const doc = normalizeDefinitionOfDone({
      items: [
        { id: "a", label: " Code reviewed ", category: "code", required: true, done: true },
        { id: "b", label: "Docs", category: "weird", required: "yes" },
        { id: "a", label: "Duplicate id" },
        { label: "   " },
        { label: "No id" },
        null,
      ],
      history: [{ sprintName: "S1", totalRequired: 3, completed: -1, ts: "2026-01-01" }, { x: 1 }],
    });
    expect(doc).toEqual({
      id: DOD_DOC_ID,
      items: [
        { id: "a", label: "Code reviewed", category: "code", required: true, done: true },
        { id: "b", label: "Docs", category: "other", required: false },
        { id: "criterion-5", label: "No id", category: "other", required: false },
      ],
      history: [{ sprintName: "S1", totalRequired: 3, completed: 0, ts: "2026-01-01" }],
    });
    expect(normalizeDefinitionOfDone(undefined)).toEqual({
      id: DOD_DOC_ID,
      items: [],
      history: [],
    });
  });
});

describe("whether a story meets the DoD", () => {
  it("needs every required criterion ticked, ignores optional and removed ones", () => {
    expect(meetsDod(story("a"), DOD)).toBe(false);
    expect(openCriteria(story("a", ticked("rev")), DOD).map((c) => c.id)).toEqual(["ci"]);
    expect(meetsDod(story("a", ticked("rev", "ci", "gone")), DOD)).toBe(true);
    expect(meetsDod(story("a"), { items: [crit("doc", "Docs", false)] })).toBe(null);
  });

  it("ticks and unticks on a story, leaving it alone when nothing changes", () => {
    const s = story("a");
    const one = withStoryDodCheck(s, "rev", true, "t1");
    expect(one.dodChecks).toEqual({ checked: ["rev"], updatedAt: "t1" });
    expect(withStoryDodCheck(one, "rev", true, "t2")).toBe(one);
    expect("dodChecks" in withStoryDodCheck(one, "rev", false, "t3")).toBe(false);
  });

  it("writes ticks through setStoryDodCheck", () => {
    seed({ stories: [story("a")] });
    setStoryDodCheck("a", "rev", true, "t1");
    expect(ws().stories[0].dodChecks).toEqual({ checked: ["rev"], updatedAt: "t1" });
    expect(setStoryDodCheck("missing", "rev", true)).toBe(null);
  });
});

describe("adherence", () => {
  const stories = [
    story("a", ticked("rev", "ci")),
    story("b", ticked("rev")),
    story("c", { status: "in_progress" }),
    story("d", { sprintId: "s2", ...ticked("rev", "ci") }),
    story("example-x"),
  ];

  it("is the share of done stories meeting the DoD, examples never counted", () => {
    expect(dodAdherence(stories, DOD, "s1")).toEqual({
      required: 2,
      done: 2,
      meeting: 1,
      pct: 50,
      missing: [{ id: "b", title: "Story b", sprintId: "s1", open: ["Tests pass in CI"] }],
    });
    expect(dodAdherence(stories, DOD)).toMatchObject({ done: 3, meeting: 2, pct: 67 });
    expect(dodAdherence(stories, DOD, "s1", { examples: true }).done).toBe(3);
  });

  it("reads — with no done stories or nothing required, never 0", () => {
    expect(dodAdherence([], DOD).pct).toBe(null);
    expect(dodAdherence(stories, { items: [crit("doc", "Docs", false)] }, "s1")).toMatchObject({
      done: 2,
      meeting: 0,
      pct: null,
      missing: [],
    });
  });

  it("goes sprint by sprint, oldest first, skipping cancelled sprints and ones with nothing done", () => {
    const rows = adherenceBySprint(
      stories,
      [sprint("s2", 2), sprint("s1", 1), sprint("s3", 3), sprint("s4", 4, { status: "cancelled" })],
      DOD
    );
    expect(rows.map((r) => [r.sprintId, r.done, r.meeting, r.pct])).toEqual([
      ["s1", 2, 1, 50],
      ["s2", 1, 1, 100],
    ]);
  });

  it("says what's missing in one sentence, with a % only from three done stories", () => {
    const a = dodAdherence(stories, DOD, "s1");
    expect(dodVerdict(DOD, a, "Sprint 1")).toBe(
      "1 of 2 done stories in Sprint 1 meet the DoD; “Story b” still needs Tests pass in CI."
    );
    const three = dodAdherence([...stories, story("e", ticked("rev", "ci"))], DOD, "s1");
    expect(dodVerdict(DOD, three, "Sprint 1")).toMatch(
      /^2 of 3 done stories in Sprint 1 meet the DoD \(67%\)/
    );
    expect(dodVerdict({ items: [] }, a)).toBe("No Definition of Done yet.");
    expect(dodVerdict({ items: [crit("x", "X", false)] }, a)).toBe(
      "1 criterion, none required yet: mark the ones every story must meet."
    );
    expect(dodVerdict(DOD, dodAdherence([], DOD, "s9"), "Sprint 9")).toBe(
      "3 criteria (2 required); no story in Sprint 9 is done yet."
    );
    expect(dodVerdict(DOD, dodAdherence([story("a", ticked("rev", "ci"))], DOD))).toBe(
      "The done story meets the DoD."
    );
  });

  it("keeps its statistics behind their minimum samples", () => {
    const ex = buildExample(TODAY);
    const points = adherencePoints(
      adherenceBySprint(ex.stories, ex.sprints, ex.doc, { examples: true })
    );
    expect(points.map((p) => p.pct)).toEqual([50, 60, 75, 80, 100, 67]);
    expect(adherenceControl(points)).toBe(null); // 6 < MIN_SAMPLE.changePoint
    expect(adherenceTrend(points)).not.toBe(null); // 6 = MIN_SAMPLE.trend
    expect(adherenceTrend(points.slice(0, 5))).toBe(null);
    expect(adherenceChartText(points).summary).toBe(
      "Done stories meeting the DoD rose from 50% in Sprint 20 to 67% in Sprint 25 (6 sprints)."
    );
    // The example never reaches the team's numbers.
    expect(adherenceBySprint(ex.stories, ex.sprints, ex.doc)).toEqual([]);
  });
});

describe("the add form", () => {
  it("starts Required, needs words and refuses a duplicate", () => {
    expect(EMPTY_CRITERION.required).toBe(true);
    expect(validateCriterion(EMPTY_CRITERION, [])).toEqual({
      ok: false,
      errors: { label: "Say what a done story must have." },
    });
    expect(
      validateCriterion({ ...EMPTY_CRITERION, label: "code reviewed." }, DOD.items)
    ).toMatchObject({
      ok: false,
      errors: { label: "That criterion is already in the Definition of Done." },
    });
  });
});

/* ── Release Readiness's gate ───────────────────────────────────────── */

describe("the release gate", () => {
  it("checks the done stories a release links, else falls back to the old ticks", () => {
    const stories = [
      story("a", ticked("rev", "ci")),
      story("b", { title: "Pay by card", ...ticked("rev") }),
      story("c", { status: "todo" }),
    ];
    expect(checkDodGate(DOD, [stories[0]])).toMatchObject({ passed: true });
    expect(checkDodGate(DOD, stories)).toMatchObject({
      passed: false,
      detail: "Not met: Pay by card (1 open)",
    });
    expect(checkDodGate(DOD, [stories[2]])).toMatchObject({ passed: null });
    // No linked stories: the team-level ticks, as before.
    const ticks = { items: [crit("rev", "Code reviewed", true, { done: true })] };
    expect(checkDodGate(ticks)).toMatchObject({ passed: true });
    expect(checkDodGate({ items: [] }, stories)).toMatchObject({ passed: null });
    const checks = releaseChecks({ id: "r1", storyIds: ["b"] }, [], DOD, TODAY, stories);
    expect(checks.dod).toMatchObject({ passed: false });
    expect(releaseChecks({ id: "r1" }, [], ticks, TODAY, stories).dod).toMatchObject({
      passed: true,
    });
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("starts empty: the common criteria are a choice (with Undo), never a default", () => {
    renderPage();
    expect(screen.getByText(/No Definition of Done yet\. Add the criteria/)).toBeInTheDocument();
    expect(stored()).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Start from common criteria" }));
    expect(stored()?.items.map((i) => i.label)).toEqual(COMMON_CRITERIA.map((c) => c.label));
    undoLast();
    expect(stored()?.items).toEqual([]);
  });

  it("shows the example in memory only", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(/2 of 3 done stories in Sprint 25 meet the DoD \(67%\)/, { selector: "p" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete “/ })[0]);
    expect(stored()).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("button", { name: "Start from common criteria" })).toBeInTheDocument();
  });

  it("adds a criterion as Required unless unticked, and refuses a blank one", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getByText("Say what a done story must have.")).toBeInTheDocument();
    expect(stored()).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/^Criterion/), { target: { value: "Code reviewed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(stored()?.items).toMatchObject([
      { label: "Code reviewed", required: true, category: "code" },
    ]);
    fireEvent.change(screen.getByLabelText(/^Criterion/), { target: { value: "Docs updated" } });
    fireEvent.click(screen.getByLabelText(/^Required: every done story/));
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(stored()?.items.map((i) => i.required)).toEqual([true, false]);
  });

  it("edits in place, keeps a criterion when its words are emptied, and deletes with Undo", () => {
    seed({ definitionsOfDone: [DOD] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Tests pass in CI/ }));
    const editor = screen.getByLabelText("Criterion");
    fireEvent.change(editor, { target: { value: " " } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(stored()?.items.map((i) => i.label)).toEqual([
      "Code reviewed",
      "Tests pass in CI",
      "Docs",
    ]);

    fireEvent.click(screen.getByLabelText("Required: Docs"));
    expect(stored()?.items[2].required).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Delete “Code reviewed”" }));
    expect(stored()?.items.map((i) => i.id)).toEqual(["ci", "doc"]);
    undoLast();
    expect(stored()?.items.map((i) => i.id)).toEqual(["rev", "ci", "doc"]);
  });

  it("reads adherence from the stories of the selected sprint and names what's missing", () => {
    seed({
      definitionsOfDone: [DOD],
      sprints: [sprint("s1", 1, { status: "active" })],
      stories: [
        story("a", ticked("rev", "ci")),
        story("b", { title: "Pay by card", ...ticked("rev") }),
      ],
    });
    renderPage();
    expect(
      screen.getByText(
        "1 of 2 done stories in Sprint 1 meet the DoD; “Pay by card” still needs Tests pass in CI.",
        { selector: "p" }
      )
    ).toBeInTheDocument();
    const missing = screen.getByRole("list", { name: "Done stories missing the DoD" });
    expect(within(missing).getByText("Pay by card")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tick them on the Sprint board/ })).toHaveAttribute(
      "href",
      "/kanban?sprint=s1"
    );
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "- Pay by card: needs Tests pass in CI"
    );
  });

  it("clears the criteria with a confirm and Undo", () => {
    seed({ definitionsOfDone: [DOD] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear the criteria" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear criteria" }));
    expect(stored()?.items).toEqual([]);
    undoLast();
    expect(stored()?.items.map((i) => i.id)).toEqual(["rev", "ci", "doc"]);
  });
});

/* ── The old blob's one-time move ───────────────────────────────────── */

describe("moving the old blob into the workspace", () => {
  const blob = {
    items: [
      {
        id: "seed-code-review",
        label: "Code reviewed by peer",
        category: "code",
        required: true,
        done: true,
      },
    ],
    history: [{ sprintName: "Sprint 3", totalRequired: 1, completed: 1, ts: "2026-05-01" }],
  };

  it("reads the blob until it can move, then copies it once and keeps the blob", () => {
    window.localStorage.setItem(DOD_LEGACY_KEY, JSON.stringify(blob));
    const first = renderPage();
    // Not safe to write yet (mode "off"): the page reads the blob.
    expect(screen.getByRole("button", { name: /^Code reviewed by peer/ })).toBeInTheDocument();
    expect(stored()).toBeUndefined();
    first.unmount();

    migrationMode.value = "local";
    const second = renderPage();
    expect(stored()).toEqual(normalizeDefinitionOfDone(blob));
    expect(screen.getByText(/Before per-story checks \(1 sprint\)/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(DOD_LEGACY_KEY)!)).toEqual(blob);
    second.unmount();

    // Emptied later, it stays empty: the move never writes over a workspace DoD.
    act(() => ws().upsertDefinitionOfDone({ id: DOD_DOC_ID, items: [], history: [] }));
    renderPage();
    expect(stored()?.items).toEqual([]);
  });

  it("plans on the cloud's copy for the owner", async () => {
    window.localStorage.setItem(DOD_LEGACY_KEY, JSON.stringify(blob));
    const cloud = {
      items: [{ id: "c1", label: "Newer on another device", category: "testing", required: true }],
      history: [],
    };
    cloudRead.mockResolvedValue(new Map<string, unknown>([[DOD_LEGACY_KEY, cloud]]));
    migrationMode.value = "cloud";
    signedIn.value = { user: { id: "owner" } };
    const ready = vi.spyOn(syncEngine, "whenReady").mockResolvedValue(undefined);
    try {
      renderPage();
      await waitFor(() => expect(stored()?.items.map((i) => i.id)).toEqual(["c1"]));
      expect(cloudRead).toHaveBeenCalledWith("owner", [DOD_LEGACY_KEY]);
    } finally {
      ready.mockRestore();
    }
  });
});

describe("the example and the export", () => {
  it("keeps every example row on example- ids", () => {
    const ex = buildExample(TODAY);
    expect(ex.doc.items.every((c) => isExampleId(c.id))).toBe(true);
    expect(ex.sprints.every((s) => isExampleId(s.id))).toBe(true);
    expect(ex.stories.every((s) => isExampleId(s.id))).toBe(true);
  });

  it("writes the criteria by category, optional ones marked, and the by-sprint table", () => {
    const md = dodMarkdown(DOD, {
      sprint: { name: "Sprint 1", adherence: dodAdherence([story("a", ticked("rev"))], DOD, "s1") },
      bySprint: [
        {
          sprintId: "s1",
          name: "Sprint 1",
          startDate: "",
          endDate: "",
          done: 1,
          meeting: 0,
          pct: 0,
        },
      ],
    });
    expect(md).toContain("## Code\n\n- Code reviewed\n- Tests pass in CI\n- Docs (optional)");
    expect(md).toContain("0 of 1 done story meets the DoD (0%).");
    expect(md).toContain("| Sprint 1 | 1 | 0 | 0% |");
    expect(dodMarkdown({ items: [] })).toContain("Not written yet.");
  });
});
