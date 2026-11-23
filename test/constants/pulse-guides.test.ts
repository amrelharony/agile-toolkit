// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_GUIDES } from "@/lib/tools/guides/core";
import { GUIDES } from "@/lib/tools/guides/team";
import type { ToolGuide } from "@/lib/tools/guides";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { HEALTH_LIGHTS } from "@/lib/health-check/score";
import {
  ANOMALY_DROP,
  LEGACY_ROUND_ID,
  LEGACY_ROUND_NAME,
  PSYCH_SAFETY_MIN_RESPONSES,
  PSYCH_SAFETY_QUESTIONS,
  emptyPsychSafetyLog,
  legacyRound,
  questionLabel,
  withoutRound,
} from "@/lib/psych-safety/instrument";
import {
  LOW_MOOD,
  LOW_MOOD_DAYS,
  MOOD_LABELS,
  MOOD_WINDOW_DAYS,
  moodSummary,
} from "@/lib/team/mood";
import type { PsychSafetyResponse } from "@/lib/stores/workspace-types";

/*
 * The pulse guides (Squad Health Check, Psych Safety, Mood Tracker) walk
 * through the anonymous vote round as the shared kit runs it and quote the
 * minimums that keep it anonymous. These lock the kit's labels against its
 * source and the numbers against the libraries' constants, so a renamed
 * button or a changed minimum fails here instead of leaving a guide wrong.
 */

function guide(list: readonly ToolGuide[], id: string): ToolGuide {
  const found = list.find((g) => g.toolId === id);
  if (!found) throw new Error(`No guide for ${id}`);
  return found;
}

const allText = (g: ToolGuide) => [g.summary, ...g.steps, ...(g.tips ?? [])].join("\n");
const scaleValues = (g: ToolGuide, name: string) =>
  g.scales?.find((s) => s.name === name)?.values.map((v) => v.value) ?? [];

const health = guide(CORE_GUIDES, "health-check");
const psych = guide(GUIDES, "psych-safety");
const mood = guide(GUIDES, "mood-tracker");

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

/** The vote-round kit's source, where its buttons are labelled. */
const KIT = [
  "src/components/collab/vote-room/vote-round-panel.tsx",
  "src/components/collab/vote-room/host-vote-room.tsx",
  "src/components/collab/vote-room/facilitator-tally.tsx",
  "src/components/collab/visitor-room-chip.tsx",
]
  .map(source)
  .join("\n");

describe("the pulse guides run the vote round as the kit does", () => {
  const LIVE = ["Run a live round", "Copy link", "Show QR code", "Reveal results", "Save round"];
  const TALLY = ["Enter counts", "Show totals", "Save round"];

  it.each(Array.from(new Set([...LIVE, ...TALLY])))("the kit labels a button %j", (label) => {
    expect(KIT).toContain(label);
  });

  it.each([
    ["health-check", health],
    ["psych-safety", psych],
    ["mood-tracker", mood],
  ] as const)("%s names the live round's steps and the count entry", (_id, g) => {
    const text = allText(g);
    // The link is shared by Copy link or by the room chip's QR code.
    for (const label of [...LIVE, "Enter counts"]) expect(text).toContain(label);
    // The button lost its "instead" when it moved under One screen.
    expect(text).not.toContain("Enter counts instead");
  });
});

