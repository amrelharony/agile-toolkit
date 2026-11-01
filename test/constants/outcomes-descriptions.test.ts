import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getToolById } from "@/lib/constants/tools";
import { resetToolSearchIndex, searchTools } from "@/lib/search/tool-search";

/*
 * The Outcomes, quality & library descriptions are the tools' one-liners
 * in the catalog, the palette's search and the pages' metadata, so they
 * say what the rebuilt pages do, and a word dropped from one can't lose
 * the tool its search match.
 */

const description = (id: string) => getToolById(id)?.description ?? "";

describe("Outcomes, quality & library tool descriptions", () => {
  beforeEach(() => resetToolSearchIndex());

  it("OKRs: baseline to target either way, dated check-ins, confidence and sprint goals", () => {
    const text = description("okrs");
    for (const words of ["baseline", "up or down", "dated check-ins", "confidence trend"]) {
      expect(text, words).toContain(words);
    }
    expect(text).toContain("sprint goals that move them");
    expect(text).not.toMatch(/trajectory forecast|3–5 Key Results/);
  });

  it("NPS / CSAT: import, periods with their n, CSAT as % satisfied, tags", () => {
    const text = description("nps-csat");
    for (const words of ["Import", "per week or month", "% satisfied", "theme tags"]) {
      expect(text, words).toContain(words);
    }
    expect(text).toContain("number of responses behind each");
  });

  it("the discovery tools: verdicts, participants, targets and linked hypotheses", () => {
    const hypotheses = description("hypothesis-tracker");
    expect(hypotheses).toContain("numeric target");
    expect(hypotheses).toContain("suggests a verdict you apply");
    expect(hypotheses).toContain("validation rate counts only decisive results");

    const interviews = description("user-interviews");
    expect(interviews).toContain("counted by the participants who raised it");
    expect(interviews).toContain("raised as an opportunity");
    expect(interviews).not.toMatch(/tag-frequency/);

    const tree = description("opportunity-tree");
    expect(tree).toContain("nested");
    expect(tree).toContain("one target opportunity per outcome");
    expect(tree).toContain("tested as hypotheses");

    const assumptions = description("riskiest-assumption");
    expect(assumptions).toContain("unrated until you do");
    expect(assumptions).toContain("Test the riskiest as a linked hypothesis");
    expect(assumptions).not.toMatch(/test cards/);
  });

  it("Risk Register and Tech Debt: what each row now carries", () => {
    const risks = description("risk-register");
    for (const words of ["owner", "overdue", "residual risk", "raised as an impediment"]) {
      expect(risks, words).toContain(words);
    }
    expect(risks).not.toMatch(/burn-down/);

    const debt = description("tech-debt");
    for (const words of ["capped interest", "age in sprints", "Add to backlog", "heatmap"]) {
      expect(debt, words).toContain(words);
    }
  });

  it("the quality tools: quarters, shapes, runs and working hours", () => {
    const coq = description("quality-cost");
    expect(coq).toContain("quarter by quarter");
    expect(coq).toContain("failure share");
    expect(coq).toContain("hours × rate");
    expect(coq).not.toMatch(/teaching tool/);

    const pyramid = description("test-pyramid");
    for (const shape of ["pyramid", "ice-cream cone", "hourglass", "diamond"]) {
      expect(pyramid, shape).toContain(shape);
    }
    expect(pyramid).toContain("run time");
    expect(pyramid).toContain("snapshots");
    expect(pyramid).not.toMatch(/cost-of-quality|inverted/);

    const flaky = description("flaky-tests");
    expect(flaky).toContain("failed runs out of runs");
    expect(flaky).toContain("weighted by runs");
    expect(flaky).toContain("long quarantines");

    const review = description("code-review-metrics");
    expect(review).toContain("Time to first review");
    expect(review).toContain("working hours");
    expect(review).toContain("by PR size");
    expect(review).toContain("no author ranking");
  });

  it("Agile at Work no longer promises a PDF to download", () => {
    // The comics are protected web-sized images; there is no download.
    expect(description("comics")).not.toMatch(/download|pdf/i);
  });

  it("keeps a smart default only where a page still offers it", () => {
    // The OKR page dropped the KR-target chip; the register suggests a due
    // day from its own median time to close.
    expect(getToolById("okrs")?.predictedDefaults).toBeUndefined();
    expect(getToolById("risk-register")?.predictedDefaults).toBeUndefined();
    expect(getToolById("tech-debt")?.predictedDefaults?.map((p) => p.field)).toEqual([
      "interestRate",
    ]);
    const row = readFileSync(
      join(process.cwd(), "src", "app", "(tools)", "tech-debt", "debt-row.tsx"),
      "utf8"
    );
    expect(row).toContain('usePredictedDefault<number>("tech-debt", "interestRate"');
  });

  it("lists the statistics the pages run", () => {
    expect(getToolById("okrs")?.analyticsFeatures).toEqual(["trend"]);
    expect(getToolById("flaky-tests")?.analyticsFeatures).not.toContain("survival");
    expect(getToolById("quality-cost")?.analyticsFeatures).toEqual(["trend"]);
  });

  it.each([
    ["key results", "okrs"],
    ["net promoter", "nps-csat"],
    ["validation rate", "hypothesis-tracker"],
    ["interview quotes", "user-interviews"],
    ["teresa torres", "opportunity-tree"],
    ["riskiest assumption", "riskiest-assumption"],
    ["mitigation", "risk-register"],
    ["technical debt", "tech-debt"],
    ["cost of quality", "quality-cost"],
    ["ice-cream cone", "test-pyramid"],
    ["quarantine", "flaky-tests"],
    ["first review", "code-review-metrics"],
  ])("%j still finds %s", (query, id) => {
    expect(searchTools(query, 3).map((t) => t.id)).toContain(id);
  });
});

describe("Outcomes, quality & library page metadata", () => {
  // These pages kept their own copy of a description while the catalog's
  // was stale; the catalog's is the one kept up to date, so they read it.
  it.each([
    "okrs",
    "nps-csat",
    "hypothesis-tracker",
    "user-interviews",
    "opportunity-tree",
    "riskiest-assumption",
    "risk-register",
    "tech-debt",
    "quality-cost",
    "test-pyramid",
    "flaky-tests",
    "code-review-metrics",
  ])("%s takes its title and description from the catalog", (id) => {
    const src = readFileSync(join(process.cwd(), "src", "app", "(tools)", id, "page.tsx"), "utf8");
    expect(src).toContain(`toolMetadata("${id}");`);
    expect(src).not.toMatch(/description:/);
  });
});
