import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isExampleId } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type DoraSample,
  type Incident,
  type KanbanCard,
  type Release,
  type ReleaseReadiness,
  type Story,
} from "@/lib/stores/workspace-types";
import {
  currentQuarterIndex,
  dashQuarter,
  isDashQuarter,
  normalizeQuarter,
  quarterBounds,
  quarterIndex,
} from "@/lib/roadmap/quarters";
import { cardItems, storyItems, type FlowItem } from "@/lib/flow";

/**
 * DORA Scorecard: bands from one named report (the 2023 Accelerate State of
 * DevOps Report's clusters), a quarter picker in the stored "YYYY-Qn" form,
 * one sample per quarter with a duplicate leading to its editor, inline
 * validation without clamping, edit in place, delete and clear with Undo,
 * a sample derived from releases, the boards and incidents, statistics that
 * wait for enough quarters, an in-memory example, a verdict, a Markdown
 * export, and the agent reading the same latest quarter and bands.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
// Recharts has nothing to measure in jsdom; the charts' text is tested directly.
vi.mock("@/app/(tools)/dora-scorecard/charts", () => ({ MetricTrendChart: () => null }));

import "@/lib/actions/tools/dora-scorecard";
import { registry } from "@/lib/actions/registry";
import { DoraScorecardClient } from "@/app/(tools)/dora-scorecard/dora-scorecard-client";
import { buildExample } from "@/app/(tools)/dora-scorecard/example";
import { toMarkdown } from "@/app/(tools)/dora-scorecard/markdown";
import { analyseDora } from "@/app/(tools)/dora-scorecard/analysis";
import {
  metricTrendText,
  doraTrendText,
  type DoraTrendRow,
} from "@/app/(tools)/dora-scorecard/chart-text";
import {
  applyValues,
  draftFrom,
  draftWithDerivation,
  emptyDraft,
  newSample,
  validateDoraDraft,
  type DoraDraft,
} from "@/app/(tools)/dora-scorecard/form";
import { DORA_BANDS, bandRanges, bandsCitation, doraBand, formatMetric } from "@/lib/dora/bands";
import {
  DORA_DOC_ID,
  isExampleSample,
  latestSample,
  numberErrors,
  quarterError,
  sampleFor,
  scorecardSummary,
  sortSamples,
  usableSamples,
} from "@/lib/dora/samples";
import { deriveDoraSample, leadBasisText, provenanceText } from "@/lib/dora/derive";
import { doraVerdict } from "@/lib/dora/verdict";
import { todayIso } from "@/lib/sprints/series";

const NOW = new Date();
const TODAY = todayIso(NOW);
const THIS_Q = dashQuarter(currentQuarterIndex(NOW));
const LAST_Q = dashQuarter(currentQuarterIndex(NOW) - 1);
const NEXT_Q = dashQuarter(currentQuarterIndex(NOW) + 1);

const s = (id: string, quarter: string, extra: Partial<DoraSample> = {}): DoraSample => ({
  id,
  quarter,
  deployFreqPerWeek: 2,
  leadTimeHours: 48,
  changeFailRate: 0.08,
  mttrHours: 3,
  ...extra,
});

const seed = (...samples: DoraSample[]) =>
  useWorkspaceStore.setState({ doraScorecards: [{ id: DORA_DOC_ID, samples }] });
const stored = () =>
  (useWorkspaceStore.getState().doraScorecards ?? []).find((d) => d.id === DORA_DOC_ID)?.samples ??
  [];

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  useWorkspaceStore.setState({
    doraScorecards: [],
    releaseReadinesses: [],
    stories: [],
    kanbanBoards: [],
    incidentCommanders: [],
  });
});

/* ── Bands ──────────────────────────────────────────────────────────── */

