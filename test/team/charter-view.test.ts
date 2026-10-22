import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
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
      { passRate: 100, date: "2026-10-20", storyName: "A" },
      { passRate: 50, date: "2026-10-19", storyName: "B" },
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
      status: "2 rules · 1 agreed by name",
      detail: "Version 3, published 2026-10-01",
    });
    expect(dod).toMatchObject({
      status: "2 criteria · 1 required",
      detail: "Last check: Sprint 1, 1 of 1 required met",
    });
    expect(dor).toMatchObject({
      status: "2 checks",
      detail: "75% pass rate over the last 2 stories",
    });
    expect(estimation.status).toMatch(/^Fibonacci · 2 of \d+ values in the team's words$/);
    expect(estimation.detail).toBe("1 reference story");
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
