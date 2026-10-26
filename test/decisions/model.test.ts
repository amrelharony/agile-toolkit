/**
 * lib/decisions/model: one decision record for the Decision Log, DACI and
 * RAPID. How old rows read (blob rows, DACI and RAPID rows, timestamps),
 * the one numbering sequence, the hand-off's record, the lifecycle moves,
 * the DACI/RAPID status vocabulary the agent aliases keep, the checks, the
 * verdict and time to decide.
 */

import { describe, expect, it } from "vitest";
import {
  DECISION_TEXT_MAX,
  DECISION_TITLE_MAX,
  STATUS_RANK,
  allDecisions,
  buildDecision,
  daysWaiting,
  decide,
  decideError,
  decisionHref,
  decisionIssues,
  decisionLabel,
  decisionVerdict,
  fromDaci,
  fromRapid,
  isDecided,
  legacyKindOf,
  legacyStatusOf,
  nextDecisionNumber,
  normalizeDecision,
  numberUnnumbered,
  optionsOf,
  reopen,
  roleHolders,
  supersede,
  templateOf,
  timeToDecide,
  withFreeNumber,
  withLegacyStatus,
} from "@/lib/decisions/model";
import { SINGLE_ROLES, TEMPLATES } from "@/lib/decisions/templates";
import type { DACIDecision, Decision, RAPIDDecision } from "@/lib/stores/workspace-types";

const rec = (over: Partial<Decision> = {}): Decision => ({
  id: "d1",
  title: "Use Postgres",
  decision: "",
  status: "proposed",
  date: "2026-10-01",
  ...over,
});

const daci = (over: Partial<DACIDecision> = {}): DACIDecision => ({
  id: "x1",
  title: " Pick a vendor ",
  status: "open",
  date: "2026-10-02T09:30:00.000Z",
  ...over,
});

const rapid = (over: Partial<RAPIDDecision> = {}): RAPIDDecision => ({
  id: "r1",
  title: "Reorg",
  status: "open",
  date: "2026-10-03T10:00:00.000Z",
  ...over,
});

describe("reading a record", () => {
  it("templateOf: absent or unknown is an ADR", () => {
    expect(templateOf({})).toBe("adr");
    expect(templateOf({ template: "rapid" })).toBe("rapid");
    expect(templateOf({ template: "nope" as never })).toBe("adr");
  });

  it("optionsOf: options win; a pre-template ADR's alternatives read as options", () => {
    expect(optionsOf(rec({ alternatives: ["Mongo", " ", "  Dynamo "] }))).toEqual([
      { id: "d1-a0", text: "Mongo" },
      { id: "d1-a1", text: "Dynamo" },
    ]);
    expect(optionsOf(rec({ alternatives: ["Mongo"], options: [] }))).toEqual([]);
    expect(optionsOf(rec())).toEqual([]);
  });

  it("isDecided and the lifecycle order", () => {
    expect(isDecided("proposed")).toBe(false);
    expect(isDecided(undefined)).toBe(false);
    for (const s of ["accepted", "deprecated", "superseded"] as const)
      expect(isDecided(s)).toBe(true);
    expect(STATUS_RANK.proposed).toBeLessThan(STATUS_RANK.accepted);
    expect(STATUS_RANK.deprecated).toBe(STATUS_RANK.superseded);
  });

  it("decisionHref opens the one record", () => {
    expect(decisionHref("a b")).toBe("/decision-log?id=a%20b");
  });

  it("single roles come from the templates", () => {
    expect(Array.from(SINGLE_ROLES).sort()).toEqual(["driver", "recommend"]);
    expect(TEMPLATES.daci.deciderLabel).toBe("Approver");
    expect(TEMPLATES.rapid.deciderLabel).toBe("Decide (D)");
    expect(TEMPLATES.adr.deciderRequiredToDecide).toBe(false);
  });
});

