import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FeatureFlag } from "@/lib/stores/workspace-types";

/**
 * Feature Flag Tracker, rebuilt on workspace.featureFlags: staleness by
 * purpose (rollouts after 30 days, experiments after 60, kill switches
 * never, permission flags only past a removal date), a planned removal
 * date, an editable (backdatable) created day, On / Off / Retired with a
 * retired day, the owner from the roster, a link to the release it ships
 * behind, the one-time move of the old blob, edit in place, delete with
 * Undo, an example that stays out of the workspace, a verdict, Markdown,
 * and agent actions that read the same numbers.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
const migrationMode = vi.hoisted(() => ({ value: "off" as string }));
// The owner signed in (cloud mode), and the cloud's copy of the old blobs.
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
vi.mock("@/app/(tools)/feature-flag-tracker/cloud-rows", () => ({ readCloudBlobs: cloudRead }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/app/(tools)/feature-flag-tracker/charts", () => ({
  FlagSurvivalChart: () => null,
  FlagAgeChart: () => null,
}));

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

import { FeatureFlagTrackerClient } from "@/app/(tools)/feature-flag-tracker/feature-flag-tracker-client";
import { buildExample } from "@/app/(tools)/feature-flag-tracker/example";
import { toMarkdown } from "@/app/(tools)/feature-flag-tracker/markdown";
import { flagVerdict } from "@/app/(tools)/feature-flag-tracker/verdict";
import {
  applyFlag,
  emptyDraft,
  releaseOptions,
  validateFlag,
  validateRetiredDay,
} from "@/app/(tools)/feature-flag-tracker/form";
import {
  ageBuckets,
  createdPerWeek,
  creationTrend,
  flagSurvival,
  trendSentence,
} from "@/app/(tools)/feature-flag-tracker/analysis";
import { dayLabel, stalenessText } from "@/app/(tools)/feature-flag-tracker/text";
import { weekOf } from "@/lib/flow";
import { syncEngine } from "@/lib/sync/engine";
import {
  FLAGS_LEGACY_KEY,
  FLAGS_MOVED_KEY,
  compareFlags,
  flagDateErrors,
  flagStaleness,
  flagSummary,
  normalizeFlag,
  planLegacyMove,
  quarterStart,
  withLiveStatus,
} from "@/lib/flags/model";
import { checkFlagsGate } from "@/lib/releases/auto-gates";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/feature-flag-tracker";

const TODAY = todayIso();
const on = (n: number) => addDays(TODAY, n) as string;

const flag = (over: Partial<FeatureFlag> = {}): FeatureFlag => ({
  id: "f1",
  name: "checkout_v2",
  status: "on",
  purpose: "rollout",
  createdAt: on(-5),
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().featureFlags ?? [];
const seed = (...flags: FeatureFlag[]) => useWorkspaceStore.setState({ featureFlags: flags });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <FeatureFlagTrackerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const card = (name: string) => screen.getByRole("article", { name });
const undo = (label: string) => {
  const call = toastSpy.mock.calls.find((c) => String(c[0]).startsWith(label));
  expect(call, `toast "${label}"`).toBeTruthy();
  act(() => (call![1] as { action: { onClick: () => void } }).action.onClick());
};

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = <T,>(verb: string, params: Record<string, unknown>) =>
  registry.get(`tool.feature_flag_tracker.${verb}`)!.handler(params, ctx()) as Promise<T>;

beforeEach(() => {
  toastSpy.mockReset();
  migrationMode.value = "off";
  signedIn.value = null;
  cloudRead.mockReset();
  cloudRead.mockResolvedValue(null);
  window.localStorage.removeItem(FLAGS_LEGACY_KEY);
  window.localStorage.removeItem(FLAGS_MOVED_KEY);
  useWorkspaceStore.setState({ featureFlags: [], releaseReadinesses: [], stories: [] });
});

/* ── Staleness ──────────────────────────────────────────────────────── */

