import { describe, expect, it } from "vitest";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import type { Story } from "@/lib/stores/workspace-types";
import type { StorySave } from "@/app/(tools)/refinement/store";
import { passRateRecords } from "@/app/(tools)/refinement/session";
import { EXAMPLE_NOTES, EXAMPLE_REFERENCE_STORIES } from "@/app/(tools)/estimation-guide/example";
import {
  baselineReferences,
  charterCards,
  charterMarkdown,
  dorPassRate,
  estimationCoverage,
  type CharterCardId,
  type CharterDocs,
  type DorDoc,
  type EstimationDoc,
} from "@/app/(meta)/team/charter-view";

/**
 * The Team charter's Definition of Ready and estimation baseline cards read
 * the workspace's stories as well as the tools' own stores: refinement
 * checks live on the stories (`Story.readiness`) since the session, and the
 * guide pins done stories as each card's reference.
 */

const C = [
  { id: "c1", label: "Acceptance criteria defined" },
  { id: "c2", label: "Fits in a sprint" },
];

/** A local stamp on 2026-10-<day>, so the check's local day is that day in any time zone. */
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

const story = (id: string, extra: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "backlog",
  ...extra,
});

/** A story checked in the refinement session on `day`, with `met` ticked. */
const checked = (id: string, met: string[], day: number, extra: Partial<Story> = {}): Story =>
  story(id, { readiness: { checked: met, ready: false, updatedAt: at(day) }, ...extra });

/** A check saved by name on `day`. */
const check = (id: string, day: number, metCount: number, totalCriteria = 2): StorySave => ({
  id,
  storyName: `Check ${id}`,
  date: `2026-10-${String(day).padStart(2, "0")}`,
  checks: [],
  totalCriteria,
  metCount,
  passRate: totalCriteria > 0 ? Math.round((metCount / totalCriteria) * 100) : 0,
});

const dor = (history: StorySave[] = [], criteria = C): DorDoc => ({ criteria, history });

const FIB: EstimationDoc = { selectedScale: "Fibonacci", descriptions: {}, examples: {} };

const docs = (extra: Partial<CharterDocs>): CharterDocs => ({
  members: [],
  cadence: DEFAULT_CADENCE,
  agreement: undefined,
  dod: { items: [], history: [] },
  dor: dor(),
  estimation: FIB,
  ...extra,
});

const card = (d: CharterDocs, id: CharterCardId) => {
  const found = charterCards(d).find((c) => c.id === id);
  if (!found) throw new Error(`no ${id} card`);
  return found;
};

