import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FeatureFlag, Release, ReleaseReadiness } from "@/lib/stores/workspace-types";
import { RELEASE_GATE_IDS } from "@/lib/stores/workspace-types";

/**
 * Release Readiness, rebuilt: the team's own gates (the built-ins until it
 * changes them), two of them checked automatically (Feature flag ready
 * from the Feature Flag Tracker, Definition of Done met from the DoD
 * Builder); Ship through a dated dialog that freezes the gates as they
 * stood instead of the browser's confirm(); rollbacks with their day;
 * reopened releases whose earlier ship still counts; stats over every
 * ship from lib/releases; edit in place; delete with Undo; an example
 * that never touches the workspace; a verdict; a Markdown export; and
 * agent actions that read the same numbers.
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
// Recharts has nothing to measure in jsdom; the charts' text is tested directly.
vi.mock("@/app/(tools)/release-readiness/charts", () => ({
  GatePassControlChart: () => null,
  SkippedGatesChart: () => null,
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

import { ReleaseReadinessClient } from "@/app/(tools)/release-readiness/release-readiness-client";
import { buildExample } from "@/app/(tools)/release-readiness/example";
import { toMarkdown } from "@/app/(tools)/release-readiness/markdown";
import {
  EMPTY_RELEASE,
  applyRelease,
  validateGate,
  validateRelease,
} from "@/app/(tools)/release-readiness/form";
import {
  nextRelease,
  overallVerdict,
  releaseVerdict,
} from "@/app/(tools)/release-readiness/verdict";
import {
  passControl,
  passSeries,
  passTrend,
  skippedChartText,
  skippedRows,
} from "@/app/(tools)/release-readiness/analysis";
import {
  checkDodGate,
  checkFlagsGate,
  effectiveGates,
  gateLabels,
  gateResults,
  newGateId,
  releaseChecks,
  reopenRelease,
  rollBackRelease,
  rollbackDateError,
  shipDateError,
  shipRelease,
  storedGates,
  withTeamGates,
} from "@/lib/releases/auto-gates";
import { BUILT_IN_GATES, DOD_GATE, RELEASE_DOC_ID, gatesOf, teamGates } from "@/lib/releases/gates";
import { releaseStats, shipEvents } from "@/lib/releases/model";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/release-readiness";

const TODAY = todayIso();
const on = (n: number) => addDays(TODAY, n) as string;
const DOD_KEY = "agile-toolkit:dod-builder";

const release = (over: Partial<Release> = {}): Release => ({
  id: "r1",
  name: "v1",
  plannedDate: on(3),
  status: "planning",
  gates: {},
  ...over,
});

const flag = (over: Partial<FeatureFlag> = {}): FeatureFlag => ({
  id: "f1",
  name: "checkout_v2",
  status: "on",
  purpose: "rollout",
  createdAt: on(-5),
  owner: "Priya",
  removeBy: on(30),
  releaseId: "r1",
  ...over,
});

const allPassed = Object.fromEntries(RELEASE_GATE_IDS.map((id) => [id, true]));

const ws = () => useWorkspaceStore.getState();
const doc = () => (ws().releaseReadinesses ?? []).find((d) => d.id === RELEASE_DOC_ID);
const releases = () => doc()?.releases ?? [];
const seed = (d: Partial<ReleaseReadiness>, flags: FeatureFlag[] = []) =>
  useWorkspaceStore.setState({
    releaseReadinesses: [{ id: RELEASE_DOC_ID, releases: [], ...d }],
    featureFlags: flags,
    retroBoards: [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ReleaseReadinessClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const card = (name: string) => screen.getByRole("article", { name });
/** Click Undo on the toast whose label starts with `label`. */
const undo = (label: string) => {
  const call = toastSpy.mock.calls.find((c) => String(c[0]).startsWith(label));
  expect(call, `toast "${label}"`).toBeTruthy();
  act(() => (call![1] as { action: { onClick: () => void } }).action.onClick());
};

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = <T,>(verb: string, params: Record<string, unknown>) =>
  registry.get(`tool.release_readiness.${verb}`)!.handler(params, ctx()) as Promise<T>;

