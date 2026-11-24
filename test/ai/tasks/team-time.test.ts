// @vitest-environment node
/**
 * The golden test for team-time.schedule_note: a short note on the team's
 * schedule with up to four tips. A canned answer reads into the note, a
 * long or partly bad one is salvaged (good tips kept, at most four) or
 * refused, the prompt carries the facts as data and no names, the rules'
 * fallback answers validly, the largest input (in 3-byte text) fits the
 * route's body budget, and the page's input merges places first.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { SCHEDULE_NOTE_MAX, teamTimeScheduleNoteTask } from "@/lib/ai/tasks/team-time";
import { teamTimeScheduleNotePrompt } from "@/lib/ai/tasks/team-time.server";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { scheduleNoteInput } from "@/lib/team-time/note";
import { london, newYork, person } from "../../team-time/fixtures";

const task = teamTimeScheduleNoteTask;
/** A BMP character that is 3 bytes in UTF-8 and counts 1 toward `.max()`. */
const wide = (n: number) => "時".repeat(n);

describe("team-time.schedule_note", () => {
  it("is a quick task anyone may run, with a list's token budget", () => {
    expect(task).toMatchObject({
      id: "team-time.schedule_note",
      toolId: "team-time",
      tier: "flash",
      effort: "low",
      maxTokens: 4096,
    });
    expect(task.ownerOnly).toBeUndefined();
  });

  it("caps its input: 1 to 12 places, real offsets, minutes within a day", () => {
    const place = task.sample.places[0];
    expect(task.input.safeParse(task.sample).success).toBe(true);
    expect(task.input.safeParse({ ...task.sample, places: [] }).success).toBe(false);
    expect(
      task.input.safeParse({ ...task.sample, places: Array.from({ length: 13 }, () => place) })
        .success
    ).toBe(false);
    expect(
      task.input.safeParse({ ...task.sample, places: [{ ...place, offsetMinutes: 900 }] }).success
    ).toBe(false);
    expect(task.input.safeParse({ ...task.sample, overlapMinutes: 1441 }).success).toBe(false);
    expect(
      task.input.safeParse({ ...task.sample, places: [{ ...place, label: wide(61) }] }).success
    ).toBe(false);
  });

  it("reads a typical model answer", () => {
    const answer =
      '```json\n{"note":"The team spans 16 hours, so nobody shares a whole hour with everyone.","tips":["Move the Daily Scrum into the written standup.","Rotate the Retro between a Europe morning and an Americas afternoon."]}\n```';
    expect(parseAnswer(answer, task.output)).toEqual({
      ok: true,
      data: {
        note: "The team spans 16 hours, so nobody shares a whole hour with everyone.",
        tips: [
          "Move the Daily Scrum into the written standup.",
          "Rotate the Retro between a Europe morning and an Americas afternoon.",
        ],
      },
    });
  });

  it("keeps four good tips of a long, partly bad answer, and refuses an empty note", () => {
    const answer = JSON.stringify({
      note: "A short note.",
      tips: ["", "One.", "Two.", "Three.", "Four.", "Five."],
    });
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.tips.length).toBeLessThanOrEqual(SCHEDULE_NOTE_MAX.tips);
      expect(parsed.data.tips).not.toContain("");
    }
    expect(parseAnswer('{"note":"  ","tips":[]}', task.output).ok).toBe(false);
  });

  it("answers without AI with a valid note", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.note).toBe(
      "The team works in 5 places, from Sydney to Toronto, 16 hours apart. No hour covers everyone; all but one share 1 h on the best day."
    );
    expect(out.tips[0]).toMatch(/^Use the written standup/);
    expect(out.tips).toContain(
      "Rotate Daily Scrum: it lands at night or on a day off for 1 person."
    );
  });

  it("keeps the fallback inside its caps at the largest input", () => {
    const largest = {
      places: Array.from({ length: SCHEDULE_NOTE_MAX.places }, (_, i) => ({
        label: wide(SCHEDULE_NOTE_MAX.label),
        offsetMinutes: 840 - i * 60,
        people: 50,
        hours: "09:00–17:30",
        days: wide(SCHEDULE_NOTE_MAX.days),
      })),
      overlapMinutes: 0,
      mostOverlapMinutes: 0,
      meetings: Array.from({ length: SCHEDULE_NOTE_MAX.meetings }, () => ({
        name: wide(SCHEDULE_NOTE_MAX.meetingName),
        outsideHours: 50,
        nightOrDayOff: 50,
      })),
      anchorDays: Array.from({ length: SCHEDULE_NOTE_MAX.anchorDays }, () => ({
        site: wide(SCHEDULE_NOTE_MAX.site),
        days: [0, 1, 2, 3, 4, 5, 6],
      })),
      clockChanges: Array.from({ length: SCHEDULE_NOTE_MAX.clockChanges }, () =>
        wide(SCHEDULE_NOTE_MAX.clockChange)
      ),
    };
    const parsed = task.input.parse(largest);
    expect(task.output.safeParse(task.fallback(parsed)).success).toBe(true);
    // The whole request body, in 3-byte text, fits the route's budget: no fitter needed.
    expect(jsonBytes({ task: task.id, input: parsed })).toBeLessThan(TOOL_AI_BODY_BUDGET);
  });

  it("builds the prompt on the server, the facts inside the block", () => {
    expect(buildTaskSystem(task, teamTimeScheduleNotePrompt)).toContain("2 or 3 plain sentences");
    const user = buildTaskUser(teamTimeScheduleNotePrompt, task.input.parse(task.sample));
    expect(user.startsWith("<user_content>\n")).toBe(true);
    expect(user).toContain("- Sydney (UTC+11): 1 person, 07:00–15:00, Mon–Fri");
    expect(user).toContain("All but one share: 1 h 0 min on the best day.");
    expect(user).toContain("- Retro: outside working hours for 3, at night or on a day off for 2");
    expect(user).toContain("Anchor days: London office on Thu");
  });

  it("gets places from the page, never a person's name", () => {
    const people = [
      london,
      person({
        id: "x",
        name: "Very Private",
        timeZone: "Europe/London",
        start: "09:00",
        end: "17:30",
      }),
      newYork,
    ];
    const input = scheduleNoteInput({
      people,
      now: new Date("2026-11-18T10:00:00Z"),
      zone: "UTC",
      cadence: null,
      rotations: [],
    });
    expect(task.input.safeParse(input).success).toBe(true);
    expect(input.places.map((p) => [p.label, p.people])).toEqual([
      ["London", 2],
      ["New York", 1],
    ]);
    expect(JSON.stringify(input)).not.toMatch(/Very Private|Lou|Noor/);
  });
});