describe("normalizeDecision (old blob rows, rows read on the server)", () => {
  it("needs an id", () => {
    expect(normalizeDecision(null)).toBeNull();
    expect(normalizeDecision("x")).toBeNull();
    expect(normalizeDecision({ title: "No id" })).toBeNull();
    expect(normalizeDecision({ id: "  " })).toBeNull();
  });

  it("reads a pre-template ADR: unknown status proposed, a timestamp as its day, no blank alternatives", () => {
    expect(
      normalizeDecision({
        id: "a",
        title: " ADR-0001: Postgres ",
        context: "  ",
        decision: "We will",
        consequences: "Ops",
        alternatives: ["Mongo", "", " ", 3],
        status: "rejected",
        date: "2026-10-01T23:30:00.000Z",
        sourceRef: { tool: "six-hats", id: "s1" },
      })
    ).toEqual({
      id: "a",
      title: "ADR-0001: Postgres",
      decision: "We will",
      consequences: "Ops",
      alternatives: ["Mongo"],
      status: "proposed",
      date: "2026-10-01",
      sourceRef: { tool: "six-hats", id: "s1" },
    });
  });

  it("a date that isn't one reads as unknown, and a missing outcome as empty", () => {
    expect(normalizeDecision({ id: "a", date: "yesterday" })).toEqual({
      id: "a",
      title: "",
      decision: "",
      status: "proposed",
      date: "",
    });
  });

  it("keeps every Phase 7 field, dropping unknown roles and a second Driver", () => {
    const d = normalizeDecision({
      id: "a",
      title: "T",
      decision: "",
      status: "accepted",
      date: "2026-10-01",
      template: "daci",
      number: 3,
      options: [
        { id: "o1", text: "One", note: " cheap " },
        { id: "o1", text: "Dup" },
        { id: "o2", text: " " },
      ],
      chosenOptionId: "o1",
      recommendation: "One",
      decider: " Ana ",
      roles: { driver: ["Bo", "Cy"], informed: ["Dee", "dee", " "], boss: ["X"] },
      decidedAt: "2026-10-05T08:00:00Z",
      implementedAt: "2026-10-09",
      reopenedAt: "nope",
      supersededBy: "b",
    });
    expect(d).toEqual({
      id: "a",
      title: "T",
      decision: "",
      status: "accepted",
      date: "2026-10-01",
      template: "daci",
      number: 3,
      options: [{ id: "o1", text: "One", note: "cheap" }],
      chosenOptionId: "o1",
      recommendation: "One",
      decider: "Ana",
      roles: { driver: ["Bo"], informed: ["Dee"] },
      decidedAt: "2026-10-05",
      implementedAt: "2026-10-09",
      supersededBy: "b",
    });
    expect(normalizeDecision({ id: "a", number: 0 })?.number).toBeUndefined();
    expect(normalizeDecision({ id: "a", number: 2.5 })?.number).toBeUndefined();
  });
});

describe("fromDaci", () => {
  it("maps every status: open, decided, implemented, revisit", () => {
    expect(fromDaci(daci({ status: "open" }))).toMatchObject({ status: "proposed" });
    const decided = fromDaci(daci({ status: "decided" }));
    expect(decided).toMatchObject({ status: "accepted", decision: "" });
    expect(decided.implementedAt).toBeUndefined();
    expect(fromDaci(daci({ status: "implemented" }))).toMatchObject({
      status: "accepted",
      implementedAt: "2026-10-02",
    });
    const revisit = fromDaci(daci({ status: "revisit" }));
    expect(revisit).toMatchObject({ status: "proposed", reopenedAt: "2026-10-02" });
  });

  it("maps the people, options and recommendation, and never guesses the outcome", () => {
    expect(
      fromDaci(
        daci({
          context: "Two quotes",
          driver: "Ana",
          approver: "Bo",
          contributors: ["Cy", " "],
          informed: ["Dee"],
          options: ["Acme", "", "Globex"],
          recommendation: "Acme",
          status: "decided",
        })
      )
    ).toEqual({
      id: "x1",
      title: "Pick a vendor",
      context: "Two quotes",
      decision: "",
      status: "accepted",
      date: "2026-10-02",
      template: "daci",
      options: [
        { id: "x1-o0", text: "Acme" },
        { id: "x1-o1", text: "Globex" },
      ],
      recommendation: "Acme",
      decider: "Bo",
      roles: { driver: ["Ana"], contributor: ["Cy"], informed: ["Dee"] },
    });
  });
});

