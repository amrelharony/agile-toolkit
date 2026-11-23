import type { Interview, Persona } from "@/lib/stores/workspace-types";
import {
  EVIDENCE_LABEL,
  LIST_LABEL,
  PERSONA_LISTS,
  TIER_LABEL,
  linkedInterviews,
} from "@/lib/personas/model";

/** "23 Nov 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line of text: line breaks folded, Markdown's heading and list marks kept out. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/**
 * The library as Markdown, for a research doc or a planning page: each
 * persona's name and role, its tier and evidence, its lists, quote and
 * context, and how many interviews it is based on. Only the persona's own
 * (made-up) text goes in: never an interview's participant, date or quotes.
 */
export function personasMarkdown(
  personas: readonly Persona[],
  interviews: readonly Interview[] = [],
  now: Date = new Date()
): string {
  const title = `# Personas — ${mdDate(now)}`;
  if (personas.length === 0) return `${title}\n\nNo personas yet.\n`;
  const lines: string[] = [title];
  for (const p of personas) {
    lines.push("", `## ${oneLine(p.name)}, ${oneLine(p.role) || "role to confirm"}`, "");
    lines.push(`Tier: ${TIER_LABEL[p.tier]} · Evidence: ${EVIDENCE_LABEL[p.evidence]}`);
    if (p.summary) lines.push("", oneLine(p.summary));
    for (const list of PERSONA_LISTS) {
      if (p[list].length === 0) continue;
      lines.push("", `**${LIST_LABEL[list]}**`, "", ...p[list].map((x) => `- ${oneLine(x)}`));
    }
    if (p.quote) lines.push("", `> ${oneLine(p.quote)}`);
    if (p.context) lines.push("", `Context: ${oneLine(p.context)}`);
    if (p.tags.length > 0) lines.push("", `Tags: ${p.tags.map(oneLine).join(", ")}`);
    const based = linkedInterviews(p, interviews).length;
    if (based > 0) lines.push("", `Based on ${based} interview${based === 1 ? "" : "s"}.`);
  }
  return `${lines.join("\n")}\n`;
}
