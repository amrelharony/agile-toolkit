/**
 * The Decision Log as Markdown: each record an ADR-style section (its
 * number and title, status, dates, the people its form names, context,
 * options with the chosen one marked, the outcome, consequences, and what
 * it replaced or was replaced by), for one record or the whole log.
 */

import type { Decision } from "@/lib/stores/workspace-types";
import { decisionLabel, optionsOf, roleHolders, templateOf } from "@/lib/decisions/model";
import { DECISION_STATUS_LABEL, TEMPLATES } from "@/lib/decisions/templates";
import { recordName, supersededRecords } from "./view";

/** Text on one line, so it can't break a list item or a heading. */
const line = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();

/** One record as a section. `all` names the records it links to. */
export function decisionToMarkdown(d: Decision, all: readonly Decision[]): string {
  const spec = TEMPLATES[templateOf(d)];
  const out: string[] = [`## ${decisionLabel(d)} · ${line(d.title) || "Untitled"}`, ""];

  const facts: string[] = [
    `- **Status:** ${DECISION_STATUS_LABEL[d.status] ?? d.status}`,
    `- **Form:** ${spec.label}`,
    `- **Raised:** ${d.date || "—"}`,
  ];
  if (d.decidedAt) facts.push(`- **Decided:** ${d.decidedAt}`);
  if (d.implementedAt) facts.push(`- **Carried out:** ${d.implementedAt}`);
  if (d.reopenedAt && d.status === "proposed") facts.push(`- **Reopened:** ${d.reopenedAt}`);
  facts.push(`- **${spec.deciderLabel}:** ${d.decider ? line(d.decider) : "—"}`);
  for (const r of spec.roles) {
    const who = roleHolders(d, r.role);
    facts.push(`- **${r.label}:** ${who.length > 0 ? who.map(line).join(", ") : "—"}`);
  }
  if (d.supersededBy) facts.push(`- **Superseded by:** ${recordName(all, d.supersededBy)}`);
  const replaced = supersededRecords(all, d.id);
  if (replaced.length > 0) {
    facts.push(`- **Supersedes:** ${replaced.map((x) => recordName(all, x.id)).join(", ")}`);
  }
  out.push(...facts, "");

  if (d.context?.trim()) out.push("### Context", "", d.context.trim(), "");
  const options = optionsOf(d);
  if (options.length > 0) {
    out.push("### Options", "");
    for (const o of options) {
      const chosen = o.id === d.chosenOptionId ? " **(chosen)**" : "";
      const note = o.note ? ` — ${line(o.note)}` : "";
      out.push(`- ${line(o.text)}${chosen}${note}`);
    }
    out.push("");
  }
  if (d.recommendation?.trim()) out.push("### Recommendation", "", d.recommendation.trim(), "");
  out.push("### Decision", "", d.decision.trim() || "_Not decided yet._", "");
  if (d.consequences?.trim()) out.push("### Consequences", "", d.consequences.trim(), "");
  return out.join("\n").trimEnd();
}

/** The log: a heading, its verdict, then every record (in the order given). */
export function decisionsToMarkdown(
  list: readonly Decision[],
  {
    all = list,
    verdict,
    title = "Decision Log",
  }: {
    all?: readonly Decision[];
    verdict: string;
    title?: string;
  }
): string {
  const head = [`# ${title}`, "", verdict, ""];
  if (list.length === 0) return [...head, "_No decisions recorded yet._"].join("\n");
  return [...head, list.map((d) => decisionToMarkdown(d, all)).join("\n\n")].join("\n");
}