beforeEach(() => {
  toastSpy.mockReset();
  window.localStorage.removeItem(DOD_KEY);
  useWorkspaceStore.setState({ releaseReadinesses: [], featureFlags: [], retroBoards: [] });
});

/* ── Auto gates ─────────────────────────────────────────────────────── */

describe("the Feature flag ready check", () => {
  it("can't tell with no live flag linked, so the gate takes a manual tick", () => {
    expect(checkFlagsGate(release(), [], TODAY)).toMatchObject({
      passed: null,
      detail: "No flags linked",
      href: "/feature-flag-tracker",
    });
    expect(checkFlagsGate(release(), [flag({ releaseId: "other" })], TODAY).passed).toBeNull();
    expect(
      checkFlagsGate(release(), [flag({ status: "retired", retiredAt: on(-1) })], TODAY)
    ).toMatchObject({ passed: null, detail: "The one linked flag is retired" });
  });

  it("passes when each linked rollout or experiment flag has an owner and a removal date", () => {
    expect(checkFlagsGate(release(), [flag()], TODAY)).toMatchObject({
      passed: true,
      detail: "checkout_v2 is ready",
    });
    // A kill switch only has to be live.
    const kill = flag({
      id: "k",
      name: "kill",
      purpose: "kill_switch",
      owner: undefined,
      removeBy: undefined,
    });
    expect(checkFlagsGate(release(), [flag(), kill], TODAY)).toMatchObject({
      passed: true,
      detail: "All 2 linked flags are ready",
    });
  });

  it("fails naming the flags that aren't ready", () => {
    const noOwner = flag({ owner: undefined });
    const noDate = flag({ id: "e", name: "search_ab", purpose: "experiment", removeBy: undefined });
    const both = flag({ id: "b", name: "both", owner: " ", removeBy: undefined });
    const late = flag({ id: "l", name: "late", removeBy: on(-2), createdAt: on(-20) });
    const check = checkFlagsGate(release(), [noOwner, noDate, both, late], TODAY);
    expect(check.passed).toBe(false);
    expect(check.detail).toBe(
      "checkout_v2 has no owner; search_ab has no removal date; both has no owner and no removal date; late is past its removal date"
    );
  });
});

describe("the Definition of Done check", () => {
  it("can't tell without a DoD, or with no required criteria", () => {
    expect(checkDodGate(null).passed).toBeNull();
    expect(checkDodGate({ items: [] })).toMatchObject({
      passed: null,
      detail: "No Definition of Done yet",
    });
    expect(
      checkDodGate({ items: [{ label: "Docs", required: false, done: true }] }).passed
    ).toBeNull();
    expect(checkDodGate("garbage").passed).toBeNull();
  });

  it("passes when every required criterion is ticked, and names the ones that aren't", () => {
    expect(
      checkDodGate({
        items: [
          { label: "Reviewed", required: true, done: true },
          { label: "Docs", required: false },
        ],
      })
    ).toMatchObject({
      passed: true,
      detail: "The required criterion is ticked",
      href: "/dod-builder",
    });
    expect(
      checkDodGate({
        items: [
          { label: "Reviewed", required: true, done: true },
          { label: "Tests pass", required: true },
          { label: "Load test", required: true, done: false },
          { nope: 1 },
        ],
      })
    ).toMatchObject({ passed: false, detail: "Not ticked: Tests pass and Load test" });
  });
});