describe("fromRapid", () => {
  it("maps open, decided and implemented, and the five roles", () => {
    expect(fromRapid(rapid())).toMatchObject({ status: "proposed", template: "rapid" });
    expect(fromRapid(rapid({ status: "decided" })).status).toBe("accepted");
    expect(
      fromRapid(
        rapid({
          status: "implemented",
          recommend: "Ana",
          agree: ["Bo"],
          perform: ["Cy", "Dee"],
          input: ["Eve"],
          decide: "Fay",
        })
      )
    ).toEqual({
      id: "r1",
      title: "Reorg",
      decision: "",
      status: "accepted",
      date: "2026-10-03",
      template: "rapid",
      decider: "Fay",
      roles: { recommend: ["Ana"], agree: ["Bo"], perform: ["Cy", "Dee"], input: ["Eve"] },
      implementedAt: "2026-10-03",
    });
  });
});

describe("allDecisions and legacyKindOf", () => {
  it("lists stored records first, then old rows no record replaced", () => {
    const stored = [rec({ id: "x1", title: "Edited vendor", template: "daci" }), rec({ id: "d2" })];
    const list = allDecisions(stored, [daci(), daci({ id: "x2" })], [rapid()]);
    expect(list.map((d) => [d.id, d.template ?? "adr"])).toEqual([
      ["x1", "daci"],
      ["d2", "adr"],
      ["x2", "daci"],
      ["r1", "rapid"],
    ]);
    // The stored record wins over the old row under its id.
    expect(list[0].title).toBe("Edited vendor");
    expect(allDecisions(undefined, undefined, undefined)).toEqual([]);
  });

  it("reads a stored timestamp as its day, and keeps rows that need nothing as they are", () => {
    const plain = rec();
    const stamped = rec({
      id: "d2",
      date: "2026-10-04T22:00:00Z",
      decidedAt: "2026-10-05T01:00:00Z",
    });
    const [a, b] = allDecisions([plain, stamped], [], []);
    expect(a).toBe(plain);
    expect(b).toMatchObject({ date: "2026-10-04", decidedAt: "2026-10-05" });
  });

  it("legacyKindOf names an old row only while no record replaced it", () => {
    expect(legacyKindOf("x1", [], [daci()], [])).toBe("daci");
    expect(legacyKindOf("r1", [], [], [rapid()])).toBe("rapid");
    expect(legacyKindOf("x1", [rec({ id: "x1" })], [daci()], [])).toBeNull();
    expect(legacyKindOf("nope", [], [daci()], [rapid()])).toBeNull();
  });
});

describe("numbers", () => {
  it("one sequence across templates; example rows don't count", () => {
    expect(nextDecisionNumber([])).toBe(1);
    expect(
      nextDecisionNumber([
        rec({ number: 3 }),
        rec({ id: "b", template: "rapid", number: 7 }),
        rec({ id: "example-c", number: 40 }),
        rec({ id: "c" }),
      ])
    ).toBe(8);
  });

  it("numbers the unnumbered after the highest, oldest day first, then by id, unknown days last", () => {
    const list = [
      rec({ id: "n2", number: 2 }),
      rec({ id: "late", date: "2026-10-09" }),
      rec({ id: "b", date: "2026-10-01" }),
      rec({ id: "a", date: "2026-10-01" }),
      rec({ id: "nodate", date: "" }),
      rec({ id: "example-x" }),
    ];
    expect(numberUnnumbered(list).map((d) => [d.id, d.number])).toEqual([
      ["a", 3],
      ["b", 4],
      ["late", 5],
      ["nodate", 6],
    ]);
    // Numbers given are never changed: nothing left to number.
    const numbered = list.map((d) => numberUnnumbered(list).find((n) => n.id === d.id) ?? d);
    expect(numberUnnumbered(numbered)).toEqual([]);
  });

  it("withFreeNumber keeps a record's number unless another record now holds it", () => {
    const back = rec({ id: "x", number: 5 });
    // The delete freed 5 and a new record took it before the Undo.
    const list = [rec({ id: "a", number: 4 }), rec({ id: "new", number: 5 })];
    expect(withFreeNumber(back, list)).toEqual({ ...back, number: 6 });
    // Nobody took it, or only the record itself (or an example row) holds it.
    const free = [rec({ id: "a", number: 4 }), rec({ id: "example-e", number: 5 })];
    expect(withFreeNumber(back, free)).toBe(back);
    expect(withFreeNumber(back, [...free, back])).toBe(back);
    // Unnumbered records and example rows stay as they are.
    const bare = rec({ id: "y" });
    expect(withFreeNumber(bare, list)).toBe(bare);
    const example = rec({ id: "example-z", number: 5 });
    expect(withFreeNumber(example, list)).toBe(example);
  });

  it("labels a record by its template and number", () => {
    expect(decisionLabel(rec({ number: 3 }))).toBe("ADR-0003");
    expect(decisionLabel(rec({ template: "daci", number: 4 }))).toBe("DACI-0004");
    expect(decisionLabel(rec({ template: "rapid", number: 12345 }))).toBe("RAPID-12345");
    expect(decisionLabel(rec())).toBe("Unnumbered");
  });
});

