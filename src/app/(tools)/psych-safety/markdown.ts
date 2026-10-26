import type { PsychSafetyRound } from "@/lib/stores/workspace-types";
import {
  PSYCH_SAFETY_MIN_RESPONSES,
  compareRounds,
  questionLabel,
  roundResult,
} from "@/lib/psych-safety/instrument";

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

const num = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "—" : String(Math.round(n * 10 ** digits) / 10 ** digits);

const signed = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))}`;

const SOURCE: Record<PsychSafetyRound["source"], string> = {
  room: "answered anonymously in a live round",
  facilitator: "counted by hand",
  legacy: "answer sheets kept before rounds",
};

/**
 * The survey as Markdown, for the team channel or a retro page: the
 * verdict, the round shown (each statement's score, reverse scoring
 * applied, against the round it is compared with), and every round's team
 * score. Counts and averages only: nothing per person.
 */
export function toMarkdown(
  rounds: readonly PsychSafetyRound[],
  {
    now = new Date(),
    verdict,
    shown,
    compared,
  }: {
    now?: Date;
    verdict?: string;
    /** The round to detail (default the latest) and the one it is compared with. */
    shown?: PsychSafetyRound | null;
    compared?: PsychSafetyRound | null;
  } = {}
): string {
  const title = `# Psychological Safety — ${mdDate(now)}`;
  if (rounds.length === 0) return `${title}\n\nNo rounds yet.\n`;
  const round = shown ?? rounds[rounds.length - 1];
  const other = compared === undefined ? (rounds[rounds.indexOf(round) - 1] ?? null) : compared;
  const result = roundResult(round);
  const cmp = other ? compareRounds(other, round) : null;

  const lines = [title, ""];
  if (verdict) lines.push(verdict, "");
  lines.push(
    `## ${cell(round.name)} (${cell(round.date)})`,
    "",
    `${round.responses} ${round.responses === 1 ? "person" : "people"}, ${SOURCE[round.source]}.`,
    ""
  );
  if (!result) {
    lines.push(
      `_Results show from ${PSYCH_SAFETY_MIN_RESPONSES} responses, so no one's answers can be singled out._`
    );
  } else {
    lines.push(
      `**Team score:** ${num(result.teamScore)}/5 (the mean of the statements' scores; the three worded negatively count 6 − the answer)`,
      "",
      `| Statement | Reverse-scored | Answers | Mean answer | Score |${other ? ` vs ${cell(other.name)} |` : ""}`,
      `|---|---|---:|---:|---:|${other ? "---:|" : ""}`,
      ...result.perQuestion.map((q) => {
        const delta = cmp?.perQuestion.find((x) => x.id === q.id)?.delta;
        const score = q.adjusted === null ? "Withheld" : num(q.adjusted);
        return `| ${questionLabel(q.id)}. ${cell(q.text)} | ${q.reversed ? "Yes" : "No"} | ${q.n} | ${num(q.mean)} | ${score} |${other ? ` ${signed(delta)} |` : ""}`;
      })
    );
    if (cmp?.anomaly) {
      lines.push(
        "",
        `**Fell by more than 0.5 since ${cell(other?.name)}:** ${cmp.dropped.map(questionLabel).join(", ")}.`
      );
    }
  }

  lines.push(
    "",
    "## Rounds",
    "",
    "| Round | Date | Responses | Team score |",
    "|---|---|---:|---:|",
    ...rounds.map((r) => {
      const res = roundResult(r);
      return `| ${cell(r.name)} | ${cell(r.date)} | ${r.responses} | ${res ? num(res.teamScore) : "—"} |`;
    })
  );
  return `${lines.join("\n")}\n`;
}
