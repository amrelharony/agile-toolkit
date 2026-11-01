import { MATURITY_DIMENSIONS, MATURITY_LEVEL_LABELS } from "@/lib/constants/maturity-model";
import type { MaturityAssessment, RetroBoard } from "@/lib/stores/workspace-types";
import {
  latestAssessment,
  levelOf,
  maturityVerdict,
  previousAssessment,
  roadmapCards,
  roadmapFor,
  savedAssessments,
  summarizeEntry,
  targetOf,
} from "@/lib/maturity/assessment";
import { formatDate } from "@/lib/utils/formatters";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");
const row = (cells: (string | number)[]) => `| ${cells.map(cell).join(" | ")} |`;

/**
 * The assessment as Markdown: the verdict, the latest assessment with each
 * dimension against the one before and the target, every saved assessment,
 * and the roadmap with what was sent to Retro Actions.
 */
export function maturityToMarkdown(
  doc: MaturityAssessment,
  boards: readonly RetroBoard[] = []
): string {
  const lines = ["# Agile maturity assessment", "", `> ${oneLine(maturityVerdict(doc))}`, ""];
  const latest = latestAssessment(doc);
  if (!latest) return `${lines.join("\n").trimEnd()}\n`;
  const previous = previousAssessment(doc);
  const now = summarizeEntry(latest);
  const target = targetOf(doc);
  lines.push(
    `## Latest: ${formatDate(now.assessedAt)}`,
    "",
    `Overall ${now.percentage}% · Level ${now.level} (${now.label}) · average ${now.averageLevel} / 5`,
    ""
  );
  if (now.note) lines.push(`Note: ${oneLine(now.note)}`, "");
  lines.push(
    row(["Dimension", "Previous", "Latest", "Target"]),
    row(["---", "---", "---", "---"]),
    ...MATURITY_DIMENSIONS.map((d) => {
      const level = levelOf(latest.scores[d.id]) ?? 1;
      const before = previous ? levelOf(previous.scores[d.id]) : null;
      return row([
        d.name,
        before === null ? "—" : `${before}`,
        `${level} ${MATURITY_LEVEL_LABELS[level] ?? ""}`.trim(),
        target,
      ]);
    }),
    ""
  );

  const saved = savedAssessments(doc);
  lines.push("## Assessments", "");
  for (const e of saved) {
    const s = summarizeEntry(e);
    lines.push(
      `- ${formatDate(s.assessedAt)}: ${s.percentage}% · Level ${s.level} (${s.label})${s.note ? ` · ${oneLine(s.note)}` : ""}`
    );
  }
  lines.push("");

  const roadmap = roadmapFor(latest, target);
  lines.push(`## Roadmap to level ${target}`, "");
  if (roadmap.length === 0) {
    lines.push(`Every dimension is at level ${target} or above.`);
  } else {
    for (const step of roadmap) {
      const sent = roadmapCards(boards, step.key).length > 0 ? " · sent to Retro Actions" : "";
      lines.push(
        `- ${step.name}: ${step.current} → ${step.toLevel} (${step.toLabel})${sent}`,
        `  ${oneLine(step.description)}`
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