describe("buildDecision (the hand-off's record)", () => {
  const src = {
    title: "  Adopt trunk-based development?  ",
    description: " Try it for one sprint. ",
    sourceRef: { tool: "six-hats", id: "s1" },
  };

  it("a proposed ADR with the outcome left to write", () => {
    expect(buildDecision(src, "n1", 6, "2026-10-20")).toEqual({
      id: "n1",
      title: "Adopt trunk-based development?",
      context: "Try it for one sprint.",
      decision: "",
      status: "proposed",
      date: "2026-10-20",
      sourceRef: { tool: "six-hats", id: "s1" },
      template: "adr",
      number: 6,
    });
    expect(buildDecision(src, "n1", undefined, "2026-10-20").number).toBeUndefined();
  });

  it("takes the form, the options in order and the recommendation from src.decision, clipped", () => {
    const d = buildDecision(
      {
        ...src,
        title: "x".repeat(DECISION_TITLE_MAX + 5),
        decision: { template: "rapid", options: ["B", " ", "A"], recommendation: "B" },
      },
      "n1",
      1,
      "2026-10-20"
    );
    expect(d.title).toHaveLength(DECISION_TITLE_MAX);
    expect(d).toMatchObject({
      template: "rapid",
      options: [
        { id: "n1-o0", text: "B" },
        { id: "n1-o1", text: "A" },
      ],
      recommendation: "B",
    });
  });
});