describe("a release's gates", () => {
  const withDod: ReleaseReadiness = {
    id: RELEASE_DOC_ID,
    releases: [],
    gates: [...BUILT_IN_GATES.map((g) => ({ ...g })), DOD_GATE],
  };

  it("lets a deciding check set an auto gate, and leaves it to the tick when the check can't tell", () => {
    const r = release({ gates: { feature_flag_ready: false, dod_met: true, a11y_audit: true } });
    const decided = gateResults(r, withDod, releaseChecks(r, [flag()], { items: [] }, TODAY));
    const ff = decided.find((g) => g.id === "feature_flag_ready")!;
    expect(ff).toMatchObject({ passed: true, locked: true });
    expect(ff.check?.detail).toBe("checkout_v2 is ready");
    // No DoD yet: the gate keeps its manual tick.
    expect(decided.find((g) => g.id === "dod_met")).toMatchObject({ passed: true, locked: false });
    expect(decided.find((g) => g.id === "a11y_audit")).toMatchObject({
      passed: true,
      locked: false,
      check: null,
    });
  });

  it("freezes the gates, with the auto results, when it ships", () => {
    const r = release({
      gates: { a11y_audit: true, feature_flag_ready: false },
      rolledBackAt: "x",
    });
    const checks = releaseChecks(r, [flag()], { items: [{ label: "A", required: true }] }, TODAY);
    const shipped = shipRelease(r, withDod, checks, on(-1));
    expect(shipped).toMatchObject({ status: "shipped", shippedDate: on(-1) });
    expect(shipped.rolledBackAt).toBeUndefined();
    expect(shipped.gateIds).toEqual([...RELEASE_GATE_IDS, "dod_met"]);
    expect(shipped.gates.feature_flag_ready).toBe(true);
    expect(shipped.gates.dod_met).toBe(false);
    expect(shipped.gatesOpenAtShip).toBe(8); // 7 built-ins still open, and the DoD
    expect(effectiveGates(r, [DOD_GATE], checks)).toMatchObject({
      a11y_audit: true,
      dod_met: false,
    });
    // Once shipped, the frozen gates read as they were, whatever the flags do later.
    const later = gateResults(shipped, withDod, releaseChecks(shipped, [], null, TODAY));
    expect(later.find((g) => g.id === "feature_flag_ready")).toMatchObject({
      passed: true,
      locked: true,
    });
  });

  it("keeps a reopened release's ship, rollback day and frozen gates", () => {
    const shipped = shipRelease(release(), undefined, {}, on(-4));
    const back = rollBackRelease(shipped, on(-3));
    const reopened = reopenRelease(back);
    expect(reopened.status).toBe("planning");
    expect(reopened.shippedDate).toBeUndefined();
    expect(reopened.gateIds).toBeUndefined();
    expect(reopened.previousShips).toEqual([
      {
        shippedDate: on(-4),
        rolledBackAt: on(-3),
        gateIds: [...RELEASE_GATE_IDS],
        gates: Object.fromEntries(RELEASE_GATE_IDS.map((id) => [id, false])),
        gatesOpenAtShip: 9,
      },
    ]);
    // Reopened again after a second ship: both kept, oldest first.
    const twice = reopenRelease(shipRelease(reopened, undefined, {}, on(-1)));
    expect(twice.previousShips?.map((s) => s.shippedDate)).toEqual([on(-4), on(-1)]);
    expect(twice.previousShips?.[1].rolledBackAt).toBeUndefined();
    // Planning again: it reads the team's gates, not the frozen ones.
    expect(gatesOf(twice, { gates: [{ id: "smoke", label: "Smoke" }] }).map((g) => g.id)).toEqual([
      "smoke",
    ]);
  });

  it("dates a legacy rollback that had no day by its ship day, so it still counts as rolled back", () => {
    const legacy = release({ status: "rolled_back", shippedDate: on(-9), plannedDate: on(-10) });
    const reopened = reopenRelease(legacy);
    expect(reopened.previousShips?.[0]).toMatchObject({
      shippedDate: on(-9),
      rolledBackAt: on(-9),
    });
    expect(releaseStats({ id: RELEASE_DOC_ID, releases: [reopened] }).rolledBack).toBe(1);
    // A release rolled back without ever shipping has nothing to keep.
    const never = reopenRelease(release({ status: "rolled_back" }));
    expect(never).toMatchObject({ status: "planning" });
    expect(never.previousShips).toBeUndefined();
  });

  it("checks ship and rollback days", () => {
    expect(shipDateError(TODAY, TODAY)).toBeNull();
    expect(shipDateError(on(-30), TODAY)).toBeNull();
    expect(shipDateError(on(1), TODAY)).toBe("It can't ship in the future.");
    expect(shipDateError("", TODAY)).toBe("Pick the day it shipped.");
    expect(shipDateError("2026-02-30", TODAY)).toBe("Use a date like 2026-10-24.");
    expect(rollbackDateError(on(-2), on(-3), TODAY)).toBeNull();
    expect(rollbackDateError(on(-4), on(-3), TODAY)).toBe(
      "It can't be rolled back before it shipped."
    );
    expect(rollbackDateError(on(1), on(-3), TODAY)).toBe("It can't be rolled back in the future.");
  });
});