describe("staleness by purpose", () => {
  it("calls a rollout stale once it's over 30 days old, counted from a backdated created day", () => {
    expect(flagStaleness(flag({ createdAt: on(-30) }), TODAY)).toMatchObject({
      stale: false,
      dueOn: TODAY,
      ageDays: 30,
    });
    expect(flagStaleness(flag({ createdAt: on(-31) }), TODAY)).toMatchObject({
      stale: true,
      reason: "over-typical-lifetime",
      daysOver: 1,
      ageDays: 31,
    });
    expect(flagStaleness(flag({ purpose: "experiment", createdAt: on(-61) }), TODAY)).toMatchObject(
      {
        stale: true,
        daysOver: 1,
      }
    );
    expect(flagStaleness(flag({ purpose: "experiment", createdAt: on(-45) }), TODAY).stale).toBe(
      false
    );
  });

  it("uses the planned removal date first, whatever the age", () => {
    const young = flag({ createdAt: on(-3), removeBy: on(-1) });
    expect(flagStaleness(young, TODAY)).toMatchObject({
      stale: true,
      reason: "past-removal-date",
      daysOver: 1,
      dueOn: on(-1),
    });
    // An old rollout with a removal date still ahead isn't stale.
    expect(flagStaleness(flag({ createdAt: on(-200), removeBy: on(10) }), TODAY).stale).toBe(false);
  });

  it("never calls a kill switch stale, and a permission flag only once it has a removal date that passed", () => {
    expect(
      flagStaleness(flag({ purpose: "kill_switch", createdAt: on(-900) }), TODAY)
    ).toMatchObject({
      stale: false,
      exempt: true,
    });
    expect(
      flagStaleness(
        flag({ purpose: "kill_switch", createdAt: on(-900), removeBy: on(-100) }),
        TODAY
      ).stale
    ).toBe(false);
    expect(
      flagStaleness(flag({ purpose: "permission", createdAt: on(-900) }), TODAY)
    ).toMatchObject({
      stale: false,
      exempt: true,
    });
    expect(
      flagStaleness(flag({ purpose: "permission", createdAt: on(-900), removeBy: on(-1) }), TODAY)
    ).toMatchObject({ stale: true, exempt: false, reason: "past-removal-date" });
  });

  it("never calls a retired flag stale, and reads its age to the retired day", () => {
    expect(
      flagStaleness(flag({ status: "retired", createdAt: on(-400), retiredAt: on(-300) }), TODAY)
    ).toMatchObject({ stale: false, ageDays: 100 });
    // An unreadable created day: age unknown, not stale.
    expect(flagStaleness(flag({ createdAt: "" }), TODAY)).toMatchObject({
      stale: false,
      ageDays: null,
    });
  });

  it("words why", () => {
    expect(
      stalenessText(flagStaleness(flag({ createdAt: on(-3), removeBy: on(-12) }), TODAY), "rollout")
    ).toBe("Past its removal date by 12 days");
    expect(stalenessText(flagStaleness(flag({ createdAt: on(-35) }), TODAY), "rollout")).toBe(
      "Over 30 days for a rollout (by 5 days)"
    );
    expect(
      stalenessText(flagStaleness(flag({ purpose: "kill_switch" }), TODAY), "kill_switch")
    ).toBe("Exempt: kill switch");
  });
});

describe("the summary", () => {
  it("counts live, stale, past removal, exempt, unowned and retired this quarter", () => {
    const flags = [
      flag({ id: "a", createdAt: on(-40) }),
      flag({ id: "b", removeBy: on(-1), owner: "Sam" }),
      flag({ id: "c", purpose: "kill_switch", status: "off" }),
      flag({ id: "d", status: "retired", retiredAt: TODAY }),
      flag({ id: "e", status: "retired", retiredAt: addDays(quarterStart(TODAY), -1) as string }),
      flag({ id: "f", status: "retired" }),
    ];
    expect(flagSummary(flags, TODAY)).toEqual({
      total: 6,
      live: 3,
      on: 2,
      off: 1,
      retired: 3,
      stale: 2,
      pastRemoval: 1,
      overLifetime: 1,
      exempt: 1,
      noOwner: 2,
      retiredThisQuarter: 1,
      byPurpose: { rollout: 2, experiment: 0, kill_switch: 1, permission: 0 },
    });
    expect(flagSummary([], TODAY)).toMatchObject({ total: 0, live: 0, stale: 0 });
  });

  it("orders live flags most overdue first, the exempt last among them, then retired ones", () => {
    const flags = [
      flag({ id: "retired", name: "r", status: "retired", retiredAt: on(-1) }),
      flag({ id: "kill", name: "k", purpose: "kill_switch" }),
      flag({ id: "due", name: "d", removeBy: on(5) }),
      flag({ id: "late", name: "l", createdAt: on(-50) }),
      flag({ id: "later", name: "ll", createdAt: on(-90) }),
    ];
    expect([...flags].sort((a, b) => compareFlags(a, b, TODAY)).map((f) => f.id)).toEqual([
      "later",
      "late",
      "due",
      "kill",
      "retired",
    ]);
  });

  it("says how many are stale and why, and which are exempt", () => {
    expect(flagVerdict([], TODAY)).toBe("No flags tracked yet.");
    expect(flagVerdict(buildExample(TODAY), TODAY)).toBe(
      "2 of 5 live flags are stale: 1 rollout past its removal date and 1 experiment over 60 days. 2 are exempt: 1 kill switch and 1 permission flag."
    );
    expect(flagVerdict([flag()], TODAY)).toBe("No stale flags among the one live flag.");
    expect(flagVerdict([flag({ status: "retired" })], TODAY)).toBe(
      "No live flags: the one flag tracked is retired."
    );
  });
});

