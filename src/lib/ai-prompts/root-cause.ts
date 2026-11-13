import type { PromptDefinition } from "./types";
import {
  buildPreamble,
  sanitizePromptBlock,
  sanitizePromptCell,
  wrapUserContent,
} from "./prompt-utils";
import type { RootCauseAnalysis } from "../stores/workspace-types";
import { ROOT_CAUSE_METHOD_LABEL, paretoRows, whyLines } from "../root-cause/model";

/** Causes listed in the prompt at most. */
const MAX_CAUSES = 30;

/**
 * Copyable prompts for one root-cause analysis (the one open on the page):
 * a challenge of the why chain, a read of the fishbone with its Pareto
 * order, and countermeasures with a way to check them. Everything typed is
 * user content, so the analysis is wrapped as data.
 */
export function generateRootCausePrompts(a: RootCauseAnalysis | null): PromptDefinition[] {
  if (!a) return [];
  const whys = whyLines(a.whys);
  const pareto = paretoRows(a.causes).slice(0, MAX_CAUSES);
  const block = [
    `Problem: ${sanitizePromptCell(a.title, 200)}`,
    a.problem.trim() ? `As a fact: ${sanitizePromptBlock(a.problem, 1000)}` : "",
    whys.length > 0
      ? `5 Whys:\n${whys.map((w, i) => `${i + 1}. ${sanitizePromptCell(w, 300)}`).join("\n")}`
      : "",
    a.causes.length > 0
      ? `Fishbone causes (category | cause | count):\n${a.causes
          .slice(0, MAX_CAUSES)
          .map(
            (c) =>
              `- ${sanitizePromptCell(c.category, 60)} | ${sanitizePromptCell(c.text, 200)} | ${c.count}`
          )
          .join("\n")}`
      : "",
    pareto.length > 0
      ? `Pareto order: ${pareto.map((r) => `${sanitizePromptCell(r.text, 80)} (${Math.round(r.cumulative * 100)}%)`).join("; ")}`
      : "",
    a.rootCause?.trim() ? `Root cause named: ${sanitizePromptBlock(a.rootCause, 1000)}` : "",
    a.countermeasure?.trim()
      ? `Countermeasure agreed: ${sanitizePromptBlock(a.countermeasure, 1000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const context = `${ROOT_CAUSE_METHOD_LABEL[a.method]} analysis with ${whys.length} whys and ${a.causes.length} fishbone causes.`;
  const data = `## The analysis\n\n${wrapUserContent(block)}\n\n`;
  return [
    {
      id: "challenge-whys",
      title: "Challenge the why chain",
      description: "Check each answer really causes the one above it, and where the chain jumps.",
      prompt:
        buildPreamble("Root Cause tool", context) +
        data +
        "## Questions\n\n1. For each why, would fixing it stop the line above it? Flag any that wouldn't.\n2. Where does the chain jump a step, or blame a person instead of a process?\n3. Is the last answer something the team can change? If not, suggest the next why to ask.\n4. Suggest one other branch of whys worth following.",
    },
    {
      id: "fishbone-read",
      title: "Read the fishbone",
      description: "Spot missing categories, misplaced causes and the vital few.",
      prompt:
        buildPreamble("Root Cause tool", context) +
        data +
        "## Questions\n\n1. Which categories have no causes yet, and what might belong there?\n2. Which causes sit under the wrong category?\n3. Which few causes explain most of the counts, and how confident should we be in those counts?\n4. Which cause would you test first, and how?",
    },
    {
      id: "countermeasures",
      title: "Countermeasures with a check",
      description:
        "Turn the root cause into actions the team owns, each with a way to know it worked.",
      prompt:
        buildPreamble("Root Cause tool", context) +
        data +
        "## Questions\n\n1. Suggest three countermeasures that remove or contain the root cause, each small enough for one sprint.\n2. For each, say how the team will know within two sprints whether it worked.\n3. Which one would you start with, and who on a Scrum team usually owns it?",
    },
  ];
}
