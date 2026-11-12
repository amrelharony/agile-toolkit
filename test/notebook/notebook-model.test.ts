// @vitest-environment node
/**
 * The Scrum Master Notebook's pure model (lib/notebook): reading stored
 * notes back, weeks that start on Monday, counts, the search and filters,
 * keyword themes and tags without AI, the week read without AI, the input
 * cut to fit the AI route, tool links that only ever name real tools, and
 * the next step for a theme that keeps coming up.
 */

import { describe, expect, it } from "vitest";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { getToolById } from "@/lib/constants/tools";
import {
  NOTEBOOK_EVENTS,
  SUMMARY_TAG,
  addedLinks,
  compareNotes,
  eventCounts,
  eventLabel,
  filterNotes,
  formatDay,
  formatShortDay,
  groupByWeek,
  isDay,
  noteHandoffSource,
  noteName,
  normTags,
  normalizeEntries,
  notesOfWeek,
  parseTags,
  shiftDay,
  tagCounts,
  weekEndOf,
  weekStartOf,
} from "@/lib/notebook/model";
import {
  NOTE_THEMES,
  keywordTags,
  noteThemes,
  themeCounts,
  themeTool,
} from "@/lib/notebook/themes";
import {
  linkableTool,
  linkedToolOf,
  pickableTools,
  resolveSuggestedTools,
} from "@/lib/notebook/tools";
import {
  WEEKLY_BODY_MAX,
  WEEKLY_BYTE_BUDGET,
  WEEKLY_CHAR_BUDGET,
  WEEKLY_MAX_NOTES,
  summaryNoteBody,
  summaryNoteTitle,
  weeklyFallback,
  weeklyInput,
} from "@/lib/notebook/summary";
import { NEXT_STEP_NOTES, notebookNextSteps } from "@/lib/notebook/next-step";
import { NOTE_TEMPLATES, bodyWithTemplate } from "@/lib/notebook/templates";

