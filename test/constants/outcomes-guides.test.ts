// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_GUIDES } from "@/lib/tools/guides/core";
import { GUIDES as OUTCOMES } from "@/lib/tools/guides/outcomes";
import { GUIDES as QUALITY } from "@/lib/tools/guides/quality";
import type { ToolGuide } from "@/lib/tools/guides";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { CHECK_IN_STALE_DAYS } from "@/lib/okrs/progress";
import { INTEREST_CAP } from "@/lib/tech-debt/model";
import { FAILURE_SHARE_HIGH } from "@/lib/quality/cost";
import { PYRAMID_SHAPE_LABEL, SHAPE_TOLERANCE } from "@/lib/quality/pyramid";
import { FEW_RUNS, QUARANTINE_ALERT_DAYS } from "@/lib/quality/flaky";
import type { Okr } from "@/lib/stores/workspace-types";
import { ALL_QUARTERS, defaultQuarter } from "@/app/(tools)/okrs/view";

/*
 * The Outcomes, quality & library guides name the pages' labels and quote
 * the minimums behind them. These lock the lines against the pages' own
 * source and the libraries' constants, so a renamed button, a changed
 * threshold or a removed control fails here instead of leaving a guide
 * describing a page that isn't there.
 */

const ALL = [...CORE_GUIDES, ...OUTCOMES, ...QUALITY];

function guide(id: string): ToolGuide {
  const found = ALL.find((g) => g.toolId === id);
  if (!found) throw new Error(`No guide for ${id}`);
  return found;
}

const allText = (g: ToolGuide) => [g.summary, ...g.steps, ...(g.tips ?? [])].join("\n");
/** With the When to use lines: removed UI and dropped ideas stay out of those too. */
const fullText = (g: ToolGuide) => [allText(g), ...g.whenToUse].join("\n");

const source = (...files: string[]) =>
  files.map((f) => readFileSync(join(process.cwd(), f), "utf8")).join("\n");
const tool = (id: string, ...files: string[]) =>
  source(...files.map((f) => `src/app/(tools)/${id}/${f}`));

/** Shared controls the guides name: Re-sort, Load an example / Clear example. */
const SHARED = source(
  "src/components/shared/resort-chip.tsx",
  "src/components/tool-frame/example-data.tsx"
);

