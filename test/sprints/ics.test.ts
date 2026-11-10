import { describe, expect, it } from "vitest";
import type { Sprint } from "@/lib/stores/workspace-types";
import {
  CEREMONY_HREF,
  DEFAULT_CADENCE,
  ceremonyDates,
  ceremonyTimeboxMinutes,
  localDateTime,
  type CeremonyKind,
} from "@/lib/sprints/cadence";
import {
  CEREMONY_REMINDER_MINUTES,
  MAX_LINE_OCTETS,
  calendarActions,
  escapeIcsText,
  foldIcsLine,
  icsUtc,
  sprintCalendar,
  sprintCalendarEntries,
  weeklyStoryStart,
  type CalendarAction,
  type SprintCalendarInput,
} from "@/lib/sprints/ics";
import { sprintLengthDays } from "@/lib/sprints/series";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";

/**
 * The sprint's calendar file (RFC 5545): the format itself (line endings,
 * folding, escaping), one entry per ceremony with holidays skipped, UIDs that
 * stay the same from one download to the next, the two optional extras, and
 * a sprint without dates. Times are compared through `localDateTime`, so the
 * tests read the same in any time zone; the change from local time to UTC
 * itself is checked against written-out values with the zone pinned
 * (`inZone`), since on a UTC machine the two read the same.
 */

// Monday 19 Oct 2026 to Friday 30 Oct 2026: planning, 9 dailies, 2 refinements, review, retro.
const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  goal: "Checkout works end to end",
  pointsPlanned: 30,
  status: "active",
};
const ORIGIN = "https://agile.amrelharony.com";
const NOW = new Date(Date.UTC(2026, 9, 18, 16, 5, 9));

const input = (over: Partial<SprintCalendarInput> = {}): SprintCalendarInput => ({
  sprint: SPRINT,
  cadence: DEFAULT_CADENCE,
  now: NOW,
  origin: ORIGIN,
  ...over,
});
const build = (over: Partial<SprintCalendarInput> = {}) => {
  const calendar = sprintCalendar(input(over));
  if (!calendar) throw new Error("no calendar");
  return calendar;
};

const octets = (s: string) => new TextEncoder().encode(s).length;
/** The file's lines as they were before folding. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");
/** A TEXT value back as the words that went in. */
const unescape = (value: string) =>
  value.replace(/\\([\\;,n])/g, (_, c: string) => (c === "n" ? "\n" : c));
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

type Event = string[];
/** Each VEVENT's lines, unfolded, without its BEGIN and END. */
function events(ics: string): Event[] {
  const out: Event[] = [];
  let current: Event | null = null;
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT") {
      if (current) out.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  return out;
}
/** The value of the first `name` line (with or without parameters), or undefined. */
const prop = (event: Event, name: string): string | undefined => {
  const line = event.find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
  return line?.slice(line.indexOf(":") + 1);
};
const uids = (ics: string) => events(ics).map((e) => prop(e, "UID"));
const byUid = (ics: string, uid: string) => {
  const event = events(ics).find((e) => prop(e, "UID") === uid);
  if (!event) throw new Error(`no entry ${uid}`);
  return event;
};
const uidOf = (kind: CeremonyKind, day: string, sprintId = "s1") =>
  `sprint-${sprintId}-${kind}-${day}@agile.amrelharony.com`;

/** Monday 19 Oct to Monday 2 Nov 2026: two weeks, so a 4 h planning, a 2 h review and a 1 h 30 retro. */
const TWO_WEEKS: Sprint = { ...SPRINT, endDate: "2026-11-02" };

/**
 * Run with this process's time zone set to `zone`, then put it back (as
 * test/tools/retro-actions-upgrade does). A local time is then a known UTC
 * instant on any machine, a UTC runner included.
 */