describe("the team's gate list", () => {
  it("keeps a gate left out of a new list, archived, so shipped releases still name it", () => {
    const d: ReleaseReadiness = { id: RELEASE_DOC_ID, releases: [] };
    const next = withTeamGates(d, [{ id: "smoke", label: "Smoke test" }]);
    expect(teamGates(next).map((g) => g.id)).toEqual(["smoke"]);
    expect(storedGates(next).filter((g) => g.archived)).toHaveLength(9);
    const shipped = release({
      status: "shipped",
      shippedDate: on(-1),
      gateIds: ["a11y_audit", "smoke"],
    });
    expect(gatesOf(shipped, next).map((g) => g.label)).toEqual(["A11y audit", "Smoke test"]);
    expect(gateLabels(next).get("smoke")).toBe("Smoke test");
  });

  it("makes a new gate's id from its label, unique among the gates it knows", () => {
    expect(newGateId("Smoke test in staging!", [])).toBe("smoke_test_in_staging");
    expect(newGateId("Smoke test", ["smoke_test"])).toBe("smoke_test_2");
    expect(newGateId("SRE review", [])).toBe("sre_review_2");
    expect(newGateId("!!!", [])).toBe("gate");
  });

  it("asks for a gate name, and won't take one already on the list", () => {
    expect(validateGate({ label: " ", description: "" })).toEqual({
      ok: false,
      errors: { label: "Name the gate, e.g. Smoke test in staging." },
    });
    expect(validateGate({ label: "sre review", description: "" }, ["SRE review"]).ok).toBe(false);
    expect(validateGate({ label: "Smoke", description: " Runs " })).toEqual({
      ok: true,
      values: { label: "Smoke", description: "Runs" },
    });
  });
});

/* ── Form, verdict, analysis, export ────────────────────────────────── */

describe("the release form", () => {
  it("needs a name and a planned day instead of defaulting to today", () => {
    expect(validateRelease(EMPTY_RELEASE)).toEqual({
      ok: false,
      errors: {
        name: "Name the release, e.g. v3.4 Checkout redesign.",
        plannedDate: "Pick the day it is planned to ship.",
      },
    });
    expect(
      validateRelease({ ...EMPTY_RELEASE, name: "x".repeat(201), plannedDate: TODAY }).ok
    ).toBe(false);
  });

  it("takes a planned day in the past (a release logged late)", () => {
    expect(
      validateRelease({ name: " v3 \n hotfix ", plannedDate: on(-40), description: "" })
    ).toEqual({
      ok: true,
      values: { name: "v3 hotfix", plannedDate: on(-40) },
    });
  });

  it("leaves an unchanged release as it is, and clears an emptied description", () => {
    const r = release({ description: "Scope" });
    expect(applyRelease(r, { name: "v1", plannedDate: r.plannedDate, description: "Scope" })).toBe(
      r
    );
    const next = applyRelease(r, { name: "v1.1", plannedDate: r.plannedDate });
    expect(next).toMatchObject({ name: "v1.1", id: "r1" });
    expect(next.description).toBeUndefined();
  });
});

