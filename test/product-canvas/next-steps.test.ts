/**
 * Product Canvas's next steps, through the registered lazy rule
 * (lib/tools/next-steps.ts → lib/product-canvas/next-steps): write the
 * Product Goal the canvases serve, and run the tests they sent. Example
 * canvases are left out, nothing is said with no canvas, and every step
 * links to a page that exists.
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
        canvases: [{ id: "x", format: "idea" } as unknown as ProductCanvas],
        goals: [],
        trackers: [],
      })
    ).toEqual([]);
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