/* ── Stored rows and the move ───────────────────────────────────────── */

describe("the tracker's old rows", () => {
  it("reads active as on and deprecated as retired, keeping (never inventing) the retired day", () => {
    const old = {
      id: "x",
      name: "a",
      status: "active",
      createdAt: "2026-01-10",
      environment: "prod",
      purpose: "rollout",
    };
    expect(normalizeFlag(old)).toEqual({
      id: "x",
      name: "a",
      status: "on",
      purpose: "rollout",
      createdAt: "2026-01-10",
      environment: "prod",
    });
    expect(normalizeFlag({ ...old, status: "deprecated", retiredAt: "2026-03-01" })).toMatchObject({
      status: "retired",
      retiredAt: "2026-03-01",
    });
    const undated = normalizeFlag({ ...old, status: "deprecated" });
    expect(undated?.status).toBe("retired");
    expect(undated?.retiredAt).toBeUndefined();
    expect(normalizeFlag({ ...old, status: "off" })?.status).toBe("off");
    expect(normalizeFlag({ ...old, createdAt: "garbage" })?.createdAt).toBe("");
    expect(normalizeFlag({ ...old, purpose: "mystery" })).toBeNull();
    expect(normalizeFlag({ ...old, id: "" })).toBeNull();
    expect(normalizeFlag("nope")).toBeNull();
  });

  it("moves the old blob's flags by id, once, never over a workspace row", () => {
    const blob = [
      {
        id: "a",
        name: "a",
        status: "active",
        createdAt: on(-50),
        environment: "prod",
        purpose: "rollout",
      },
      {
        id: "b",
        name: "b",
        status: "deprecated",
        createdAt: on(-80),
        retiredAt: on(-10),
        environment: "dev",
        purpose: "experiment",
      },
    ];
    const first = planLegacyMove(blob, [], []);
    expect(first.toMove.map((f) => f.id)).toEqual(["a", "b"]);
    expect(first.moved).toEqual(["a", "b"]);
    // Run again with the moved rows in the workspace: nothing to do.
    expect(planLegacyMove(blob, first.toMove, first.moved)).toEqual({
      toMove: [],
      moved: ["a", "b"],
      changed: false,
    });
    // A flag deleted since the move stays deleted.
    expect(planLegacyMove(blob, [first.toMove[0]], first.moved).toMove).toEqual([]);
    // The record hasn't synced, but the workspace has some of the flags: moved already.
    expect(planLegacyMove(blob, [{ id: "a" }], []).toMove).toEqual([]);
    // A row already in the workspace is never overwritten.
    expect(planLegacyMove(blob, [{ id: "a" }], ["a"]).toMove.map((f) => f.id)).toEqual(["b"]);
    expect(planLegacyMove(null, [], [])).toEqual({ toMove: [], moved: [], changed: false });
  });

  it("moves them on the page, leaves the old blob as the backup, and doesn't bring back a deleted flag", () => {
    const blob = [
      {
        id: "old1",
        name: "legacy_rollout",
        status: "active",
        createdAt: on(-50),
        environment: "prod",
        purpose: "rollout",
      },
      {
        id: "old2",
        name: "legacy_kill",
        status: "on",
        createdAt: on(-500),
        environment: "all",
        purpose: "kill_switch",
      },
    ];
    window.localStorage.setItem(FLAGS_LEGACY_KEY, JSON.stringify(blob));
    migrationMode.value = "local";
    const first = renderPage();
    expect(
      stored()
        .map((f) => f.id)
        .sort()
    ).toEqual(["old1", "old2"]);
    expect(stored().find((f) => f.id === "old1")).toMatchObject({
      status: "on",
      purpose: "rollout",
    });
    expect(card("legacy_rollout")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(FLAGS_LEGACY_KEY)!)).toEqual(blob);
    first.unmount();

    act(() => ws().removeFeatureFlag("old1"));
    renderPage();
    expect(stored().map((f) => f.id)).toEqual(["old2"]);
  });
});