describe("the verdicts", () => {
  it("says whether a planned release is ready, and what's open", () => {
    const r = release({ name: "v3.4", plannedDate: on(3) });
    const results = gateResults(
      { ...r, gates: { ...allPassed, rollback_tested: false, sre_review: false } },
      undefined,
      {}
    );
    expect(releaseVerdict(r, results, TODAY)).toBe(
      "2 gates still open on v3.4, planned in 3 days: Rollback tested and SRE review."
    );
    const ready = gateResults({ ...r, gates: allPassed }, undefined, {});
    expect(releaseVerdict(r, ready, TODAY)).toBe("v3.4 is ready: all 9 gates pass.");
    expect(releaseVerdict({ ...r, plannedDate: on(-2) }, results, TODAY)).toContain(
      "planned 2 days ago"
    );
  });

  it("says how a release went out", () => {
    const r = release({
      status: "rolled_back",
      shippedDate: on(-3),
      plannedDate: on(-3),
      rolledBackAt: on(-2),
    });
    const results = gateResults({ ...r, gates: allPassed }, undefined, {});
    expect(releaseVerdict(r, results, TODAY)).toMatch(
      /^v1 shipped .+ \(on time\) with every gate passed, and was rolled back .+\.$/
    );
  });

  it("waits for enough ships before quoting a rate", () => {
    const one: ReleaseReadiness = {
      id: RELEASE_DOC_ID,
      releases: [
        release({ id: "a", status: "shipped", shippedDate: on(-1), plannedDate: on(-1) }),
        release({ id: "b", name: "v2" }),
      ],
    };
    const stats = releaseStats(one);
    const next = nextRelease(one.releases)!;
    expect(next.id).toBe("b");
    expect(
      overallVerdict({
        releases: one.releases,
        stats,
        labelOf: (id) => id,
        next: "v2 is ready: all 9 gates pass.",
      })
    ).toBe(
      "v2 is ready: all 9 gates pass. 1 ship so far: 2 more to see how often releases go out on time."
    );
    expect(overallVerdict({ releases: [], stats, labelOf: (id) => id })).toBe("No releases yet.");
  });

  it("quotes the on-time rate, rollbacks and the most-skipped gate over every ship", () => {
    const ex = buildExample(TODAY);
    const labels = gateLabels(ex.doc);
    expect(
      overallVerdict({
        releases: ex.doc.releases,
        stats: releaseStats(ex.doc),
        labelOf: (id) => labels.get(id) ?? id,
      })
    ).toBe("3 of 5 ships were on time; 2 were rolled back; Rollback tested is skipped most.");
  });
});

describe("the charts' data", () => {
  it("names each gate's skips, most skipped first", () => {
    const ex = buildExample(TODAY);
    const labels = gateLabels(ex.doc);
    const rows = skippedRows(releaseStats(ex.doc), (id) => labels.get(id) ?? id);
    expect(rows[0]).toEqual({
      gateId: "rollback_tested",
      label: "Rollback tested",
      skipped: 3,
      of: 5,
    });
    const text = skippedChartText(rows);
    expect(text.summary).toMatch(
      /^Rollback tested was open at 3 of 5 ships; \d+ other gates were skipped at least once\.$/
    );
    expect(text.table.columns).toEqual(["Gate", "Open at ship", "Ships it applied to"]);
  });

  it("keeps the p-chart and the trend behind their minimum samples", () => {
    const ships = (n: number): ReleaseReadiness => ({
      id: RELEASE_DOC_ID,
      releases: Array.from({ length: n }, (_, i) =>
        release({
          id: `r${i}`,
          status: "shipped",
          shippedDate: on(-n + i),
          plannedDate: on(-n + i),
          gates: allPassed,
          gatesOpenAtShip: i % 3,
        })
      ),
    });
    expect(passControl(passSeries(shipEvents(ships(7))))).toBeNull();
    expect(passControl(passSeries(shipEvents(ships(8))))).not.toBeNull();
    expect(passTrend(passSeries(shipEvents(ships(5))))).toBeNull();
    expect(passTrend(passSeries(shipEvents(ships(6))))).not.toBeNull();
    // At most the latest 20 ships.
    expect(passSeries(shipEvents(ships(25)))).toHaveLength(20);
  });
});

