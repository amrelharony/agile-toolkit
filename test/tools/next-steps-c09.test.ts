/**
 * Next steps for the Persona Library (tools plan, phase 2, chain C09),
 * through the lazy rule the page loads: use a persona on an Impact Map
 * while no actor names one, check a guess against the interviews once 3 or
 * more are logged, and mark a main persona among two or more. The
 * example's personas, maps and interviews never count. The Epic Roadmap's
 * "Now holds N epics" step is the lead's, at landing.
 */

import { describe, expect, it } from "vitest";
import { getNextStepRule, loadNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type Interview,
  type Persona,
  type StrategyMap,
  type Workspace,
} from "@/lib/stores/workspace-types";

const AT = "2026-11-20T10:00:00.000Z";

const steps = async (ws: Partial<Workspace>): Promise<NextStep[]> => {
  await loadNextStepRule("persona-library");
  const rule = getNextStepRule("persona-library");
  if (!rule) throw new Error("no rule for persona-library");
  return rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
};

const persona = (id: string, over: Partial<Persona> = {}): Persona => ({
  id,
  name: id === "persona_a" ? "Maya" : "Tom",
  role: "Someone",
  tier: "primary",
  evidence: "some",
  goals: [],
  pains: [],
  behaviours: [],
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const map = (id: string, personaId?: string): StrategyMap => ({
  id,
  format: "impact-map",
  title: "Fewer refund calls",
  nodes: [
    { id: "g", parentId: null, level: 0, text: "Fewer refund calls" },
    { id: "a", parentId: "g", level: 1, text: "Shop owners", ...(personaId ? { personaId } : {}) },
  ],
  createdAt: AT,
  updatedAt: AT,
});

const interviews = (n: number, prefix = "i"): Interview[] =>
  Array.from({ length: n }, (_, k) => ({
    id: `${prefix}${k}`,
    date: AT,
    participant: `P${k}`,
    quotes: [],
  }));

describe("persona-library", () => {
  it("asks to use the main persona on an Impact Map while no actor names one", async () => {
    const out = await steps({
      personas: [persona("persona_b", { tier: "secondary" }), persona("persona_a")],
      strategyMaps: [map("m1")],
    });
    expect(out).toEqual([
      expect.objectContaining({
        id: "persona-use-on-map",
        label: "Use “Maya” on an Impact Map",
        href: "/impact-map",
      }),
    ]);
  });

  it("is quiet about maps once one actor names a persona", async () => {
    const out = await steps({
      personas: [persona("persona_a"), persona("persona_b", { tier: "secondary" })],
      strategyMaps: [map("m1", "persona_b")],
    });
    expect(out).toEqual([]);
  });

  it("asks to check a guess against the interviews once 3 are logged", async () => {
    const base = {
      personas: [persona("persona_a", { evidence: "assumed" })],
      strategyMaps: [map("m1", "persona_a")],
    };
    expect(
      await steps({
        ...base,
        userInterviewLogs: [{ id: "userInterviewLog:current", interviews: interviews(2) }],
      })
    ).toEqual([]);
    const out = await steps({
      ...base,
      userInterviewLogs: [{ id: "userInterviewLog:current", interviews: interviews(3) }],
    });
    expect(out).toEqual([
      expect.objectContaining({
        id: "persona-check-guess",
        label: "Check “Maya” against your interviews",
        href: "/persona-library?persona=persona_a",
      }),
    ]);
    // The example's interviews don't count.
    expect(
      await steps({
        ...base,
        userInterviewLogs: [
          { id: "userInterviewLog:current", interviews: interviews(5, "example-i") },
        ],
      })
    ).toEqual([]);
  });

  it("asks to mark a main persona among two or more", async () => {
    const out = await steps({
      personas: [
        persona("persona_a", { tier: "secondary" }),
        persona("persona_b", { tier: "anti" }),
      ],
      strategyMaps: [map("m1", "persona_a")],
    });
    expect(out.map((s) => s.id)).toEqual(["persona-mark-main"]);
    expect(out[0]).toMatchObject({ label: "Mark your main persona", href: "/persona-library" });
  });

  it("leaves the example's personas and maps out", async () => {
    expect(
      await steps({
        personas: [persona("example-persona-maya"), persona("example-persona-tom")],
        strategyMaps: [map("example-map", "example-persona-maya")],
      })
    ).toEqual([]);
    expect(await steps({})).toEqual([]);
  });
});