/* ── The form ───────────────────────────────────────────────────────── */

describe("the flag form", () => {
  it("requires a name and a purpose, and leaves the environment unset", () => {
    expect(emptyDraft(TODAY)).toMatchObject({
      purpose: null,
      environment: "",
      createdAt: TODAY,
      removeBy: "",
    });
    expect(validateFlag(emptyDraft(TODAY), TODAY)).toEqual({
      ok: false,
      errors: {
        name: "Enter the flag's name, as it is in the code.",
        purpose: "Pick what the flag is for: it decides when it goes stale.",
      },
    });
    const ok = validateFlag({ ...emptyDraft(TODAY), name: "x", purpose: "permission" }, TODAY);
    expect(ok).toEqual({
      ok: true,
      values: { name: "x", purpose: "permission", createdAt: TODAY },
    });
  });

  it("errors on a name over 200 characters instead of cutting it", () => {
    const v = validateFlag(
      { ...emptyDraft(TODAY), name: "n".repeat(201), purpose: "rollout" },
      TODAY
    );
    expect(v).toEqual({ ok: false, errors: { name: "Keep the name to 200 characters." } });
  });

  it("backdates the created day but not into the future, and removes it no earlier than it was created", () => {
    const base = { ...emptyDraft(TODAY), name: "x", purpose: "rollout" as const };
    expect(validateFlag({ ...base, createdAt: on(-400) }, TODAY).ok).toBe(true);
    expect(validateFlag({ ...base, createdAt: on(1) }, TODAY)).toMatchObject({
      ok: false,
      errors: { createdAt: "It can't be created in the future." },
    });
    expect(validateFlag({ ...base, createdAt: on(-5), removeBy: on(-6) }, TODAY)).toMatchObject({
      ok: false,
      errors: { removeBy: "It can't be removed before it was created." },
    });
    // A removal date already past is fine: an overdue flag logged late.
    expect(validateFlag({ ...base, createdAt: on(-50), removeBy: on(-6) }, TODAY).ok).toBe(true);
    expect(flagDateErrors({ createdAt: "2026-02-30" }, TODAY)).toEqual({
      createdAt: "Use a date like 2026-10-24.",
    });
  });

  it("checks the retired day: not before created, not in the future", () => {
    expect(validateRetiredDay(on(-1), on(-5), TODAY)).toEqual({ ok: true, values: on(-1) });
    expect(validateRetiredDay(on(-6), on(-5), TODAY).ok).toBe(false);
    expect(validateRetiredDay(on(1), on(-5), TODAY).ok).toBe(false);
  });

  it("keeps fields the editor doesn't show, and an unchanged flag as it is", () => {
    const f = flag({
      sentTo: [{ route: "backlog-story", targetId: "s1", at: "x" }],
      owner: "Sam",
      environment: "prod",
    });
    const v = validateFlag(
      {
        ...emptyDraft(TODAY),
        ...{
          name: f.name,
          purpose: f.purpose,
          createdAt: f.createdAt,
          owner: "Sam",
          environment: "prod",
        },
      },
      TODAY
    );
    expect(v.ok && applyFlag(f, v.values)).toBe(f);
    const next = v.ok && applyFlag(f, { ...v.values, owner: undefined, environment: undefined });
    expect(next).toMatchObject({ sentTo: f.sentTo });
    expect(next && next.owner).toBeUndefined();
  });

  it("offers the real releases, the planned ones first", () => {
    expect(
      releaseOptions([
        {
          id: "s",
          name: "Shipped",
          plannedDate: "2026-01-01",
          status: "shipped",
          shippedDate: "2026-01-01",
          gates: {},
        },
        {
          id: "example-x",
          name: "Example",
          plannedDate: "2026-01-01",
          status: "planning",
          gates: {},
        },
        { id: "p2", name: "Later", plannedDate: "2026-12-01", status: "planning", gates: {} },
        { id: "p1", name: "Soon", plannedDate: "2026-11-01", status: "planning", gates: {} },
        { id: "blank", name: " ", plannedDate: "2026-11-01", status: "planning", gates: {} },
      ]).map((o) => o.id)
    ).toEqual(["p1", "p2", "s"]);
  });
});