describe("Definition of Ready pass rate", () => {
  it("is empty without checks", () => {
    expect(dorPassRate(dor(), [])).toBeNull();
    // Stories never checked, and a check saved while the list was empty, say nothing.
    expect(dorPassRate(dor([check("h", 3, 0, 0)]), [story("s")])).toBeNull();
    expect(card(docs({ dor: dor([], []) }), "dor")).toMatchObject({
      status: "No checks yet",
      empty: true,
    });
    // Criteria written, nothing checked against them yet: no rate to show.
    expect(card(docs({ stories: [story("s")] }), "dor")).toMatchObject({ status: "2 checks" });
    expect(card(docs({ stories: [story("s")] }), "dor").detail).toBeUndefined();
  });

  it("legacy only: averages the latest ten checks saved by name", () => {
    // Newest first, as the store keeps them: the two oldest failed.
    const history = Array.from({ length: 12 }, (_, i) => check(`h${i}`, 23 - i, i < 10 ? 2 : 0));
    expect(dorPassRate(dor(history))).toEqual({ rate: 100, checks: 10 });
    expect(card(docs({ dor: dor(history) }), "dor")).toMatchObject({
      status: "2 checks",
      detail: "100% pass rate over the last 10 stories",
    });
  });

  it("readiness only: each story's latest check, newest by updatedAt, against today's criteria", () => {
    // Ten passing checks and one older failing one outside the window.
    const stories = [
      checked("oldest", [], 1),
      ...Array.from({ length: 10 }, (_, i) => checked(`s${i}`, ["c1", "c2"], 10 + i)),
      story("never-checked"),
    ];
    expect(dorPassRate(dor(), stories)).toEqual({ rate: 100, checks: 10 });

    // A criterion deleted since the check no longer counts.
    const two = [checked("a", ["c1", "gone"], 5), checked("b", ["c1", "c2"], 6)];
    expect(dorPassRate(dor(), two)).toEqual({ rate: 75, checks: 2 });
    expect(card(docs({ dor: dor(), stories: two }), "dor").detail).toBe(
      "75% pass rate over the last 2 stories"
    );

    // Same day: the later stamp is the newer check, whatever the stored order.
    const sameDay = [
      story("late", { readiness: { checked: ["c1", "c2"], ready: true, updatedAt: at(20, 15) } }),
      story("early", { readiness: { checked: [], ready: false, updatedAt: at(20, 9) } }),
    ];
    expect(dorPassRate(dor(), sameDay, 1)).toEqual({ rate: 100, checks: 1 });
  });

  it("both: one series, newest first, with a check sent to the backlog counted once", () => {
    const history = [check("h-sent", 18, 0), check("h-old", 10, 1)];
    const stories = [
      // "Add to backlog" made this story from h-sent; it has been checked since.
      checked("promoted", ["c1", "c2"], 19, { sourceRef: { tool: "refinement", id: "h-sent" } }),
      checked("s", ["c1"], 15),
    ];
    // h-old 50%, s 50%, promoted 100%; h-sent is the promoted story's.
    expect(dorPassRate(dor(history), stories)).toEqual({ rate: 67, checks: 3 });
    // The newest two: promoted, then s.
    expect(dorPassRate(dor(history), stories, 2)).toEqual({ rate: 75, checks: 2 });

    // The same records the Refinement page charts.
    const page = passRateRecords(stories, history, C).slice(-10);
    const mean = Math.round(page.reduce((n, r) => n + r.passRate, 0) / page.length);
    expect(dorPassRate(dor(history), stories)?.rate).toBe(mean);
    expect(card(docs({ dor: dor(history), stories }), "dor").detail).toBe(
      "67% pass rate over the last 3 stories"
    );
  });

  it("never counts example stories or checks", () => {
    const stories = [checked("example-refinement-1", [], 20), checked("own", ["c1", "c2"], 19)];
    const history = [check("example-h", 21, 0), check("h", 18, 2)];
    expect(dorPassRate(dor(history), stories)).toEqual({ rate: 100, checks: 2 });
    expect(dorPassRate(dor([check("example-h", 21, 0)]), [stories[0]])).toBeNull();
  });

  it("counts only checks by name while the Definition of Ready has no criteria, like the page", () => {
    const d = dor([check("h", 3, 1)], []);
    expect(dorPassRate(d, [checked("s", ["c1"], 4)])).toEqual({ rate: 50, checks: 1 });
    expect(card(docs({ dor: d, stories: [checked("s", ["c1"], 4)] }), "dor")).toMatchObject({
      status: "No checks yet",
      detail: "50% pass rate over the last 1 story",
    });
  });
});

