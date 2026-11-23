/**
 * "Suggest deliverables" without AI: three plain templates for what a team
 * could build or do to cause an impact. Our own words. Pure.
 */

import { NODE_TEXT_MAX } from "./model";

const cut = (s: string) => (s.length > NODE_TEXT_MAX ? s.slice(0, NODE_TEXT_MAX).trimEnd() : s);

/** "Skip a week instead." → "skip a week instead", keeping an acronym's capitals ("API calls"). */
export function asClause(text: string): string {
  const t = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  const first = t.split(" ")[0] ?? "";
  if (first.length > 1 && first === first.toUpperCase()) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * Three ideas for deliverables under an impact, each cut to a node's cap
 * and left out when the impact already has it (any case).
 */
export function deliverableIdeas(
  actor: string,
  impact: string,
  existing: readonly string[] = []
): string[] {
  const who = asClause(actor) || "them";
  const what = asClause(impact) || "do it";
  const taken = new Set(existing.map((e) => e.replace(/\s+/g, " ").trim().toLowerCase()));
  return [
    `A change in the product that makes it easier for ${who} to ${what}`,
    `A message, guide or training that shows ${who} how`,
    `A small test to see whether ${who} really does it`,
  ]
    .map(cut)
    .filter((idea) => !taken.has(idea.toLowerCase()));
}