/* ── Analysis and export ────────────────────────────────────────────── */

describe("analysis", () => {
  it("bands live flags by age", () => {
    const buckets = ageBuckets(buildExample(TODAY), TODAY);
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 1]);
    expect(buckets[4].byPurpose.kill_switch).toBe(1);
  });

  it("opens the survival curve only from five retired flags with their days", () => {
    const ex = buildExample(TODAY);
    expect(flagSurvival(ex, TODAY)?.retired).toBe(7);
    const four = ex
      .filter((f) => f.status !== "retired")
      .concat(ex.filter((f) => f.status === "retired").slice(0, 4));
    expect(flagSurvival(four, TODAY)).toBeNull();
    // A retirement with no day is left out, not dated today.
    const undated = four.concat(flag({ id: "u", status: "retired" }));
    expect(flagSurvival(undated, TODAY)).toBeNull();
  });

  it("reads a creation trend only from six weeks, three of them with flags", () => {
    const weekly = (weeks: number) =>
      Array.from({ length: weeks }, (_, i) => flag({ id: `w${i}`, createdAt: on(-7 * i) }));
    expect(creationTrend(createdPerWeek(weekly(5), TODAY))).toBeNull();
    expect(creationTrend(createdPerWeek(weekly(6), TODAY))).not.toBeNull();
    // Six weeks, but flags in only two of them.
    expect(
      creationTrend(
        createdPerWeek([flag({ createdAt: on(-42) }), flag({ id: "b", createdAt: TODAY })], TODAY)
      )
    ).toBeNull();
  });

  it("exports Markdown with the verdict, live flags most overdue first, and retired ones", () => {
    const md = toMarkdown(buildExample(TODAY), TODAY, () => undefined);
    expect(md).toContain("**2 of 5 live flags are stale");
    expect(md).toContain("- Retired this quarter: 1");
    const live = md.split("## Live (5)")[1].split("## Retired")[0];
    expect(live.indexOf("search_ranking_ab")).toBeLessThan(live.indexOf("checkout_v2_rollout"));
    expect(md).toContain("Past its removal date by 12 days");
    expect(md).toContain("Exempt: kill switch");
    expect(md).toContain("## Retired (7)");
    expect(toMarkdown([], TODAY, () => undefined)).toMatch(/No flags tracked yet\.\n$/);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("adds nothing until the flag has a name and a purpose, then saves a backdated live flag", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add flag" }));
    expect(screen.getByText("Enter the flag's name, as it is in the code.")).toBeInTheDocument();
    expect(screen.getByText(/Pick what the flag is for/)).toBeInTheDocument();
    expect(stored()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "search_v3" } });
    fireEvent.click(screen.getByRole("radio", { name: "Rollout" }));
    fireEvent.change(screen.getByLabelText(/^Created on/), { target: { value: on(-40) } });
    fireEvent.click(screen.getByRole("button", { name: "Add flag" }));
    expect(stored()).toEqual([
      expect.objectContaining({
        name: "search_v3",
        status: "on",
        purpose: "rollout",
        createdAt: on(-40),
      }),
    ]);
    expect(stored()[0].environment).toBeUndefined();
    // Backdated past 30 days: stale at once.
    expect(
      within(card("search_v3")).getByText("Over 30 days for a rollout (by 10 days)")
    ).toBeInTheDocument();
  });

  it("turns a flag off and on, and retires it on a backdated day that counts in its own quarter", () => {
    seed(flag({ createdAt: on(-200) }));
    renderPage();
    fireEvent.click(within(card("checkout_v2")).getByRole("radio", { name: "Off" }));
    expect(stored()[0].status).toBe("off");

    fireEvent.click(
      within(card("checkout_v2")).getByRole("button", { name: "Retire checkout_v2" })
    );
    const lastQuarter = addDays(quarterStart(TODAY), -3) as string;
    fireEvent.change(within(card("checkout_v2")).getByLabelText(/^Retired on/), {
      target: { value: lastQuarter },
    });
    fireEvent.click(within(card("checkout_v2")).getByRole("button", { name: "Retire flag" }));
    expect(stored()[0]).toMatchObject({ status: "retired", retiredAt: lastQuarter });
    expect(flagSummary(stored(), TODAY).retiredThisQuarter).toBe(0);
    undo("Retired “checkout_v2”");
    expect(stored()[0]).toMatchObject({ status: "off" });
    expect(stored()[0].retiredAt).toBeUndefined();
  });

  it("edits every field in place, the created day included", () => {
    seed(flag());
    renderPage();
    fireEvent.click(within(card("checkout_v2")).getByRole("button", { name: "Edit checkout_v2" }));
    const editor = within(screen.getByRole("group", { name: "Edit checkout_v2" }));
    fireEvent.change(editor.getByLabelText(/^Created on/), { target: { value: on(-100) } });
    fireEvent.change(editor.getByLabelText(/^Planned removal/), { target: { value: on(20) } });
    fireEvent.change(editor.getByLabelText(/^Owner/), { target: { value: "Priya" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()[0]).toMatchObject({
      id: "f1",
      createdAt: on(-100),
      removeBy: on(20),
      owner: "Priya",
    });
    expect(within(card("checkout_v2")).getByText(/Due by/)).toBeInTheDocument();
  });

  it("deletes with Undo", () => {
    seed(flag({ id: "a", name: "a" }), flag({ id: "b", name: "b" }));
    renderPage();
    fireEvent.click(within(card("a")).getByRole("button", { name: "Delete a" }));
    expect(stored().map((f) => f.id)).toEqual(["b"]);
    undo("Deleted “a”");
    expect(
      stored()
        .map((f) => f.id)
        .sort()
    ).toEqual(["a", "b"]);
  });

  it("links a flag to a release, which Release Readiness's flag gate then reads", () => {
    useWorkspaceStore.setState({
      releaseReadinesses: [
        {
          id: RELEASE_DOC_ID,
          releases: [{ id: "r1", name: "v3.4", plannedDate: on(5), status: "planning", gates: {} }],
        },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "checkout_v2" } });
    fireEvent.click(screen.getByRole("radio", { name: "Rollout" }));
    fireEvent.change(screen.getByLabelText(/^Ships with/), { target: { value: "r1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add flag" }));
    expect(stored()[0].releaseId).toBe("r1");
    expect(within(card("checkout_v2")).getByRole("link", { name: "v3.4" })).toHaveAttribute(
      "href",
      "/release-readiness"
    );
    expect(checkFlagsGate({ id: "r1" }, stored(), TODAY)).toMatchObject({
      passed: false,
      detail: "checkout_v2 has no owner and no removal date",
    });
  });

  it("shows the example without writing it to the workspace, and clears it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(card("checkout_v2_rollout")).toBeInTheDocument();
    expect(stored()).toEqual([]);
    fireEvent.click(
      within(card("dark_mode_rollout")).getByRole("button", { name: "Delete dark_mode_rollout" })
    );
    expect(stored()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
    expect(screen.getByText(/No flags tracked yet/)).toBeInTheDocument();
  });

  it("offers a stale flag's removal to the backlog", () => {
    seed(flag({ createdAt: on(-60) }));
    renderPage();
    expect(
      within(card("checkout_v2")).getByRole("button", { name: /^Send to… Remove flag checkout_v2/ })
    ).toBeInTheDocument();
  });

  it("brings a retired flag back on", () => {
    seed(flag({ status: "retired", retiredAt: on(-2) }));
    renderPage();
    fireEvent.click(
      within(card("checkout_v2")).getByRole("button", { name: "Bring back checkout_v2" })
    );
    expect(stored()[0]).toEqual(
      withLiveStatus(flag({ status: "retired", retiredAt: on(-2) }), "on")
    );
  });
});