describe("bands from the 2023 report", () => {
  it("names the report and year it comes from", () => {
    expect(DORA_BANDS.report).toBe("Accelerate State of DevOps Report");
    expect(DORA_BANDS.year).toBe(2023);
    expect(bandsCitation()).toBe("Accelerate State of DevOps Report 2023, DORA (Google Cloud)");
    expect(DORA_BANDS.clusters.Low.changeFailRate).toBe("64%");
  });

  it("bands each metric by the clusters, a boundary going to the better band", () => {
    expect(doraBand("deployFreqPerWeek", 7)).toBe("Elite");
    expect(doraBand("deployFreqPerWeek", 6.9)).toBe("High");
    expect(doraBand("deployFreqPerWeek", 1)).toBe("High");
    expect(doraBand("deployFreqPerWeek", 0.25)).toBe("Medium");
    expect(doraBand("deployFreqPerWeek", 0.2)).toBe("Low"); // rarer than monthly
    expect(doraBand("leadTimeHours", 24)).toBe("Elite");
    expect(doraBand("leadTimeHours", 25)).toBe("High");
    expect(doraBand("leadTimeHours", 24 * 30)).toBe("Medium");
    expect(doraBand("leadTimeHours", 24 * 31)).toBe("Low");
    // The old 15/30/45% bands matched no report: 12% was "Elite".
    expect(doraBand("changeFailRate", 0.05)).toBe("Elite");
    expect(doraBand("changeFailRate", 0.07)).toBe("High");
    expect(doraBand("changeFailRate", 0.12)).toBe("Medium");
    expect(doraBand("changeFailRate", 0.16)).toBe("Low");
    expect(doraBand("mttrHours", 1)).toBe("Elite");
    expect(doraBand("mttrHours", 24)).toBe("High");
    expect(doraBand("mttrHours", 24 * 7)).toBe("Medium");
    expect(doraBand("mttrHours", 24 * 8)).toBe("Low");
  });

  it("gives a missing or impossible value no band (the old code said Low)", () => {
    expect(doraBand("leadTimeHours", -1)).toBeNull();
    expect(doraBand("mttrHours", Number.NaN)).toBeNull();
    expect(doraBand("deployFreqPerWeek", null)).toBeNull();
    expect(doraBand("deployFreqPerWeek", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("writes each band's range for the legend and the guide", () => {
    expect(bandRanges("deployFreqPerWeek").map((r) => r.range)).toEqual([
      "7+ a week",
      "1+ a week",
      "monthly or more",
      "rarer than monthly",
    ]);
    expect(bandRanges("leadTimeHours").map((r) => r.range)).toEqual([
      "up to 1 day",
      "up to 1 week",
      "up to 30 days",
      "over 30 days",
    ]);
    expect(bandRanges("changeFailRate").map((r) => r.range)).toEqual([
      "up to 5%",
      "up to 10%",
      "up to 15%",
      "over 15%",
    ]);
    expect(formatMetric("leadTimeHours", 0.5)).toBe("30 min");
    expect(formatMetric("leadTimeHours", 36)).toBe("36 h");
    expect(formatMetric("leadTimeHours", 72)).toBe("3 days");
    expect(formatMetric("leadTimeHours", 24 * 21)).toBe("3 weeks");
    expect(formatMetric("changeFailRate", 0.0577)).toBe("5.8%");
    expect(formatMetric("deployFreqPerWeek", 1e9)).toBe("1000000000 a week");
  });
});

/* ── Quarters ───────────────────────────────────────────────────────── */

describe("quarters in the dash form", () => {
  it("reads the dash form alongside the roadmap's, additively", () => {
    expect(quarterIndex("2026-Q3")).toBe(quarterIndex("2026 Q3"));
    expect(normalizeQuarter("2026-Q3")).toBe("2026 Q3");
    expect(dashQuarter(quarterIndex("2026 Q4"))).toBe("2026-Q4");
    expect(isDashQuarter("2026-Q3")).toBe(true);
    for (const bad of ["2026 Q3", "Q1 2026", "2026-Q10", "2026-q3", "1800-Q1", "", null]) {
      expect(isDashQuarter(bad), String(bad)).toBe(false);
    }
  });

  it("knows a quarter's first and last day, leap years included", () => {
    expect(quarterBounds("2026-Q1")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterBounds("2028-Q1")).toEqual({ start: "2028-01-01", end: "2028-03-31" });
    expect(quarterBounds("2026-Q2")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterBounds("2026 Q4")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarterBounds("nope")).toBeNull();
  });
});

/* ── Samples and the form's checks ──────────────────────────────────── */

describe("samples", () => {
  it("orders by quarter, unreadable ones last, and reads the latest by quarter", () => {
    const list = [s("c", "2026-Q2"), s("x", "Q1 2026"), s("a", "2025-Q4"), s("b", "2026 Q1")];
    expect(sortSamples(list).map((x) => x.id)).toEqual(["a", "b", "c", "x"]);
    // The agent used to report the last added; the page the latest quarter.
    expect(latestSample(list)?.id).toBe("c");
    expect(latestSample([s("x", "Q1 2026")])).toBeNull();
  });

  it("reads old or odd stored lists without crashing", () => {
    expect(usableSamples(null)).toEqual([]);
    expect(usableSamples({ id: DORA_DOC_ID, samples: "x" as never })).toEqual([]);
    const doc = {
      id: DORA_DOC_ID,
      samples: [null, 3, s("a", "2026-Q1"), s("example-b", "2026-Q2")] as never,
    };
    expect(usableSamples(doc).map((x) => x.id)).toEqual(["a"]);
    expect(usableSamples(doc, { includeExamples: true })).toHaveLength(2);
    for (const id of ["example-1", "x", "Example-1", "example", ""]) {
      expect(isExampleSample({ id }), id).toBe(isExampleId(id));
    }
  });

  it("allows one sample per quarter, only once it has started", () => {
    const list = [s("a", "2026 Q1")];
    expect(sampleFor(list, "2026-Q1")?.id).toBe("a");
    expect(quarterError("2026-Q1", list, TODAY)).toBe("2026-Q1 already has a sample.");
    expect(quarterError("2026-Q1", list, TODAY, "a")).toBeNull();
    expect(quarterError(NEXT_Q, list, TODAY)).toBe(`${NEXT_Q} hasn't started yet.`);
    expect(quarterError("2026 Q2", list, TODAY)).toBe("Use a quarter like 2026-Q3.");
    expect(quarterError("", list, TODAY)).toBe("Pick a quarter.");
  });

  it("refuses a rate over 100% instead of clamping it", () => {
    expect(
      numberErrors({ deployFreqPerWeek: 1, leadTimeHours: 1, changeFailRate: 1.4, mttrHours: 1 })
    ).toEqual({
      changeFailRate: "Use a rate from 0% to 100%.",
    });
    expect(Object.keys(numberErrors({}))).toHaveLength(4);
  });
});

describe("the draft", () => {
  const filled = (patch: Partial<DoraDraft> = {}): DoraDraft => ({
    ...emptyDraft(LAST_Q),
    deployFreqPerWeek: "3",
    leadTimeHours: "40",
    changeFailRatePct: "12",
    mttrHours: "2",
    ...patch,
  });

  it("turns blanks into errors, never a silent 0", () => {
    const r = validateDoraDraft(emptyDraft(""), { samples: [], today: TODAY });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual([
      "changeFailRatePct",
      "deployFreqPerWeek",
      "leadTimeHours",
      "mttrHours",
      "quarter",
    ]);
  });

  it("stores the percentage as a rate, and rejects 140% rather than clamping", () => {
    const ok = validateDoraDraft(filled({ changeFailRatePct: "12%" }), {
      samples: [],
      today: TODAY,
    });
    expect(ok).toEqual({
      ok: true,
      values: {
        quarter: LAST_Q,
        deployFreqPerWeek: 3,
        leadTimeHours: 40,
        changeFailRate: 0.12,
        mttrHours: 2,
      },
    });
    const bad = validateDoraDraft(filled({ changeFailRatePct: "140" }), {
      samples: [],
      today: TODAY,
    });
    expect(!bad.ok && bad.errors.changeFailRatePct).toBe("Use a percentage from 0 to 100.");
    const neg = validateDoraDraft(filled({ mttrHours: "-1" }), { samples: [], today: TODAY });
    expect(!neg.ok && neg.errors.mttrHours).toMatch(/0 or more/);
  });

  it("refuses a logged quarter, except the sample's own", () => {
    const list = [s("a", LAST_Q)];
    const dup = validateDoraDraft(filled(), { samples: list, today: TODAY });
    expect(!dup.ok && dup.errors.quarter).toBe(`${LAST_Q} already has a sample.`);
    expect(validateDoraDraft(filled(), { samples: list, today: TODAY, editingId: "a" }).ok).toBe(
      true
    );
  });

  it("edits a stored sample: an old quarter form shows as the dash form, an unreadable one asks", () => {
    expect(draftFrom(s("a", "2026 Q3", { changeFailRate: 0.07 }))).toMatchObject({
      quarter: "2026-Q3",
      changeFailRatePct: "7",
      leadTimeHours: "48",
    });
    expect(draftFrom(s("a", "Q1 2026")).quarter).toBe("");
  });

  it("fills only what the data could give, keeping what was typed", () => {
    const d = draftWithDerivation(filled({ mttrHours: "9" }), {
      ...deriveDoraSample({ quarter: LAST_Q, items: [], today: TODAY })!,
      deployFreqPerWeek: 4.123,
      changeFailRate: 0.25,
    });
    expect(d).toMatchObject({
      deployFreqPerWeek: "4.12",
      changeFailRatePct: "25",
      leadTimeHours: "40",
      mttrHours: "9",
    });
  });

  it("saves derived only for the quarter it was derived for, and stamps edits", () => {
    const values = {
      quarter: LAST_Q,
      deployFreqPerWeek: 1,
      leadTimeHours: 2,
      changeFailRate: 0,
      mttrHours: 1,
    };
    const from = { releases: 3, rolledBack: 0, items: 5, incidents: 1 };
    expect(newSample(values, "n", { quarter: LAST_Q, derivedFrom: from })).toMatchObject({
      source: "derived",
      derivedFrom: from,
    });
    expect(newSample(values, "n", { quarter: THIS_Q, derivedFrom: from }).source).toBe("manual");
    const sample = newSample(values, "n");
    expect(applyValues(sample, values, "t")).toBe(sample);
    expect(applyValues(sample, { ...values, mttrHours: 2 }, "t")).toMatchObject({
      id: "n",
      mttrHours: 2,
      updatedAt: "t",
      source: "manual",
    });
  });
});

/* ── Deriving a quarter from the data ───────────────────────────────── */

describe("deriving a sample", () => {
  const release = (id: string, shippedDate: string, extra: Partial<Release> = {}): Release => ({
    id,
    name: id,
    plannedDate: shippedDate,
    status: "shipped",
    shippedDate,
    gates: {},
    ...extra,
  });
  const doc = (...releases: Release[]): ReleaseReadiness => ({
    id: "releaseReadiness:current",
    releases,
  });
  const story = (id: string, start: string, done: string): Story => ({
    id,
    title: id,
    status: "done",
    startedAt: `${start}T10:00:00`,
    doneAt: `${done}T16:00:00`,
  });
  const items = (...stories: Story[]): FlowItem[] => storyItems(stories);

  it("counts ships per week, a rolled-back ship as a failure, examples and other quarters out", () => {
    const d = deriveDoraSample({
      quarter: "2026-Q1",
      releases: doc(
        release("a", "2026-01-10"),
        release("b", "2026-02-10", { status: "rolled_back", rolledBackAt: "2026-02-11" }),
        // Reopened: its earlier ship in Q1 still counts.
        release("c", "2026-04-02", { previousShips: [{ shippedDate: "2026-03-01" }] }),
        release("example-d", "2026-03-03"),
        release("e", "2026-03-20", { status: "planning", shippedDate: undefined })
      ),
      items: [],
      today: TODAY,
    })!;
    expect(d.derivedFrom).toMatchObject({ releases: 3, rolledBack: 1 });
    expect(d.deployFreqPerWeek).toBeCloseTo(3 / (90 / 7), 2);
    expect(d.changeFailRate).toBeCloseTo(1 / 3, 4);
    expect(d.weeks).toBeCloseTo(90 / 7, 2);
    expect(d.inProgress).toBe(false);
  });

  it("leaves a metric empty, with the reason, when the data can't give it (never 0)", () => {
    const none = deriveDoraSample({ quarter: "2026-Q1", items: [], today: TODAY })!;
    expect(none.deployFreqPerWeek).toBeNull();
    expect(none.changeFailRate).toBeNull();
    expect(none.leadTimeHours).toBeNull();
    expect(none.mttrHours).toBeNull();
    expect(none.missing).toEqual({
      deployFreqPerWeek: "No releases are tracked yet.",
      changeFailRate: "No releases are tracked yet.",
      leadTimeHours: "No story or card with a start date was finished in 2026-Q1.",
      mttrHours: "No incident was resolved in 2026-Q1.",
    });
    const quiet = deriveDoraSample({
      quarter: "2026-Q1",
      releases: doc(release("a", "2025-12-01")),
      items: [],
      today: TODAY,
    })!;
    expect(quiet.missing.deployFreqPerWeek).toBe("No release went out in 2026-Q1.");
    expect(deriveDoraSample({ quarter: "2026 Q1", items: [], today: TODAY })).toBeNull();
    const future = deriveDoraSample({ quarter: NEXT_Q, items: [], today: TODAY })!;
    expect(future.missing.leadTimeHours).toBe(`${NEXT_Q} hasn't started yet.`);
  });

  it("measures lead time from the start of work to the release that shipped it", () => {
    const stories = [
      story("s1", "2026-01-05", "2026-01-08"), // first ship after: 01-10 → 6 days
      story("s2", "2026-01-06", "2026-01-09"), // listed by release b (02-10) → 36 days
      story("s3", "2026-02-01", "2026-02-02"), // first ship after: b, 02-10 → 10 days
      story("s4", "2026-03-25", "2026-03-28"), // nothing shipped since: left out
    ];
    const d = deriveDoraSample({
      quarter: "2026-Q1",
      releases: doc(release("a", "2026-01-10"), release("b", "2026-02-10", { storyIds: ["s2"] })),
      items: items(...stories),
      today: TODAY,
    })!;
    expect(d.lead).toEqual({ basis: "start-to-ship", measured: 3, linked: 1, notShipped: 1 });
    expect(d.leadTimeHours).toBe(10 * 24); // median of 6, 10 and 36 days
    expect(d.derivedFrom.items).toBe(3);
    expect(leadBasisText(d)).toContain("1 by the stories their release lists");
    expect(leadBasisText(d)).toContain("1 item not shipped yet left out");
  });

  it("trusts a release's story list: unshipped means not out yet, a stale one falls back", () => {
    const d = deriveDoraSample({
      quarter: "2026-Q1",
      releases: doc(
        release("a", "2026-01-03", { storyIds: ["s2"] }), // shipped before s2 was done: stale
        release("b", "2026-01-20"),
        release("c", "2026-03-30", { status: "planning", shippedDate: undefined, storyIds: ["s1"] })
      ),
      items: items(
        story("s1", "2026-01-05", "2026-01-08"),
        story("s2", "2026-01-06", "2026-01-09")
      ),
      today: TODAY,
    })!;
    // s1 waits in release c, though b went out after it was done; s2 falls back to b.
    expect(d.lead).toEqual({ basis: "start-to-ship", measured: 1, linked: 0, notShipped: 1 });
  });

  it("measures start to done when no releases are tracked, and needs three items", () => {
    const two = deriveDoraSample({
      quarter: "2026-Q1",
      items: items(
        story("s1", "2026-01-05", "2026-01-05"),
        story("s2", "2026-01-06", "2026-01-09")
      ),
      today: TODAY,
    })!;
    expect(two.leadTimeHours).toBeNull();
    expect(two.missing.leadTimeHours).toBe(
      "Only 2 items to measure in 2026-Q1; 1 more needed for a median."
    );
    const three = deriveDoraSample({
      quarter: "2026-Q1",
      items: items(
        story("s1", "2026-01-05", "2026-01-05"),
        story("s2", "2026-01-06", "2026-01-09"),
        story("s3", "2026-02-06", "2026-02-07")
      ),
      today: TODAY,
    })!;
    expect(three.lead.basis).toBe("start-to-done");
    expect(three.leadTimeHours).toBe(2 * 24); // 1, 2 and 4 days: a same-day story is 1 day
  });

  it("reads Flow-board cards too, and leaves example rows out", () => {
    const cards: KanbanCard[] = ["c1", "c2", "example-c3"].map((id) => ({
      id,
      title: id,
      column: "done",
      class: "standard",
      createdAt: "2026-01-02T09:00:00",
      startedAt: "2026-01-03T09:00:00",
      completedAt: "2026-01-04T09:00:00",
    }));
    const d = deriveDoraSample({
      quarter: "2026-Q1",
      items: [
        ...cardItems(cards),
        ...items(
          story("example-s", "2026-01-01", "2026-01-02"),
          story("s", "2026-01-01", "2026-01-02")
        ),
      ],
      today: TODAY,
    })!;
    expect(d.lead.measured).toBe(3);
  });

  it("takes time to restore from incidents resolved in the quarter", () => {
    const incidents: Incident[] = [
      {
        id: "i1",
        title: "a",
        severity: "sev1",
        status: "resolved",
        openedAt: "2026-02-01T10:00:00",
        resolvedAt: "2026-02-01T12:00:00",
        timeline: [],
      },
      {
        id: "i2",
        title: "b",
        severity: "sev2",
        status: "resolved",
        openedAt: "2026-03-01T10:00:00",
        resolvedAt: "2026-03-01T14:00:00",
        timeline: [],
      },
      {
        id: "i3",
        title: "c",
        severity: "sev2",
        status: "resolved",
        openedAt: "2026-05-01T10:00:00",
        resolvedAt: "2026-05-01T20:00:00",
        timeline: [],
      },
      {
        id: "i4",
        title: "d",
        severity: "sev2",
        status: "active",
        openedAt: "2026-03-02T10:00:00",
        timeline: [],
      },
      {
        id: "example-i5",
        title: "e",
        severity: "sev1",
        status: "resolved",
        openedAt: "2026-03-02T10:00:00",
        resolvedAt: "2026-03-09T10:00:00",
        timeline: [],
      },
    ];
    const d = deriveDoraSample({
      quarter: "2026-Q1",
      items: [],
      incidents: { id: "incidentCommander:current", incidents },
      today: TODAY,
    })!;
    expect(d.mttrHours).toBe(3);
    expect(d.derivedFrom.incidents).toBe(2);
    expect(provenanceText(d.derivedFrom)).toBe(
      "From 0 releases, 0 finished items and 2 incidents."
    );
  });

  it("measures the quarter in progress over the weeks so far", () => {
    const bounds = quarterBounds(THIS_Q)!;
    const d = deriveDoraSample({ quarter: THIS_Q, items: [], today: TODAY })!;
    expect(d.to).toBe(TODAY === bounds.end ? bounds.end : TODAY);
    expect(d.from).toBe(bounds.start);
  });
});

/* ── Verdict, export, charts and statistics ─────────────────────────── */

describe("verdict and export", () => {
  it("names the weakest metric of the latest quarter and its band", () => {
    expect(doraVerdict([])).toBe("No quarters logged yet.");
    expect(
      doraVerdict([
        s("old", "2025-Q4", { leadTimeHours: 2000 }),
        s("new", "2026-Q1", {
          deployFreqPerWeek: 10,
          leadTimeHours: 200,
          changeFailRate: 0.04,
          mttrHours: 0.5,
        }),
      ])
    ).toBe("2026-Q1: lead time is the weakest (Medium, 8.3 days); the other three are Elite.");
    expect(
      doraVerdict([
        s("a", "2026-Q1", {
          deployFreqPerWeek: 10,
          leadTimeHours: 2,
          changeFailRate: 0.01,
          mttrHours: 0.2,
        }),
      ])
    ).toBe("2026-Q1: all four metrics are Elite.");
    expect(doraVerdict([s("a", "2026-Q1", { changeFailRate: 0.2, mttrHours: 400 })])).toBe(
      "2026-Q1: change failure rate and time to restore are the weakest (Low); the other two are High or better."
    );
  });

  it("exports the verdict, the latest quarter, every quarter and the bands it cites", () => {
    const md = toMarkdown([
      s("a", "2026-Q1", {
        source: "derived",
        derivedFrom: { releases: 26, rolledBack: 2, items: 30, incidents: 1 },
      }),
      s("b", "2025-Q4", { description: "New | pipeline" }),
    ]);
    expect(md).toContain("**2026-Q1:");
    expect(md).toContain("Bands: Accelerate State of DevOps Report 2023, DORA (Google Cloud).");
    expect(md).toContain("| Lead time | 2 days | High |");
    expect(md).toContain("From 26 releases (2 rolled back), 30 finished items and 1 incident.");
    expect(md).toContain("New \\| pipeline");
    expect(md.indexOf("| 2026-Q1 |")).toBeLessThan(md.indexOf("| 2025-Q4 |"));
    expect(md).toContain("| Elite | 7+ a week | up to 1 day | up to 5% | up to 1 h |");
    expect(toMarkdown([])).toBe("# DORA Scorecard\n\nNo quarters logged yet.\n");
  });

  it("describes each metric's chart, with its band, and keeps the combined table", () => {
    const rows: DoraTrendRow[] = [
      {
        quarter: "2026-Q1",
        deployFreqPerWeek: 2,
        leadTimeHours: 48,
        changeFailRatePct: 15,
        mttrHours: 6,
      },
      {
        quarter: "2026-Q2",
        deployFreqPerWeek: 8,
        leadTimeHours: 20,
        changeFailRatePct: 8,
        mttrHours: 2,
      },
    ];
    const lead = metricTrendText("leadTimeHours", rows);
    expect(lead.summary).toBe(
      "From 2026-Q1 to 2026-Q2, lead time fell from 2 days to 20 h; 2026-Q2 is Elite."
    );
    expect(lead.table.rows).toEqual([
      ["2026-Q1", 48, "High"],
      ["2026-Q2", 20, "Elite"],
    ]);
    expect(metricTrendText("changeFailRate", rows).table.rows[1]).toEqual(["2026-Q2", 8, "High"]);
    expect(doraTrendText(rows).table.rows).toHaveLength(2);
  });

  it("runs the trend test from 6 quarters and control limits from 8, not before", () => {
    const rows = (n: number): DoraTrendRow[] =>
      Array.from({ length: n }, (_, i) => ({
        quarter: dashQuarter(quarterIndex("2024-Q1") + i),
        deployFreqPerWeek: 1 + i,
        leadTimeHours: 100 - i * 5,
        changeFailRatePct: 10,
        mttrHours: 5,
      }));
    expect(analyseDora(rows(5))).toMatchObject({ trends: null, control: null, shifts: null });
    const six = analyseDora(rows(6));
    // The shared test confirms a trend from 10 points only; below, it says which way it leans.
    expect(six.trends?.[0].text).toMatch(
      /^Deploy frequency: no confirmed trend \(p = .*\), leaning up; the test confirms a trend from 10 quarters\.$/
    );
    expect(six.trends?.[2].text).toMatch(
      /^Change failure rate: no confirmed trend \(p = 1\.000\)\.$/
    );
    expect(six.control).toBeNull();
    const eight = analyseDora(rows(8));
    expect(eight.control).toMatch(/^Deploy frequency's control limits run from/);
    expect(eight.shifts).toMatch(/CUSUM/);
    const ten = analyseDora(rows(10));
    expect(ten.trends?.[0].text).toMatch(/^Deploy frequency: rising .*the better direction\.$/);
    expect(ten.trends?.[1].text).toMatch(/^Lead time: falling .*the better direction\.$/);
  });
});

/* ── Page and agent agree ───────────────────────────────────────────── */

describe("page and agent parity", () => {
  it("list_state reads the same latest quarter, bands and verdict as the page", async () => {
    const list = [
      s("b", "2026-Q1", { leadTimeHours: 500 }),
      s("a", "2025-Q4"),
      s("example-x", "2026-Q2"),
    ];
    seed(...list);
    const r = (await registry.get("tool.dora_scorecard.list_state")!.handler(
      {},
      {
        userId: "u",
        source: "agent",
        squadProfileIds: [],
      }
    )) as { latest: DoraSample; bands: Record<string, string>; verdict: string };
    const page = usableSamples({ id: DORA_DOC_ID, samples: list });
    expect(r.latest.id).toBe(latestSample(page)!.id);
    expect(r.bands.leadTimeHours).toBe(doraBand("leadTimeHours", 500));
    expect(r.verdict).toBe(doraVerdict(page));
    expect(scorecardSummary({ id: DORA_DOC_ID, samples: list }).total).toBe(2);
  });

  it("derive_sample works the quarter out as the page's Fill from your data does", async () => {
    const stories: Story[] = ["s1", "s2", "s3"].map((id, i) => ({
      id,
      title: id,
      status: "done",
      startedAt: `2026-01-0${i + 1}T10:00:00`,
      doneAt: `2026-01-0${i + 3}T10:00:00`,
    }));
    useWorkspaceStore.setState({
      stories,
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          cards: [],
          wipLimits: { backlog: 1, ready: 1, in_progress: 1, review: 1, done: 1 },
        },
      ],
    });
    const r = (await registry
      .get("tool.dora_scorecard.derive_sample")!
      .handler({ quarter: "2026-Q1" }, { userId: "u", source: "agent", squadProfileIds: [] })) as {
      leadTimeHours: number;
    };
    const page = deriveDoraSample({
      quarter: "2026-Q1",
      items: storyItems(stories),
      today: TODAY,
    })!;
    expect(r.leadTimeHours).toBe(page.leadTimeHours);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <DoraScorecardClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () =>
  act(() => (lastToast()[1] as { action: { onClick: () => void } }).action.onClick());
const logForm = () => screen.getByRole("button", { name: "Save quarter" }).closest("form")!;
const fill = (form: HTMLElement, label: RegExp, value: string) =>
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });

describe("the page", () => {
  it("starts empty, with an example that stays in memory", () => {
    renderPage();
    expect(screen.getByText(/No quarters logged yet\. Log the last quarter/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem", { name: /^\d{4}-Q[1-4]$/ })).toHaveLength(6);
    expect(screen.getByText(/How they.re set/)).toHaveTextContent(
      "Bands: Accelerate State of DevOps Report 2023, DORA (Google Cloud)."
    );
    expect(stored()).toEqual([]);
    expect(buildExample(NOW).every((x) => isExampleId(x.id))).toBe(true);
    expect(buildExample(NOW).at(-1)?.quarter).toBe(LAST_Q);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.getByText(/Log the last quarter below/)).toBeInTheDocument();
  });

  it("logs a quarter only when valid, showing each error in place", () => {
    renderPage();
    const form = logForm();
    // The latest quarter without a sample is picked to start with.
    expect(within(form).getByLabelText(/^Quarter/)).toHaveValue(THIS_Q);
    fireEvent.click(within(form).getByRole("button", { name: "Save quarter" }));
    const deploys = within(form).getByLabelText(/^Deploys a week/);
    expect(deploys).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(deploys);
    expect(stored()).toEqual([]);

    fireEvent.change(within(form).getByLabelText(/^Quarter/), { target: { value: LAST_Q } });
    fill(form, /^Deploys a week/, "3");
    fill(form, /^Lead time/, "40");
    fill(form, /^Change failure rate/, "140");
    fill(form, /^Time to restore/, "2");
    fireEvent.submit(form);
    expect(within(form).getByText("Use a percentage from 0 to 100.")).toBeInTheDocument();
    expect(stored()).toEqual([]);

    fill(form, /^Change failure rate/, "12");
    fireEvent.submit(form);
    expect(stored()).toMatchObject([
      {
        quarter: LAST_Q,
        deployFreqPerWeek: 3,
        leadTimeHours: 40,
        changeFailRate: 0.12,
        mttrHours: 2,
        source: "manual",
      },
    ]);
    expect(logs.at(-1)?.action).toBe("sample_logged");
    expect(lastToast()[0]).toBe(`Logged ${LAST_Q}`);
    undoLast();
    expect(stored()).toEqual([]);
  });

  it("points a quarter already logged to its editor, and edits in place", () => {
    seed(s("a", LAST_Q), s("b", THIS_Q));
    renderPage();
    const form = logForm();
    fireEvent.change(within(form).getByLabelText(/^Quarter/), { target: { value: LAST_Q } });
    expect(within(form).getByText(`${LAST_Q} is logged already.`)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: `Edit ${LAST_Q}` }));
    const row = screen.getByRole("listitem", { name: LAST_Q });
    const editor = row.querySelector("form")!;
    fireEvent.change(within(editor).getByLabelText(/^Time to restore/), {
      target: { value: "0.5" },
    });
    fireEvent.submit(editor);
    expect(stored().find((x) => x.id === "a")).toMatchObject({ mttrHours: 0.5, quarter: LAST_Q });
    expect(stored().find((x) => x.id === "a")?.updatedAt).toBeTruthy();
    expect(logs.at(-1)?.action).toBe("sample_updated");
    // Focus goes back to the row's Edit button.
    expect(document.activeElement).toBe(
      within(screen.getByRole("listitem", { name: LAST_Q })).getByRole("button", {
        name: `Edit ${LAST_Q}`,
      })
    );
  });

  it("deletes with Undo, and clears every sample after a confirm, with Undo", () => {
    seed(s("a", LAST_Q), s("b", THIS_Q));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: `Delete ${LAST_Q}` }));
    expect(stored().map((x) => x.id)).toEqual(["b"]);
    expect(lastToast()[0]).toBe(`Deleted the ${LAST_Q} sample`);
    undoLast();
    expect(stored().map((x) => x.id)).toEqual(["a", "b"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear all samples" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear samples" })
    );
    expect(stored()).toEqual([]);
    expect(logs.some((l) => l.action === "dora_reset")).toBe(true);
    undoLast();
    expect(
      stored()
        .map((x) => x.id)
        .sort()
    ).toEqual(["a", "b"]);
  });

  it("fills a quarter from the data, saving it as derived with what it came from", () => {
    const q = quarterBounds(LAST_Q)!;
    const mid = (n: number) => {
      const d = new Date(`${q.start}T10:00:00`);
      d.setDate(d.getDate() + n);
      return todayIso(d);
    };
    useWorkspaceStore.setState({
      releaseReadinesses: [
        {
          id: "releaseReadiness:current",
          releases: [
            {
              id: "r1",
              name: "1",
              plannedDate: mid(20),
              status: "shipped",
              shippedDate: mid(20),
              gates: {},
            },
            {
              id: "r2",
              name: "2",
              plannedDate: mid(40),
              status: "rolled_back",
              shippedDate: mid(40),
              gates: {},
            },
          ],
        },
      ],
      stories: ["s1", "s2", "s3"].map((id, i) => ({
        id,
        title: id,
        status: "done" as const,
        startedAt: `${mid(i)}T10:00:00`,
        doneAt: `${mid(i + 5)}T10:00:00`,
      })),
    });
    renderPage();
    const form = logForm();
    fireEvent.change(within(form).getByLabelText(/^Quarter/), { target: { value: LAST_Q } });
    fireEvent.click(within(form).getByRole("button", { name: /Fill from your data/ }));
    expect(
      within(form).getByText("From 2 releases (1 rolled back), 3 finished items and 0 incidents.")
    ).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Change failure rate/)).toHaveValue("50");
    expect(within(form).getByText(`No incident was resolved in ${LAST_Q}.`)).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Time to restore/)).toHaveValue("");
    fill(form, /^Time to restore/, "1");
    fireEvent.submit(form);
    expect(stored()[0]).toMatchObject({
      quarter: LAST_Q,
      source: "derived",
      derivedFrom: { releases: 2, rolledBack: 1, items: 3, incidents: 0 },
      changeFailRate: 0.5,
      mttrHours: 1,
    });
    expect(logs.at(-1)?.action).toBe("sample_derived");
  });
});