describe("decide, supersede, reopen", () => {
  it("decide accepts with the outcome and day, and clears revisit and a replacement", () => {
    const d = decide(rec({ reopenedAt: "2026-10-03", supersededBy: "z", decider: "Ana" }), {
      outcome: "  We will use Postgres. ",
      date: "2026-10-04",
    });
    expect(d).toEqual(
      rec({
        status: "accepted",
        decision: "We will use Postgres.",
        decidedAt: "2026-10-04",
        decider: "Ana",
      })
    );
  });

  it("decide saves a pre-template ADR's alternatives when one is chosen, and ignores an unknown choice", () => {
    const old = rec({ alternatives: ["Mongo", "Postgres"] });
    const d = decide(old, {
      outcome: "Postgres",
      chosenOptionId: "d1-a1",
      decider: "Bo",
      date: "2026-10-04",
    });
    expect(d.options).toEqual([
      { id: "d1-a0", text: "Mongo" },
      { id: "d1-a1", text: "Postgres" },
    ]);
    expect(d).toMatchObject({ chosenOptionId: "d1-a1", decider: "Bo" });
    const ignored = decide(old, { outcome: "x", chosenOptionId: "nope", date: "2026-10-04" });
    expect(ignored.chosenOptionId).toBeUndefined();
    expect(ignored.options).toBeUndefined();
  });

  it("decideError: outcome, day, the DACI/RAPID decider and a real option", () => {
    const ok = { outcome: "Go", date: "2026-10-04" };
    expect(decideError(rec(), ok)).toBeNull();
    expect(decideError(rec(), { ...ok, outcome: "  " })).toBe("Write down what was decided.");
    expect(decideError(rec(), { ...ok, outcome: "x".repeat(DECISION_TEXT_MAX + 1) })).toMatch(
      /Keep the outcome/
    );
    expect(decideError(rec(), { ...ok, date: "2026-02-30" })).toBe("Pick the day it was decided.");
    expect(decideError(rec({ template: "daci" }), ok)).toBe("Name the Approver before deciding.");
    expect(decideError(rec({ template: "rapid" }), ok)).toBe(
      "Name the Decide (D) before deciding."
    );
    expect(decideError(rec({ template: "daci" }), { ...ok, decider: "Ana" })).toBeNull();
    expect(decideError(rec({ template: "daci", decider: "Ana" }), ok)).toBeNull();
    expect(decideError(rec(), { ...ok, chosenOptionId: "nope" })).toBe(
      "Pick one of the record's options."
    );
  });

  it("supersede names the replacement once", () => {
    const old = rec({ status: "accepted" });
    const next = supersede(old, "d9")!;
    expect(next).toEqual({ ...old, status: "superseded", supersededBy: "d9" });
    expect(supersede(next, "d9")).toBeNull();
    expect(supersede(old, "d1")).toBeNull();
  });

  it("reopen goes back to proposed, no longer carried out or replaced", () => {
    const done = rec({
      status: "superseded",
      decision: "Go",
      implementedAt: "2026-10-05",
      supersededBy: "z",
    });
    expect(reopen(done, "2026-10-10")).toEqual(
      rec({ status: "proposed", decision: "Go", reopenedAt: "2026-10-10" })
    );
    const open = rec();
    expect(reopen(open, "2026-10-10")).toBe(open);
  });
});

describe("the DACI / RAPID status vocabulary (agent aliases)", () => {
  it("reads open, revisit (DACI only), decided and implemented", () => {
    expect(legacyStatusOf(rec(), "daci")).toBe("open");
    expect(legacyStatusOf(rec({ reopenedAt: "2026-10-02" }), "daci")).toBe("revisit");
    expect(legacyStatusOf(rec({ reopenedAt: "2026-10-02" }), "rapid")).toBe("open");
    expect(legacyStatusOf(rec({ status: "accepted" }), "rapid")).toBe("decided");
    expect(legacyStatusOf(rec({ status: "superseded" }), "daci")).toBe("decided");
    expect(legacyStatusOf(rec({ status: "accepted", implementedAt: "2026-10-03" }), "daci")).toBe(
      "implemented"
    );
  });

  it("writes them, and leaves a record already in the status as it is", () => {
    const today = "2026-10-10";
    expect(withLegacyStatus(rec(), "decided", today)).toEqual(
      rec({ status: "accepted", decidedAt: today })
    );
    expect(
      withLegacyStatus(rec({ status: "accepted", decidedAt: "2026-10-04" }), "implemented", today)
    ).toEqual(rec({ status: "accepted", decidedAt: "2026-10-04", implementedAt: today }));
    expect(
      withLegacyStatus(rec({ status: "accepted", decidedAt: "2026-10-04" }), "revisit", today)
    ).toEqual(rec({ status: "proposed", decidedAt: "2026-10-04", reopenedAt: today }));
    expect(
      withLegacyStatus(rec({ status: "accepted", implementedAt: "2026-10-05" }), "open", today)
    ).toEqual(rec({ status: "proposed" }));
    const same = rec({ status: "accepted", implementedAt: "2026-10-05" });
    expect(withLegacyStatus(same, "implemented", today)).toBe(same);
    const reopened = rec({ reopenedAt: "2026-10-02" });
    expect(withLegacyStatus(reopened, "open", today)).toBe(reopened);
  });
});

