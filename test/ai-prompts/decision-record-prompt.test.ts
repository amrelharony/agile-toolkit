// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateDecisionLogPrompts } from "@/lib/ai-prompts/decision-log";
import { generateDaciPrompts } from "@/lib/ai-prompts/daci";
import { generateRapidPrompts } from "@/lib/ai-prompts/rapid-decision";
import { decisionVerdict } from "@/lib/decisions/model";
import type { Decision } from "@/lib/stores/workspace-types";

/**
 * The Decision Log, DACI and RAPID prompts read the one decision record as
 * the page does: its number from the one sequence (ADR-0001, DACI-0002),
 * its template, the ADR lifecycle (carried out and reopened as dates),
 * the template's roles and what the record still needs, never the old
 * DACI/RAPID "open / decided / implemented" vocabulary.
 */

const TODAY = "2026-10-27";

const rec = (over: Partial<Decision>): Decision => ({
  id: "d",
  title: "Untitled",
  decision: "",
  status: "proposed",
  date: "2026-10-01",
  ...over,
});

const LIST: Decision[] = [
  rec({
    id: "a",
    number: 1,
    title: "Use Postgres for the event log",
    status: "accepted",
    decision: "We use Postgres with a partitioned events table.",
    decider: "Priya",
    date: "2026-10-01",
    decidedAt: "2026-10-03",
  }),
  rec({
    id: "b",
    number: 2,
    template: "daci",
    title: "Pick a flag service",
    date: "2026-09-01",
    roles: { contributor: ["Chen"] },
  }),
  rec({
    id: "c",
    number: 3,
    template: "rapid",
    title: "Weekly releases",
    status: "accepted",
    decider: "Morgan",
    date: "2026-10-10",
    decidedAt: "2026-10-20",
    implementedAt: "2026-10-22",
    roles: { recommend: ["Priya"], agree: ["Sam", "Lee", "Kim", "Ola"], input: ["QA"] },
  }),
  rec({
    id: "e",
    number: 4,
    title: "Host on Heroku",
    status: "superseded",
    decision: "Heroku.",
    date: "2026-08-01",
    decidedAt: "2026-08-07",
    supersededBy: "a",
  }),
  // Waiting for a number.
  rec({ id: "f", title: "Adopt OpenTelemetry", date: "2026-10-26" }),
];

describe("generateDecisionLogPrompts", () => {
  const [review, risk] = generateDecisionLogPrompts({ decisions: LIST, today: TODAY });

  it("lists every record with its number, template and lifecycle, newest number first", () => {
    expect(review.prompt).toContain(
      "| Number | Template | Title | Status | Raised | Decided | Decider | Outcome |"
    );
    expect(review.prompt).toContain(
      "| ADR-0001 | ADR | Use Postgres for the event log | Accepted | 2026-10-01 | 2026-10-03 | Priya | We use Postgres with a partitioned events table. |"
    );
    expect(review.prompt).toContain(
      "| RAPID-0003 | RAPID | Weekly releases | Accepted, carried out 2026-10-22 | 2026-10-10 | 2026-10-20 | Morgan | Not written down |"
    );
    expect(review.prompt).toContain(
      "- RAPID-0003: Accepted, but what was decided isn't written down."
    );
    expect(review.prompt).toContain("| Unnumbered | ADR | Adopt OpenTelemetry | Proposed |");
    expect(review.prompt.indexOf("ADR-0004")).toBeLessThan(review.prompt.indexOf("RAPID-0003"));
    expect(review.prompt).not.toMatch(/\| (open|decided|implemented) \|/);
  });

  it("states what a stale proposal needs, the verdict and how long decisions take", () => {
    expect(review.prompt).toContain(
      "- DACI-0002: No Approver named: name the one person who makes the call. No Driver named: name the person who runs the decision. Proposed 56 days ago and still not decided."
    );
    // A record that needs nothing isn't listed there.
    expect(review.prompt).not.toContain("- ADR-0001:");
    expect(review.prompt).toContain(`Verdict: ${decisionVerdict(LIST, TODAY)}`);
    expect(review.prompt).toContain("Decisions take 6 days from raised to decided (median of 3).");
    expect(risk.prompt).toContain("| ADR-0001 |");
  });

  it("has nothing to ask about an empty log", () => {
    expect(generateDecisionLogPrompts({ decisions: [], today: TODAY })).toEqual([]);
  });
});

describe("generateDaciPrompts", () => {
  it("names the Driver, the Approver, Contributors and Informed, and what's missing", () => {
    const [p] = generateDaciPrompts({ decisions: [LIST[1]], today: TODAY });
    expect(p.prompt).toContain(
      "| Number | Title | Status | Driver | Approver | Contributors | Informed | Waiting |"
    );
    expect(p.prompt).toContain(
      "| DACI-0002 | Pick a flag service | Proposed | — | — | Chen | — | 56 days |"
    );
    expect(p.prompt).toContain("- DACI-0002: No Approver named");
  });
});

describe("generateRapidPrompts", () => {
  it("names each RAPID role and flags an Agree list over the limit", () => {
    const proposed = rec({
      ...LIST[2],
      status: "proposed",
      decidedAt: undefined,
      implementedAt: undefined,
      date: "2026-10-20",
    });
    const [p] = generateRapidPrompts({ decisions: [proposed], today: TODAY });
    expect(p.prompt).toContain(
      "| Number | Title | Status | Recommend (R) | Agree (A) | Perform (P) | Input (I) | Decide (D) | Waiting |"
    );
    expect(p.prompt).toContain(
      "| RAPID-0003 | Weekly releases | Proposed | Priya | Sam, Lee, Kim, Ola | — | QA | Morgan | 7 days |"
    );
    expect(p.prompt).toContain(
      "- RAPID-0003: 4 people must agree, and each one is a veto: keep it to 3 or fewer."
    );
  });
});