describe("the Outcomes, quality & library guides describe the pages as they are now", () => {
  it.each([
    ["okrs", /Set a baseline and a target for each|Score honestly/i],
    ["nps-csat", /average score out of 5|Score Trend chart/i],
    ["hypothesis-tracker", /New Hypothesis|We will do|Validation Rate and Median/],
    ["user-interviews", /Theme Frequency|Anonymize on export|Add Quote/],
    ["opportunity-tree", /Add Outcome|remove branches/],
    ["riskiest-assumption", /Generate test card|pair of 3s/i],
    ["risk-register", /avoid, reduce, transfer or accept/i],
    // Interest is score points a sprint now: the page shows no velocity cost.
    ["tech-debt", /New Debt|[Vv]elocity|Resolution survival curve/],
    ["quality-cost", /recalculate next period|Pick one period/i],
    ["test-pyramid", /Cost-of-quality figure|Inverted pyramid alert|% unit \(aim/i],
    ["flaky-tests", /Failure rate \(%\)|single failure rate|Top 10 flakiest/i],
    [
      "code-review-metrics",
      /Cycle median and Cycle P85|Weekly cycle-time mean|Parse & import|Log PR sample/,
    ],
  ])("%s drops the removed UI", (id, removed) => {
    expect(fullText(guide(id))).not.toMatch(removed);
  });

  it("the shared controls the guides name exist", () => {
    for (const label of ["Re-sort", "Load an example", "Clear example"]) {
      expect(SHARED, label).toContain(label);
    }
  });

  it("the old pages' conflict notices: the tips name the two buttons as they read", () => {
    for (const id of ["risk-register", "tech-debt"]) {
      const text = allText(guide(id));
      expect(text, id).toContain("Keep or Use this instead");
      expect(text, id).not.toContain("Keep it or");
      const notice = tool(id, "conflict-notice.tsx");
      expect(notice, id).toMatch(/>\s*Keep\s*</);
      expect(notice, id).toMatch(/>\s*Use this instead\s*</);
    }
  });

  it("OKRs: the list opens on this quarter only when it has objectives", () => {
    const now = new Date(2026, 9, 27, 12);
    const okr = (quarter: string): Okr => ({
      id: quarter,
      objective: "O",
      quarter,
      keyResults: [],
    });
    expect(defaultQuarter([okr("2026 Q4"), okr("2026 Q3")], now)).toBe("2026 Q4");
    expect(defaultQuarter([okr("2026 Q3")], now)).toBe(ALL_QUARTERS);
    expect(allText(guide("okrs"))).toContain(
      "the list opens on this quarter when it has objectives, otherwise on All."
    );
  });

  it("Hypothesis Tracker: names every tool that sends it a hypothesis", () => {
    // A send on the "hypothesis" route: sendHandoff("hypothesis", …) or a Send to menu's routes.
    const sends =
      /sendHandoff\(\s*"hypothesis"|ROUTES[^=\n]*=\s*\[[^\]]*"hypothesis"|routes=\{\[[^\]]*"hypothesis"/;
    const tools = join(process.cwd(), "src", "app", "(tools)");
    const senders = new Set<string>();
    for (const file of readdirSync(tools, { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(file)) continue;
      if (sends.test(readFileSync(join(tools, file), "utf8"))) senders.add(file.split(/[\\/]/)[0]);
    }
    const named: Record<string, string> = {
      "riskiest-assumption": "Riskiest Assumption",
      "opportunity-tree": "the Opportunity Tree",
      cynefin: "Cynefin",
      "design-sprint": "a Design Sprint",
    };
    expect(Array.from(senders).sort()).toEqual(Object.keys(named).sort());
    expect(allText(guide("hypothesis-tracker"))).toContain(
      `(${Object.values(named).slice(0, -1).join(", ")} or ${Object.values(named).at(-1)})`
    );
  });

  it.each([
    [
      "okrs",
      ["okrs-client.tsx", "objective-form.tsx", "objective-card.tsx"],
      ["key-result-form.tsx", "key-result-row.tsx", "check-in-form.tsx"],
      [
        "New objective",
        "Quarter",
        "Owner",
        "Add objective",
        "Add key result",
        "The number should",
        "Go up",
        "Go down",
        "Baseline",
        "Target",
        "Check in",
        "Save check-in",
        "Confidence",
        "Moves these sprint goals",
        "Progress over time",
        "Confidence over time",
        "No baseline",
      ],
    ],
    [
      "nps-csat",
      ["nps-csat-client.tsx", "response-form.tsx", "import-panel.tsx"],
      [],
      [
        "Add a response",
        "Survey",
        "Score",
        "Respondent",
        "Tags",
        "Verbatim",
        "Add response",
        "Import CSV",
        "CSAT satisfied",
        "Score trend",
        "Group by",
        "Themes",
        "Clear all",
      ],
    ],
    [
      "hypothesis-tracker",
      ["hypothesis-tracker-client.tsx", "hypothesis-form.tsx", "hypothesis-fields.tsx"],
      ["hypothesis-card.tsx", "view.ts"],
      [
        "New hypothesis",
        "We believe",
        "We will",
        "To learn",
        "Success looks like",
        "Add hypothesis",
        "Raised on",
        "Numeric target",
        "The number should",
        "Rise to at least",
        "Fall to at most",
        "Needs detail",
        "Add the detail",
        "Measured result",
        "Result on",
        "What we learned",
        "Show",
        "Validation rate",
      ],
    ],
    [
      "user-interviews",
      ["user-interviews-client.tsx", "new-interview-form.tsx", "interview-pane.tsx"],
      ["quote-card.tsx", "themes.tsx"],
      [
        "New interview",
        "Participant",
        "Interviewed on",
        "Context",
        "Add interview",
        "New quote",
        "Add quote",
        "Themes",
        "Open the interview",
        "Raise as an opportunity",
        "Put it under",
        "Add to the tree",
        "Anonymise",
      ],
    ],
    [
      "opportunity-tree",
      ["opportunity-tree-client.tsx", "node-card.tsx", "node-form.tsx"],
      ["view.ts"],
      ["Add outcome", "Add sub-opportunity", "Evidence", "Target", "Test as a hypothesis"],
    ],
    [
      "riskiest-assumption",
      ["riskiest-assumption-client.tsx", "assumption-form.tsx", "assumption-card.tsx"],
      [],
      [
        "Add an assumption",
        "Test idea",
        "Risk",
        "Evidence",
        "Not rated",
        "Add assumption",
        "Ranked",
        "Tested",
        "Test",
        "Status",
      ],
    ],
    [
      "risk-register",
      ["risk-register-client.tsx", "risk-form.tsx", "risk-row.tsx"],
      ["conflict-notice.tsx"],
      [
        "New risk",
        "Likelihood",
        "Impact",
        "Owner",
        "Raised on",
        "Mitigation plan",
        "Mitigation due",
        "After mitigation",
        "Add risk",
        "More about it",
        "Closed on",
        "High or critical",
        "No owner",
        "Exposure",
        "Median time to mitigate",
        "Raise as impediment",
        "Close the risk",
        "Keep",
        "Use this instead",
      ],
    ],
    [
      "tech-debt",
      ["tech-debt-client.tsx", "debt-form.tsx", "debt-row.tsx"],
      ["conflict-notice.tsx", "analysis.ts"],
      [
        "New debt",
        "Area",
        "Interest per sprint",
        "Raised on",
        "Add debt",
        "capped",
        "Add to backlog",
        "On the backlog",
        "Its backlog story is done",
        "Mark resolved",
        "Paid down on",
        "Reopen",
        "Interest a sprint",
        "Oldest open",
        "Top hotspot",
        "Impact × effort",
        "-day sprints",
        "Keep",
        "Use this instead",
      ],
    ],
    [
      "quality-cost",
      ["quality-cost-client.tsx", "period-form.tsx"],
      ["view.ts"],
      [
        "Log a quarter",
        "Blended hourly rate",
        "Quarter",
        "Prevention",
        "Detection",
        "Internal failure",
        "External failure",
        "Not entered",
        "Hours × rate",
        "Save quarter",
        "Quarter shown",
        "Failure share by quarter",
        "Clear history",
        "Figures from before quarters",
        "Save as a period",
        "Discard them",
        "External / internal",
      ],
    ],
    [
      "test-pyramid",
      ["test-pyramid-client.tsx", "forms.tsx"],
      [],
      [
        "Test counts",
        "Save counts",
        "Shape",
        "Run time per layer",
        "Save minutes",
        "Weigh the layers by",
        "Run time",
        "Relative run cost",
        "Snapshots",
        "Counts as of",
        "Take snapshot",
        "Compare today's counts with",
      ],
    ],
    [
      "flaky-tests",
      ["flaky-tests-client.tsx", "test-form.tsx", "test-card.tsx"],
      [],
      [
        "Log a flaky test",
        "Test name",
        "Failed runs",
        "Runs",
        "First seen",
        "Add test",
        "Failure rate (by runs)",
        "Last fixed",
        "Few runs",
        "Edit",
        "Sort by",
      ],
    ],
    [
      "code-review-metrics",
      ["code-review-metrics-client.tsx", "sample-form.tsx", "csv-import.tsx"],
      ["working-window.tsx"],
      [
        "Log a pull request",
        "Author",
        "Opened",
        "First review",
        "Merged",
        "Reviewers",
        "Review comments",
        "Lines changed",
        "Add PR",
        "Import from CSV",
        "Check rows",
        "Working hours",
        "Day starts",
        "Day ends",
        "Save working hours",
        "Count whole days instead",
        "Median time to first review",
        "Median cycle time",
        "P85 cycle time",
        "Review flow by PR size",
        "Logged pull requests",
      ],
    ],
  ])("%s names labels its page shows", (id, files, more, labels) => {
    const text = allText(guide(id));
    const page = tool(id, ...files, ...more);
    for (const label of labels) {
      expect(text, label).toContain(label);
      expect(page, label).toContain(label);
    }
  });
});

describe("the guides quote the libraries' thresholds", () => {
  it("OKRs: stale after 14 days, the charts from 3 days and the trend test from 6", () => {
    const text = allText(guide("okrs"));
    expect(CHECK_IN_STALE_DAYS).toBe(14);
    expect(text).toContain(`no check-in for ${CHECK_IN_STALE_DAYS} days`);
    expect(MIN_SAMPLE.average).toBe(3);
    expect(MIN_SAMPLE.trend).toBe(6);
    expect(text).toContain("three days with a check-in");
    expect(text).toContain("waits for six");
  });

  it("NPS / CSAT: a period reads without a warning from 10 answers", () => {
    const text = allText(guide("nps-csat"));
    expect(text).toContain(`at least ${MIN_SAMPLE.surveyPeriod} answers`);
    expect(text).toContain(`fewer than ${MIN_SAMPLE.surveyPeriod} answers`);
  });

  it("Tech Debt: the interest stops at the cap", () => {
    expect(allText(guide("tech-debt"))).toContain(`The interest part stops at ${INTEREST_CAP}`);
  });

  it("Cost of Quality: the failure-share flag", () => {
    expect(allText(guide("quality-cost"))).toContain(
      `above ${Math.round(FAILURE_SHARE_HIGH * 100)}% is flagged`
    );
  });

  it("Test Pyramid: every shape it names, and the level tolerance", () => {
    const text = allText(guide("test-pyramid"));
    for (const shape of ["pyramid", "ice-cream-cone", "hourglass", "diamond", "even"] as const) {
      expect(text, shape).toContain(PYRAMID_SHAPE_LABEL[shape]);
    }
    expect(text).toContain(`within ${Math.round(SHAPE_TOLERANCE * 100)} points`);
  });

  it("Flaky tests: the quarantine alert and the few-runs note", () => {
    const text = allText(guide("flaky-tests"));
    expect(text).toContain(`from ${QUARANTINE_ALERT_DAYS} days an alert`);
    expect(text).toContain(`under ${FEW_RUNS} runs`);
  });

  it("Code review: the medians from 3 PRs and P85 from 5", () => {
    const text = allText(guide("code-review-metrics"));
    expect(text).toContain(
      `from ${MIN_SAMPLE.average} PRs, P85 cycle time from ${MIN_SAMPLE.distribution}`
    );
  });
});