describe("the pulse guides say what is still stored per person", () => {
  it("Psych Safety: a round keeps nothing per person; the earlier sheets are still stored", () => {
    const text = allText(psych);
    expect(psych.summary).toContain("in anonymous rounds, each keeping only how many people");
    expect(text).toContain("A round keeps nothing per person.");
    expect(text).not.toMatch(/Nothing per person is kept/);
    // A sheet from before rounds keeps the name typed on it until the
    // Earlier responses round is deleted, which empties the list.
    const sheet: PsychSafetyResponse = {
      id: "r1",
      ts: "2026-01-05T10:00:00.000Z",
      scores: { q1: 2, q2: 4, q3: 2, q4: 4, q5: 2, q6: 4, q7: 4 },
      respondent: "Priya",
    };
    const log = { ...emptyPsychSafetyLog(), responses: [sheet] };
    expect(legacyRound(log.responses)?.name).toBe(LEGACY_ROUND_NAME);
    expect(log.responses[0].respondent).toBe("Priya");
    expect(withoutRound(log, LEGACY_ROUND_ID)?.responses).toEqual([]);
    expect(text).toContain(
      `Answer sheets saved one by one before rounds, with any names typed on them, are still stored and show as one round, ${LEGACY_ROUND_NAME}. Delete it to remove them.`
    );
  });

  it("Mood Tracker: switching to Anonymous keeps the check-ins by name, as the page says", () => {
    const text = allText(mood);
    expect(text).toContain("Anonymous records only team pulses");
    expect(text).not.toMatch(/Anonymous keeps only team pulses/);
    const page = source("src/app/(tools)/mood-tracker/mood-tracker-client.tsx");
    expect(page).toContain(
      "Earlier check-ins by name are kept but not shown, and still count in the team average."
    );
    // The team average reads every named check-in, whatever the mode.
    const named = ["a", "b", "c"].map((memberId, i) => ({
      id: `m_${memberId}`,
      memberId,
      date: `2026-10-0${i + 1}`,
      score: 2 as const,
    }));
    expect(moodSummary(named, [], "2026-10-01", "2026-10-03").average).toBe(2);
    // Each row's eraser clears one check-in.
    expect(source("src/app/(tools)/mood-tracker/check-in.tsx")).toMatch(
      /label=\{`Clear \$\{member\.name\}'s check-in for/
    );
    expect(text).toContain(
      "Check-ins by name already saved stay, hidden but still in the team average: clear them with the eraser under By name first if they should go."
    );
  });
});

describe("the pulse guides quote the minimums", () => {
  it("Health Check: votes from MIN_SAMPLE.anonymous answers, and its lights", () => {
    const text = allText(health);
    expect(text).toContain(`once ${MIN_SAMPLE.anonymous} have answered`);
    expect(text).toContain(`count only from ${MIN_SAMPLE.anonymous} answers`);
    expect(scaleValues(health, "Traffic light")).toEqual(
      HEALTH_LIGHTS.map((l) => l[0].toUpperCase() + l.slice(1))
    );
  });

  it("Psych Safety: results from five, the fall flagged, the reverse-scored statements", () => {
    const text = allText(psych);
    expect(text).toContain(`once ${PSYCH_SAFETY_MIN_RESPONSES} have answered`);
    expect(text).toContain(`Results wait for ${PSYCH_SAFETY_MIN_RESPONSES} responses`);
    expect(text).toContain(`more than ${ANOMALY_DROP}`);
    const reversed = PSYCH_SAFETY_QUESTIONS.filter((q) => q.reversed).map((q) =>
      questionLabel(q.id)
    );
    expect(text).toContain(
      `${reversed.slice(0, -1).join(", ")} and ${reversed[reversed.length - 1]} are reverse-scored`
    );
    expect(text).toContain(LEGACY_ROUND_NAME);
    // The uncited 4.0 benchmark and the per-person sliders are gone.
    expect(text).not.toMatch(/benchmark|slider|Submit response/i);
  });

  it("Mood Tracker: the window, the average and trend minimums, the low-mood run", () => {
    const text = allText(mood);
    expect(mood.summary).toContain(`from ${MOOD_LABELS[1]} to ${MOOD_LABELS[5]}`);
    expect(text).toContain(`${MOOD_WINDOW_DAYS}-day average`);
    expect(text).toContain(`from ${MIN_SAMPLE.average} check-ins`);
    expect(text).toContain(`from ${MIN_SAMPLE.trend} days with check-ins`);
    expect(text).toContain(`once ${MIN_SAMPLE.anonymous} have answered`);
    expect(text).toContain(
      `${LOW_MOOD} or less on ${LOW_MOOD_DAYS} check-in days in a row, each with ${MIN_SAMPLE.anonymous} or more check-ins`
    );
    // Logging is no longer today-only, and the card is no longer "Today's check-in".
    expect(text).not.toMatch(/only log today|Today's check-in/);
  });
});
