import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/tools/guides/team";
import type { ToolGuide } from "@/lib/tools/guides";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { RECENT_DAYS } from "@/lib/kudos/recognition";
import { PROFICIENCY_STEPS } from "@/lib/skills/coverage";
import { RACI_LOAD } from "@/lib/raci/model";
import { BARRIER_MAX, ELEMENT_LABEL } from "@/lib/adkar/model";
import { TREND_MIN_ROUNDS } from "@/lib/working-agreement/model";
import { MATURITY_LEVEL_LABELS } from "@/lib/constants/maturity-model";
import { STATUS_LABELS } from "@/app/(tools)/one-on-one/model";
import { DUE_SOON_DAYS, HIGH, QUADRANT_LABEL } from "@/app/(tools)/stakeholder-map/model";
import { BUILT_IN_TEMPLATES } from "@/app/(tools)/onboarding-tracker/model";
import { CHART_MIN_SPRINTS } from "@/app/(tools)/dod-builder/adherence";
import { TREND_MIN_ASSESSMENTS } from "@/app/(tools)/maturity/chart-text";

/*
 * The Team & people guides name on-screen labels and the minimums behind
 * them. These lock the lines against the code's own constants, so a
 * renamed status or a changed minimum fails here instead of leaving the
 * guide wrong.
 */

function guide(id: string): ToolGuide {
  const found = GUIDES.find((g) => g.toolId === id);
  if (!found) throw new Error(`No Team guide for ${id}`);
  return found;
}

const allText = (g: ToolGuide) => [g.summary, ...g.steps, ...(g.tips ?? [])].join("\n");
const scaleValues = (g: ToolGuide, name: string) =>
  g.scales?.find((s) => s.name === name)?.values.map((v) => v.value) ?? [];

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];

describe("Team guides match their pages", () => {
  it("Kudos: the windows and the hints' minimum", () => {
    const text = allText(guide("kudos"));
    expect(text).toContain(`Last ${RECENT_DAYS} days`);
    expect(text).toContain(`From ${MIN_SAMPLE.distribution} kudos`);
  });

  it("1:1s: one line per agenda status, and the usual gap from MIN_SAMPLE.average gaps", () => {
    const g = guide("one-on-one");
    expect(scaleValues(g, "Agenda status")).toEqual(Object.values(STATUS_LABELS));
    // N gaps need N + 1 meetings.
    expect(allText(g)).toContain(`${WORDS[MIN_SAMPLE.average + 1]} 1:1s`);
    expect(allText(g)).not.toMatch(/growth themes/i);
  });

  it("1:1s: only the Markdown export carries the cadence; the CSV is one row per agenda item", () => {
    const text = allText(guide("one-on-one"));
    expect(text).not.toMatch(/Markdown or CSV/);
    expect(text).toContain(
      "the cadence and the 1:1s as Markdown, or each 1:1's agenda and actions as CSV"
    );
  });

  it("Onboarding: the built-ins and the KPIs' minimum", () => {
    const text = allText(guide("onboarding-tracker"));
    expect(text).toContain(`the ${WORDS[BUILT_IN_TEMPLATES.length]} defaults`);
    expect(text).toContain(`once ${MIN_SAMPLE.average} people`);
  });

  it("Stakeholder Map: the quadrants, what counts as high, and when a touch is due", () => {
    const g = guide("stakeholder-map");
    expect(scaleValues(g, `Quadrants (${HIGH} or more counts as high)`).sort()).toEqual(
      Object.values(QUADRANT_LABEL).sort()
    );
    expect(allText(g)).toContain(`due within ${DUE_SOON_DAYS} days`);
  });

  it("Working Agreement: the chart and the trend test minimums", () => {
    const text = allText(guide("working-agreement"));
    expect(text).toContain(`from ${WORDS[TREND_MIN_ROUNDS]}`);
    expect(text).toContain(`trend test from ${WORDS[MIN_SAMPLE.trend]}`);
  });

  it("Definition of Done: the chart, trend and control-limit minimums; no snapshots", () => {
    const text = allText(guide("dod-builder"));
    expect(text).toContain(`from ${CHART_MIN_SPRINTS} sprints`);
    expect(text).toContain(`trend test from ${MIN_SAMPLE.trend} sprints`);
    expect(text).toContain(`control limits from ${MIN_SAMPLE.changePoint}`);
    expect(text).not.toMatch(/Snapshot this sprint/);
  });

  it("RACI: the load checks quote RACI_LOAD", () => {
    const text = allText(guide("raci"));
    expect(RACI_LOAD.maxAccountableShare).toBe(0.5);
    expect(text).toContain(
      `more than half of ${RACI_LOAD.minActivitiesForShare} or more activities, or more than ${RACI_LOAD.maxConsulted} roles consulted`
    );
  });

  it("Skills Matrix: the levels are the page's, and a single point of failure starts at Intermediate", () => {
    const g = guide("skills-matrix");
    expect(scaleValues(g, "Proficiency")).toEqual(PROFICIENCY_STEPS.map((s) => s.name));
    expect(allText(g)).toContain("at Intermediate or above");
    expect(allText(g)).not.toMatch(/bus factor/i);
  });

  it("Skills Matrix: the add-listed-skills button reads Add it for one skill", () => {
    // skills-matrix-client: "Add it" for one missing skill, "Add all N" for more.
    expect(allText(guide("skills-matrix"))).toContain("offered with Add all (Add it for one)");
  });

  it("Maturity: the levels are the model's, and the trend starts at TREND_MIN_ASSESSMENTS", () => {
    const g = guide("maturity");
    expect(scaleValues(g, "Maturity level")).toEqual(
      Object.entries(MATURITY_LEVEL_LABELS).map(([level, label]) => `${level} ${label}`)
    );
    expect(allText(g)).toContain(`From ${WORDS[TREND_MIN_ASSESSMENTS]} assessments`);
  });

  it("ADKAR: the stages and the barrier threshold", () => {
    const g = guide("adkar");
    expect(scaleValues(g, "ADKAR stages")).toEqual(Object.values(ELEMENT_LABEL));
    expect(allText(g)).toContain(`scored ${BARRIER_MAX} or lower`);
  });
});
