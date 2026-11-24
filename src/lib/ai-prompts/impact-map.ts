import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type {
  Hypothesis,
  StrategyMap,
  StrategyMapNode,
  Workspace,
} from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { mapChecks } from "../strategy-map/checks";
import { levelOf } from "../strategy-map/formats";
import { childrenOf, nodeTitle, rootOf } from "../strategy-map/model";

/** The most parts listed. */
const MAX_NODES = 150;

/**
 * A strategy map as an indented list, root first: each part's level, its
 * text and the fields it has, every typed field sanitised so a pasted
 * instruction or a triple-backtick block can't break out of the prompt.
 * Shared with the Strategy Tree's prompts.
 */
export function renderStrategyMap(map: StrategyMap): { text: string; listed: number } {
  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (n: StrategyMapNode, depth: number) => {
    if (depth > 3 || seen.has(n.id) || lines.length >= MAX_NODES) return;
    seen.add(n.id);
    const marks = [
      n.focus ? "focus" : "",
      n.status ?? "",
      n.measure?.trim() ? `measure: ${sanitizePromptCell(n.measure, 120)}` : "",
      n.owner?.trim() ? `owner: ${sanitizePromptCell(n.owner, 60)}` : "",
    ].filter(Boolean);
    lines.push(
      `${"  ".repeat(depth)}- [${levelOf(map.format, n.level).label}] ${sanitizePromptCell(nodeTitle(n, map.format), 200)}${marks.length > 0 ? ` (${marks.join("; ")})` : ""}`
    );
    for (const c of childrenOf(map, n.id)) walk(c, depth + 1);
  };
  const root = rootOf(map);
  if (root) walk(root, 0);
  return { text: lines.join("\n"), listed: lines.length };
}

/** The checks the page lists, as prompt lines. */
export function renderChecks(
  map: StrategyMap,
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[]
): string {
  const checks = mapChecks(map, hypotheses);
  return checks.length === 0
    ? "(none)"
    : checks
        .slice(0, 20)
        .map((c) => `- ${sanitizePromptCell(c.text, 240)}`)
        .join("\n");
}

/**
 * The impact map prompts, for the map the page has open: review the map
 * (impacts that are features in disguise, missing actors), and pick what
 * to build first.
 */
export function generateImpactMapPrompts(
  data: { map: StrategyMap | undefined; hypotheses?: readonly Pick<Hypothesis, "id" | "status">[] },
  workspace?: Workspace | null
): PromptDefinition[] {
  const { map } = data;
  if (!map || map.nodes.length === 0) return [];
  const { text, listed } = renderStrategyMap(map);
  const more =
    listed < map.nodes.length ? `\n(Showing ${listed} of ${map.nodes.length} parts)` : "";
  const body = wrapUserContent(
    `${text}${more}\n\nWhat the page says is missing:\n${renderChecks(map, data.hypotheses ?? [])}`
  );
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const about =
    "An impact map starts from a goal (why), lists the actors who can help or block it (who), how each must act differently (impacts: start, stop, more or less of something) and what the team could build or do to cause that change (deliverables). One impact is the focus.";
  return [
    {
      id: "impact-map-review",
      title: "Review the map",
      description:
        "Find impacts that are features in disguise, missing actors and weak links to the goal.",
      prompt:
        buildPreamble("Impact Map", about) +
        `## Map\n\n${body}${context}\n\n## Questions\n\n1. Which impacts are really features? Rewrite each as a change in behaviour.\n2. Which actors are missing, including people who could slow the goal down?\n3. Does each deliverable plausibly cause its impact? Which are too big?`,
    },
    {
      id: "impact-map-first",
      title: "What to build first",
      description: "Pick the smallest deliverable that tests the focus impact.",
      prompt:
        buildPreamble("Impact Map", about) +
        `## Map\n\n${body}${context}\n\n## Questions\n\n1. Is the focus impact the one most likely to move the goal's measure? Why?\n2. Which single deliverable would show soonest whether the focus impact happens?\n3. How would the team know, within two sprints, that it worked?`,
    },
  ];
}
