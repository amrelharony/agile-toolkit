import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import {
  charterCards,
  charterMarkdown,
  estimationCoverage,
  recentPassRate,
  type CharterDocs,
} from "@/app/(meta)/team/charter-view";

const EMPTY: CharterDocs = {
  members: [],
  cadence: DEFAULT_CADENCE,
  agreement: undefined,
  dod: { items: [], history: [] },
  dor: { criteria: [], history: [] },
  estimation: { selectedScale: "Fibonacci", descriptions: {}, examples: {} },
};

const FULL: CharterDocs = {
  members: [
    { id: "m1", name: "Ann", role: "Dev", capacityPct: 80 },
    { id: "m2", name: "Bob" },
  ],
  cadence: { ...DEFAULT_CADENCE, dailyTime: "10:00", refinement: null },
  agreement: {
    id: "workingAgreement:current",
    rules: [
      { id: "r1", category: "communication", text: "Core hours 10–15", agreedBy: ["Ann", "Bob"] },
      { id: "r2", category: "meetings", text: "Cameras on | optional", agreedBy: [] },
    ] as CharterDocs["agreement"] extends infer A
      ? A extends { rules: infer R }
        ? R
        : never
      : never,
    meta: { version: 3, publishedAt: "2026-10-01T10:00:00.000Z", teamName: "Checkout" },
  },
  dod: {
    items: [
      { id: "d1", label: "Code reviewed", category: "code", required: true },
      { id: "d2", label: "Docs updated", category: "docs", required: false },
    ],
    history: [{ sprintName: "Sprint 1", totalRequired: 1, completed: 1, ts: "2026-10-01" }],
  },
  dor: {
    criteria: [
      { id: "c1", label: "Acceptance criteria defined" },
      { id: "c2", label: "Estimated by team" },
    ],
    history: [
      {
        id: "h1",
        storyName: "A",
        date: "2026-10-20",
        checks: [],
        totalCriteria: 2,
        metCount: 2,
        passRate: 100,
      },
      {
        id: "h2",
        storyName: "B",
        date: "2026-10-19",
        checks: [],
        totalCriteria: 2,
        metCount: 1,
        passRate: 50,
      },
    ],
  },
  estimation: {
    selectedScale: "Fibonacci",
    descriptions: {
      "Fibonacci:1": "Our tiniest change",
      "Fibonacci:3": "About a day for one of us",
    },
    examples: { "Fibonacci:3": "Add a field to the form" },
  },
};

