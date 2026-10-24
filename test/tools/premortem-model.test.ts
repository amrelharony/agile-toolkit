import { describe, it, expect } from "vitest";
import {
  EMPTY_PREMORTEM_STATE,
  LEGACY_PREMORTEM_ID,
  causeScore,
  compareCauses,
  mergeCause,
  normalizePremortemState,
  pickPremortem,
  rankCauses,
  scoreText,
  setVotes,
  splitCause,
  topCauses,
  unmergeCause,
  votesById,
  withVotes,
  type Premortem,
  type PremortemCause,
  type PremortemState,
} from "@/app/(tools)/premortem/model";
import { linkOptions, linkText, resolveLink } from "@/app/(tools)/premortem/links";
import { toMarkdown } from "@/app/(tools)/premortem/markdown";
import { premortemVerdict } from "@/app/(tools)/premortem/verdict";
import { buildExample, withoutExample } from "@/app/(tools)/premortem/example";
import type { EpicRoadmap, ReleaseReadiness } from "@/lib/stores/workspace-types";

/**
 * Premortem logic: the normalizer that reads the old single premortem and
 * any stored shape, the one ranking (votes, then likelihood × impact), the
 * top 3 and ties at the cut-off, grouping duplicates and splitting them,
 * the verdict per phase, links to releases and epics, and the Markdown.
 */

const cause = (id: string, text: string, over: Partial<PremortemCause> = {}): PremortemCause => ({
  id,
  text,
  ...over,
});