const AT = "2026-11-12T09:00:00.000Z";
const note = (id: string, date: string, over: Partial<NotebookEntry> = {}): NotebookEntry => ({
  id,
  date,
  body: `Note ${id}`,
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe("reading stored notes", () => {
  it("keeps notes with an id, a real day and a body, and tidies their tags", () => {
    const out = normalizeEntries([
      { id: "a", date: "2026-11-12", body: "ok", tags: [" Blockers ", "blockers", 3, "UX"] },
      { id: "b", date: "2026-02-30", body: "no such day" },
      { id: "c", date: "2026-11-12" },
      null,
      "text",
      { id: "d", date: "2026-11-11", body: "x", title: 7, event: "", linkedTool: "kanban" },
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "d"]);
    expect(out[0].tags).toEqual(["blockers", "ux"]);
    expect(out[1]).not.toHaveProperty("title");
    expect(out[1]).not.toHaveProperty("event");
    expect(out[1].linkedTool).toBe("kanban");
  });

  it("knows a real day", () => {
    expect(isDay("2026-11-12")).toBe(true);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("12/11/2026")).toBe(false);
  });

  it("names a note by its title, else its first line", () => {
    expect(noteName({ title: "  Quiet  standup ", body: "x" })).toBe("Quiet standup");
    expect(noteName({ body: "\n  First line here\nsecond" })).toBe("First line here");
    expect(noteName({ body: "x".repeat(100) }, 10)).toBe("xxxxxxxxx…");
    expect(noteName({ body: "   " })).toBe("Untitled note");
  });

  it("tags lower case, single spaced, each once", () => {
    expect(parseTags(" Sprint  Goal, sprint goal,, UX ")).toEqual(["sprint goal", "ux"]);
    expect(normTags(["A", "a", 1 as unknown as string])).toEqual(["a"]);
  });

  it("labels the events, and shows an agent's own event as typed", () => {
    expect(eventLabel("daily-scrum")).toBe("Daily Scrum");
    expect(eventLabel("retro")).toBe("Retrospective");
    expect(eventLabel("  hallway   chat ")).toBe("hallway chat");
    expect(eventLabel(undefined)).toBe("");
    expect(NOTEBOOK_EVENTS.map((e) => e.id)).toContain("one-on-one");
  });
});

describe("weeks", () => {
  it("start on Monday and end on Sunday", () => {
    // Thursday 12 Nov 2026.
    expect(weekStartOf("2026-11-12")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09");
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16");
    expect(weekEndOf("2026-11-09")).toBe("2026-11-15");
    // Across a year and a daylight-saving change.
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28");
    expect(shiftDay("2026-03-28", 2)).toBe("2026-03-30");
  });

  it("formats days without a time zone", () => {
    expect(formatDay("2026-11-09")).toBe("9 Nov 2026");
    expect(formatShortDay("2026-11-12")).toBe("Thu 12 Nov");
  });

  it("groups notes by week, newest week and note first", () => {
    const list = [
      note("a", "2026-11-02"),
      note("b", "2026-11-12", { createdAt: "2026-11-12T08:00:00.000Z" }),
      note("c", "2026-11-12", { createdAt: "2026-11-12T10:00:00.000Z" }),
      note("d", "2026-11-09"),
    ];
    expect(groupByWeek(list)).toEqual([
      { weekStart: "2026-11-09", notes: [list[2], list[1], list[3]] },
      // 2 Nov 2026 is a Monday: its own week.
      { weekStart: "2026-11-02", notes: [list[0]] },
    ]);
    expect([...list].sort(compareNotes).map((e) => e.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("keeps a week's summaries apart from its notes", () => {
    const list = [
      note("a", "2026-11-10"),
      note("s", "2026-11-15", { tags: [SUMMARY_TAG] }),
      note("old", "2026-11-08"),
    ];
    const week = notesOfWeek(list, "2026-11-09");
    expect(week.notes.map((e) => e.id)).toEqual(["a"]);
    expect(week.summaries.map((e) => e.id)).toEqual(["s"]);
  });
});

describe("counts", () => {
  const list = [
    note("a", "2026-11-10", { tags: ["blockers", "ux"], event: "daily-scrum" }),
    note("b", "2026-11-11", { tags: ["Blockers"], event: "daily-scrum" }),
    note("c", "2026-11-12", { tags: ["ux"], event: "retro" }),
    note("d", "2026-11-12", { tags: [] }),
  ];

  it("counts notes per tag and per event, most first", () => {
    expect(tagCounts(list)).toEqual([
      { tag: "blockers", count: 2 },
      { tag: "ux", count: 2 },
    ]);
    expect(eventCounts(list)).toEqual([
      { event: "daily-scrum", label: "Daily Scrum", count: 2 },
      { event: "retro", label: "Retrospective", count: 1 },
    ]);
  });
});

describe("search and filters", () => {
  const list = [
    note("a", "2026-11-10", {
      title: "Quiet standup",
      body: "Two people didn't speak.",
      tags: ["participation"],
      event: "daily-scrum",
    }),
    note("b", "2026-11-11", {
      body: "The sandbox is still blocked.",
      tags: ["blockers"],
      linkedTool: "impediments",
    }),
    note("c", "2026-11-12", {
      body: "Retro went well.",
      tags: ["participation", "kudos"],
      event: "retro",
    }),
  ];
  const name = (id: string) => getToolById(id)?.name;

  it("needs every word, in any field, ignoring case", () => {
    expect(filterNotes(list, { query: "QUIET speak" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterNotes(list, { query: "daily scrum" }).map((e) => e.id)).toEqual(["a"]);
    expect(filterNotes(list, { query: "impediment tracker" }, name).map((e) => e.id)).toEqual([
      "b",
    ]);
    expect(filterNotes(list, { query: "nothing here" })).toEqual([]);
  });

  it("filters by every tag picked, the event and the days", () => {
    expect(filterNotes(list, { tags: ["Participation"] }).map((e) => e.id)).toEqual(["c", "a"]);
    expect(filterNotes(list, { tags: ["participation", "kudos"] }).map((e) => e.id)).toEqual(["c"]);
    expect(filterNotes(list, { event: "retro" }).map((e) => e.id)).toEqual(["c"]);
    expect(filterNotes(list, { from: "2026-11-11", to: "2026-11-11" }).map((e) => e.id)).toEqual([
      "b",
    ]);
  });
});

describe("themes without AI", () => {
  it("names a registry tool for every theme", () => {
    for (const t of NOTE_THEMES) {
      if (t.tool) expect(getToolById(t.tool), t.tag).toBeDefined();
      expect(Boolean(t.tool) === Boolean(t.why), t.tag).toBe(true);
    }
    expect(new Set(NOTE_THEMES.map((t) => t.tag)).size).toBe(NOTE_THEMES.length);
  });

  it("reads themes from a note's tags and words, an alias as its theme, kind tags left out", () => {
    expect(
      noteThemes({
        body: "Still blocked on the sandbox. Estimates were 3 and 13.",
        tags: ["Blocker", "observation", "ux"],
      })
    ).toEqual(["blockers", "ux", "estimation"]);
    expect(themeTool("blocker")).toBe("impediments");
    expect(themeTool("nothing")).toBeUndefined();
  });

  it("suggests the notebook's own tags it mentions first, then keyword themes", () => {
    expect(
      keywordTags("The UX review overran and we were blocked by the other team.", {
        known: ["ux", "luxury"],
      })
    ).toEqual(["ux", "blockers", "timebox", "dependencies"]);
  });

  it("never suggests a tag the note has, under its name or an alias", () => {
    expect(
      keywordTags("Blocked again, estimates far apart.", { current: ["blocker", "estimation"] })
    ).toEqual([]);
    expect(keywordTags("blocked", { max: 0 })).toEqual([]);
  });

  it("counts themes per note with the events they came from", () => {
    expect(
      themeCounts([
        { body: "blocked", tags: [], event: "daily-scrum" },
        { body: "still stuck", tags: ["blockers"], event: "retro" },
        { body: "fine", tags: ["kudos"] },
      ])
    ).toEqual([
      { tag: "blockers", notes: 2, events: ["Daily Scrum", "Retrospective"] },
      { tag: "kudos", notes: 1, events: [] },
    ]);
  });
});

describe("tool links", () => {
  it("resolve through the registry and drop unknown ids", () => {
    expect(linkableTool(" Kanban ")?.id).toBe("kanban");
    expect(linkableTool("no-such-tool")).toBeUndefined();
    expect(linkableTool("sm-notebook")).toBeUndefined();
    expect(linkableTool("//evil.example")).toBeUndefined();
    expect(linkedToolOf({ linkedTool: "impediments" })).toEqual({
      id: "impediments",
      name: "Impediment Tracker",
      href: "/impediments",
    });
    expect(linkedToolOf({ linkedTool: "made-up" })).toBeNull();
  });

  it("keep suggested tools real, each once, at most five", () => {
    const out = resolveSuggestedTools([
      { id: "impediments", why: "  keeps\n blockers  visible " },
      { id: "made-up-tool", why: "x" },
      { id: "impediments", why: "again" },
      { id: "kanban", why: "wip" },
      { id: "retro", why: "a" },
      { id: "kudos", why: "b" },
      { id: "mood-tracker", why: "c" },
      { id: "psych-safety", why: "d" },
    ]);
    expect(out.map((t) => t.id)).toEqual([
      "impediments",
      "kanban",
      "retro",
      "kudos",
      "mood-tracker",
    ]);
    expect(out[0]).toEqual({
      id: "impediments",
      name: "Impediment Tracker",
      href: "/impediments",
      why: "keeps blockers visible",
    });
    expect(resolveSuggestedTools(null)).toEqual([]);
  });

  it("offer the main tools in the picker, plus a shelved one a note already has", () => {
    const ids = pickableTools().map((t) => t.id);
    expect(ids).toContain("impediments");
    expect(ids).not.toContain("sm-notebook");
    expect(ids).not.toContain("meeting-audit");
    expect(pickableTools("meeting-audit").map((t) => t.id)).toContain("meeting-audit");
  });
});

describe("the week read", () => {
  const week = "2026-11-09";
  const list = [
    note("a", "2026-11-09", {
      body: "Blocked on the sandbox.",
      tags: ["blockers"],
      event: "daily-scrum",
    }),
    note("b", "2026-11-10", { body: "Still stuck on access.", event: "daily-scrum" }),
    note("c", "2026-11-11", {
      body: "Estimates 3 and 13.",
      tags: ["estimation"],
      event: "refinement",
    }),
    note("d", "2026-11-12", { body: "Waiting on the other team again.", event: "daily-scrum" }),
    note("s", "2026-11-12", { body: "Kept.", tags: [SUMMARY_TAG] }),
    note("old", "2026-11-02", { body: "Last week." }),
  ];

  it("sends the week's notes oldest first, summaries left out, each cut", () => {
    const input = weeklyInput(
      [...list, note("long", "2026-11-13", { body: "y".repeat(2000), title: "t".repeat(300) })],
      week
    )!;
    expect(input.weekStart).toBe(week);
    expect(input.notes.map((n) => n.date)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]);
    const long = input.notes[4];
    expect(long.body).toHaveLength(WEEKLY_BODY_MAX);
    expect(long.body.endsWith("…")).toBe(true);
    expect(long.title!.length).toBeLessThanOrEqual(120);
    expect(weeklyInput(list, "2026-11-16")).toBeNull();
  });

  it("keeps the newest 60 and cuts every note shorter when the whole is too big", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      note(`n${i}`, "2026-11-10", {
        body: "é".repeat(1500),
        createdAt: `2026-11-10T00:${String(i).padStart(2, "0")}:00.000Z`,
      })
    );
    const input = weeklyInput(many, week)!;
    expect(input.notes).toHaveLength(WEEKLY_MAX_NOTES);
    const json = JSON.stringify(input);
    expect(json.length).toBeLessThanOrEqual(WEEKLY_CHAR_BUDGET);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(WEEKLY_BYTE_BUDGET);
    expect(input.notes[0].body.length).toBeLessThan(WEEKLY_BODY_MAX);
  });

  it("reads the week without AI: counts, repeated themes and tools for them", () => {
    const out = weeklyFallback(weeklyInput(list, week)!);
    expect(out.summary).toBe(
      "4 notes in the week of 9 Nov 2026, 3 of them from the Daily Scrum. What came up most: blockers (3 notes)."
    );
    expect(out.patterns).toEqual([
      "“blockers” came up in 3 notes, at the Daily Scrum.",
      "3 of 4 notes came from the Daily Scrum: notice the other events too.",
    ]);
    // One theme repeats, so the single ones' tools come too (A to Z on a tie).
    expect(out.tools.map((t) => t.id)).toEqual(["impediments", "dependency-map", "planning-poker"]);
    expect(out.tools[0].why).toMatch(/^“blockers” came up in 3 notes: the Impediment Tracker/);
    expect(out.tools[1].why).toMatch(/^“dependencies” came up: /);
    expect(resolveSuggestedTools(out.tools)).toHaveLength(3);
  });

  it("says so when nothing repeats, and when the week is empty", () => {
    const quiet = weeklyFallback({
      weekStart: week,
      notes: [
        { date: week, body: "Kudos to the team.", tags: [] },
        { date: week, body: "Mood is low, people are tired.", tags: [] },
      ],
    });
    expect(quiet.summary).toBe(
      "2 notes in the week of 9 Nov 2026. No theme came up in more than one note."
    );
    expect(quiet.patterns).toEqual([]);
    expect(quiet.tools.map((t) => t.id)).toEqual(["kudos", "mood-tracker"]);
    expect(weeklyFallback({ weekStart: week, notes: [] })).toEqual({
      summary: "No notes in the week of 9 Nov 2026 yet.",
      patterns: [],
      tools: [],
    });
  });

  it("keeps a summary as a note's title and text", () => {
    expect(summaryNoteTitle(week)).toBe("Week of 9 Nov 2026: summary");
    expect(summaryNoteBody(" A calm week. ", ["One", "  ", "Two\nlines"])).toBe(
      "A calm week.\n\nPatterns:\n- One\n- Two lines"
    );
    expect(summaryNoteBody("Only this.", [])).toBe("Only this.");
  });
});

describe("the next step", () => {
  const today = "2026-11-12";

  it("points a theme from three recent notes to its tool", () => {
    const list = [
      note("a", "2026-11-12", { tags: ["blockers"] }),
      note("b", "2026-11-05", { body: "Blocked again." }),
      note("c", "2026-10-30", { tags: ["blocker"] }),
    ];
    expect(notebookNextSteps(list, today)).toEqual([
      {
        id: "sm-notebook-theme",
        label: "Try Impediment Tracker for “blockers”",
        detail: "“blockers” came up in 3 of your notes in the last two weeks.",
        href: "/impediments",
      },
    ]);
  });

  it("takes a theme with no tool to the retro", () => {
    const list = ["a", "b", "c"].map((id) => note(id, today, { tags: ["pairing rota"] }));
    expect(notebookNextSteps(list, today)).toEqual([
      expect.objectContaining({
        id: "sm-notebook-retro",
        label: "Take “pairing rota” to the retro",
        href: "/retro",
      }),
    ]);
  });

  it("ignores examples, summaries, old notes and themes under three notes", () => {
    const list = [
      note("example-a", today, { tags: ["blockers"] }),
      note("b", today, { tags: ["blockers", SUMMARY_TAG] }),
      note("c", "2026-10-29", { tags: ["blockers"] }),
      note("d", today, { tags: ["blockers"] }),
      note("e", today, { tags: ["blockers"] }),
    ];
    expect(NEXT_STEP_NOTES).toBe(3);
    expect(notebookNextSteps(list, today)).toEqual([]);
    expect(notebookNextSteps(undefined, today)).toEqual([]);
  });
});

describe("templates and hand-offs", () => {
  it("fills an empty note, or adds the prompts under the text", () => {
    const t = NOTE_TEMPLATES.find((x) => x.id === "experiment")!;
    expect(bodyWithTemplate("", t)).toBe(t.body);
    expect(bodyWithTemplate("Seen today.  \n", t)).toBe(`Seen today.\n\n${t.body}`);
    expect(NOTE_TEMPLATES.map((x) => x.label)).toEqual([
      "Observation",
      "Coaching moment",
      "Experiment",
      "1:1 note",
      "Impediment pattern",
    ]);
    for (const x of NOTE_TEMPLATES)
      if (x.linkedTool) expect(getToolById(x.linkedTool)).toBeDefined();
  });

  it("hands a note on with its name, text and a way back", () => {
    const e = note("n1", "2026-11-12", { title: "Sandbox", body: "Blocked for three days." });
    expect(noteHandoffSource(e)).toEqual({
      title: "Sandbox",
      description: "Blocked for three days.",
      sourceRef: { tool: "sm-notebook", id: "n1" },
    });
    const a = { route: "impediment" as const, targetId: "i1", at: AT };
    const b = { route: "retro-action" as const, targetId: "r1", at: AT };
    expect(addedLinks([a], [a, b])).toEqual([b]);
    expect(addedLinks(undefined, [a])).toEqual([a]);
    expect(addedLinks([a, b], [a])).toEqual([]);
  });
});
