import type { PromptDefinition } from "./types";
import {
  buildPreamble,
  sanitizePromptBlock,
  sanitizePromptCell,
  wrapUserContent,
} from "./prompt-utils";
import type { RootCauseAnalysis } from "../stores/workspace-types";
import { ROOT_CAUSE_METHOD_LABEL, paretoRows, whyLines } from "../root-cause/model";
import { describeLoop, findLoops } from "../root-cause/loops";

/** Causes listed in the prompt at most. */
const MAX_CAUSES = 30;

/**
 * Copyable prompts for one root-cause analysis (the one open on the page):
 * a challenge of the why chain, a read of the fishbone with its Pareto
 * order, countermeasures with a way to check them and, for an analysis with
 * a causal loop, a read of the loop (last, so the others keep their
 * places). Everything typed is user content, so the analysis is wrapped as
 * data.
 */
export function generateRootCausePrompts(a: RootCauseAnalysis | null): PromptDefinition[] {
  if (!a) return [];
  const whys = whyLines(a.whys);
  const pareto = paretoRows(a.causes).slice(0, MAX_CAUSES);
  const loop = a.loop && a.loop.nodes.length > 0 ? a.loop : null;
  const text = new Map((loop?.nodes ?? []).map((n) => [n.id, sanitizePromptCell(n.text, 120)]));
  const loops = loop ? findLoops(loop).loops : [];
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
    loop
      ? [
          `Causal loop things: ${loop.nodes.map((n) => text.get(n.id)).join("; ")}`,
          loop.links.length > 0
            ? `Arrows (+ same way, − opposite ways):\n${loop.links
                .map(
                  (l) =>
                    `- ${text.get(l.from) ?? "?"} → ${text.get(l.to) ?? "?"} (${l.polarity === "same" ? "+" : "−"}${l.delay ? ", takes time" : ""})`
                )
                .join("\n")}`
            : "",
          loops.length > 0
            ? `Loops:\n${loops.map((l) => `- ${l.label}: ${sanitizePromptCell(describeLoop(loop, l), 600)}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    a.rootCause?.trim() ? `Root cause named: ${sanitizePromptBlock(a.rootCause, 1000)}` : "",
    a.countermeasure?.trim()
      ? `Countermeasure agreed: ${sanitizePromptBlock(a.countermeasure, 1000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const context = `${ROOT_CAUSE_METHOD_LABEL[a.method]} analysis with ${whys.length} whys and ${a.causes.length} fishbone causes${loop ? `, and a causal loop of ${loop.nodes.length} things and ${loop.links.length} arrows` : ""}.`;
  const data = `## The analysis\n\n${wrapUserContent(block)}\n\n`;
  const prompts: PromptDefinition[] = [
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
  if (loop) {
    prompts.push({
      id: "loop-read",
      title: "Read the causal loop",
      description: "Check each arrow's sign, find missing arrows and where to act.",
      prompt:
        buildPreamble("Root Cause tool", context) +
        data +
        "## Questions\n\n1. For each arrow, is the sign right (+ both move the same way, − they move opposite ways)? Flag any that look wrong.\n2. Which arrows are missing, especially ones that would close a loop?\n3. Which loops feed the problem (reinforcing) and which hold it back (balancing)? Where do delays hide the effect?\n4. Which one thing would you act on first to break the loop that feeds the problem, and why?",
    });
  }
  return prompts;
}