const pm = (over: Partial<Premortem> = {}): Premortem => ({
  id: "p1",
  title: "Launch",
  scenario: "It failed.",
  phase: "act",
  causes: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const ids = (causes: readonly PremortemCause[]) => causes.map((c) => c.id);

describe("normalizePremortemState", () => {
  const legacy = {
    scenario: "The launch slipped a quarter",
    causes: [
      {
        id: "c1",
        text: "Payment certification took too long",
        description: "Nobody had done it",
        likelihood: 4,
        impact: 5,
        preventiveAction: "Start in sprint 1",
        owner: "Priya",
        sentTo: [{ route: "risk", targetId: "r1", at: "2026-10-01T00:00:00.000Z" }],
      },
      // The old "Add Cause" saved these blank, rated 3 × 3.
      { id: "c2", text: "", likelihood: 3, impact: 3 },
      "junk",
      { text: "No id" },
      { id: "c3", text: "Scope creep", likelihood: 3, impact: 3 },
    ],
  };

  it("reads the single pre-upgrade premortem as the first one, in the Act phase", () => {
    const state = normalizePremortemState(legacy);
    expect(state.version).toBe(2);
    expect(state.premortems).toEqual([
      {
        id: LEGACY_PREMORTEM_ID,
        title: "Premortem",
        scenario: "The launch slipped a quarter",
        phase: "act",
        createdAt: "",
        causes: [
          {
            id: "c1",
            text: "Payment certification took too long",
            description: "Nobody had done it",
            likelihood: 4,
            impact: 5,
            preventiveAction: "Start in sprint 1",
            owner: "Priya",
            sentTo: [{ route: "risk", targetId: "r1", at: "2026-10-01T00:00:00.000Z" }],
          },
          { id: "c3", text: "Scope creep", likelihood: 3, impact: 3 },
        ],
      },
    ]);
  });

  it("gives the same result when run twice, or after a round trip through storage", () => {
    const once = normalizePremortemState(legacy);
    expect(normalizePremortemState(once)).toEqual(once);
    expect(normalizePremortemState(JSON.parse(JSON.stringify(once)))).toEqual(once);
    const v2: PremortemState = {
      version: 2,
      premortems: [
        pm({
          link: { kind: "epic", id: "e1", name: "Checkout" },
          phase: "vote",
          dotsPerPerson: 3,
          causes: [
            cause("a", "A", {
              votes: 3,
              merged: [cause("b", "B", { votes: 1 })],
              likelihood: 2.5,
            }),
          ],
        }),
      ],
    };
    expect(normalizePremortemState(v2)).toEqual(v2);
    expect(normalizePremortemState(normalizePremortemState(v2))).toEqual(v2);
  });

  it("is empty for nothing stored, a blank old premortem, or garbage", () => {
    for (const raw of [undefined, null, "x", 42, [], {}, { scenario: " ", causes: [] }]) {
      expect(normalizePremortemState(raw)).toEqual(EMPTY_PREMORTEM_STATE);
    }
    expect(normalizePremortemState({ version: 2, premortems: [null, { title: "no id" }] })).toEqual(
      EMPTY_PREMORTEM_STATE
    );
  });

  it("keeps an off-scale rating, brings others into range and drops what isn't a number", () => {
    const [p] = normalizePremortemState({
      causes: [
        { id: "a", text: "A", likelihood: 2.5, impact: 9 },
        { id: "b", text: "B", likelihood: "4", impact: "high" },
        { id: "c", text: "C", likelihood: 0, impact: -3, votes: -2 },
        { id: "d", text: "D", votes: 2.7 },
      ],
    }).premortems;
    expect(p.causes).toEqual([
      { id: "a", text: "A", likelihood: 2.5, impact: 5 },
      { id: "b", text: "B", likelihood: 4 },
      { id: "c", text: "C", likelihood: 1, impact: 1 },
      { id: "d", text: "D", votes: 2 },
    ]);
  });

  it("lets the first of two rows with one id win, grouped duplicates included", () => {
    const state = normalizePremortemState({
      version: 2,
      premortems: [
        pm({ causes: [cause("a", "A", { merged: [cause("b", "B")] }), cause("b", "Again")] }),
        pm({ title: "Second copy" }),
        { ...pm({ id: "p2" }), phase: "dance", link: { kind: "sprint", id: "s1" } },
      ],
    });
    expect(state.premortems.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(state.premortems[0].causes).toEqual([cause("a", "A", { merged: [cause("b", "B")] })]);
    // An unknown phase starts at the beginning; a link it can't read is dropped.
    expect(state.premortems[1].phase).toBe("write");
    expect(state.premortems[1].link).toBeUndefined();
  });

  it("opens the premortem asked for, else the newest", () => {
    const old = pm({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = pm({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" });
    const legacyOne = pm({ id: LEGACY_PREMORTEM_ID, createdAt: "" });
    expect(pickPremortem([old, legacyOne, newer], null)?.id).toBe("new");
    expect(pickPremortem([old, newer], "old")?.id).toBe("old");
    expect(pickPremortem([old, newer], "gone")?.id).toBe("new");
    expect(pickPremortem([], "x")).toBeUndefined();
  });
});

describe("Premortem ranking", () => {
  it("ranks by votes, then likelihood × impact with the unscored last, then the text", () => {
    const causes = [
      cause("u", "Unscored, no votes"),
      cause("s", "Scored 4", { likelihood: 2, impact: 2 }),
      cause("t", "Scored 9", { likelihood: 3, impact: 3 }),
      cause("v", "Voted", { votes: 1 }),
      cause("w", "A tie on text", { likelihood: 2, impact: 2 }),
    ];
    expect(ids(rankCauses(causes))).toEqual(["v", "t", "w", "s", "u"]);
    expect(compareCauses(causes[0], causes[0])).toBe(0);
  });

  it("scores only rated causes, never a silent 3 × 3", () => {
    expect(causeScore(cause("a", "A"))).toBeNull();
    expect(causeScore(cause("a", "A", { likelihood: 4 }))).toBeNull();
    expect(causeScore(cause("a", "A", { likelihood: 4, impact: 5 }))).toBe(20);
    expect(scoreText(cause("a", "A"))).toBe("Not scored");
    expect(scoreText(cause("a", "A", { likelihood: 2.5, impact: 2 }))).toBe("L2.5 × I2 = 5");
  });

  it("takes the top 3 and names a tie at the cut-off", () => {
    const clear = [
      cause("a", "A", { votes: 4 }),
      cause("b", "B", { votes: 3 }),
      cause("c", "C", { votes: 2 }),
      cause("d", "D", { votes: 1 }),
    ];
    expect(topCauses(clear)).toEqual({ top: clear.slice(0, 3), tied: [] });

    const tie = [
      ...clear.slice(0, 2),
      cause("c", "C", { votes: 1 }),
      cause("d", "D", { votes: 1 }),
    ];
    const { top, tied } = topCauses(tie);
    expect(ids(top)).toEqual(["a", "b", "c"]);
    expect(ids(tied)).toEqual(["c", "d"]);

    // Equal votes, but likelihood × impact settles it: no tie.
    const settled = [
      ...clear.slice(0, 2),
      cause("c", "C", { votes: 1, likelihood: 4, impact: 4 }),
      cause("d", "D", { votes: 1, likelihood: 2, impact: 2 }),
    ];
    expect(topCauses(settled).tied).toEqual([]);
  });

  it("doesn't call it a tie before anyone has voted or rated, and copes with few causes", () => {
    const blank = ["a", "b", "c", "d"].map((id) => cause(id, id.toUpperCase()));
    expect(topCauses(blank)).toEqual({ top: blank.slice(0, 3), tied: [] });
    expect(topCauses([])).toEqual({ top: [], tied: [] });
    expect(ids(topCauses([cause("a", "A")]).top)).toEqual(["a"]);
  });
});

describe("Premortem grouping", () => {
  const base = pm({
    causes: [
      cause("a", "Scope creep", { votes: 2 }),
      cause("b", "Scope keeps growing", { votes: 1, owner: "Bo" }),
      cause("c", "No tests"),
    ],
  });

  it("folds a duplicate into a cause, votes and all, and Undo puts it back as it was", () => {
    const merged = mergeCause(base, "b", "a");
    expect(merged.causes).toEqual([
      cause("a", "Scope creep", {
        votes: 3,
        merged: [cause("b", "Scope keeps growing", { votes: 1, owner: "Bo" })],
      }),
      cause("c", "No tests"),
    ]);
    expect(unmergeCause(merged, base.causes[1], "a", 1)).toEqual(base);
    // Undo twice is still one cause.
    const back = unmergeCause(merged, base.causes[1], "a", 1);
    expect(unmergeCause(back, base.causes[1], "a", 1)).toBe(back);
  });

  it("ignores grouping a cause with itself or with one that is gone", () => {
    expect(mergeCause(base, "a", "a")).toBe(base);
    expect(mergeCause(base, "a", "zz")).toBe(base);
  });

  it("splits a chain of groupings back into every cause, each with its own votes", () => {
    const chained = mergeCause(mergeCause(base, "b", "a"), "a", "c");
    expect(chained.causes).toEqual([
      cause("c", "No tests", {
        votes: 3,
        merged: [
          cause("a", "Scope creep", { votes: 2 }),
          cause("b", "Scope keeps growing", { votes: 1, owner: "Bo" }),
        ],
      }),
    ]);
    expect(splitCause(chained, "c").causes).toEqual([
      cause("c", "No tests"),
      cause("a", "Scope creep", { votes: 2 }),
      cause("b", "Scope keeps growing", { votes: 1, owner: "Bo" }),
    ]);
    expect(splitCause(base, "c")).toBe(base);
  });

  it("never takes votes below zero, and clears and restores every vote", () => {
    expect(setVotes(base, "c", -4).causes[2]).toEqual(cause("c", "No tests"));
    expect(setVotes(base, "c", 2).causes[2]).toEqual(cause("c", "No tests", { votes: 2 }));
    const grouped = mergeCause(base, "b", "a");
    const before = votesById(grouped);
    const cleared = withVotes(grouped, new Map());
    expect(cleared.causes.every((c) => !c.votes && !c.merged?.some((m) => m.votes))).toBe(true);
    expect(withVotes(cleared, before)).toEqual(grouped);
  });
});

describe("Premortem verdict", () => {
  it("says what to do next in each phase", () => {
    expect(premortemVerdict(pm())).toBe("No causes yet: imagine it failed and write why.");
    const two = [cause("a", "Scope creep"), cause("b", "No tests")];
    expect(premortemVerdict(pm({ phase: "write", causes: two }))).toBe(
      "2 causes written so far. When the writing time is up, move on to Group."
    );
    expect(premortemVerdict(pm({ phase: "group", causes: two }))).toBe(
      "2 causes, none grouped yet. Put duplicates together, then vote."
    );
    expect(premortemVerdict(mergeCause(pm({ phase: "group", causes: two }), "b", "a"))).toBe(
      "1 distinct cause after grouping 1 duplicate. Vote once every duplicate is grouped."
    );
    expect(premortemVerdict(pm({ phase: "vote", causes: two }))).toBe(
      "No votes yet: give everyone a few dots for the causes most likely to sink it."
    );
    expect(premortemVerdict(pm({ phase: "vote", causes: two, dotsPerPerson: 3 }))).toBe(
      "No votes yet: give everyone 3 dots for the causes most likely to sink it."
    );
    expect(
      premortemVerdict(pm({ phase: "vote", causes: [cause("a", "Scope creep", { votes: 2 })] }))
    ).toBe("“Scope creep” leads with 2 votes. The top cause goes to the Risk Register.");
  });

  it("names a tie at the cut-off", () => {
    const causes = [
      cause("a", "A", { votes: 3 }),
      cause("b", "B", { votes: 2 }),
      cause("c", "C", { votes: 1 }),
      cause("d", "D", { votes: 1 }),
    ];
    expect(premortemVerdict(pm({ phase: "vote", causes }))).toBe(
      "“A” leads with 3 votes. “C” and “D” tie at the cut-off with 1 vote, so break the tie before you act."
    );
  });

  it("in the Act phase, asks for ratings first, then names the top risk and what's missing", () => {
    const top = [
      cause("a", "A", { votes: 3, likelihood: 4, impact: 4, preventiveAction: "x" }),
      cause("b", "B", { votes: 2 }),
      cause("c", "C", { votes: 1, likelihood: 2, impact: 2 }),
    ];
    expect(premortemVerdict(pm({ causes: top }))).toBe(
      "Rate likelihood and impact for 1 of the top 3 before it goes to the Risk Register."
    );
    const rated = top.map((c) => ({ ...c, likelihood: c.likelihood ?? 3, impact: c.impact ?? 3 }));
    expect(premortemVerdict(pm({ causes: rated }))).toBe(
      "Top risk: “A” (3 votes, L4 × I4 = 16). 2 of the top 3 have no preventive action yet."
    );
    const ready = rated.map((c) => ({ ...c, preventiveAction: "Act" }));
    expect(premortemVerdict(pm({ causes: ready }))).toBe(
      "Top risk: “A” (3 votes, L4 × I4 = 16). Each has a preventive action: send them to the Risk Register."
    );
    expect(premortemVerdict(pm({ causes: ready }), () => true)).toBe(
      "Top risk: “A” (3 votes, L4 × I4 = 16). All 3 are in the Risk Register."
    );
  });
});

describe("Premortem links", () => {
  const releases: ReleaseReadiness[] = [
    {
      id: "releaseReadiness:current",
      releases: [
        {
          id: "r1",
          name: "2.0",
          plannedDate: "2026-11-12",
          status: "planning",
          gates: {} as never,
        },
        {
          id: "example-r",
          name: "Example",
          plannedDate: "",
          status: "planning",
          gates: {} as never,
        },
        { id: "r2", name: "  ", plannedDate: "", status: "planning", gates: {} as never },
      ],
    },
    {
      id: "other",
      releases: [
        { id: "x", name: "Elsewhere", plannedDate: "", status: "planning", gates: {} as never },
      ],
    },
  ];
  const epics: EpicRoadmap[] = [
    {
      id: "epicRoadmap:current",
      epics: [
        {
          id: "e1",
          title: "Checkout",
          startQuarter: "2026 Q3",
          endQuarter: "2026 Q4",
          progress: 0,
        },
      ],
    },
  ];

  it("offers the real releases and epics, not examples or blanks", () => {
    expect(linkOptions(releases, epics)).toEqual([
      { kind: "release", id: "r1", name: "2.0", detail: "planned 2026-11-12" },
      { kind: "epic", id: "e1", name: "Checkout", detail: "2026 Q3 – 2026 Q4" },
    ]);
    expect(linkOptions(undefined, undefined)).toEqual([]);
  });

  it("shows a renamed target by its new name and a removed one as removed", () => {
    const options = linkOptions(releases, epics);
    expect(resolveLink({ kind: "release", id: "r1", name: "Old name" }, options)).toEqual({
      kind: "release",
      name: "2.0",
      removed: false,
    });
    const gone = resolveLink({ kind: "epic", id: "e9", name: "Payments" }, options);
    expect(linkText(gone)).toBe("Epic “Payments” (removed)");
    expect(resolveLink(undefined, options)).toBeNull();
    expect(linkText(null)).toBe("Not linked");
  });

  it("puts the link and the Risk Register marker in the Markdown", () => {
    const p = pm({
      causes: [
        cause("a", "A", {
          likelihood: 2,
          impact: 2,
          sentTo: [{ route: "risk", targetId: "r", at: "" }],
        }),
      ],
    });
    const md = toMarkdown(p, {
      link: { kind: "release", name: "2.0", removed: true },
      isSent: (c) => Boolean(c.sentTo?.length),
      now: new Date(2026, 9, 24),
    });
    expect(md).toContain("**For:** Release “2.0” (removed)");
    expect(md).toContain("| 1 | A | 0 | 2 | 2 | 4 |  |  | Added |");
    expect(md).toContain("**Top risk: “A” (L2 × I2 = 4). It has no preventive action yet.**");
  });
});

describe("Premortem example data", () => {
  it("is one premortem with example ids, a grouped duplicate and votes", () => {
    const ex = buildExample(new Date("2026-10-24T00:00:00Z"));
    expect(ex.id).toBe("example-premortem");
    expect(ex.phase).toBe("act");
    expect(ex.link).toBeUndefined();
    expect(
      [...ex.causes, ...ex.causes.flatMap((c) => c.merged ?? [])].every((c) =>
        c.id.startsWith("example-")
      )
    ).toBe(true);
    expect(normalizePremortemState({ version: 2, premortems: [ex] }).premortems[0]).toEqual(ex);
  });

  it("clears to nothing, or keeps only what the user made their own", () => {
    const ex = buildExample();
    expect(withoutExample({ version: 2, premortems: [ex, pm()] }, "k")).toEqual({
      state: { version: 2, premortems: [pm()] },
      keptId: undefined,
    });
    const mine = cause("m", "Mine", {
      votes: 2,
      merged: [cause("example-cause-9", "Ex", { votes: 1 })],
    });
    const withMine = { ...ex, causes: [...ex.causes, { ...mine, votes: 3 }] };
    const cleared = withoutExample({ version: 2, premortems: [withMine] }, "k");
    expect(cleared.keptId).toBe("k");
    expect(cleared.state.premortems).toEqual([
      expect.objectContaining({
        id: "k",
        title: "Premortem",
        scenario: "",
        phase: "act",
        causes: [cause("m", "Mine", { votes: 2 })],
      }),
    ]);
  });
});
