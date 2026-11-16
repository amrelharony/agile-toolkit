import { formatClock as clock } from "@/lib/timer/dock-timer";
import { agendaSeconds, type Agenda } from "./agenda";
import { anonymousSharesText, percent, type SpeakingShares } from "./history";
import type { RunReport } from "./run";
import { plannedSlots, type Participant } from "./speakers";
import { planVerdict, runVerdict } from "./verdict";

export type { Participant } from "./speakers";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * Speaking time across runs: with names, a table; without (the default),
 * one sentence with the range of shares, so the export never names who
 * spoke most unless the facilitator chose to.
 */
function sharesSection(shares: SpeakingShares | null | undefined, names: boolean): string {
  if (!shares || shares.runs === 0 || shares.people.length === 0) return "";
  const head = "## Speaking time across runs";
  if (!names) return `${head}\n\n${anonymousSharesText(shares)}`;
  return [
    head,
    "",
    shares.runs === 1
      ? "Each person's share of the speaking time in the last meeting with turns."
      : `Each person's average share of the speaking time over the last ${shares.runs} meetings with turns.`,
    "",
    "| Speaker | Share | Even share | Meetings |",
    "|---|---:|---:|---:|",
    ...shares.people.map(
      (p) =>
        `| ${cell(p.name)} | ${percent(p.share)} | ${percent(p.even)} | ${p.runs} of ${shares.runs} |`
    ),
  ].join("\n");
}

/** "+02:15" over, "−00:40" under, "00:00" on the dot. */
function signed(seconds: number): string {
  if (seconds === 0) return "00:00";
  return `${seconds > 0 ? "+" : "−"}${clock(Math.abs(seconds))}`;
}

/**
 * The ceremony as Markdown, for the meeting invite before and the team
 * channel after: the time-box, the agenda with each segment's start and
 * length, the speaking order of any round of turns (an even share each, as
 * the round starts), and, once it has run, planned against actual per
 * segment and per turn with the one-sentence verdict.
 */
export function toMarkdown(
  {
    agenda,
    speakers,
    report,
    shares,
    exportNames = false,
  }: {
    /** The agenda picked, or null before one is. */
    agenda: Agenda | null;
    speakers: readonly Participant[];
    /** The run so far, once started. */
    report?: RunReport | null;
    /** Speaking time across the meetings kept, when there are any with turns. */
    shares?: SpeakingShares | null;
    /** Name people in that section; without it, only the range of shares. */
    exportNames?: boolean;
  },
  now: Date = new Date()
): string {
  const title = `# Ceremony Timer — ${mdDate(now)}`;
  const total = agenda ? agendaSeconds(agenda) : 0;
  const across = sharesSection(shares, exportNames);
  if (!agenda || (total <= 0 && !report)) {
    return `${title}\n\nNo ceremony set up yet.\n${across ? `\n${across}\n` : ""}`;
  }

  const segs = agenda.segments;
  const lines = [title, "", `**${cell(agenda.label)}:** ${clock(total)} time-box`, ""];

  if (segs.length > 1 || report) {
    lines.push("## Agenda", "");
    if (report) {
      lines.push("| # | Segment | Planned | Actual | Difference |", "|---:|---|---:|---:|---:|");
      report.segments.forEach((s, i) => {
        // Mid-meeting, the segment on has no difference yet: it isn't over.
        const actual =
          s.actualSeconds === null ? "—" : `${clock(s.actualSeconds)}${s.current ? " so far" : ""}`;
        const diff =
          s.actualSeconds === null || s.current ? "—" : signed(s.actualSeconds - s.plannedSeconds);
        lines.push(
          `| ${i + 1} | ${cell(s.label)} | ${clock(s.plannedSeconds)} | ${actual} | ${diff} |`
        );
      });
      const total = report.finished
        ? `${clock(report.actualSeconds)} | ${signed(report.actualSeconds - report.plannedSeconds)}`
        : `${clock(report.actualSeconds)} so far | —`;
      lines.push(`| | **Total** | ${clock(report.plannedSeconds)} | ${total} |`);
    } else {
      lines.push("| # | Segment | Starts at | Time |", "|---:|---|---:|---:|");
      let start = 0;
      segs.forEach((s, i) => {
        lines.push(`| ${i + 1} | ${cell(s.label)} | ${clock(start)} | ${clock(s.seconds)} |`);
        start += s.seconds;
      });
    }
    lines.push("");
  }

  const rounds = segs
    .map((s, i) => ({ s, i, offset: segs.slice(0, i).reduce((sum, x) => sum + x.seconds, 0) }))
    .filter(({ s }) => s.speakers);
  if (rounds.length === 0) {
    lines.push(
      segs.length > 1
        ? "No round of speakers in this agenda."
        : "One shared time-box, no speaker rotation."
    );
  } else if (speakers.length === 0) {
    lines.push("No speakers added yet.");
  }

  for (const { s, i, offset } of speakers.length > 0 ? rounds : []) {
    const turns = report?.segments[i]?.turns ?? [];
    const name = segs.length > 1 ? `: ${cell(s.label)}` : "";
    if (turns.length > 0) {
      lines.push(
        `## Turns${name}`,
        "",
        "| # | Speaker | Share | Spoke |",
        "|---:|---|---:|---:|",
        ...turns.map(
          (t, n) =>
            `| ${n + 1} | ${cell(t.name)} | ${clock(t.plannedSeconds)} | ${
              t.skipped ? "skipped" : clock(t.actualSeconds)
            } |`
        ),
        ""
      );
      continue;
    }
    const slots = plannedSlots(s.seconds, speakers, offset);
    const per = Math.floor(s.seconds / speakers.length);
    lines.push(
      s.seconds > 0 ? `## Speaking order${name} (${clock(per)} each)` : `## Speaking order${name}`,
      "",
      "| # | Speaker | Starts at | Time |",
      "|---:|---|---:|---:|",
      ...slots.map(({ participant, startSeconds, seconds }, n) =>
        s.seconds > 0
          ? `| ${n + 1} | ${cell(participant.name)} | ${clock(startSeconds)} | ${clock(seconds)} |`
          : `| ${n + 1} | ${cell(participant.name)} | — | — |`
      ),
      ""
    );
  }

  const verdict = report?.finished ? runVerdict(report) : planVerdict(agenda, speakers.length);
  lines.push("", `**${verdict}**`);
  if (across) lines.push("", across);
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
