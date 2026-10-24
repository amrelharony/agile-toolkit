import { agendaSeconds, durationText, minutesText, shortClock, type Agenda } from "./agenda";
import type { RunReport } from "./run";
import { MIN_TURN_SECONDS } from "./speakers";

/** Over or under by less than this is "on time": nobody watches the seconds. */
const ON_TIME_SECONDS = 60;
/** A segment or turn is worth naming once it ran over by this much. */
const NOTABLE_SEGMENT_OVER = 60;
const NOTABLE_TURN_OVER = 30;

/** "took 18 of 12 minutes", or in clock time for short or uneven ones ("took 1:40 of 1:00"). */
function took(actual: number, planned: number): string {
  const whole = planned % 60 === 0 && planned >= 120 && actual >= 120;
  return whole
    ? `took ${Math.round(actual / 60)} of ${Math.round(planned / 60)} minutes`
    : `took ${shortClock(actual)} of ${shortClock(planned)}`;
}

/**
 * The plan in one sentence, before the meeting: the length, and for a
 * round of speakers each one's share (or that they won't fit).
 */
export function planVerdict(agenda: Agenda, speakerCount: number): string {
  const total = agendaSeconds(agenda);
  if (total <= 0) return "Set the length of the time-box to start.";
  const segs = agenda.segments;
  if (segs.length === 1) {
    const [only] = segs;
    if (!only.speakers) return `${agenda.label}: ${durationText(total)}, one shared time-box.`;
    if (speakerCount === 0) {
      return `${agenda.label}: ${durationText(total)}. Add speakers to give each a fair turn.`;
    }
    if (speakerCount * MIN_TURN_SECONDS > total) {
      return `${agenda.label}: ${speakerCount} speakers need at least ${shortClock(speakerCount * MIN_TURN_SECONDS)}, and the time-box is ${durationText(total)}.`;
    }
    const each = Math.floor(total / speakerCount);
    return `${agenda.label}: ${durationText(total)} for ${speakerCount} ${speakerCount === 1 ? "speaker" : "speakers"}, ${shortClock(each)} each.`;
  }
  return `${agenda.label}: ${segs.length} segments in ${durationText(total)}.`;
}

/**
 * The result in one sentence, once the meeting is over: on time, over or
 * early, and the segment (or, in a single round, the speaker) that ran
 * over the most. "Retro ran 7 minutes over; Generate insights took 18 of
 * 12 minutes."
 */
export function runVerdict(report: RunReport): string {
  const diff = report.actualSeconds - report.plannedSeconds;
  const ran = report.segments.filter(
    (s): s is typeof s & { actualSeconds: number } => s.actualSeconds !== null
  );

  let detail = "";
  const worst = ran
    .map((s) => ({ s, over: s.actualSeconds - s.plannedSeconds }))
    .filter((x) => x.over >= NOTABLE_SEGMENT_OVER)
    .sort((a, b) => b.over - a.over)[0];
  if (report.segments.length > 1 && worst) {
    detail = `${worst.s.label} ${took(worst.s.actualSeconds, worst.s.plannedSeconds)}`;
  } else {
    const turn = ran
      .flatMap((s) => s.turns)
      .filter((t) => !t.skipped)
      .map((t) => ({ t, over: t.actualSeconds - t.plannedSeconds }))
      .filter((x) => x.over >= NOTABLE_TURN_OVER)
      .sort((a, b) => b.over - a.over)[0];
    if (turn)
      detail = `${turn.t.name} spoke for ${shortClock(turn.t.actualSeconds)} of ${shortClock(turn.t.plannedSeconds)}`;
  }

  if (diff >= ON_TIME_SECONDS) {
    return `${report.short} ran ${minutesText(diff)} over${detail ? `; ${detail}` : ""}.`;
  }
  if (diff <= -ON_TIME_SECONDS) {
    return `${report.short} finished ${minutesText(-diff)} early${detail ? `, though ${detail}` : ""}.`;
  }
  return `${report.short} finished on time${detail ? `; ${detail}` : ""}.`;
}
