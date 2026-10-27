/**
 * The AI prompts for the responses on screen, with the numbers the page
 * shows. lib/ai-prompts/nps-csat takes plain numbers: given no NPS answers
 * it would print "Current NPS: 0", a score nobody gave, and it quotes the
 * CSAT average where the page reports % satisfied. Until it takes null and
 * % satisfied (a change asked of the main session), its headline sentence
 * is swapped for one read from lib/nps, with the n behind each number.
 */

import { generateNpsCsatPrompts } from "@/lib/ai-prompts/nps-csat";
import type { PromptDefinition } from "@/lib/ai-prompts/types";
import type { CsatSummary, NpsSummary } from "@/lib/nps/score";
import type { NpsResponse } from "@/lib/stores/workspace-types";

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
const responses = (n: number) => (n === 1 ? "1 response" : `${n} responses`);

/** What the prompt builder prints for the 0 and 0 passed in. */
const BUILT_HEADLINE = "Current NPS: 0. CSAT avg: 0.0.";

/** "NPS +20 from 10 responses. CSAT 80% satisfied (4–5) from 10 responses." */
export function promptHeadline(nps: NpsSummary, csat: CsatSummary): string {
  const npsText =
    nps.score === null ? "No NPS responses." : `NPS ${signed(nps.score)} from ${responses(nps.n)}.`;
  const csatText =
    csat.satisfiedPct === null
      ? "No CSAT responses."
      : `CSAT ${csat.satisfiedPct}% satisfied (4–5) from ${responses(csat.n)}.`;
  return `${npsText} ${csatText}`;
}

export function npsCsatPrompts(
  entries: readonly NpsResponse[],
  nps: NpsSummary,
  csat: CsatSummary
): PromptDefinition[] {
  const headline = promptHeadline(nps, csat);
  return generateNpsCsatPrompts({ entries: [...entries], nps: 0, csat: 0 }).map((p) =>
    p.prompt.includes(BUILT_HEADLINE)
      ? { ...p, prompt: p.prompt.replace(BUILT_HEADLINE, headline) }
      : p
  );
}