/* ── The agent ──────────────────────────────────────────────────────── */

describe("tool.feature_flag_tracker, the same numbers as the page", () => {
  it("lists every flag with its staleness and flagSummary's numbers", async () => {
    const ex = buildExample(TODAY);
    seed(...ex);
    const state = await run<{
      total: number;
      summary: ReturnType<typeof flagSummary>;
      flags: (FeatureFlag & { staleness: ReturnType<typeof flagStaleness> })[];
    }>("list_state", {});
    expect(state.total).toBe(ex.length);
    expect(state.summary).toEqual(flagSummary(ex, TODAY));
    expect(state.flags.map((f) => f.id)).toEqual(
      [...ex].sort((a, b) => compareFlags(a, b, TODAY)).map((f) => f.id)
    );
    for (const f of state.flags) expect(f.staleness).toEqual(flagStaleness(f, TODAY));
  });
});

/* ── Review fixes ───────────────────────────────────────────────────── */

describe("the old blob's move, for the owner", () => {
  it("plans on the cloud's copy, not this device's older one", async () => {
    const local = [
      { id: "A", name: "old_name", status: "active", createdAt: on(-50), purpose: "rollout" },
      { id: "B", name: "deleted_elsewhere", status: "on", createdAt: on(-40), purpose: "rollout" },
    ];
    const cloud = [
      {
        id: "A",
        name: "renamed",
        status: "deprecated",
        createdAt: on(-50),
        retiredAt: on(-3),
        purpose: "rollout",
      },
      {
        id: "C",
        name: "added_elsewhere",
        status: "off",
        createdAt: on(-20),
        purpose: "experiment",
      },
    ];
    window.localStorage.setItem(FLAGS_LEGACY_KEY, JSON.stringify(local));
    cloudRead.mockResolvedValue(new Map<string, unknown>([[FLAGS_LEGACY_KEY, cloud]]));
    migrationMode.value = "cloud";
    signedIn.value = { user: { id: "owner" } };
    const ready = vi.spyOn(syncEngine, "whenReady").mockResolvedValue(undefined);
    try {
      renderPage();
      await waitFor(() =>
        expect(
          stored()
            .map((f) => f.id)
            .sort()
        ).toEqual(["A", "C"])
      );
      expect(cloudRead).toHaveBeenCalledWith("owner", [FLAGS_LEGACY_KEY, FLAGS_MOVED_KEY]);
      expect(stored().find((f) => f.id === "A")).toMatchObject({
        name: "renamed",
        status: "retired",
        retiredAt: on(-3),
      });
      // The blob stays as this device had it, the backup.
      expect(JSON.parse(window.localStorage.getItem(FLAGS_LEGACY_KEY)!)).toEqual(local);
    } finally {
      ready.mockRestore();
    }
  });

  it("doesn't bring back flags moved and deleted on another device, whose record only the cloud has", async () => {
    const blob = [
      { id: "A", name: "a", status: "on", createdAt: on(-50), purpose: "rollout" },
      { id: "B", name: "b", status: "on", createdAt: on(-40), purpose: "rollout" },
    ];
    window.localStorage.setItem(FLAGS_LEGACY_KEY, JSON.stringify(blob));
    cloudRead.mockResolvedValue(
      new Map<string, unknown>([
        [FLAGS_LEGACY_KEY, blob],
        [FLAGS_MOVED_KEY, ["A", "B"]],
      ])
    );
    migrationMode.value = "cloud";
    signedIn.value = { user: { id: "owner" } };
    const ready = vi.spyOn(syncEngine, "whenReady").mockResolvedValue(undefined);
    try {
      renderPage();
      await waitFor(() =>
        expect(JSON.parse(window.localStorage.getItem(FLAGS_MOVED_KEY) ?? "[]")).toEqual(["A", "B"])
      );
      expect(stored()).toEqual([]);
    } finally {
      ready.mockRestore();
    }
  });

  it("moves what this device holds when the cloud can't be read", async () => {
    const blob = [{ id: "A", name: "a", status: "on", createdAt: on(-50), purpose: "rollout" }];
    window.localStorage.setItem(FLAGS_LEGACY_KEY, JSON.stringify(blob));
    migrationMode.value = "cloud";
    signedIn.value = { user: { id: "owner" } };
    const ready = vi.spyOn(syncEngine, "whenReady").mockResolvedValue(undefined);
    try {
      renderPage();
      await waitFor(() => expect(stored().map((f) => f.id)).toEqual(["A"]));
    } finally {
      ready.mockRestore();
    }
  });
});