describe("charterCards", () => {
  it("says what is missing when nothing is agreed yet", () => {
    const cards = charterCards(EMPTY);
    expect(cards.map((c) => c.id)).toEqual(["agreement", "dod", "dor", "estimation"]);
    expect(cards.every((c) => c.empty)).toBe(true);
    expect(cards[0].status).toBe("No rules agreed yet");
    expect(cards[1].status).toBe("Not written yet");
    expect(cards[2].status).toBe("No checks yet");
    expect(cards[3].status).toBe("Fibonacci · built-in meanings only");
  });

  it("summarises each agreement", () => {
    const [agreement, dod, dor, estimation] = charterCards(FULL);
    expect(agreement).toMatchObject({
      empty: false,
      status: "2 rules · 1 with everyone's consent",
      detail: "Version 3, published 2026-10-01",
    });
    // No sprint has closed with per-story ticks: the old snapshot, named as such.
    expect(dod).toMatchObject({
      status: "2 criteria · 1 required",
      detail: "Old team-level tally: Sprint 1, 1 of 1 required met",
    });
    expect(dor).toMatchObject({
      status: "2 checks",
      detail: "75% pass rate over the last 2 stories",
    });
    expect(estimation.status).toMatch(/^Fibonacci · 2 of \d+ values in the team's words$/);
    // The guide's free-text example column; pinned stories are counted apart.
    expect(estimation.detail).toBe("1 team example");
    expect(estimation.references).toBeUndefined();
  });
});

describe("the working agreement card", () => {
  const ROSTER: CharterDocs["members"] = [
    { id: "m1", name: "Ann" },
    { id: "m2", name: "Bob" },
    { id: "m3", name: "Cy" },
  ];
  const vote = (name: string, v: "consent" | "concern" | "object") => ({
    name,
    vote: v,
    at: "2026-10-01T09:00:00.000Z",
  });
  const rule = (id: string, consent: ReturnType<typeof vote>[]) => ({
    id,
    category: "work" as const,
    text: `Rule ${id}`,
    agreedBy: consent.filter((c) => c.vote === "consent").map((c) => c.name),
    consent,
  });
  const agreement = (extra: Partial<NonNullable<CharterDocs["agreement"]>> = {}) =>
    charterCards({
      ...EMPTY,
      members: ROSTER,
      agreement: {
        id: "workingAgreement:current",
        rules: [
          // Everyone answered; a concern still consents.
          rule("r1", [vote("Ann", "consent"), vote("Bob", "concern"), vote("Cy", "consent")]),
          // Cy hasn't answered.
          rule("r2", [vote("Ann", "consent"), vote("Bob", "consent")]),
          // Bob objects.
          rule("r3", [vote("Ann", "consent"), vote("Bob", "object"), vote("Cy", "consent")]),
        ],
        meta: { version: 2, publishedAt: "2026-10-05T10:00:00.000Z" },
        ...extra,
      },
    })[0];

  it("counts the rules with everyone on the roster's consent, and the objections", () => {
    expect(agreement().status).toBe("3 rules · 1 with everyone's consent · 1 with an objection");
  });

  it("says when nobody has answered yet, rather than none consenting", () => {
    const card = charterCards({
      ...EMPTY,
      members: ROSTER,
      agreement: {
        id: "workingAgreement:current",
        rules: [rule("r1", [])],
        meta: { version: 0 },
      },
    })[0];
    expect(card.status).toBe("1 rule · nobody has given consent yet");
    // Version 0 is a draft, not a version.
    expect(card.detail).toBe("Not published yet");
  });

  it("adds what the last saved check-in found to the version", () => {
    const card = agreement({
      checkIns: [
        {
          id: "c2",
          date: "2026-10-20",
          version: 2,
          results: { r1: "working", r2: "not_working", r3: "working" },
        },
        { id: "c1", date: "2026-10-06", version: 2, results: { r1: "not_working" } },
      ],
    });
    expect(card.detail).toBe(
      "Version 2, published 2026-10-05 · Last check-in 2026-10-20: 2 of 3 rules working"
    );
  });
});

describe("the Definition of Done card", () => {
  const DOD: CharterDocs["dod"] = {
    items: [
      { id: "d1", label: "Code reviewed", category: "code", required: true },
      { id: "d2", label: "Tests pass", category: "testing", required: true },
      { id: "d3", label: "Docs updated", category: "docs", required: false },
    ],
    history: [{ sprintName: "Sprint 1", totalRequired: 2, completed: 1, ts: "2026-08-01" }],
  };
  const sprint = (
    id: string,
    endDate: string,
    status: Sprint["status"] = "completed",
    name = `Sprint ${id}`
  ): Sprint => ({ id, name, startDate: "2026-09-01", endDate, pointsPlanned: 10, status });
  const done = (id: string, sprintId: string, checked: string[]): Story => ({
    id,
    title: `Story ${id}`,
    status: "done",
    sprintId,
    ...(checked.length > 0 ? { dodChecks: { checked, updatedAt: "2026-10-01" } } : {}),
  });
  const detail = (extra: Partial<CharterDocs>) =>
    charterCards({ ...EMPTY, dod: DOD, ...extra })[1].detail;

  it("reports the latest completed sprint's done stories, ticked on their cards", () => {
    const sprints = [
      sprint("7", "2026-10-14"),
      sprint("6", "2026-09-30"),
      // Neither an open, a cancelled nor an example sprint is the latest completed one.
      sprint("8", "2026-10-28", "active"),
      sprint("9", "2026-10-21", "cancelled"),
      sprint("example-preview-sprint-1", "2026-10-25", "completed", "Example sprint"),
    ];
    const stories: Story[] = [
      done("a", "7", ["d1", "d2"]),
      done("b", "7", ["d1", "d2", "d3"]),
      done("c", "7", ["d1", "d2"]),
      done("d", "7", ["d2"]),
      // An example story never counts.
      done("example-e", "7", []),
      // Another sprint's, and one not done yet.
      done("f", "6", []),
      { id: "g", title: "Story g", status: "in_progress", sprintId: "7" },
    ];
    expect(detail({ sprints, stories })).toBe("Sprint 7: 3 of 4 done stories meet it (75%)");
  });

  it("quotes no percentage below the minimum sample", () => {
    const sprints = [sprint("7", "2026-10-14")];
    expect(
      detail({ sprints, stories: [done("a", "7", ["d1"]), done("b", "7", ["d1", "d2"])] })
    ).toBe("Sprint 7: 1 of 2 done stories meet it");
    expect(detail({ sprints, stories: [done("a", "7", ["d1", "d2"])] })).toBe(
      "Sprint 7: 1 of 1 done story meets it"
    );
  });

  it("says when the latest completed sprint had no story done", () => {
    expect(detail({ sprints: [sprint("7", "2026-10-14")], stories: [] })).toBe(
      "Sprint 7: no story was done"
    );
  });

  it("falls back to the old team-level tally, named as such, without a completed sprint", () => {
    expect(detail({ sprints: [sprint("8", "2026-10-28", "active")] })).toBe(
      "Old team-level tally: Sprint 1, 1 of 2 required met"
    );
    expect(detail({ dod: { items: DOD.items, history: [] } })).toBeUndefined();
  });

  it("has nothing to report per story when no criterion is required", () => {
    const optional = { items: [{ ...DOD.items[2] }], history: [] };
    expect(
      detail({ dod: optional, sprints: [sprint("7", "2026-10-14")], stories: [done("a", "7", [])] })
    ).toBeUndefined();
  });
});

describe("helpers", () => {
  it("counts described values on the chosen scale, bare keys included", () => {
    const cov = estimationCoverage({
      selectedScale: "Fibonacci",
      descriptions: { "Fibonacci:5": "x", "8": "legacy" },
      examples: {},
    });
    expect(cov.described).toBe(2);
    expect(cov.examples).toBe(0);
  });

  it("averages the latest ten checks", () => {
    expect(recentPassRate([])).toBeNull();
    expect(
      recentPassRate(
        Array.from({ length: 12 }, (_, i) => ({
          passRate: i < 10 ? 100 : 0,
          date: "",
          storyName: "",
        }))
      )
    ).toBe(100);
  });
});

describe("charterMarkdown", () => {
  it("writes the whole charter as one document", () => {
    const md = charterMarkdown(FULL, "2026-10-22");
    expect(md.startsWith("# Checkout — team charter\n")).toBe(true);
    expect(md).toContain("- Ann (Dev, 80% capacity)");
    expect(md).toContain("- Daily Scrum: 10:00, Mon, Tue, Wed, Thu, Fri");
    expect(md).toContain("- Backlog Refinement: no fixed slot");
    expect(md).toContain("- Core hours 10–15 _(communication)_ — agreed by Ann, Bob");
    expect(md).toContain("## Definition of Ready\n\n- Acceptance criteria defined");
    expect(md).toContain("**Code**\n- Code reviewed\n\n**Docs**\n- Docs updated _(optional)_");
    expect(md).toContain("| 3 | About a day for one of us | Add a field to the form |");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("says plainly what is missing", () => {
    const md = charterMarkdown(EMPTY, "2026-10-22");
    expect(md).toContain("# Team charter");
    expect(md).toContain("No members listed yet.");
    expect(md).toContain("No rules agreed yet.");
    expect(md).toContain("Not written yet.");
  });
});
