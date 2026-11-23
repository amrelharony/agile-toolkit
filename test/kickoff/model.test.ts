// @vitest-environment node
/**
 * Kickoff's pure parts (lib/kickoff): the six formats' catalog, reading a
 * stored kickoff, what's still open, the trade-off sliders, the problem
 * statement and its How might we… starters, drafted lines, the team's
 * purpose, what a line takes when it is sent on, the example and the
 * Markdown.
 */

import { describe, expect, it } from "vitest";
import { buildExample } from "@/app/(tools)/kickoff/example";
import { kickoffToMarkdown } from "@/app/(tools)/kickoff/markdown";
import { getToolById } from "@/lib/constants/tools";
import {
  DEFAULT_SLIDERS,
  KICKOFF_FORMAT_DEFS,
  KICKOFF_FORMAT_LIST,
  KICKOFF_SECTION_ROUTES,
  kickoffFormat,
} from "@/lib/kickoff/formats";
import {
  blankKickoff,
  changedSinceAgreed,
  coveredWorry,
  coveringItems,
  dayLabel,
  draftItemsFor,
  draftSlidersFor,
  hmwStarters,
  itemSource,
  kickoffCatalogProblem,
  kickoffGaps,
  moveSlider,
  normalizeKickoff,
  orderedSliders,
  peopleFromRoster,
  readKickoffs,
  sendProblem,
  sliderSummary,
  slidersDecisionSource,
  statementFrom,
  teamPurpose,
  validateKickoff,
  withDraftLines,
  withSlider,
  withSliderOrder,
  withStatus,
  worryToRisk,
} from "@/lib/kickoff/model";
import { formatProblems, hasPlaceholder, removeDraftLines } from "@/lib/sectioned/model";
import {
  HANDOFF_ROUTE_IDS,
  KICKOFF_FORMATS,
  KICKOFF_ITEM_MAX,
  TOOL_LIST_MAX,
  type Kickoff,
  type KickoffItem,
} from "@/lib/stores/workspace-types";
import { exampleId, isExampleId } from "@/lib/utils/example-id";

const AT = "2026-11-20T09:00:00.000Z";
const LATER = "2026-11-21T09:00:00.000Z";

