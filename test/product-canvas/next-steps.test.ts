/**
 * Product Canvas's next steps, through the registered lazy rule
 * (lib/tools/next-steps.ts → lib/product-canvas/next-steps): write the
 * Product Goal the canvases serve, run the tests they sent, triage the
 * ideas waiting in the inbox, and decide on a bet whose cycle has ended.
 * Example canvases are left out, nothing is said with no canvas, and every
 * step links to a page that exists.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { getNextStepRule, loadNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import { productCanvasSteps } from "@/lib/product-canvas/next-steps";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import {
  emptyWorkspace,
  type Hypothesis,
  type ProductCanvas,
  type ProductCanvasItem,
  type ProductGoal,
  type Workspace,
} from "@/lib/stores/workspace-types";

const seen = new Set<string>();

beforeAll(async () => {
  await loadNextStepRule("product-canvas");
});

const steps = (ws: Partial<Workspace>): NextStep[] => {
  const rule = getNextStepRule("product-canvas");
  if (!rule) throw new Error("no rule for product-canvas");
  const out = rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
  for (const s of out) seen.add(s.href);
  return out;
};
const ids = (ws: Partial<Workspace>) => steps(ws).map((s) => s.id);

const STAMP = "2026-11-20T09:00:00.000Z";
const item = (
  id: string,
  text: string,
  over: Partial<ProductCanvasItem> = {}
): ProductCanvasItem => ({
  id,
  text,
  ...over,
});
const canvas = (id: string, sections: ProductCanvas["sections"] = {}): ProductCanvas => ({
  id,
  format: "vision-board",
  title: "Tapline",
  sections,
  createdAt: STAMP,
  updatedAt: STAMP,
});
const goal: ProductGoal = {
  id: "goal_1",
  statement: "Shop owners take every payment on their phone",
  measures: [],
  status: "active",
  createdAt: STAMP,
  updatedAt: STAMP,
};
const hypothesis = (id: string, status: Hypothesis["status"]): Hypothesis => ({
  id,
  believe: "x",
  willDo: "",
  toLearn: "",
  successMetric: "",
  status,
  raisedAt: "2026-11-20",
});
const sent = (targetId: string) => [{ route: "hypothesis" as const, targetId, at: STAMP }];
const tracker = (...hs: Hypothesis[]) => [{ id: HYPOTHESIS_TRACKER_ID, hypotheses: hs }];

describe("product-canvas next steps", () => {
  it("says nothing with no canvas, or only the example's", () => {
    expect(steps({})).toEqual([]);
    expect(steps({ productCanvases: [canvas("example-pc-vision")] })).toEqual([]);
  });

  it("asks for the Product Goal the canvases serve", () => {
    const out = steps({ productCanvases: [canvas("pcanvas_1"), canvas("pcanvas_2")] });
    expect(out.map((s) => s.id)).toEqual(["product-canvas-goal"]);
    expect(out[0]).toMatchObject({
      label: "Write the Product Goal these canvases serve",
      href: "/product-goal",
    });
    expect(out[0].detail).toMatch(/^2 canvases/);
    expect(ids({ productCanvases: [canvas("pcanvas_1")], productGoals: [goal] })).toEqual([]);
  });

  it("counts the lines still drafted or running in the Hypothesis Tracker", () => {
    const ws: Partial<Workspace> = {
      productGoals: [goal],
      productCanvases: [
        canvas("pcanvas_1", {
          who: [
            item("a", "Stall holders", { sentTo: sent("h1") }),
            item("b", "Cleaners", { sentTo: sent("h2") }),
            item("c", "Hairdressers", { sentTo: sent("h3") }),
          ],
        }),
        canvas("example-pc", { who: [item("d", "Example", { sentTo: sent("h4") })] }),
      ],
      hypothesisTrackers: tracker(
        hypothesis("h1", "drafted"),
        hypothesis("h2", "running"),
        hypothesis("h3", "validated"),
        hypothesis("h4", "running")
      ),
    };
    const out = steps(ws);
    expect(out.map((s) => s.id)).toEqual(["product-canvas-tests"]);
    expect(out[0]).toMatchObject({
      label: "Run the 2 tests your canvases sent",
      href: "/hypothesis-tracker",
    });
  });

  it("reads rows through the canvas model, so a bad row says nothing", () => {
    expect(
      productCanvasSteps({
        canvases: [{ id: "x", format: "lean-canvas" } as unknown as ProductCanvas],
        goals: [],
        trackers: [],
      })
    ).toEqual([]);
  });

  /* ── P2.3b: the idea inbox and the betting table ─────────────────── */

  const idea = (
    id: string,
    status: NonNullable<ProductCanvas["intake"]>["status"],
    createdAt: string
  ): ProductCanvas => ({
    id,
    format: "idea",
    title: `Idea ${id}`,
    sections: {},
    intake: { requesters: [], source: "customer", demand: 1, status },
    createdAt,
    updatedAt: createdAt,
  });
  const pitch = (id: string, bet: ProductCanvas["bet"]): ProductCanvas => ({
    id,
    format: "shape-up",
    title: `Pitch ${id}`,
    sections: {},
    ...(bet ? { bet } : {}),
    createdAt: STAMP,
    updatedAt: STAMP,
  });

  it("asks to triage new ideas that have waited more than 14 days, only new ones", () => {
    const today = "2026-11-23";
    const out = productCanvasSteps({
      canvases: [
        idea("pcanvas_old1", "new", "2026-11-01T09:00:00.000Z"),
        idea("pcanvas_old2", "new", "2026-11-08T09:00:00.000Z"),
        idea("pcanvas_fresh", "new", "2026-11-20T09:00:00.000Z"),
        idea("pcanvas_seen", "assessing", "2026-10-01T09:00:00.000Z"),
        idea("example-pc-idea", "new", "2026-10-01T09:00:00.000Z"),
      ],
      goals: [goal],
      trackers: [],
      today,
    });
    expect(out.map((s) => s.id)).toEqual(["product-canvas-inbox"]);
    expect(out[0]).toMatchObject({
      label: "Triage 2 waiting ideas",
      href: "/product-canvas?format=idea&inbox=new",
    });
    for (const s of out) seen.add(s.href);
    // Exactly 14 days is not yet over: the day before the cutoff is.
    expect(
      productCanvasSteps({
        canvases: [idea("pcanvas_edge", "new", "2026-11-09T09:00:00.000Z")],
        goals: [goal],
        trackers: [],
        today,
      })
    ).toEqual([]);
  });

  it("asks for a decision on a bet whose cycle has ended, naming the longest overdue", () => {
    const today = "2026-11-23";
    const out = productCanvasSteps({
      canvases: [
        pitch("pcanvas_late", { status: "bet", cycle: 4, start: "2026-10-01", weeks: 6 }),
        pitch("pcanvas_later", { status: "bet", cycle: 5, start: "2026-10-10", weeks: 2 }),
        pitch("pcanvas_running", { status: "bet", cycle: 6, start: "2026-11-16", weeks: 6 }),
        pitch("pcanvas_shipped", { status: "shipped", cycle: 3, start: "2026-08-01", weeks: 6 }),
        pitch("example-pc-pitch", { status: "bet", cycle: 4, start: "2026-09-01", weeks: 1 }),
      ],
      goals: [goal],
      trackers: [],
      today,
    });
    expect(out.map((s) => s.id)).toEqual(["product-canvas-cycle"]);
    // Cycle 5 ended on 10-23, cycle 4 on 11-11: the earlier end comes first.
    expect(out[0]).toMatchObject({
      label: "Decide on “Pitch pcanvas_later”: its cycle ended",
      href: "/product-canvas?canvas=pcanvas_later",
    });
    expect(out[0].detail).toMatch(/^Cycle 5 ended on 2026-10-23\./);
    expect(out[0].detail).toContain("1 other bet is out of time too.");
    for (const s of out) seen.add(s.href);
  });

  it("reads the day from the clock when the rule passes none", () => {
    const out = steps({
      productGoals: [goal],
      productCanvases: [
        pitch("pcanvas_late", { status: "bet", cycle: 1, start: "2020-01-06", weeks: 2 }),
      ],
    });
    expect(out.map((s) => s.id)).toEqual(["product-canvas-cycle"]);
  });

  // Runs last: `seen` holds every href the tests above produced.
  it("links to pages that exist", () => {
    expect(seen.size).toBeGreaterThan(1);
    const app = path.resolve(__dirname, "../../src/app");
    const roots = [
      app,
      ...readdirSync(app)
        .filter((d) => /^\(.+\)$/.test(d))
        .map((d) => path.join(app, d)),
    ];
    for (const href of Array.from(seen)) {
      const segment = href.split(/[?#]/)[0].replace(/^\//, "");
      expect(
        roots.some((root) => existsSync(path.join(root, segment, "page.tsx"))),
        href
      ).toBe(true);
    }
  });
});