describe("the creation trend, up to today", () => {
  it("runs to this week, with the quiet weeks since the last flag as 0", () => {
    // A flag a week for six weeks, then nothing for fourteen weeks.
    const old = Array.from({ length: 6 }, (_, i) =>
      flag({ id: `w${i}`, createdAt: on(-100 - 7 * i) })
    );
    const weeks = createdPerWeek(old, TODAY);
    expect(weeks[weeks.length - 1]).toEqual({ label: weekOf(TODAY), value: 0 });
    // The stand-in for today isn't counted, and every flag is.
    expect(weeks.reduce((a, w) => a + w.value, 0)).toBe(6);
    expect(creationTrend(weeks)).toMatchObject({ significant: true, trend: "down" });
    expect(trendSentence(creationTrend(weeks)!, weeks.length)).toMatch(/more slowly/);
  });

  it("counts a flag created today once, leaves out a future day, and reads nothing from no flags", () => {
    const weeks = createdPerWeek(
      [flag({ createdAt: TODAY }), flag({ id: "x", createdAt: on(5) })],
      TODAY
    );
    expect(weeks).toEqual([{ label: weekOf(TODAY), value: 1 }]);
    expect(createdPerWeek([], TODAY)).toEqual([]);
    // Never more than the latest 26 weeks.
    expect(createdPerWeek([flag({ createdAt: on(-400) })], TODAY)).toHaveLength(26);
  });
});