function inZone(zone: string, run: () => void): void {
  const before = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = zone;
  try {
    run();
  } finally {
    process.env.TZ = before;
  }
}

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon and comma, and writes a line break as \\n", () => {
    expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escapeIcsText("one\ntwo\r\nthree\rfour")).toBe("one\\ntwo\\nthree\\nfour");
    // A backslash typed before an "n" stays a backslash and an "n".
    expect(unescape(escapeIcsText("C:\\new, then; done"))).toBe("C:\\new, then; done");
  });

  it("leaves colons and quotes, turns a tab into a space and drops other control characters", () => {
    expect(escapeIcsText('09:30 "sharp"')).toBe('09:30 "sharp"');
    expect(escapeIcsText("a\tb\u0000c\u0007d\u007fe")).toBe("a bcde");
  });
});

describe("foldIcsLine", () => {
  it("leaves a line of 75 octets alone and folds one of 76", () => {
    const line75 = `SUMMARY:${"x".repeat(67)}`;
    expect(octets(line75)).toBe(MAX_LINE_OCTETS);
    expect(foldIcsLine(line75)).toBe(line75);
    expect(foldIcsLine(`${line75}y`)).toBe(`${line75}\r\n y`);
  });

  it("keeps every line to 75 octets, starts each continuation with one space, and unfolds to the same text", () => {
    const line = `DESCRIPTION:${"The quick brown fox jumps over the lazy dog. ".repeat(12)}`;
    const parts = foldIcsLine(line).split("\r\n");
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) expect(octets(part)).toBeLessThanOrEqual(MAX_LINE_OCTETS);
    // Full lines: only the last may be short.
    for (const part of parts.slice(0, -1)) expect(octets(part)).toBe(MAX_LINE_OCTETS);
    for (const part of parts.slice(1)) expect(part.startsWith(" ")).toBe(true);
    // Taking one space off each continuation gives the line back: no more was added.
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });

  it("counts octets, not characters, and never cuts a character in half", () => {
    // Arabic letters take two octets each, the emoji four (a surrogate pair).
    const line = `SUMMARY:${"مراجعة السبرنت ".repeat(10)}${"🎯".repeat(30)} é`;
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) {
      expect(octets(part)).toBeLessThanOrEqual(MAX_LINE_OCTETS);
      expect(part).not.toMatch(LONE_SURROGATE);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("keeps a backslash on the line of the character it escapes", () => {
    // The pair would straddle octets 75 and 76: it moves down whole.
    const line = `SUMMARY:${"x".repeat(66)}\\,tail`;
    expect(foldIcsLine(line)).toBe(`SUMMARY:${"x".repeat(66)}\r\n \\,tail`);
  });
});

describe("icsUtc", () => {
  it("writes an instant as a UTC date-time", () => {
    expect(icsUtc(new Date(Date.UTC(2026, 9, 19, 8, 0, 0)))).toBe("20261019T080000Z");
    expect(icsUtc(new Date(Date.UTC(2027, 0, 3, 23, 59, 7)))).toBe("20270103T235907Z");
  });

  it("writes a local time as the UTC instant it is, not its own clock digits", () => {
    inZone("America/New_York", () => {
      // 10:00 in New York in October is 14:00 UTC; in January, 15:00.
      expect(icsUtc(new Date(2026, 9, 19, 10, 0, 0))).toBe("20261019T140000Z");
      expect(icsUtc(new Date(2027, 0, 4, 10, 0, 0))).toBe("20270104T150000Z");
      // Late evening is already the next day in UTC.
      expect(icsUtc(new Date(2026, 9, 19, 22, 30, 0))).toBe("20261020T023000Z");
    });
    inZone("Asia/Tokyo", () => {
      // East of UTC the instant is earlier, here the day before.
      expect(icsUtc(new Date(2026, 9, 19, 10, 0, 0))).toBe("20261019T010000Z");
      expect(icsUtc(new Date(2026, 9, 20, 8, 0, 0))).toBe("20261019T230000Z");
    });
  });
});

describe("the sprint's calendar away from UTC", () => {
  const ACTION: CalendarAction = { id: "a1", text: "Fix the build", dueDate: "2026-10-28" };

  it("writes New York's local times as UTC instants, either side of the end of summer time", () => {
    inZone("America/New_York", () => {
      // The clocks go back on Sunday 1 Nov 2026: UTC-4 before it, UTC-5 after.
      const { ics } = build({ sprint: TWO_WEEKS, actions: [ACTION], weeklyStory: true });
      const times = (kind: CeremonyKind, day: string) => {
        const event = byUid(ics, uidOf(kind, day));
        return [prop(event, "DTSTART"), prop(event, "DTEND")];
      };
      expect(times("planning", "20261019")).toEqual(["20261019T140000Z", "20261019T180000Z"]);
      expect(times("refinement", "20261021")).toEqual(["20261021T150000Z", "20261021T160000Z"]);
      expect(times("daily", "20261030")).toEqual(["20261030T133000Z", "20261030T134500Z"]);
      expect(times("daily", "20261102")).toEqual(["20261102T143000Z", "20261102T144500Z"]);
      expect(times("review", "20261102")[0]).toBe("20261102T190000Z");
      expect(times("retro", "20261102")).toEqual(["20261102T203000Z", "20261102T220000Z"]);
      // Whole days are the sprint's own dates, in any zone.
      expect(byUid(ics, "retro-action-a1@agile.amrelharony.com")).toContain(
        "DTSTART;VALUE=DATE:20261028"
      );
      expect(byUid(ics, "agile-at-work-weekly-story@agile.amrelharony.com")).toContain(
        "DTSTART;VALUE=DATE:20261025"
      );
    });
  });

  it("names a late ceremony by the sprint's own day, though its instant is the next day in UTC", () => {
    inZone("America/New_York", () => {
      const { ics } = build({
        sprint: TWO_WEEKS,
        cadence: { ...DEFAULT_CADENCE, retroTime: "22:00" },
      });
      const retro = byUid(ics, uidOf("retro", "20261102"));
      expect(prop(retro, "DTSTART")).toBe("20261103T030000Z");
      expect(prop(retro, "DTEND")).toBe("20261103T043000Z");
    });
  });

  it("writes Tokyo's local times as UTC instants, the day before for an early one", () => {
    inZone("Asia/Tokyo", () => {
      const { ics } = build({
        sprint: TWO_WEEKS,
        cadence: { ...DEFAULT_CADENCE, dailyTime: "08:00" },
        actions: [ACTION],
        weeklyStory: true,
      });
      const planning = byUid(ics, uidOf("planning", "20261019"));
      expect(prop(planning, "DTSTART")).toBe("20261019T010000Z");
      expect(prop(planning, "DTEND")).toBe("20261019T050000Z");
      // Tuesday's 08:00 Daily Scrum is Monday 23:00 UTC, and still Tuesday's entry.
      const daily = byUid(ics, uidOf("daily", "20261020"));
      expect(prop(daily, "DTSTART")).toBe("20261019T230000Z");
      expect(prop(daily, "DTEND")).toBe("20261019T231500Z");
      expect(byUid(ics, "retro-action-a1@agile.amrelharony.com")).toContain(
        "DTSTART;VALUE=DATE:20261028"
      );
      expect(byUid(ics, "agile-at-work-weekly-story@agile.amrelharony.com")).toContain(
        "DTSTART;VALUE=DATE:20261025"
      );
    });
  });
});

describe("sprintCalendar", () => {
  it("is one calendar with an entry for every ceremony of the sprint", () => {
    const calendar = build();
    const lines = unfold(calendar.ics);
    expect(lines.slice(0, 4)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Agile Toolkit//Sprint ceremonies//EN",
      "CALSCALE:GREGORIAN",
    ]);
    expect(lines.slice(-2)).toEqual(["END:VCALENDAR", ""]);
    expect(lines.some((l) => l.startsWith("METHOD"))).toBe(false);

    const all = events(calendar.ics);
    expect(all).toHaveLength(ceremonyDates(SPRINT, DEFAULT_CADENCE).length);
    expect(all).toHaveLength(14);
    expect(calendar).toMatchObject({ ceremonies: 14, actions: 0, weeklyStory: false });
    expect(calendar.filename).toBe("sprint-1-ceremonies");
    const kinds = uids(calendar.ics).map((u) => /^sprint-s1-([a-z]+)-/.exec(u ?? "")?.[1]);
    expect(kinds.filter((k) => k === "planning")).toHaveLength(1);
    expect(kinds.filter((k) => k === "daily")).toHaveLength(9);
    expect(kinds.filter((k) => k === "refinement")).toHaveLength(2);
    expect(kinds.filter((k) => k === "review")).toHaveLength(1);
    expect(kinds.filter((k) => k === "retro")).toHaveLength(1);
  });

  it("ends every line with CRLF and keeps every line to 75 octets", () => {
    const { ics } = build({
      sprint: { ...SPRINT, name: "السبرنت الأول", goal: "🎯 ".repeat(60) },
    });
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // No line break but CRLF, anywhere.
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const physical = ics.split("\r\n");
    expect(physical.some((l) => l.startsWith(" "))).toBe(true);
    for (const line of physical) {
      expect(octets(line)).toBeLessThanOrEqual(MAX_LINE_OCTETS);
      expect(line).not.toMatch(LONE_SURROGATE);
    }
  });

  it("writes start and end as UTC instants of the local time, a timebox apart, and stamps the moment it was made", () => {
    const { ics } = build();
    const length = sprintLengthDays(SPRINT);
    const cases: [CeremonyKind, string, string][] = [
      ["planning", "2026-10-19", DEFAULT_CADENCE.planningTime],
      ["daily", "2026-10-20", DEFAULT_CADENCE.dailyTime],
      ["refinement", "2026-10-21", "11:00"],
      ["review", "2026-10-30", DEFAULT_CADENCE.reviewTime],
      ["retro", "2026-10-30", DEFAULT_CADENCE.retroTime],
    ];
    for (const [kind, day, time] of cases) {
      const event = byUid(ics, uidOf(kind, day.replace(/-/g, "")));
      const start = localDateTime(day, time)!;
      const end = new Date(start.getTime() + ceremonyTimeboxMinutes(kind, length) * 60_000);
      expect(prop(event, "DTSTART"), kind).toBe(icsUtc(start));
      expect(prop(event, "DTEND"), kind).toBe(icsUtc(end));
      expect(prop(event, "DTSTART"), kind).toMatch(/^\d{8}T\d{6}Z$/);
      expect(prop(event, "DTSTAMP"), kind).toBe("20261018T160509Z");
    }
    // In time order.
    const starts = events(ics).map((e) => prop(e, "DTSTART") ?? "");
    expect([...starts].sort()).toEqual(starts);
  });

  it("gives each entry a summary, a description, a link to its tool on that sprint and a reminder 10 minutes before", () => {
    const { ics } = build();
    const days: Record<CeremonyKind, string> = {
      planning: "20261019",
      daily: "20261022",
      refinement: "20261028",
      review: "20261030",
      retro: "20261030",
    };
    for (const kind of Object.keys(days) as CeremonyKind[]) {
      const event = byUid(ics, uidOf(kind, days[kind]));
      // The same address the sprint tools' own links use.
      const url = `${ORIGIN}${sprintHref(CEREMONY_HREF[kind], SPRINT.id)}`;
      expect(prop(event, "URL"), kind).toBe(url);
      const description = unescape(prop(event, "DESCRIPTION") ?? "");
      expect(description, kind).toContain(`Open it on Sprint 1: ${url}`);
      expect(description, kind).toContain("Sprint goal: Checkout works end to end");
      expect(description, kind).toContain("This entry is a snapshot");

      const alarm = event.slice(event.indexOf("BEGIN:VALARM"), event.indexOf("END:VALARM") + 1);
      expect(alarm[1], kind).toBe("ACTION:DISPLAY");
      expect(alarm[2], kind).toMatch(/^DESCRIPTION:.+ starts in 10 minutes$/);
      expect(alarm[3], kind).toBe(`TRIGGER:-PT${CEREMONY_REMINDER_MINUTES}M`);
      expect(alarm).toHaveLength(5);
      // Busy time: only the all-day extras are marked free.
      expect(prop(event, "TRANSP"), kind).toBeUndefined();
    }
    const daily = byUid(ics, uidOf("daily", "20261022"));
    expect(prop(daily, "SUMMARY")).toBe("Daily Scrum · Sprint 1");
    expect(prop(daily, "URL")).toBe("https://agile.amrelharony.com/standup?sprint=s1");
    expect(unescape(prop(daily, "DESCRIPTION") ?? "")).toMatch(/^Timebox: 15 min\.\n/);
    expect(prop(byUid(ics, uidOf("retro", "20261030")), "URL")).toBe(
      "https://agile.amrelharony.com/retro?sprint=s1"
    );
  });

  it("makes the same UIDs on every build, one per ceremony and day", () => {
    const first = build().ics;
    const later = build({
      now: new Date(Date.UTC(2026, 9, 25, 7, 0, 0)),
      // A preview host links to itself, and still names the entries the same.
      origin: "https://preview.example.test/",
    }).ics;
    expect(uids(later)).toEqual(uids(first));
    expect(new Set(uids(first)).size).toBe(14);
    expect(uids(first)).toContain("sprint-s1-planning-20261019@agile.amrelharony.com");
    expect(uids(first)).toContain("sprint-s1-daily-20261020@agile.amrelharony.com");

    // Made at another moment on the same site, only the stamps differ.
    const again = unfold(build({ now: new Date(Date.UTC(2026, 9, 25, 7, 0, 0)) }).ics);
    const differing = unfold(first).filter((line, i) => line !== again[i]);
    expect(differing.length).toBe(14);
    expect(differing.every((l) => l.startsWith("DTSTAMP:"))).toBe(true);

    // A moved Daily Scrum keeps its UID, so a calendar can move the entry.
    const moved = build({ cadence: { ...DEFAULT_CADENCE, dailyTime: "10:15" } }).ics;
    expect(uids(moved)).toEqual(expect.arrayContaining(uids(first)));
    expect(prop(byUid(moved, uidOf("daily", "20261020")), "DTSTART")).toBe(
      icsUtc(localDateTime("2026-10-20", "10:15")!)
    );
  });

  it("keeps the UIDs of two sprints apart, whatever is in their ids", () => {
    const odd = build({ sprint: { ...SPRINT, id: "a,b;c d" } }).ics;
    const plain = build({ sprint: { ...SPRINT, id: "abcd" } }).ics;
    for (const uid of uids(odd)) expect(uid).toMatch(/^[A-Za-z0-9._@-]+$/);
    expect(uids(odd)).toContain("sprint-a_2c_b_3b_c_20_d-planning-20261019@agile.amrelharony.com");
    expect(uids(odd).filter((u) => uids(plain).includes(u))).toEqual([]);
    expect(prop(events(odd)[0], "URL")).toBe(
      "https://agile.amrelharony.com/sprint-planning?sprint=a%2Cb%3Bc%20d"
    );
  });

  it("skips the Daily Scrum and the refinement on a holiday", () => {
    // Wednesday 21 Oct has both; Friday 23 Oct a Daily Scrum.
    const cadence = { ...DEFAULT_CADENCE, holidays: ["2026-10-21", "2026-10-23"] };
    const calendar = build({ cadence });
    expect(calendar.ceremonies).toBe(11);
    const all = uids(calendar.ics);
    expect(all.filter((u) => u?.includes("-20261021@") || u?.includes("-20261023@"))).toEqual([]);
    expect(all).toContain(uidOf("daily", "20261022"));
    expect(all).toContain(uidOf("refinement", "20261028"));
    // The days either side are untouched, and so are the sprint's own events.
    expect(all.filter((u) => u?.includes("-daily-"))).toHaveLength(7);
    expect(all).toContain(uidOf("review", "20261030"));
  });

  it("escapes what the team typed", () => {
    const sprint = {
      ...SPRINT,
      name: "Sprint 7, checkout; round 2",
      goal: "Pay by card\nand by wallet, both\\either",
    };
    const { ics } = build({ sprint });
    const planning = events(ics)[0];
    expect(prop(planning, "SUMMARY")).toBe("Sprint Planning · Sprint 7\\, checkout\\; round 2");
    const raw = prop(planning, "DESCRIPTION") ?? "";
    expect(raw).toContain("Sprint goal: Pay by card\\nand by wallet\\, both\\\\either");
    expect(unescape(raw)).toContain("Sprint goal: Pay by card\nand by wallet, both\\either");
  });

  it("has no file for a sprint without dates, whatever else is asked for", () => {
    const actions: CalendarAction[] = [{ id: "a1", text: "Fix the build", dueDate: "2026-10-28" }];
    for (const dates of [
      { startDate: "", endDate: "" },
      { startDate: "2026-10-19", endDate: "" },
      // The old Velocity tool's placeholder dates.
      { startDate: "2020-01-05", endDate: "2020-01-15" },
    ]) {
      const sprint = { ...SPRINT, ...dates };
      expect(sprintCalendar(input({ sprint, actions, weeklyStory: true }))).toBeNull();
      expect(sprintCalendarEntries(input({ sprint, actions, weeklyStory: true }))).toEqual({
        entries: [],
        ceremonies: 0,
        actions: 0,
        weeklyStory: false,
      });
    }
  });
});

