import type { AdkarInitiative } from "@/lib/stores/workspace-types";
import type { ChartText } from "@/lib/charts/chart-text";
import {
  ADKAR_ELEMENTS,
  ELEMENT_LABEL,
  adkarVerdict,
  barrierText,
  daysInStage,
  initiativeBarrier,
  scoreOf,
  stageCounts,
  stageDurations,
} from "@/lib/adkar/model";
import { formatDate } from "@/lib/utils/formatters";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");
const row = (cells: (string | number)[]) => `| ${cells.map(cell).join(" | ")} |`;

/** The stage chart's text: how many initiatives sit in each stage, and the table. */
export function stageChartText(initiatives: readonly AdkarInitiative[]): ChartText {
  const counts = stageCounts(initiatives);
  const total = initiatives.length;
  const where = ADKAR_ELEMENTS.filter((el) => counts[el] > 0)
    .map((el) => `${counts[el]} at ${ELEMENT_LABEL[el]}`)
    .join(", ");
  return {
    summary:
      total === 0
        ? "No initiatives yet."
        : `${total === 1 ? "1 initiative" : `${total} initiatives`}: ${where}.`,
    table: {
      columns: ["Stage", "Initiatives"],
      rows: ADKAR_ELEMENTS.map((el) => [ELEMENT_LABEL[el], counts[el]]),
      caption: "Initiatives by current stage",
    },
  };
}

/**
 * The initiatives as Markdown: the verdict, then per initiative its stage
 * and days in it, its barrier, a score table per group and the dated
 * stage history.
 */
export function adkarToMarkdown(initiatives: readonly AdkarInitiative[], today: string): string {
  const lines = [
    "# ADKAR change initiatives",
    "",
    `> ${oneLine(adkarVerdict(initiatives, today))}`,
    "",
  ];
  for (const i of initiatives) {
    const days = daysInStage(i, today);
    lines.push(`## ${oneLine(i.name)}`, "");
    const meta = [
      `Stage: ${ELEMENT_LABEL[i.currentStage]} (${days === 1 ? "1 day" : `${days} days`})`,
      i.owner ? `Owner: ${oneLine(i.owner)}` : null,
      `Started ${formatDate(i.startDate)}`,
    ].filter(Boolean);
    lines.push(meta.join(" · "), "");
    if (i.description) lines.push(oneLine(i.description), "");
    const barrier = initiativeBarrier(i);
    if (barrier) {
      lines.push(
        `Barrier: ${ELEMENT_LABEL[barrier.element]} (${barrier.groupName} scored ${barrier.score}/5)`,
        ""
      );
    }
    const groups = i.groups ?? [];
    if (groups.length > 0) {
      lines.push(
        row(["Group", ...ADKAR_ELEMENTS.map((el) => ELEMENT_LABEL[el]), "Barrier"]),
        row(["---", ...ADKAR_ELEMENTS.map(() => "---"), "---"]),
        ...groups.map((g) =>
          row([g.name, ...ADKAR_ELEMENTS.map((el) => scoreOf(g.scores[el]) ?? "—"), barrierText(g)])
        ),
        ""
      );
    }
    lines.push("History:", "");
    for (const d of stageDurations(i, today)) {
      lines.push(
        d.to
          ? `- ${ELEMENT_LABEL[d.stage]}: ${d.from} to ${d.to} (${d.days} days)`
          : `- ${ELEMENT_LABEL[d.stage]}: since ${d.from} (${d.days} days so far)`
      );
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