describe("the agent's dates, as the page judges them", () => {
  it("edits and retires a flag created after midnight east of UTC (tomorrow on the server)", async () => {
    seed(flag({ createdAt: on(1) }));
    expect(await run("update_flag", { flagId: "f1", owner: "Sam" })).toMatchObject({
      updated: true,
    });
    expect(await run("retire_flag", { flagId: "f1" })).toEqual({ retired: true, retiredAt: on(1) });
    // Two days ahead isn't a time zone: still refused.
    seed(flag({ id: "f2", createdAt: on(-5) }));
    expect(await run("update_flag", { flagId: "f2", createdAt: on(2) })).toMatchObject({
      updated: false,
      reason: "It can't be created in the future.",
    });
  });

  it("doesn't re-judge dates left alone: an old row with no created day still takes an owner", async () => {
    useWorkspaceStore.setState({
      featureFlags: [{ ...flag(), createdAt: "" }],
    });
    expect(await run("update_flag", { flagId: "f1", owner: "Sam" })).toMatchObject({
      updated: true,
    });
    expect(stored()[0]).toMatchObject({ owner: "Sam", createdAt: "" });
  });

  it("checks a new created day against the retired and removal days", async () => {
    seed(flag({ status: "retired", createdAt: on(-30), retiredAt: on(-10) }));
    expect(await run("update_flag", { flagId: "f1", createdAt: on(-5) })).toMatchObject({
      updated: false,
      reason: "It can't be retired before it was created.",
    });
    seed(flag({ createdAt: on(-30), removeBy: on(-10) }));
    expect(await run("update_flag", { flagId: "f1", createdAt: on(-5) })).toMatchObject({
      updated: false,
      reason: "It can't be removed before it was created.",
    });
    expect(await run("update_flag", { flagId: "f1", removeBy: on(-40) })).toMatchObject({
      updated: false,
      reason: "It can't be removed before it was created.",
    });
    expect(stored()[0]).toMatchObject({ createdAt: on(-30), removeBy: on(-10) });
  });
});

describe("the page's words", () => {
  it("says 'them' when several live flags have no owner", () => {
    seed(flag({ id: "a", name: "a" }), flag({ id: "b", name: "b" }));
    renderPage();
    expect(
      screen.getByText(
        "2 live flags have no owner. Somebody has to remove them: pick an owner with Edit."
      )
    ).toBeInTheDocument();
  });

  it("exports days with their year", () => {
    const ex = buildExample(TODAY);
    const md = toMarkdown(ex, TODAY, () => undefined);
    const live = ex.find((f) => f.status !== "retired" && f.removeBy)!;
    expect(md).toContain(
      `| ${dayLabel(live.createdAt, true)} | ${dayLabel(live.removeBy, true)} |`
    );
    const retired = ex.find((f) => f.status === "retired" && f.retiredAt)!;
    expect(md).toContain(`| ${dayLabel(retired.retiredAt, true)} |`);
  });
});
