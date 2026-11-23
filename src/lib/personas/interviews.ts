/**
 * The notes "From interviews" drafts a persona from: the picked interviews
 * of the User Interview Log, anonymised the way its own export is
 * (anonymiseInterviews: each participant becomes "Participant N", and the
 * context and quotes go through redactPii and lose the participant's own
 * name). Only the context and the quotes' text go in: never a date, a tag
 * or an id. Other people's names inside a quote aren't caught, which the
 * page says beside the button. Pure and server-safe.
 */

import type { Interview } from "@/lib/stores/workspace-types";
import { anonymiseInterviews } from "@/lib/interviews/model";
import { PERSONA_INTERVIEWS_MAX } from "./model";
import { PERSONA_NOTES_MAX } from "./from-notes";

/** The notes' cap: what the draft task takes. */
export const INTERVIEW_NOTES_MAX = PERSONA_NOTES_MAX;

/** One interview as lines: the pseudonym, then its context, then each quote in quotation marks. */
function interviewBlock(i: Interview): { head: string; lines: string[] } {
  const oneLine = (s: string) => s.trim().replace(/\s+/g, " ");
  return {
    head: `${i.participant}:`,
    lines: [
      ...(i.context?.trim() ? [oneLine(i.context)] : []),
      ...(i.quotes ?? [])
        .map((q) => oneLine(q.text ?? ""))
        .filter(Boolean)
        .map((t) => `“${t}”`),
    ],
  };
}

/**
 * The picked interviews (at most PERSONA_INTERVIEWS_MAX) as notes, a blank
 * line between interviews, at most INTERVIEW_NOTES_MAX characters. It
 * stops at a whole line: the last interview keeps the lines that fit, and
 * one whose first line doesn't fit is left out (a single line longer than
 * the cap, alone, is cut to it).
 */
export function interviewNotes(selected: readonly Interview[]): string {
  let out = "";
  for (const i of anonymiseInterviews(selected.slice(0, PERSONA_INTERVIEWS_MAX))) {
    const { head, lines } = interviewBlock(i);
    if (lines.length === 0) continue;
    let block = `${out ? `${out}\n\n` : ""}${head}`;
    let kept = 0;
    for (const l of lines) {
      if (block.length + 1 + l.length > INTERVIEW_NOTES_MAX) break;
      block = `${block}\n${l}`;
      kept++;
    }
    if (kept === 0) {
      if (!out) return `${head}\n${lines[0]}`.slice(0, INTERVIEW_NOTES_MAX);
      break;
    }
    out = block;
    if (kept < lines.length) break;
  }
  return out;
}