describe("open retro actions in the calendar", () => {
  const ACTIONS: CalendarAction[] = [
    {
      id: "late",
      text: "Pair on the flaky test",
      assignee: "Omar",
      dueDate: "2026-10-31",
      retroLabel: "Start, Stop, Continue · 16 Oct 2026",
    },
    {
      id: "soon",
      text: "Fix the build, then; tell the team",
      assignee: " ",
      dueDate: "2026-10-28",
    },
    { id: "done", text: "Already done", dueDate: "2026-10-27", done: true },
    { id: "undated", text: "No due date" },
    { id: "impossible", text: "No such day", dueDate: "2026-02-30" },
  ];

  it("keeps the open ones with a due date that exists", () => {
    expect(calendarActions(ACTIONS).map((a) => a.id)).toEqual(["late", "soon"]);
  });

  it("adds each as an all-day entry on its due date, after the ceremonies, soonest first", () => {
    const calendar = build({ actions: ACTIONS });
    expect(calendar).toMatchObject({ ceremonies: 14, actions: 2, weeklyStory: false });
    const extra = events(calendar.ics).slice(14);
    expect(extra.map((e) => prop(e, "UID"))).toEqual([
      "retro-action-soon@agile.amrelharony.com",
      "retro-action-late@agile.amrelharony.com",
    ]);

    const [soon, late] = extra;
    expect(soon).toContain("DTSTART;VALUE=DATE:20261028");
    expect(soon).toContain("DTEND;VALUE=DATE:20261029");
    // The end is the next morning, across a month's end too.
    expect(late).toContain("DTSTART;VALUE=DATE:20261031");
    expect(late).toContain("DTEND;VALUE=DATE:20261101");
    for (const event of extra) {
      expect(event).toContain("TRANSP:TRANSPARENT");
      expect(event).not.toContain("BEGIN:VALARM");
      expect(prop(event, "URL")).toBe("https://agile.amrelharony.com/retro-actions");
    }
    expect(prop(soon, "SUMMARY")).toBe("Retro action due: Fix the build\\, then\\; tell the team");
    expect(unescape(prop(soon, "DESCRIPTION") ?? "")).toContain("No owner yet.");
    const description = unescape(prop(late, "DESCRIPTION") ?? "");
    expect(description).toContain("Owner: Omar");
    expect(description).toContain("From: Start, Stop, Continue · 16 Oct 2026");
  });

  it("names an action's entry by its card, so a moved due date moves the entry", () => {
    const moved = ACTIONS.map((a) => (a.id === "soon" ? { ...a, dueDate: "2026-11-04" } : a));
    const before = uids(build({ actions: ACTIONS }).ics);
    const after = build({ actions: moved }).ics;
    expect([...uids(after)].sort()).toEqual([...before].sort());
    expect(byUid(after, "retro-action-soon@agile.amrelharony.com")).toContain(
      "DTSTART;VALUE=DATE:20261104"
    );
  });

  it("keeps a long, many-line action to a one-line title and the whole text in the description", () => {
    const text = `Write down\nhow we deploy ${"step by step ".repeat(20)}`.trim();
    const { ics } = build({ actions: [{ id: "long", text, dueDate: "2026-10-28" }] });
    const event = byUid(ics, "retro-action-long@agile.amrelharony.com");
    const summary = unescape(prop(event, "SUMMARY") ?? "");
    expect(summary).not.toContain("\n");
    expect(Array.from(summary).length).toBeLessThanOrEqual(120);
    expect(Array.from(summary).length).toBeGreaterThan(100);
    expect(summary.startsWith("Retro action due: Write down how we deploy step by step")).toBe(
      true
    );
    expect(summary.endsWith("…")).toBe(true);
    expect(unescape(prop(event, "DESCRIPTION") ?? "").startsWith(`${text}\n`)).toBe(true);
  });
});