describe("decisionIssues", () => {
  const today = "2026-10-20";

  it("a DACI proposal needs its Approver and Driver; a RAPID one its D and R, and a short Agree list", () => {
    const fresh = (over: Partial<Decision> = {}) => rec({ date: "2026-10-19", ...over });
    expect(decisionIssues(fresh({ template: "daci" }), today).map((i) => i.kind)).toEqual([
      "no_decider",
      "no_driver",
    ]);
    expect(
      decisionIssues(
        fresh({ template: "rapid", roles: { agree: ["A", "B", "C", "D"] } }),
        today
      ).map((i) => i.kind)
    ).toEqual(["no_decider", "no_recommend", "many_agree"]);
    expect(
      decisionIssues(
        fresh({
          template: "rapid",
          decider: "Fay",
          roles: { recommend: ["Ana"], agree: ["A", "B", "C"] },
        }),
        today
      )
    ).toEqual([]);
    expect(decisionIssues(fresh(), today)).toEqual([]);
  });

  it("a proposal waiting more than 14 days (since raised, or reopened) is stale", () => {
    expect(decisionIssues(rec({ date: "2026-10-06" }), today)).toEqual([]);
    expect(decisionIssues(rec({ date: "2026-10-05" }), today)).toEqual([
      { kind: "stale_proposed", message: "Proposed 15 days ago and still not decided." },
    ]);
    expect(decisionIssues(rec({ date: "2026-09-01", reopenedAt: "2026-10-18" }), today)).toEqual(
      []
    );
    expect(daysWaiting(rec({ date: "" }), today)).toBeNull();
    expect(daysWaiting(rec({ status: "accepted" }), today)).toBeNull();
  });

  it("an accepted record needs its outcome written; deprecated and superseded need nothing", () => {
    expect(decisionIssues(rec({ status: "accepted", template: "daci" }), today)).toEqual([
      {
        kind: "accepted_no_outcome",
        message: "Accepted, but what was decided isn't written down.",
      },
    ]);
    expect(decisionIssues(rec({ status: "accepted", decision: "Go" }), today)).toEqual([]);
    expect(decisionIssues(rec({ status: "superseded", template: "rapid" }), today)).toEqual([]);
  });

  it("roleHolders reads a role, or none", () => {
    expect(roleHolders(rec({ roles: { input: ["Eve"] } }), "input")).toEqual(["Eve"]);
    expect(roleHolders(rec(), "input")).toEqual([]);
  });
});

describe("the verdict and time to decide", () => {
  const today = "2026-10-22";

  it("says how many, and how long the oldest proposal has waited", () => {
    expect(decisionVerdict([], today)).toBe("No decisions recorded yet.");
    expect(
      decisionVerdict(
        [
          rec({ id: "a", date: "2026-10-01" }),
          rec({ id: "b", date: "2026-10-20" }),
          rec({ id: "c", status: "accepted", decision: "Go" }),
          rec({ id: "d", status: "accepted" }),
          rec({ id: "e", status: "superseded" }),
        ],
        today
      )
    ).toBe(
      "5 decisions: 2 proposed (oldest waiting 21 days), 2 accepted (1 without the outcome written down), 1 superseded."
    );
    expect(decisionVerdict([rec({ date: "2026-10-21" })], today)).toBe(
      "1 decision: 1 proposed (waiting 1 day)."
    );
    expect(
      decisionVerdict([rec({ date: today }), rec({ id: "x", status: "deprecated" })], today)
    ).toBe("2 decisions: 1 proposed, 1 deprecated.");
  });

  it("time to decide: the median over decided records with both days, from 3", () => {
    const decided = (id: string, date: string, decidedAt: string) =>
      rec({ id, status: "accepted", date, decidedAt });
    const two = [
      decided("a", "2026-10-01", "2026-10-03"),
      decided("b", "2026-10-01", "2026-10-11"),
    ];
    expect(timeToDecide(two)).toBeNull();
    const list = [
      ...two,
      decided("c", "2026-10-01", "2026-10-05"),
      // Not counted: still proposed, no decided day, decided before it was raised.
      rec({ id: "d", date: "2026-10-01", decidedAt: "2026-10-30" }),
      rec({ id: "e", status: "accepted" }),
      decided("f", "2026-10-10", "2026-10-01"),
    ];
    expect(timeToDecide(list)).toEqual({ medianDays: 4, n: 3 });
    expect(timeToDecide([...list, decided("g", "2026-10-01", "2026-10-21")])).toEqual({
      medianDays: 7,
      n: 4,
    });
  });
});
