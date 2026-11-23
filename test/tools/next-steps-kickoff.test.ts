/**
 * Kickoff's next steps, through the registered lazy rule
 * (lib/tools/next-steps.ts → lib/kickoff/next-step): ask the team to consent
 * to the rules a kickoff sent, turn an agreed product kickoff into a Product
 * Goal, and plan the first sprint. Example kickoffs and example members
 * never count, nothing is said with no kickoff, and every step links to a
 * page that exists.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { getNextStepRule, loadNextStepRule, type NextStep } from "@/lib/tools/next-steps";
import { kickoffNextSteps } from "@/lib/kickoff/next-step";
import { WA_ID } from "@/lib/working-agreement/model";
import {
  emptyWorkspace,
  type CharterRule,
  type Kickoff,
  type ProductGoal,
  type Sprint,
  type Workspace,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

const seen = new Set<string>();

beforeAll(async () => {
  await loadNextStepRule("kickoff");
});

const steps = (ws: Partial<Workspace>): NextStep[] => {
  const rule = getNextStepRule("kickoff");
  if (!rule) throw new Error("no rule for kickoff");
  const out = rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
  for (const s of out) seen.add(s.href);
  return out;
};
const ids = (ws: Partial<Workspace>) => steps(ws).map((s) => s.id);

const AT = "2026-11-20T09:00:00.000Z";
const kickoff = (over: Partial<Kickoff> & Pick<Kickoff, "id" | "format">): Kickoff => ({
  title: "Payments liftoff",
  sections: {},
  status: "draft",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const rule = (id: string, over: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "other",
  text: `Rule ${id}`,
  agreedBy: [],
  consent: [],
  ...over,
});
const agreement = (rules: CharterRule[]): WorkingAgreement =>
  ({ id: WA_ID, rules, meta: {} }) as unknown as WorkingAgreement;
const goal: ProductGoal = {
  id: "goal_1",
  statement: "Pay anywhere",
  measures: [],
  status: "active",
  createdAt: AT,
  updatedAt: AT,
};
const sprint: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-11-23",
  endDate: "2026-12-04",
  pointsPlanned: 20,
  status: "planned",
};

/** A Team Canvas whose rule r1 went to the Working Agreement. */
const canvasWithRule = (id = "kickoff_1"): Kickoff =>
  kickoff({
    id,
    format: "team-canvas",
    sections: {
      rules: [
        {
          id: "line1",
          text: "Pair on payments",
          sentTo: [{ route: "agreement-rule", targetId: "r1", at: AT }],
        },
      ],
    },
  });

describe("kickoff next steps", () => {
  it("says nothing with no kickoff, or only the example's", () => {
    expect(steps({})).toEqual([]);
    expect(
      steps({
        kickoffs: [
          kickoff({ id: exampleId("k"), format: "inception", status: "agreed", agreedAt: AT }),
        ],
      })
    ).toEqual([]);
  });

  it("asks for consent to the rules a kickoff sent, until everyone real has consented", () => {
    const members = [
      { id: "m1", name: "Ana" },
      { id: exampleId("m2"), name: "Example Eve" },
    ];
    const waiting = steps({
      kickoffs: [canvasWithRule()],
      workingAgreements: [agreement([rule("r1"), rule("r2")])],
      teamMembers: members,
    });
    expect(waiting.map((s) => s.id)).toEqual(["kickoff-rules-consent"]);
    expect(waiting[0]).toMatchObject({
      label: "Ask the team to consent to the kickoff's rules",
      href: "/working-agreement",
    });
    expect(waiting[0].detail).toMatch(/^1 rule from a kickoff still waits/);
    // Ana consents: the example member doesn't count, so the rule is done.
    expect(
      ids({
        kickoffs: [canvasWithRule()],
        workingAgreements: [
          agreement([
            rule("r1", { consent: [{ name: "Ana", vote: "consent" }], agreedBy: ["Ana"] }),
          ]),
        ],
        teamMembers: members,
      })
    ).toEqual([]);
    // A rule removed from the agreement isn't asked about.
    expect(
      ids({
        kickoffs: [canvasWithRule()],
        workingAgreements: [agreement([])],
        teamMembers: members,
      })
    ).toEqual([]);
    // An example kickoff's sent rules don't count.
    expect(
      ids({
        kickoffs: [canvasWithRule(exampleId("k")), kickoff({ id: "k2", format: "trade-offs" })],
        workingAgreements: [agreement([rule("r1")])],
        teamMembers: members,
      })
    ).toEqual([]);
  });

  it("turns an agreed product kickoff into a Product Goal while there is none", () => {
    const agreed = kickoff({
      id: "k",
      format: "inception",
      title: "Tap to pay",
      status: "agreed",
      agreedAt: AT,
    });
    const out = steps({ kickoffs: [agreed], sprints: [sprint] });
    expect(out.map((s) => s.id)).toEqual(["kickoff-product-goal"]);
    expect(out[0]).toMatchObject({
      label: "Turn the kickoff into a Product Goal",
      href: "/product-goal",
    });
    expect(out[0].detail).toContain("“Tap to pay” is agreed");
    expect(ids({ kickoffs: [agreed], productGoals: [goal], sprints: [sprint] })).toEqual([]);
    // An example goal isn't the team's.
    expect(
      ids({
        kickoffs: [agreed],
        productGoals: [{ ...goal, id: exampleId("g") }],
        sprints: [sprint],
      })
    ).toEqual(["kickoff-product-goal"]);
    // A Team Canvas or a draft doesn't ask for a goal.
    expect(
      ids({
        kickoffs: [
          kickoff({ id: "c", format: "team-canvas", status: "agreed", agreedAt: AT }),
          kickoff({ id: "d", format: "project-poster" }),
        ],
        sprints: [sprint],
      })
    ).toEqual([]);
  });

  it("plans the first sprint once a kickoff is agreed and the team has none", () => {
    const agreed = kickoff({ id: "c", format: "team-canvas", status: "agreed", agreedAt: AT });
    const out = steps({ kickoffs: [agreed] });
    expect(out.map((s) => s.id)).toEqual(["kickoff-first-sprint"]);
    expect(out[0]).toMatchObject({ label: "Plan the first sprint", href: "/sprint-planning" });
    expect(ids({ kickoffs: [agreed], sprints: [sprint] })).toEqual([]);
    expect(ids({ kickoffs: [agreed], sprints: [{ ...sprint, id: exampleId("s") }] })).toEqual([
      "kickoff-first-sprint",
    ]);
    expect(ids({ kickoffs: [kickoff({ id: "d", format: "team-canvas" })] })).toEqual([]);
  });

  it("puts the three steps in order", () => {
    const out = kickoffNextSteps(
      {
        kickoffs: [
          canvasWithRule(),
          kickoff({ id: "i", format: "alignment-map", status: "agreed", agreedAt: AT }),
        ],
        goals: [],
        agreements: [agreement([rule("r1")])],
        members: [{ id: "m1", name: "Ana" }],
        sprints: [],
      },
      "2026-11-20"
    );
    expect(out.map((s) => s.id)).toEqual([
      "kickoff-rules-consent",
      "kickoff-product-goal",
      "kickoff-first-sprint",
    ]);
  });

  it("links only to pages that exist", () => {
    expect(seen.size).toBeGreaterThan(0);
    for (const href of Array.from(seen)) {
      const page = path.join(process.cwd(), "src", "app", "(tools)", href.slice(1), "page.tsx");
      expect(existsSync(page), href).toBe(true);
    }
  });
});