describe("estimation baseline", () => {
  const done = (id: string, title: string, points: number): Story =>
    story(id, { title, points, status: "done" });
  const STORIES = [
    done("s3", "Add a field to the form", 3),
    done("s8a", "Retry failed card payments", 8),
    done("s8b", "Pay by bank", 8),
  ];
  const example8 = EXAMPLE_REFERENCE_STORIES.find((s) => s.points === 8)!.id;

  it("is empty with built-in meanings only, also for a guide saved before pins", () => {
    for (const est of [FIB, { ...FIB, referenceStoryIds: {} }]) {
      expect(baselineReferences(est, STORIES)).toEqual([]);
      expect(estimationCoverage(est, STORIES)).toMatchObject({ references: 0, pinnedCards: 0 });
      const c = card(docs({ estimation: est, stories: STORIES }), "estimation");
      expect(c).toMatchObject({ empty: true, status: "Fibonacci · built-in meanings only" });
      expect(c.detail).toBeUndefined();
      expect(c.references).toBeUndefined();
    }
  });

  it("pins only: counts and lists the reference stories card by card, in scale order", () => {
    const est: EstimationDoc = {
      ...FIB,
      referenceStoryIds: { "Fibonacci:8": ["s8b", "s8a"], "Fibonacci:3": ["s3"] },
    };
    const refs = [
      { value: "3", stories: [{ id: "s3", title: "Add a field to the form", drift: null }] },
      {
        value: "8",
        stories: [
          { id: "s8b", title: "Pay by bank", drift: null },
          { id: "s8a", title: "Retry failed card payments", drift: null },
        ],
      },
    ];
    expect(baselineReferences(est, STORIES)).toEqual(refs);
    expect(card(docs({ estimation: est, stories: STORIES }), "estimation")).toMatchObject({
      empty: false,
      status: "Fibonacci · built-in meanings only",
      detail: "3 reference stories on 2 cards",
      references: refs,
      href: "/estimation-guide",
    });
    // Without the workspace's stories there are no titles to show.
    expect(card(docs({ estimation: est }), "estimation").references).toBeUndefined();
  });

  it("leaves out example pins, pins whose story is gone and other scales' pins", () => {
    const est: EstimationDoc = {
      ...FIB,
      referenceStoryIds: {
        "Fibonacci:8": [example8, "deleted", "s8a"],
        "Fibonacci:5": [EXAMPLE_REFERENCE_STORIES.find((s) => s.points === 5)!.id],
        "Powers of 2:8": ["s8b"],
      },
    };
    expect(baselineReferences(est, STORIES)).toEqual([
      { value: "8", stories: [{ id: "s8a", title: "Retry failed card payments", drift: null }] },
    ]);
    expect(card(docs({ estimation: est, stories: STORIES }), "estimation").detail).toBe(
      "1 reference story on 1 card"
    );
    // Only the example's pins: nothing of the team's yet.
    const exampleOnly = { ...FIB, referenceStoryIds: { "Fibonacci:8": [example8] } };
    expect(card(docs({ estimation: exampleOnly, stories: STORIES }), "estimation").empty).toBe(
      true
    );
  });

  it("follows a renamed story and says when a pin moved off its card", () => {
    const stories = [
      done("s8a", "Retry a declined card once", 5),
      story("s8b", { title: "Pay by bank", points: 8, status: "in_progress" }),
    ];
    const est: EstimationDoc = { ...FIB, referenceStoryIds: { "Fibonacci:8": ["s8a", "s8b"] } };
    expect(baselineReferences(est, stories)[0].stories).toEqual([
      { id: "s8a", title: "Retry a declined card once", drift: "now 5 pts" },
      { id: "s8b", title: "Pay by bank", drift: "not done now" },
    ]);
    expect(charterMarkdown(docs({ estimation: est, stories }), "2026-10-23")).toContain(
      "|  | Retry a declined card once (now 5 pts); Pay by bank (not done now) |"
    );
  });

  it("examples only: counts the team's own, not the guide's example text", () => {
    const est: EstimationDoc = {
      ...FIB,
      examples: { "Fibonacci:3": "Add a field | to the form", "Fibonacci:8": EXAMPLE_NOTES["8"] },
    };
    expect(estimationCoverage(est)).toMatchObject({ examples: 1, references: 0 });
    expect(card(docs({ estimation: est }), "estimation")).toMatchObject({
      empty: false,
      detail: "1 team example",
    });
    const md = charterMarkdown(docs({ estimation: est }), "2026-10-23");
    expect(md).toContain("| Value | Means | Team example | Reference stories |");
    expect(md).toContain("| Add a field \\| to the form |  |");
    expect(md).not.toContain(EXAMPLE_NOTES["8"]);
  });

  it("both: names team examples and reference stories apart, and exports both", () => {
    const est: EstimationDoc = {
      selectedScale: "Fibonacci",
      descriptions: { "Fibonacci:8": "A week for two of us" },
      examples: { "Fibonacci:8": "Card retries" },
      referenceStoryIds: { "Fibonacci:8": ["s8a", "s8b"] },
    };
    const c = card(docs({ estimation: est, stories: STORIES }), "estimation");
    expect(c).toMatchObject({
      status: expect.stringMatching(/^Fibonacci · 1 of \d+ values in the team's words$/),
      detail: "1 team example · 2 reference stories on 1 card",
    });
    expect(c.references?.map((r) => r.value)).toEqual(["8"]);
    expect(charterMarkdown(docs({ estimation: est, stories: STORIES }), "2026-10-23")).toContain(
      "| 8 | A week for two of us | Card retries | Retry failed card payments; Pay by bank |"
    );
  });
});