describe("the Markdown export", () => {
  it("has the verdict, every release with its open gates by name, and the gate list", () => {
    const ex = buildExample(TODAY);
    const rows = ex.doc.releases.map((r) => ({
      release: r,
      results: gateResults(r, ex.doc, releaseChecks(r, ex.flags, ex.dod, TODAY)),
    }));
    const stats = releaseStats(ex.doc);
    const labels = gateLabels(ex.doc);
    const md = toMarkdown({
      today: TODAY,
      verdict: "VERDICT",
      releases: rows,
      stats,
      skipped: skippedRows(stats, (id) => labels.get(id) ?? id),
      gates: teamGates(ex.doc),
    });
    expect(md).toContain("**VERDICT**");
    expect(md).toContain("- Went out: 5 (2 rolled back)");
    expect(md).toContain("- On time: 60% (3 of 5)");
    expect(md).toMatch(
      /\| v3\.4 Checkout redesign \| Planning \| .+ \| — \| — \| 9 \/ 11 \| Rollback tested, SRE review \|/
    );
    expect(md).toContain("## Earlier ships of reopened releases");
    expect(md).toContain("11. Definition of Done met — Every required criterion");
    expect(md).toContain("(checked from the Feature Flag Tracker)");
  });

  it("says so when there's nothing to export", () => {
    const md = toMarkdown({
      today: TODAY,
      verdict: "",
      releases: [],
      stats: releaseStats(undefined),
      skipped: [],
      gates: [],
    });
    expect(md).toMatch(/No releases yet\.\n$/);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("never calls the browser's confirm()", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/release-readiness");
    for (const name of readdirSync(dir)) {
      // Comments stripped, so a note about confirm() isn't a call.
      const code = readFileSync(path.join(dir, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      expect(code, name).not.toMatch(/(?<![\w.])(?:window\.)?confirm\s*\(/);
    }
  });

  it("adds nothing until the release has a name and a planned day", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add release" }));
    expect(screen.getByText("Name the release, e.g. v3.4 Checkout redesign.")).toBeInTheDocument();
    expect(screen.getByText("Pick the day it is planned to ship.")).toBeInTheDocument();
    expect(releases()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "v4.0 Search" } });
    fireEvent.change(screen.getByLabelText(/^Planned date/), { target: { value: on(-1) } });
    fireEvent.click(screen.getByRole("button", { name: "Add release" }));
    expect(releases()).toEqual([
      expect.objectContaining({
        name: "v4.0 Search",
        plannedDate: on(-1),
        status: "planning",
        gates: {},
      }),
    ]);
    expect(card("v4.0 Search")).toBeInTheDocument();
  });

  it("ships through a dated dialog listing the open gates, rejects a future day, and freezes the gates", () => {
    seed({ releases: [release({ gates: { a11y_audit: true } })] });
    renderPage();
    fireEvent.click(within(card("v1")).getByRole("button", { name: "Ship v1" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Still open")).toBeInTheDocument();
    expect(within(dialog).getByText("Rollback tested")).toBeInTheDocument();
    // Cancel has focus, so Enter alone doesn't ship.
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    const day = within(dialog).getByLabelText(/^Shipped on/);
    expect(day).toHaveValue(TODAY);

    fireEvent.change(day, { target: { value: on(1) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ship with 8 gates open" }));
    expect(within(dialog).getByText("It can't ship in the future.")).toBeInTheDocument();
    expect(releases()[0].status).toBe("planning");

    fireEvent.change(day, { target: { value: on(-2) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ship with 8 gates open" }));
    expect(releases()[0]).toMatchObject({
      status: "shipped",
      shippedDate: on(-2),
      gateIds: RELEASE_GATE_IDS,
      gatesOpenAtShip: 8,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Shipped: the gates read as frozen, and Undo puts it back in planning.
    expect(within(card("v1")).queryByRole("checkbox")).not.toBeInTheDocument();
    undo("Shipped “v1”");
    expect(releases()[0]).toMatchObject({ status: "planning" });
    expect(releases()[0].shippedDate).toBeUndefined();
  });

  it("checks Feature flag ready from the linked flags, and leaves it to a tick without them", () => {
    seed({ releases: [release()] }, [flag()]);
    const { unmount } = renderPage();
    const ff = within(card("v1")).getByRole("checkbox", { name: "Feature flag ready" });
    expect(ff).toBeChecked();
    expect(ff).toBeDisabled();
    expect(
      within(card("v1")).getByText(/Checked from the Feature Flag Tracker: checkout_v2 is ready/)
    ).toBeInTheDocument();
    expect(within(card("v1")).getByText(/Ships behind/)).toBeInTheDocument();
    unmount();

    seed({ releases: [release()] }, []);
    renderPage();
    const manual = within(card("v1")).getByRole("checkbox", { name: "Feature flag ready" });
    expect(manual).not.toBeChecked();
    expect(manual).toBeEnabled();
    fireEvent.click(manual);
    expect(releases()[0].gates.feature_flag_ready).toBe(true);
  });

  it("checks the DoD gate from the DoD Builder's checklist", () => {
    window.localStorage.setItem(
      DOD_KEY,
      JSON.stringify({
        items: [{ id: "a", label: "Reviewed", category: "code", required: true }],
        history: [],
      })
    );
    seed({ releases: [release()], gates: [DOD_GATE] });
    renderPage();
    const dod = within(card("v1")).getByRole("checkbox", { name: "Definition of Done met" });
    expect(dod).not.toBeChecked();
    expect(dod).toBeDisabled();
    expect(within(card("v1")).getByText(/Not ticked: Reviewed/)).toBeInTheDocument();
  });

  it("rolls back on a day, and a reopened release keeps its ship in the stats", () => {
    seed({
      releases: [
        release({
          id: "s",
          name: "v2",
          status: "shipped",
          plannedDate: on(-5),
          shippedDate: on(-6),
          gates: allPassed,
          gateIds: [...RELEASE_GATE_IDS],
          gatesOpenAtShip: 0,
        }),
      ],
    });
    renderPage();
    fireEvent.click(within(card("v2")).getByRole("button", { name: "Mark v2 rolled back" }));
    const dialog = screen.getByRole("dialog");
    const day = within(dialog).getByLabelText(/^Rolled back on/);
    fireEvent.change(day, { target: { value: on(-7) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark rolled back" }));
    expect(
      within(dialog).getByText("It can't be rolled back before it shipped.")
    ).toBeInTheDocument();
    fireEvent.change(day, { target: { value: on(-4) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark rolled back" }));
    expect(releases()[0]).toMatchObject({ status: "rolled_back", rolledBackAt: on(-4) });

    fireEvent.click(within(card("v2")).getByRole("button", { name: "Reopen v2 for planning" }));
    expect(releases()[0].status).toBe("planning");
    expect(releases()[0].previousShips).toEqual([
      expect.objectContaining({ shippedDate: on(-6), rolledBackAt: on(-4), gatesOpenAtShip: 0 }),
    ]);
    // Still one ship, on time, rolled back.
    expect(releaseStats(doc())).toMatchObject({ shipped: 1, onTime: 1, rolledBack: 1 });
    expect(screen.getByText("Went out").closest("div")?.parentElement).toHaveTextContent("1");
  });

  it("edits a release in place, keeping its id", () => {
    seed({ releases: [release()] });
    renderPage();
    fireEvent.click(within(card("v1")).getByRole("button", { name: "Edit v1" }));
    const name = within(screen.getByRole("group", { name: "Edit v1" })).getByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: "v1.1 Hotfix" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(releases()).toEqual([expect.objectContaining({ id: "r1", name: "v1.1 Hotfix" })]);
    expect(card("v1.1 Hotfix")).toBeInTheDocument();
  });

  it("deletes with Undo, back in its place with its id (a premortem link resolves again)", () => {
    seed({
      releases: [
        release({ id: "a", name: "A" }),
        release({ id: "b", name: "B" }),
        release({ id: "c", name: "C" }),
      ],
    });
    renderPage();
    fireEvent.click(within(card("B")).getByRole("button", { name: "Delete B" }));
    expect(releases().map((r) => r.id)).toEqual(["a", "c"]);
    undo("Deleted “B”");
    expect(releases().map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("adds a custom gate to releases being planned, and archiving it leaves shipped ones as they were", () => {
    seed({
      releases: [
        release({ id: "p", name: "Next" }),
        release({
          id: "s",
          name: "Old",
          status: "shipped",
          shippedDate: on(-3),
          plannedDate: on(-3),
          gates: {},
        }),
      ],
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/^New gate/), { target: { value: "Smoke test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add gate" }));
    expect(teamGates(doc()).map((g) => g.label)).toContain("Smoke test");
    expect(within(card("Next")).getByRole("checkbox", { name: "Smoke test" })).toBeInTheDocument();
    // The old ship read the built-ins (no frozen ids): it doesn't gain the new gate.
    expect(within(card("Old")).queryByText("Smoke test")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive Smoke test" }));
    expect(
      within(card("Next")).queryByRole("checkbox", { name: "Smoke test" })
    ).not.toBeInTheDocument();
    expect(storedGates(doc()).find((g) => g.id === "smoke_test")?.archived).toBe(true);
    undo("Archived “Smoke test”");
    expect(within(card("Next")).getByRole("checkbox", { name: "Smoke test" })).toBeInTheDocument();
  });

  it("offers the Definition of Done gate", () => {
    seed({ releases: [release()] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add the Definition of Done gate" }));
    expect(teamGates(doc()).map((g) => g.id)).toContain("dod_met");
    expect(
      screen.queryByRole("button", { name: "Add the Definition of Done gate" })
    ).not.toBeInTheDocument();
  });

  it("shows the example without writing it to the workspace, and clears it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(card("v3.4 Checkout redesign")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(ws().releaseReadinesses).toEqual([]);
    // Edits stay in the example too.
    fireEvent.click(
      within(card("v3.5 Loyalty points")).getByRole("button", {
        name: "Delete v3.5 Loyalty points",
      })
    );
    expect(ws().releaseReadinesses).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.queryByText(/Example data\./)).not.toBeInTheDocument();
    expect(screen.getByText(/No releases yet/)).toBeInTheDocument();
  });

  it("quotes % on time only from three ships", () => {
    seed({ releases: [release({ status: "shipped", shippedDate: on(-1), plannedDate: on(-1) })] });
    renderPage();
    expect(screen.getByText("shows after 3 ships (1 so far)")).toBeInTheDocument();
  });

  it("reads legacy data: a shipped release with no frozen gates, and boolean-only gate maps", () => {
    seed({
      releases: [
        release({
          id: "old",
          name: "Old",
          status: "shipped",
          shippedDate: on(-30),
          plannedDate: on(-31),
          gates: { ...allPassed, sre_review: false },
        }),
      ],
    });
    renderPage();
    expect(within(card("Old")).getByText(/8 \/ 9 gates/)).toBeInTheDocument();
    expect(within(card("Old")).getByText(/read against the built-in gates/)).toBeInTheDocument();
  });
});

/* ── The agent ──────────────────────────────────────────────────────── */

describe("tool.release_readiness, the same numbers as the page", () => {
  it("lists the example's stats as releaseStats computes them, with per-release gate results", async () => {
    const ex = buildExample(TODAY);
    useWorkspaceStore.setState({ releaseReadinesses: [ex.doc], featureFlags: ex.flags });
    window.localStorage.setItem(DOD_KEY, JSON.stringify(ex.dod));
    const state = await run<{
      stats: Omit<ReturnType<typeof releaseStats>, "skippedByGate"> & {
        ratesQuotable: boolean;
        skippedByGate: { gateId: string; label: string }[];
      };
      gates: { id: string }[];
      releases: { id: string; gatesPassed: number; gatesTotal: number; openGates: string[] }[];
    }>("list_state", {});
    const stats = releaseStats(ex.doc);
    expect(state.stats).toMatchObject({
      shipped: stats.shipped,
      onTime: stats.onTime,
      pct: stats.pct,
      rolledBack: stats.rolledBack,
      avgGatesOpen: stats.avgGatesOpen,
      ratesQuotable: true,
    });
    expect(state.stats.skippedByGate.map((g) => g.label)[0]).toBe("Rollback tested");
    expect(state.gates.map((g) => g.id)).toEqual(teamGates(ex.doc).map((g) => g.id));
    // The page's count for each release.
    for (const r of ex.doc.releases) {
      const results = gateResults(r, ex.doc, releaseChecks(r, ex.flags, ex.dod, TODAY));
      const row = state.releases.find((x) => x.id === r.id)!;
      expect(row.gatesPassed).toBe(results.filter((g) => g.passed).length);
      expect(row.gatesTotal).toBe(results.length);
    }
    expect(state.releases.find((x) => x.id === ex.doc.releases[1].id)?.openGates).toEqual([
      "Rollback tested",
      "SRE review",
    ]);
  });
});