function kickoff(over: Partial<Kickoff> & Pick<Kickoff, "format">): Kickoff {
  return {
    id: "kickoff_1",
    title: "Payments liftoff",
    sections: {},
    status: "draft",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

const item = (id: string, text: string, over: Partial<KickoffItem> = {}): KickoffItem => ({
  id,
  text,
  ...over,
});

let n = 0;
const ids = () => `id${++n}`;

describe("the catalog", () => {
  it("has the six formats in order, each one sound", () => {
    expect(KICKOFF_FORMAT_LIST.map((f) => f.id)).toEqual([...KICKOFF_FORMATS]);
    for (const f of KICKOFF_FORMAT_LIST) {
      expect(formatProblems(f), f.id).toEqual([]);
      expect(kickoffFormat(f.id)).toBe(f);
    }
    expect(kickoffFormat("constructor")).toBeUndefined();
    expect(kickoffFormat("idea")).toBeUndefined();
  });

  it("names the formats as the page and Amr do, crediting the published ones", () => {
    expect(KICKOFF_FORMAT_LIST.map((f) => f.name)).toEqual([
      "Team Alignment Map",
      "Project Poster",
      "Team Canvas",
      "Inception deck",
      "Trade-off sliders",
      "Problem framing",
    ]);
    expect(KICKOFF_FORMAT_DEFS["team-canvas"].credit?.text).toBe("After Alex Ivanov's Team Canvas");
    expect(KICKOFF_FORMAT_DEFS.inception.credit?.text).toMatch(
      /Jonathan Rasmusson's Inception Deck/
    );
    expect(KICKOFF_FORMAT_DEFS["trade-offs"].credit).toBeUndefined();
    expect(KICKOFF_FORMAT_DEFS["problem-framing"].credit).toBeUndefined();
    // Sliders only where the order matters.
    expect(KICKOFF_FORMAT_LIST.filter((f) => f.hasSliders).map((f) => f.id)).toEqual([
      "inception",
      "trade-offs",
    ]);
  });

  it("links only to tools that exist, and sends only on real routes", () => {
    for (const f of KICKOFF_FORMAT_LIST) {
      for (const d of f.sections) {
        for (const id of d.links ?? [])
          expect(getToolById(id), `${f.id}.${d.id} → ${id}`).toBeDefined();
        for (const r of d.routes ?? []) expect(HANDOFF_ROUTE_IDS).toContain(r);
      }
    }
    expect([...KICKOFF_SECTION_ROUTES].sort()).toEqual(
      ["agreement-rule", "backlog-story", "hypothesis", "opportunity", "risk", "root-cause"].sort()
    );
  });

  it("marks worries, what covers them and who owns what", () => {
    const map = KICKOFF_FORMAT_DEFS["alignment-map"];
    expect(map.sections.filter((d) => d.coverTarget).map((d) => d.id)).toEqual(["risks"]);
    expect(map.sections.filter((d) => d.covers).map((d) => d.id)).toEqual([
      "commitments",
      "resources",
    ]);
    const inception = KICKOFF_FORMAT_DEFS.inception;
    expect(inception.sections.filter((d) => d.covers).map((d) => d.id)).toEqual(["needs"]);
    const canvas = KICKOFF_FORMAT_DEFS["team-canvas"];
    expect(canvas.sections.filter((d) => d.owner).map((d) => d.id)).toEqual([
      "people",
      "personal-goals",
      "needs",
    ]);
  });
});

describe("normalizeKickoff", () => {
  it("refuses what can't be a kickoff", () => {
    expect(normalizeKickoff(null)).toBeNull();
    expect(normalizeKickoff({ id: "", format: "inception" })).toBeNull();
    expect(normalizeKickoff({ id: "k", format: "whiteboard" })).toBeNull();
  });

  it("keeps the format's sections, drops empty lines, off-scale ratings and covers where none go", () => {
    const k = normalizeKickoff({
      id: "k1",
      title: "Map",
      format: "alignment-map",
      status: "weird",
      agreedAt: AT,
      sections: {
        mission: [item("m1", "By spring, we ship tap to pay."), item("m2", "A second answer")],
        risks: [
          item("r1", "Certification is slow", { likelihood: 4, impact: 7 }),
          item("r2", "  ", {}),
        ],
        commitments: [
          item("c1", "Watch the partner", { owner: "Omar", covers: "r1" }),
          item("c2", "Write the docs", { covers: "gone" }),
        ],
        objectives: [item("o1", "A pilot", { covers: "r1", likelihood: 3 })],
        whiteboard: [item("w1", "Not a section")],
      },
      sliders: [{ id: "s1", label: "Scope", position: 1 }],
      createdAt: AT,
      updatedAt: AT,
    })!;
    // Only the format's sections the row held: "whiteboard" goes.
    expect(Object.keys(k.sections).sort()).toEqual(
      ["commitments", "mission", "objectives", "risks"].sort()
    );
    expect(k.sections.mission.map((i) => i.id)).toEqual(["m1"]);
    expect(k.sections.risks).toEqual([item("r1", "Certification is slow", { likelihood: 4 })]);
    // A worry that isn't there keeps its cover: a deleted worry's Undo finds it.
    expect(k.sections.commitments).toEqual([
      item("c1", "Watch the partner", { owner: "Omar", covers: "r1" }),
      item("c2", "Write the docs", { covers: "gone" }),
    ]);
    // Objectives can't cover, and aren't rated.
    expect(k.sections.objectives).toEqual([item("o1", "A pilot")]);
    expect(k.status).toBe("draft");
    expect(k.agreedAt).toBeUndefined();
    // No sliders on a format without them.
    expect(k.sliders).toBeUndefined();
  });

  it("keeps slider positions unique, 1 first, and each label once", () => {
    const k = normalizeKickoff({
      id: "k",
      title: "T",
      format: "trade-offs",
      sections: {},
      sliders: [
        { id: "a", label: "Scope", position: 3 },
        { id: "b", label: "Date", position: 1 },
        { id: "c", label: "date ", position: 2 },
        { id: "d", label: "Cost", position: 1 },
        { id: "e", label: "", position: 4 },
        "junk",
      ],
      slidersSetAt: "not a time",
    })!;
    expect(orderedSliders(k).map((s) => [s.label, s.position])).toEqual([
      ["Date", 1],
      ["Cost", 2],
      ["Scope", 3],
    ]);
    expect(k.slidersSetAt).toBeUndefined();
  });

  it("drops participants that repeat, and cuts long lines to the item cap", () => {
    const k = normalizeKickoff({
      id: "k",
      title: "T",
      format: "project-poster",
      participants: ["Ana", "ana ", "", 7, "Bo"],
      sections: { measures: [item("x", "y".repeat(KICKOFF_ITEM_MAX + 50))] },
    })!;
    expect(k.participants).toEqual(["Ana", "Bo"]);
    expect(k.sections.measures[0].text).toHaveLength(KICKOFF_ITEM_MAX);
  });

  it("reads a list newest change first, skipping rows it can't read", () => {
    const rows = [
      kickoff({ id: "a", format: "trade-offs", updatedAt: AT }),
      { id: "b" },
      kickoff({ id: "c", format: "inception", updatedAt: LATER }),
    ];
    expect(readKickoffs(rows).map((k) => k.id)).toEqual(["c", "a"]);
  });
});

describe("what a written kickoff may hold (kickoffCatalogProblem)", () => {
  const canvas = kickoff({ id: "kickoff_c", format: "team-canvas" });
  const deck = kickoff({ id: "kickoff_d", format: "inception" });

  it("names what the format doesn't take, each of which the reader drops", () => {
    const cases: [Kickoff, RegExp][] = [
      [
        { ...canvas, sections: { worries: [item("w", "Slow")] } },
        new RegExp(
          `^“worries” isn't a section of the Team Canvas format\\. Its sections: ${KICKOFF_FORMAT_DEFS[
            "team-canvas"
          ].sections
            .map((d) => d.id)
            .join(", ")}\\.$`
        ),
      ],
      [
        { ...canvas, sections: { purpose: [item("a", "One"), item("b", "Two")] } },
        /^“purpose” holds one answer, not 2\.$/,
      ],
      [
        {
          ...deck,
          sections: { worries: Array.from({ length: 21 }, (_, i) => item(`w${i}`, `W${i}`)) },
        },
        /^“worries” holds up to 20 lines, not 21\.$/,
      ],
      [
        { ...canvas, sections: { rules: [item("r", "Pair", { owner: "Ana" })] } },
        /^Lines in “rules” have no owner/,
      ],
      [
        { ...deck, sections: { needs: [item("n", "A contact", { likelihood: 3 })] } },
        /^Lines in “needs” aren't rated/,
      ],
      [
        { ...canvas, sections: { rules: [item("r", "Pair", { covers: "w1" })] } },
        /^Lines in “rules” can't cover a worry/,
      ],
      [
        { ...canvas, sliders: [{ id: "s", label: "Scope", position: 1 }] },
        /^The Team Canvas format has no trade-off sliders/,
      ],
    ];
    for (const [row, message] of cases) {
      expect(kickoffCatalogProblem(row)).toMatch(message);
      // Each is something the next read would lose.
      expect(normalizeKickoff(row)).not.toEqual(row);
    }
  });

  it("takes every row the page and Amr's verbs write, a missing worry's cover included", () => {
    for (const k of buildExample(new Date(AT))) expect(kickoffCatalogProblem(k)).toBeNull();
    for (const format of KICKOFF_FORMATS) {
      const k = blankKickoff({ id: `kickoff_${format}`, format, title: "T", now: AT });
      expect(kickoffCatalogProblem(k)).toBeNull();
    }
    const covered = {
      ...deck,
      sections: {
        worries: [item("w1", "Slow", { likelihood: 2, impact: 4 })],
        needs: [item("n1", "A contact", { owner: "Omar", covers: "w1" })],
        people: [],
      },
    };
    // A section the format lacks is named even when it is empty.
    expect(kickoffCatalogProblem(covered)).toMatch(/^“people” isn't a section/);
    const { people: _people, ...sections } = covered.sections;
    void _people;
    expect(kickoffCatalogProblem({ ...covered, sections })).toBeNull();
    expect(
      kickoffCatalogProblem({
        ...covered,
        sections: { ...sections, worries: [] },
      })
    ).toBeNull();
    // An empty owner says nothing, so it isn't refused.
    expect(
      kickoffCatalogProblem({ ...canvas, sections: { rules: [item("r", "Pair", { owner: " " })] } })
    ).toBeNull();
  });
});

describe("starting one", () => {
  it("checks the start form: a name, and every cap", () => {
    expect(validateKickoff({ title: " ", brief: "", date: "", participants: [] })).toEqual({
      ok: false,
      errors: { title: "Name the kickoff: the team or the work it starts." },
    });
    const bad = validateKickoff({
      title: "x".repeat(201),
      brief: "y".repeat(2001),
      date: "2026-13-45",
      participants: Array.from({ length: 31 }, (_, i) => `P${i}`),
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(Object.keys(bad.errors).sort()).toEqual(["brief", "date", "participants", "title"]);
    expect(
      validateKickoff({
        title: " Checkout squad ",
        brief: " New ",
        date: "2026-11-24",
        participants: ["Ana"],
      })
    ).toEqual({
      ok: true,
      values: { title: "Checkout squad", brief: "New", date: "2026-11-24", participants: ["Ana"] },
    });
  });

  it("fills a Team Canvas's people from the roster, examples left out", () => {
    const people = peopleFromRoster(
      [
        { id: "m1", name: "Ana", role: "Product Owner" },
        { id: exampleId("m2"), name: "Example Eve" },
        { id: "m3", name: "Bo" },
        { id: "m4", name: "ana" },
      ],
      ids
    );
    expect(people.map((p) => [p.owner, p.text])).toEqual([
      ["Ana", "Product Owner"],
      ["Bo", ""],
    ]);
    const canvas = blankKickoff({
      id: "k",
      format: "team-canvas",
      title: "Squad",
      roster: [{ id: "m1", name: "Ana" }],
      now: AT,
      makeId: ids,
    });
    expect(canvas.sections.people).toHaveLength(1);
    expect(canvas.sliders).toBeUndefined();
    expect(canvas).toMatchObject({ status: "draft", createdAt: AT, updatedAt: AT });
  });

  it("starts an Inception deck and Trade-offs with the default sliders", () => {
    for (const format of ["inception", "trade-offs"] as const) {
      const k = blankKickoff({ id: "k", format, title: "T", now: AT, makeId: ids });
      expect(orderedSliders(k).map((s) => s.label)).toEqual([...DEFAULT_SLIDERS]);
    }
  });
});

describe("kickoffGaps", () => {
  it("names empty required sections and lines still holding a placeholder", () => {
    const k = kickoff({
      format: "problem-framing",
      sections: { who: [item("w", "[Which people]")], what: [item("x", "Refunds are slow")] },
    });
    const gaps = kickoffGaps(k).map((g) => g.text);
    expect(gaps).toContain("A line in “Who has the problem” still has [brackets] to fill in.");
    expect(gaps).toContain(
      "No evidence yet. Add what shows the problem is real before you fix it."
    );
    expect(gaps).toContain("Say what good looks like, so you'll know when it's solved.");
  });

  it("flags worries not rated or not covered, owners and roles missing, and the order never set", () => {
    const k = kickoff({
      format: "inception",
      sections: {
        worries: [
          item("w1", "Certification is slow", { likelihood: 4, impact: 5 }),
          item("w2", "Old phones", { likelihood: 2 }),
        ],
        needs: [item("n1", "A partner contact", { covers: "w1" })],
      },
      sliders: [{ id: "s", label: "Scope", position: 1 }],
    });
    const ids = kickoffGaps(k).map((g) => g.id);
    expect(ids).toContain("unrated:worries:w2");
    expect(ids).not.toContain("unrated:worries:w1");
    expect(ids).toContain("uncovered:worries:w2");
    expect(ids).not.toContain("uncovered:worries:w1");
    expect(ids).toContain("owner:needs:n1");
    expect(ids).toContain("sliders");
    expect(kickoffGaps(k).find((g) => g.id === "empty:out-of-scope")?.text).toBe(
      "Nothing is out of scope yet. Saying what you won't do keeps the work small."
    );
    const canvas = kickoff({
      format: "team-canvas",
      sections: {
        people: [item("p1", "", { owner: "Ana" }), item("p2", "Tester", { owner: "Bo" })],
      },
    });
    const gaps = kickoffGaps(canvas);
    expect(gaps.filter((g) => g.id.startsWith("role:")).map((g) => g.text)).toEqual([
      "Ana has no role yet.",
    ]);
  });
});

describe("worries sent on", () => {
  const map = kickoff({
    id: "kickoff_map",
    format: "alignment-map",
    sections: {
      risks: [
        item("r1", "The partner is slow", { likelihood: 4, impact: 3 }),
        item("r2", "Unrated worry"),
      ],
      commitments: [
        item("c1", "Chase the partner weekly", { covers: "r1" }),
        item("c2", "Keep a fallback partner warm", { owner: "Omar", covers: "r1" }),
      ],
      resources: [item("x1", "A partner contact", { covers: "r1" })],
    },
  });

  it("takes the ratings, the covering lines as the mitigation and the first owner", () => {
    expect(worryToRisk(map, map.sections.risks[0])).toEqual({
      title: "The partner is slow",
      likelihood: 4,
      impact: 3,
      mitigation: "Chase the partner weekly; Keep a fallback partner warm; A partner contact",
      owner: "Omar",
      sourceRef: { tool: "kickoff", id: "r1", doc: "kickoff_map" },
    });
    expect(worryToRisk(map, map.sections.risks[1])).toEqual({
      title: "Unrated worry",
      sourceRef: { tool: "kickoff", id: "r2", doc: "kickoff_map" },
    });
  });

  it("finds the worry a line covers, and none while that worry is gone", () => {
    const [chase] = map.sections.commitments;
    expect(coveredWorry(map, chase)?.item.text).toBe("The partner is slow");
    expect(coveredWorry(map, item("c9", "Covers nothing"))).toBeNull();
    // An id that isn't a worry's (here a commitment's) covers nothing.
    expect(coveredWorry(map, item("c9", "Odd", { covers: "c2" }))).toBeNull();
    // The worry deleted: the row keeps the covers ids, the views show none…
    const without = normalizeKickoff({
      ...map,
      sections: { ...map.sections, risks: [map.sections.risks[1]] },
    })!;
    expect(without.sections.commitments.map((c) => c.covers)).toEqual(["r1", "r1"]);
    expect(coveredWorry(without, without.sections.commitments[0])).toBeNull();
    expect(kickoffToMarkdown(without, { today: "2026-11-20" })).not.toContain("(covers:");
    // …and with the worry back (its Undo), every line covers it again.
    const back = normalizeKickoff({
      ...without,
      sections: { ...without.sections, risks: map.sections.risks },
    })!;
    expect(coveringItems(back, "r1").map((c) => c.item.id)).toEqual(["c1", "c2", "x1"]);
    expect(worryToRisk(back, back.sections.risks[0])).toEqual(
      worryToRisk(map, map.sections.risks[0])
    );
  });

  it("keeps example lines and [placeholders] from being sent", () => {
    expect(sendProblem(map, item("a", "Fine"))).toBeNull();
    expect(sendProblem(map, item("a", "[Something]"))).toMatch(/brackets/);
    expect(sendProblem({ ...map, id: exampleId("k") }, item("a", "Fine"))).toMatch(/Example/);
  });

  it("gives each route what fits it", () => {
    const framing = kickoff({
      id: "kickoff_pf",
      title: "Refunds",
      format: "problem-framing",
      sections: {
        evidence: [item("e1", "160 calls"), item("e2", "[A fact]")],
        statement: [item("s1", "Refunds take a week")],
      },
    });
    const statement = framing.sections.statement[0];
    expect(itemSource(framing, statement, "opportunity")).toEqual({
      title: "Refunds take a week",
      description: "160 calls",
      sourceRef: { tool: "kickoff", id: "s1", doc: "kickoff_pf" },
    });
    expect(itemSource(framing, statement, "root-cause").description).toBe(
      "Refunds take a week\n\nHow we know: 160 calls"
    );
    expect(itemSource(framing, statement, "hypothesis")).toEqual({
      title: "Refunds take a week",
      sourceRef: { tool: "kickoff", id: "s1", doc: "kickoff_pf" },
    });
    expect(itemSource(framing, statement, "agreement-rule").description).toBe(
      "From the kickoff “Refunds”."
    );
  });
});

describe("sliders", () => {
  const list = [
    { id: "a", label: "Scope", position: 1 },
    { id: "b", label: "Date", position: 2 },
    { id: "c", label: "Cost", position: 3 },
  ];

  it("move up and down within the list", () => {
    expect(moveSlider(list, "b", -1)!.map((s) => s.label)).toEqual(["Date", "Scope", "Cost"]);
    expect(moveSlider(list, "c", 1)).toBeNull();
    expect(moveSlider(list, "a", -1)).toBeNull();
    expect(moveSlider(list, "b", 1)!.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it("add at the bottom, never twice and never past eight", () => {
    expect(withSlider(list, "Easy to use", () => "d")!.at(-1)).toEqual({
      id: "d",
      label: "Easy to use",
      position: 4,
    });
    expect(withSlider(list, " scope ")).toBeNull();
    const eight = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      label: `L${i}`,
      position: i + 1,
    }));
    expect(withSlider(eight, "Ninth")).toBeNull();
  });

  it("take an order by label, adding new ones and keeping the rest after", () => {
    const r = withSliderOrder(list, ["cost", "Quality"], () => "q");
    expect(r.ok && r.sliders.map((s) => [s.label, s.position])).toEqual([
      ["Cost", 1],
      ["Quality", 2],
      ["Scope", 3],
      ["Date", 4],
    ]);
    expect(withSliderOrder(list, ["Cost", "cost "])).toEqual({ ok: false, reason: "duplicate" });
    const many = Array.from({ length: 6 }, (_, i) => `New ${i}`);
    expect(withSliderOrder(list, many)).toEqual({ ok: false, reason: "too_many" });
  });

  it("say what holds firm and what gives first, and go to the Decision Log in order", () => {
    const k = kickoff({ id: "kickoff_t", title: "Tap", format: "trade-offs", sliders: list });
    expect(sliderSummary(k)).toBe("Holds firm: Scope. Gives first: Cost.");
    expect(slidersDecisionSource(k)).toEqual({
      title: "Trade-offs for Tap",
      description: "Holds firm: Scope. Gives first: Cost.",
      decision: { options: ["Scope", "Date", "Cost"] },
      sourceRef: { tool: "kickoff", id: "kickoff_t:sliders", doc: "kickoff_t" },
    });
  });
});

describe("problem framing", () => {
  const framing = (sections: Kickoff["sections"]) =>
    kickoff({ format: "problem-framing", sections });

  it("builds the statement from who, what, when and where, and the cost", () => {
    expect(statementFrom(framing({ who: [item("a", "Buyers")] }))).toBeNull();
    expect(
      statementFrom(
        framing({
          who: [item("a", "Buyers who return an item")],
          what: [item("b", "Their refund takes a week.")],
          "when-where": [item("c", "After a return at the counter")],
          impact: [item("d", "Forty calls a week")],
        })
      )
    ).toBe(
      "For buyers who return an item, their refund takes a week (after a return at the counter). That costs forty calls a week."
    );
    // An acronym keeps its capitals; a placeholder doesn't count as an answer.
    expect(
      statementFrom(framing({ who: [item("a", "API users")], what: [item("b", "Timeouts")] }))
    ).toBe("For API users, timeouts.");
    expect(
      statementFrom(framing({ who: [item("a", "[Which people]")], what: [item("b", "x")] }))
    ).toBeNull();
  });

  it("offers up to three How might we… questions not in the list yet", () => {
    const k = framing({
      who: [item("a", "Buyers")],
      what: [item("b", "Refunds take a week")],
      impact: [item("c", "Forty calls a week")],
      outcome: [item("d", "Buyers see their money the same day")],
    });
    const starters = hmwStarters(k);
    expect(starters).toEqual([
      "How might we help buyers so that buyers see their money the same day?",
      "How might we change what happens today: refunds take a week?",
      "How might we lower what it costs: forty calls a week?",
    ]);
    const some = framing({ ...k.sections, hmw: [item("h", starters[0])] });
    expect(hmwStarters(some)).toEqual(starters.slice(1));
  });

  it("asks a question from what good looks like alone, as the hint says", () => {
    const outcome = [item("d", "Buyers see their money the same day.")];
    expect(hmwStarters(framing({ outcome }))).toEqual([
      "How might we get to this: buyers see their money the same day?",
    ]);
    // With who too, the outcome goes into who's question instead.
    expect(hmwStarters(framing({ outcome, who: [item("a", "Buyers")] }))).toEqual([
      "How might we help buyers so that buyers see their money the same day?",
    ]);
    // A placeholder isn't an answer.
    expect(hmwStarters(framing({ outcome: [item("d", "[What good looks like]")] }))).toEqual([]);
  });
});

describe("drafted lines", () => {
  it("drop unknown sections, full single answers, the team's people and repeats", () => {
    const k = kickoff({
      format: "team-canvas",
      sections: { purpose: [item("p", "We're here")], goals: [item("g", "Ship weekly")] },
    });
    const { lines, dropped } = draftItemsFor(
      KICKOFF_FORMAT_DEFS["team-canvas"],
      [
        { section: "purpose", text: "Another purpose" },
        { section: "people", text: "Ana" },
        { section: "nowhere", text: "Lost" },
        { section: "goals", text: "ship  weekly" },
        { section: "values", text: "Kindness" },
        { section: "values", text: "kindness" },
      ],
      k
    );
    expect(lines).toEqual([{ sectionId: "values", text: "Kindness" }]);
    expect(dropped).toBe(1);
  });

  it("fill an empty single answer, and come out again with Undo", () => {
    const k = kickoff({ format: "alignment-map" });
    const {
      kickoff: next,
      added,
      skipped,
    } = withDraftLines(
      k,
      [
        { sectionId: "mission", text: "By spring, we ship." },
        { sectionId: "mission", text: "A second aim" },
        { sectionId: "objectives", text: "A pilot" },
      ],
      LATER,
      ids
    );
    expect(next.sections.mission.map((i) => i.text)).toEqual(["By spring, we ship."]);
    expect(next.sections.objectives.map((i) => i.text)).toEqual(["A pilot"]);
    expect(skipped).toBe(1);
    expect(next.updatedAt).toBe(LATER);
    const back = removeDraftLines(next.sections, added);
    expect(back.mission).toEqual([]);
    expect(back.objectives).toEqual([]);
  });

  it("offer only sliders that aren't on the list, within its room", () => {
    const k = kickoff({ format: "inception", sliders: [{ id: "a", label: "Scope", position: 1 }] });
    expect(draftSlidersFor(k, ["scope", "Easy to use", "Easy to use", ""])).toEqual([
      "Easy to use",
    ]);
  });
});

describe("status and purpose", () => {
  it("agrees, notices a change after, and goes back to draft", () => {
    const k = withStatus(kickoff({ format: "trade-offs" }), "agreed", AT);
    expect(k).toMatchObject({ status: "agreed", agreedAt: AT });
    expect(changedSinceAgreed(k)).toBe(false);
    expect(changedSinceAgreed({ ...k, updatedAt: LATER })).toBe(true);
    const back = withStatus(k, "draft", LATER);
    expect(back.status).toBe("draft");
    expect(back.agreedAt).toBeUndefined();
  });

  it("reads the team's purpose from the newest agreed Team Canvas, never an example", () => {
    const canvas = (
      id: string,
      purpose: string,
      agreedAt: string,
      status: "agreed" | "draft" = "agreed"
    ) =>
      kickoff({
        id,
        format: "team-canvas",
        status,
        agreedAt,
        sections: { purpose: [item(`${id}-p`, purpose)] },
      });
    expect(teamPurpose([])).toBeNull();
    expect(
      teamPurpose([
        canvas("a", "Old purpose", AT),
        canvas("b", "New purpose", LATER),
        canvas(exampleId("c"), "Example purpose", "2026-12-01T00:00:00.000Z"),
        canvas("d", "Draft purpose", "2026-12-02T00:00:00.000Z", "draft"),
      ])
    ).toEqual({ kickoffId: "b", text: "New purpose" });
  });
});

describe("the example", () => {
  it("is three kickoffs with example ids throughout, read as they are, no placeholder left", () => {
    const example = buildExample(new Date(AT));
    expect(example.map((k) => k.format)).toEqual(["inception", "team-canvas", "problem-framing"]);
    for (const k of example) {
      expect(isExampleId(k.id)).toBe(true);
      expect(normalizeKickoff(k)).toEqual(k);
      for (const items of Object.values(k.sections)) {
        for (const i of items) {
          expect(isExampleId(i.id), i.id).toBe(true);
          expect(hasPlaceholder(i.text), i.text).toBe(false);
        }
      }
    }
    const [tap, squad] = example;
    expect(orderedSliders(tap).map((s) => s.label)).toEqual(["Date", "Quality", "Cost", "Scope"]);
    expect(squad.sections.people).toHaveLength(4);
    expect(squad.sections.rules).toHaveLength(3);
    expect(squad.sections.weaknesses).toHaveLength(2);
    expect(tap.sections.neighbours.map((i) => i.text).join(" ")).toMatch(
      /Support.*card partner.*Legal/
    );
  });
});

describe("the Markdown", () => {
  it("holds the header, each section with owners, ratings and covers, the trade-offs and the credit", () => {
    const [tap, squad, refunds] = buildExample(new Date(AT));
    const md = kickoffToMarkdown(tap, { today: "2026-11-20" });
    expect(md).toMatch(
      /^# Tap to pay on phones\n\nInception deck · 14 Nov 2026 · Draft\n\nParticipants: Maya, Omar, Lena, Ravi/
    );
    expect(md).toContain("## What worries us");
    expect(md).toContain(
      "- The card partner's certification takes longer than five sprints · likely 4/5 · impact 5/5"
    );
    expect(md).toContain(
      "- A contact at the card partner who answers within a day (Omar) (covers: The card partner's certification takes longer than five sprints)"
    );
    expect(md).toContain("| Order | Trade-off | Note |");
    expect(md).toContain("| 1 (holds firm) | Date | The market season starts in spring |");
    expect(md).toContain("| 4 (gives first) | Scope | Cut features, not the date |");
    expect(md).toContain("Inspired by Jonathan Rasmusson's Inception Deck (The Agile Samurai)");
    expect(md.trimEnd().endsWith("Exported 20 Nov 2026.")).toBe(true);
    const canvas = kickoffToMarkdown(squad, { today: "2026-11-20" });
    expect(canvas).toContain("Agreed 9 Nov 2026");
    expect(canvas).toContain("- Maya: Product Owner");
    const framing = kickoffToMarkdown(
      {
        ...refunds,
        sections: { ...refunds.sections, statement: [item("s", "For buyers, refunds are slow.")] },
      },
      { today: "2026-11-20" }
    );
    expect(framing).toContain("## The problem statement\n\n> For buyers, refunds are slow.");
    expect(kickoffToMarkdown(null, { today: "2026-11-20" })).toContain("No kickoff yet.");
  });

  it("says the agreed day where the reader is, as the page does, east and west of UTC", () => {
    const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    // 20:30 UTC on the 20th is the 21st in Tokyo; 03:30 UTC on the 21st is the 20th in Los Angeles.
    const cases = [
      ["Asia/Tokyo", "2026-11-20T20:30:00.000Z", "21 Nov 2026"],
      ["America/Los_Angeles", "2026-11-21T03:30:00.000Z", "20 Nov 2026"],
    ] as const;
    try {
      for (const [tz, agreedAt, day] of cases) {
        process.env.TZ = tz;
        const k = kickoff({ format: "trade-offs", status: "agreed", agreedAt, date: "2026-11-16" });
        expect(dayLabel(agreedAt)).toBe(day);
        const md = kickoffToMarkdown(k, { today: "2026-11-22" });
        expect(md).toContain(`Agreed ${day}`);
        // A plain day stays that day everywhere.
        expect(md).toContain("16 Nov 2026");
        expect(md).toContain("Exported 22 Nov 2026.");
      }
    } finally {
      process.env.TZ = zone;
    }
    expect(dayLabel("not a day")).toBe("");
    expect(dayLabel(undefined)).toBe("");
  });

  it("escapes a pipe in a trade-off and collapses lines", () => {
    const k = kickoff({
      format: "trade-offs",
      sliders: [
        { id: "a", label: "Scope | size", position: 1, note: "two\nlines" },
        { id: "b", label: "Date", position: 2 },
      ],
      sections: { notes: [item("n", "One\nline")] },
    });
    const md = kickoffToMarkdown(k, { today: "2026-11-20" });
    expect(md).toContain("| 1 (holds firm) | Scope \\| size | two lines |");
    expect(md).toContain("- One line");
  });
});

describe("caps", () => {
  it("every format fits the kit's caps", () => {
    for (const f of KICKOFF_FORMAT_LIST) {
      expect(f.sections.length).toBeLessThanOrEqual(TOOL_LIST_MAX.sections);
      for (const d of f.sections) expect(d.max).toBeLessThanOrEqual(TOOL_LIST_MAX.sectionItems);
    }
  });
});
