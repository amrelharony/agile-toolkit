// @vitest-environment node
/**
 * The Persona Library's pure modules: reading a stored persona back, the
 * duplicate-name check, where a persona is used, adding points within the
 * cap; the draft without AI (its keyword families, role, quote, tags and a
 * made-up name, the name list running out, what it refuses); and the
 * notes built from interviews (anonymised, no dates, tags or ids, capped).
 */

import { describe, expect, it } from "vitest";
import type { Interview, Persona, StrategyMap } from "@/lib/stores/workspace-types";
import {
  PERSONA_POINTS_MAX,
  allTags,
  cleanList,
  defaultTier,
  duplicateOf,
  initialOf,
  linkedInterviews,
  matchesFilters,
  personaCounts,
  readPersona,
  readPersonas,
  tagsFromText,
  usedOnMaps,
  withPoints,
} from "@/lib/personas/model";
import {
  DRAFT_POINTS_MAX,
  PERSONA_NAMES,
  ROLE_TO_CONFIRM,
  draftName,
  noteSentences,
  personaFromNotes,
  roleFromNotes,
} from "@/lib/personas/from-notes";
import {
  INTERVIEW_NOTES_MAX,
  interviewNotes,
  nameAwayFromParticipants,
  participantNames,
} from "@/lib/personas/interviews";

