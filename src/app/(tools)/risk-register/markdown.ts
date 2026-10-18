import type { Risk } from "@/lib/stores/workspace-types";

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

/** 1–5, like the matrix: a corrupt value never breaks the score. */
function scale(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : 1;
}

const STATUSES: Risk["status"][] = ["open", "mitigating", "accepted", "closed"];

/**
 * The register as Markdown, for a steering-group page or a release thread:
 * how many risks are in each status, then every risk ranked by probability ×
 * impact (tied scores share a rank), with its mitigation and due date.
 */
export function toMarkdown(risks: readonly Risk[], now: Date = new Date()): string {
  const title = `# Risk Register — ${mdDate(now)}`;
  if (risks.length === 0) return `${title}\n\nNo risks logged yet.\n`;

  const scored = risks
    .map((r) => ({ r, p: scale(r.probability), i: scale(r.impact) }))
    .map((x) => ({ ...x, score: x.p * x.i }))
    .sort((a, b) => b.score - a.score);
  const counts = STATUSES.map((s) => [s, risks.filter((r) => r.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);

  const lines = [
    title,
    "",
    `${risks.length} risk${risks.length === 1 ? "" : "s"}: ${counts.join(", ")}.`,
    "",
    "## Risks by score",
    "",
    "| # | Risk | P × I | Score | Status | Mitigation | Due |",
    "|---:|---|---|---:|---|---|---|",
    ...scored.map(({ r, p, i, score }) => {
      const rank = scored.findIndex((x) => x.score === score) + 1;
      const status = r.status.charAt(0).toUpperCase() + r.status.slice(1);
      return `| ${rank} | ${cell(r.title) || "(untitled)"} | ${p} × ${i} | ${score} | ${status} | ${cell(
        r.mitigation
      )} | ${r.mitigationDueAt ?? ""} |`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}
