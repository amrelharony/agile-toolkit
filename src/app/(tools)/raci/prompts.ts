import type { PromptDefinition } from "@/lib/ai-prompts/types";

/** The check sections generateRACIPrompts writes into the gap analysis. */
const GENERATED_CHECKS =
  /## (?:Validation Warnings|Potentially Overloaded Roles)\n\n(?:- .*\n)+\n/g;

/**
 * The gap-analysis prompt with the page's own checks. generateRACIPrompts
 * (lib/ai-prompts/raci) counts only cells that are exactly "A" (or "R"),
 * so it told the model an A/R cell had no Accountable and flagged rows
 * nobody is assigned to yet; its check sections are swapped for the
 * messages of activityIssues and loadWarnings, so the prompt says what the
 * page says. Other prompts carry no checks and pass through.
 */
export function withPageChecks(p: PromptDefinition, checks: readonly string[]): PromptDefinition {
  if (p.id !== "raci-gaps") return p;
  const section =
    checks.length > 0
      ? `## Checks (as the page reads them)\n\n${checks.map((c) => `- ${c}`).join("\n")}\n\n`
      : "";
  return {
    ...p,
    prompt: p.prompt
      .replace(GENERATED_CHECKS, "")
      .replace("## Questions", `${section}## Questions`),
  };
}