describe("the weekly Agile at Work story in the calendar", () => {
  it("is left out unless asked for", () => {
    const { ics, weeklyStory } = build();
    expect(weeklyStory).toBe(false);
    expect(ics).not.toContain("RRULE");
  });

  it("is one all-day entry on the sprint's first Sunday that repeats every week", () => {
    const calendar = build({ weeklyStory: true });
    expect(calendar).toMatchObject({ ceremonies: 14, actions: 0, weeklyStory: true });
    const all = events(calendar.ics);
    expect(all).toHaveLength(15);
    const story = all[14];
    // The same UID in every sprint's file, so a calendar keeps one entry.
    expect(prop(story, "UID")).toBe("agile-at-work-weekly-story@agile.amrelharony.com");
    expect(story).toContain("DTSTART;VALUE=DATE:20261025");
    expect(story).toContain("DTEND;VALUE=DATE:20261026");
    expect(story).toContain("RRULE:FREQ=WEEKLY");
    expect(story).toContain("SUMMARY:New Agile at Work story");
    expect(story).toContain("TRANSP:TRANSPARENT");
    expect(story).not.toContain("BEGIN:VALARM");
    expect(prop(story, "URL")).toBe("https://agile.amrelharony.com/comics");
    expect(new Date(Date.UTC(2026, 9, 25)).getUTCDay()).toBe(0);
  });

  it("starts on the sprint's first day when that is a Sunday, else on the next one", () => {
    expect(weeklyStoryStart({ startDate: "2026-10-18" })).toBe("2026-10-18");
    expect(weeklyStoryStart({ startDate: "2026-10-19" })).toBe("2026-10-25");
    expect(weeklyStoryStart({ startDate: "2026-10-24" })).toBe("2026-10-25");
    // Into the next month and year.
    expect(weeklyStoryStart({ startDate: "2026-12-28" })).toBe("2027-01-03");
    expect(weeklyStoryStart({ startDate: "" })).toBeNull();
  });
});
