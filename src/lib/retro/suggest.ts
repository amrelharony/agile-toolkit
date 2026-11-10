/**
 * One format suggested for the sprint a retro looks back on, read from the
 * facts the retro already has (lib/retro/facts), with the reason in one
 * short line. It is a hint for the Scrum Master in the format picker (and
 * in tool.retro.list_state), never a pick made for them.
 *
 *   mood averaged LOW_MOOD (2.5 of 5) or lower  → Mad / Sad / Glad
 *   the sprint goal was not met, or partly met   → Sailboat
 *   under 90% of the commitment was done          → DAKI
 *
 * In that order, when several hold: a team that felt low needs to say so
 * before it can look at its process; a missed goal is about what held the
 * sprint back and what lies ahead (Sailboat's anchors, rocks and island);
 * unfinished, carried-over work is about what to drop, add, keep and
 * improve. Nothing to go on, or a sprint that went fine: no suggestion.
 *
 * Pure: the caller passes the facts.
 */

import { fmt, plural } from "@/lib/charts/chart-text";
import { LOW_MOOD } from "@/lib/team/mood";
import type { RetroFacts } from "./facts";

export interface FormatSuggestion {
  /** A built-in format's id (lib/constants/retro-formats). */
  formatId: "mad-sad-glad" | "sailboat" | "daki";
  /** Why, in one short line that names the sprint. */
  reason: string;
}

type Facts = Pick<
  RetroFacts,
  "sprintName" | "goalOutcome" | "committed" | "completed" | "sayDo" | "mood"
>;

/** The format to suggest for these facts, or null when nothing calls for one. */
export function suggestFormat(facts: Facts | null | undefined): FormatSuggestion | null {
  if (!facts) return null;
  const sprint = facts.sprintName;
  const mood = facts.mood.average;
  if (mood !== null && mood <= LOW_MOOD) {
    return {
      formatId: "mad-sad-glad",
      reason: `Mood in ${sprint} averaged ${fmt(mood)} out of 5: start with how people felt.`,
    };
  }
  const met = facts.goalOutcome?.met;
  if (met === "not-met" || met === "partly") {
    return {
      formatId: "sailboat",
      reason: `${sprint} ${met === "partly" ? "partly met" : "didn't meet"} its goal: look at what held it back and what lies ahead.`,
    };
  }
  const grade = facts.sayDo?.grade;
  if ((grade === "close" || grade === "missed") && facts.completed < facts.committed) {
    const left = facts.committed - facts.completed;
    return {
      formatId: "daki",
      reason: `${sprint} left ${fmt(left)} of ${plural(facts.committed, "committed point")} unfinished: agree what to drop, add, keep and improve.`,
    };
  }
  return null;
}