const AT = "2026-11-20T10:00:00.000Z";
const persona = (over: Partial<Persona> = {}): Persona => ({
  id: "persona_a",
  name: "Maya",
  role: "Shift nurse",
  tier: "primary",
  evidence: "some",
  goals: ["Dinner in 30 minutes"],
  pains: [],
  behaviours: [],
  tags: ["mobile"],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe("readPersona", () => {
  it("keeps a good persona as it is", () => {
    const p = persona({ summary: "S", quote: "Q", context: "C", interviewIds: ["i1"] });
    expect(readPersona(p)).toEqual(p);
  });

  it("drops rows with no id, and mends what it can", () => {
    expect(readPersona(null)).toBeNull();
    expect(readPersona({ name: "x" })).toBeNull();
    const p = readPersona({
      id: "p",
      name: "  ",
      role: 7,
      tier: "boss",
      evidence: "loads",
      goals: [" a ", "A", "", 3, "b"],
      tags: "x",
      summary: "   ",
    });
    expect(p).toMatchObject({
      id: "p",
      name: "Unnamed persona",
      role: "",
      tier: "secondary",
      evidence: "assumed",
      goals: ["a", "b"],
      pains: [],
      tags: [],
    });
    expect(p).not.toHaveProperty("summary");
  });

  it("cuts text and lists to the CRUD's caps", () => {
    const p = readPersona({
      ...persona(),
      name: "n".repeat(300),
      goals: Array.from({ length: 12 }, (_, i) => `goal ${i} ${"x".repeat(250)}`),
    })!;
    expect(p.name).toHaveLength(200);
    expect(p.goals).toHaveLength(PERSONA_POINTS_MAX);
    expect(p.goals.every((g) => g.length <= 200)).toBe(true);
  });

  it("orders the library: main, also served, not for us, then by name", () => {
    const list = readPersonas([
      persona({ id: "1", name: "Zed", tier: "anti" }),
      persona({ id: "2", name: "bo", tier: "secondary" }),
      persona({ id: "3", name: "Al", tier: "secondary" }),
      persona({ id: "4", name: "Mia", tier: "primary" }),
    ]);
    expect(list.map((p) => p.name)).toEqual(["Mia", "Al", "bo", "Zed"]);
  });
});

describe("the library's rules", () => {
  it("finds a duplicate name in any case and spacing, except the persona itself", () => {
    const all = [persona(), persona({ id: "persona_b", name: "Tom" })];
    expect(duplicateOf(" maya ", all)?.id).toBe("persona_a");
    expect(duplicateOf("Maya", all, "persona_a")).toBeUndefined();
    expect(duplicateOf("Riley", all)).toBeUndefined();
    expect(duplicateOf("  ", all)).toBeUndefined();
  });

  it("starts a new persona as the main one only while there is none (examples aside)", () => {
    expect(defaultTier([])).toBe("primary");
    expect(defaultTier([persona({ id: "example-x" })])).toBe("primary");
    expect(defaultTier([persona()])).toBe("secondary");
  });

  it("counts the impact maps whose actors name the persona, never a strategy tree", () => {
    const map = (id: string, format: StrategyMap["format"], personaId?: string, level = 1) =>
      ({
        id,
        format,
        title: id,
        nodes: [
          { id: "g", parentId: null, level: 0, text: "Goal" },
          {
            id: "a",
            parentId: "g",
            level,
            text: "Shop owners",
            ...(personaId ? { personaId } : {}),
          },
        ],
        createdAt: AT,
        updatedAt: AT,
      }) as StrategyMap;
    const maps = [
      map("m1", "impact-map", "persona_a"),
      map("m2", "impact-map"),
      map("m3", "dibb", "persona_a"),
      map("m4", "impact-map", "persona_a", 2),
    ];
    expect(usedOnMaps(persona(), maps).map((m) => m.id)).toEqual(["m1"]);
    expect(usedOnMaps(persona(), undefined)).toEqual([]);
  });

  it("links only the interviews still in the log", () => {
    const interviews = [
      { id: "i1", date: AT, participant: "A", quotes: [] },
      { id: "i2", date: AT, participant: "B", quotes: [] },
    ] as Interview[];
    expect(
      linkedInterviews(persona({ interviewIds: ["i2", "gone"] }), interviews).map((i) => i.id)
    ).toEqual(["i2"]);
    expect(linkedInterviews(persona(), interviews)).toEqual([]);
  });

  it("adds points within the cap, skipping repeats and blanks", () => {
    const full = persona({ goals: Array.from({ length: 7 }, (_, i) => `g${i}`) });
    const r = withPoints(full, "goals", ["G0", " new ", "another", ""]);
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(3);
    expect(r.persona.goals).toHaveLength(8);
    expect(r.persona.goals[7]).toBe("new");
    const same = withPoints(full, "goals", ["g1"]);
    expect(same.persona).toBe(full);
  });

  it("filters, counts, tags and initials", () => {
    const all = [
      persona(),
      persona({ id: "b", tier: "anti", evidence: "assumed", tags: ["Mobile", "price"] }),
    ];
    expect(personaCounts(all)).toEqual({
      tiers: { primary: 1, secondary: 0, anti: 1 },
      evidence: { assumed: 1, some: 1, researched: 0 },
    });
    expect(allTags(all)).toEqual(["Mobile", "price"]);
    expect(matchesFilters(all[1], { tier: "anti", evidence: "", tag: "MOBILE" })).toBe(true);
    expect(matchesFilters(all[0], { tier: "", evidence: "assumed", tag: "" })).toBe(false);
    expect(initialOf(" élise")).toBe("É");
    expect(initialOf("")).toBe("?");
    expect(tagsFromText(" a, b ,, A, c")).toEqual(["a", "b", "c"]);
    expect(cleanList(["x", "X", "y"], 1, 10)).toEqual(["x"]);
  });
});

const NOTES = [
  "As a parent of two who works shifts, I plan dinner on my phone.",
  "I want dinner sorted before I get home, so that I'm not cooking at midnight.",
  "It's frustrating when a recipe needs ten things I don't have.",
  "Deliveries are slow on Mondays.",
  "I usually order on Sunday for the whole week.",
  "We order dinner every Friday too.",
  "The weather was nice.",
].join("\n");

describe("personaFromNotes (the draft without AI)", () => {
  it("sorts sentences into goals, frustrations and habits, and finds the role and a quote", () => {
    const d = personaFromNotes(NOTES, "primary", []);
    expect(d.role).toBe("Parent of two who works shifts");
    expect(d.goals).toEqual([
      "I want dinner sorted before I get home, so that I'm not cooking at midnight.",
    ]);
    expect(d.pains).toEqual([
      "It's frustrating when a recipe needs ten things I don't have.",
      "Deliveries are slow on Mondays.",
    ]);
    expect(d.behaviours).toEqual([
      "As a parent of two who works shifts, I plan dinner on my phone.",
      "I usually order on Sunday for the whole week.",
      "We order dinner every Friday too.",
    ]);
    // No quoted line: the first frustration said in the first person.
    expect(d.quote).toBe("It's frustrating when a recipe needs ten things I don't have.");
    // Words more than one sentence uses.
    expect(d.tags).toContain("dinner");
    expect(d.tags.every((t) => t.length <= 40)).toBe(true);
    expect(PERSONA_NAMES).toContain(d.name);
  });

  it("takes a quoted line first, and says the role is to confirm when the notes don't give one", () => {
    const d = personaFromNotes(
      "They said “the app forgets my order every week” twice.",
      "anti",
      []
    );
    expect(d.quote).toBe("the app forgets my order every week");
    expect(d.role).toBe(ROLE_TO_CONFIRM);
    expect(roleFromNotes("As a result we changed it. I'm a team lead at night.")).toBe(
      "Team lead at night"
    );
    expect(roleFromNotes("I'm a bit tired")).toBeNull();
  });

  it("keeps at most five points a list, each cut to 200 characters", () => {
    const long = Array.from({ length: 9 }, (_, i) => `I need thing ${i} ${"x".repeat(300)}.`).join(
      "\n"
    );
    const d = personaFromNotes(long, "secondary", []);
    expect(d.goals).toHaveLength(DRAFT_POINTS_MAX);
    expect(d.goals.every((g) => g.length <= 200)).toBe(true);
  });

  it("never uses a name already taken, and falls back to Persona N when all are", () => {
    const taken = PERSONA_NAMES.slice(0, 10);
    expect(taken.map((n) => n.toLowerCase())).not.toContain(draftName(taken, "seed").toLowerCase());
    expect(draftName(PERSONA_NAMES.map((n) => n.toUpperCase()))).toBe(
      `Persona ${PERSONA_NAMES.length + 1}`
    );
    expect(draftName([...PERSONA_NAMES, `Persona ${PERSONA_NAMES.length + 1}`])).toBe(
      `Persona ${PERSONA_NAMES.length + 2}`
    );
    expect(new Set(PERSONA_NAMES).size).toBe(PERSONA_NAMES.length);
    expect(PERSONA_NAMES.length).toBeGreaterThanOrEqual(40);
  });

  it("refuses what the task's schema refuses", () => {
    expect(() => personaFromNotes("too short", "primary", [])).toThrow();
    expect(() => personaFromNotes("x".repeat(6001), "primary", [])).toThrow();
    expect(() => personaFromNotes(NOTES, "boss" as never, [])).toThrow();
    expect(() => personaFromNotes(NOTES, "primary", Array(31).fill("a"))).toThrow();
  });

  it("splits notes into sentences, bullets and wrapping quotes stripped", () => {
    expect(noteSentences("- “One thing.” Two things!\n* ok\n3) Three")).toEqual([
      "One thing.",
      "Two things!",
      "Three",
    ]);
  });
});

describe("interviewNotes", () => {
  const interview = (over: Partial<Interview> = {}): Interview => ({
    id: "i1",
    date: "2026-11-02T09:00:00.000Z",
    participant: "Dana Lee",
    context: "Dana runs a bakery; call her on +44 7700 900123.",
    quotes: [
      { id: "q1", text: "Dana here: I lose an hour a day to refunds.", tags: ["refunds"] },
      { id: "q2", text: "Mail me at dana@example.com", tags: [] },
    ],
    ...over,
  });

  it("anonymises participants and takes only the context and quote text", () => {
    const text = interviewNotes([
      interview(),
      interview({
        id: "i2",
        date: "2026-11-03T09:00:00.000Z",
        participant: "Sam",
        context: undefined,
        quotes: [{ id: "q3", text: "Sam again: the export is slow.", tags: ["export"] }],
      }),
    ]);
    // Numbered by the order they were logged, oldest first.
    expect(text).toBe(
      [
        "Participant 1:",
        "Participant 1 runs a bakery; call her on [redacted:phone].",
        "“Participant 1 here: I lose an hour a day to refunds.”",
        "“Mail me at [redacted:email]”",
        "",
        "Participant 2:",
        "“Participant 2 again: the export is slow.”",
      ].join("\n")
    );
    for (const leak of ["Dana", "Sam", "2026-11", "refunds,", "q1", "i1", "@example.com", "7700"])
      expect(text).not.toContain(leak);
  });

  it("is capped at 6,000 characters, at a whole line", () => {
    const many = Array.from({ length: 20 }, (_, k) =>
      interview({
        id: `i${k}`,
        participant: `P${k}`,
        context: undefined,
        quotes: [{ id: `q${k}`, text: "w".repeat(900), tags: [] }],
      })
    );
    const text = interviewNotes(many);
    expect(text.length).toBeLessThanOrEqual(INTERVIEW_NOTES_MAX);
    expect(text.endsWith("”")).toBe(true);
    expect(interviewNotes([])).toBe("");
  });

  it("never tags a draft from interviews with the participants' pseudonym", () => {
    const people = ["Dana Lee", "Sam", "Omar Khalil"].map((participant, k) =>
      interview({
        id: `i${k}`,
        date: `2026-11-0${k + 1}T09:00:00.000Z`,
        participant,
        context: `${participant.split(" ")[0]} orders dinner for the family.`,
        quotes: [
          {
            id: `q${k}`,
            text: `${participant.split(" ")[0]} here: I want dinner sorted before the shift.`,
            tags: [],
          },
        ],
      })
    );
    const notes = interviewNotes(people);
    // The pseudonym is all over the notes: a head line and the text of each interview.
    expect(notes.match(/Participant \d+/g)?.length).toBeGreaterThanOrEqual(9);
    const d = personaFromNotes(notes, "primary", []);
    expect(d.tags.length).toBeGreaterThan(0);
    expect(d.tags).toContain("dinner");
    expect(d.tags.map((t) => t.toLowerCase())).not.toContain("participant");
    // Nor a number left behind by it.
    expect(d.tags.some((t) => /^\d+$/.test(t))).toBe(false);
  });
});

describe("participant names a draft never takes", () => {
  // A stored row may lack its participant, so the lists read one without it too.
  const log = (...participants: (string | undefined)[]) =>
    participants.map((participant) => ({ participant }) as Pick<Interview, "participant">);

  it("lists each label, its parts and their first words", () => {
    expect(
      participantNames(log("Leo Park", "PM (Sam)", " Dana Lee, engineering manager "))
    ).toEqual([
      "Leo Park",
      "Leo",
      "PM (Sam)",
      "PM",
      "Sam",
      "Dana Lee, engineering manager",
      "Dana Lee",
      "Dana",
      "engineering manager",
      "engineering",
    ]);
    // A label with a digit names no one; blanks and one letter are skipped.
    expect(participantNames(log("Customer 3", "", undefined, "A", "leo park"))).toEqual([
      "Customer 3",
      "leo park",
      "leo",
    ]);
  });

  it("swaps a drafted name that is a participant's for a made-up one", () => {
    const interviews = log("Leo Park", "Omar Khalil");
    expect(nameAwayFromParticipants("Noor", interviews, [])).toBe("Noor");
    for (const real of ["Leo", " leo ", "LEO PARK", "Omar"]) {
      const name = nameAwayFromParticipants(real, interviews, ["Maya"]);
      expect(PERSONA_NAMES).toContain(name);
      expect(["leo", "omar", "maya"]).not.toContain(name.toLowerCase());
    }
  });
});
