import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type {
  Workspace,
  Whiteboard,
  WhiteboardObject,
  WhiteboardCommentThread,
} from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { ClusterResult } from "../whiteboard/cluster-bridge";
import type { BoardInsight } from "../analytics/board-insights";

interface CanvasPromptData {
  board: Whiteboard;
  objects: WhiteboardObject[];
  comments?: WhiteboardCommentThread[];
  clusters?: ClusterResult[];
  insights?: BoardInsight[];
}

/**
 * Compact a board object's content into a single AI-prompt line.
 * Covers every object kind so the AI sees the full board, not just stickies.
 * Returns null only when the object truly carries no textual info.
 */
function stickyText(o: WhiteboardObject): string | null {
  switch (o.type) {
    case "sticky":
    case "text":
      return o.content || null;
    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle":
      return o.content ?? null;
    case "frame":
      return `[Frame: ${o.label}]`;
    case "connector":
      // Connector lines carry meaning even without a label — surface the
      // relationship as A → B so AI can reason about the graph topology.
      return o.label
        ? `[Connector: ${o.fromId} ${o.label} ${o.toId}]`
        : `[Connector: ${o.fromId} → ${o.toId}]`;
    case "line":
    case "arrow":
      return o.type === "arrow" ? "[Arrow]" : "[Line]";
    case "freehand":
      return `[Sketch · ${Math.round(o.points.length / 2)} points]`;
    case "image":
      return o.alt ? `[Image: ${o.alt}]` : "[Image]";
    case "embed":
      return `[Embed (${o.kind}): ${o.src.slice(0, 60)}]`;
    default:
      return null;
  }
}

export function generateCanvasPrompts(
  data: CanvasPromptData,
  workspace?: Workspace | null,
): PromptDefinition[] {
  const { board, objects } = data;
  if (objects.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const stickies = objects
    .map((o) => stickyText(o))
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  if (stickies.length === 0) return [];

  const sample = stickies.slice(0, 60).map((s, i) => `${i + 1}. ${s.replace(/\n+/g, " ").slice(0, 140)}`).join("\n");
  const counts = countTypes(objects);
  const connectorCount = counts.connector ?? 0;
  const stickyCount = counts.sticky ?? 0;
  const frameCount = counts.frame ?? 0;

  const clusterBlock = data.clusters && data.clusters.length > 0
    ? `\n\n## Detected clusters (k-means on position)\n\n${data.clusters
        .map((c) => `- Cluster ${c.id + 1} (${c.objectIds.length} items)`)
        .join("\n")}`
    : "";

  const insightBlock = data.insights && data.insights.length > 0
    ? `\n\n## Detected board anti-patterns\n\n${data.insights
        .map((i) => `- [${i.severity.toUpperCase()}] ${i.title} — ${i.detail}`)
        .join("\n")}`
    : "";

  const prompts: PromptDefinition[] = [
    {
      id: "canvas-summary",
      title: "Summarize Board",
      description: "Identify dominant themes, label clusters, and surface the 3 strongest narratives.",
      prompt:
        buildPreamble(
          "Canvas Whiteboard",
          `It is a collaborative whiteboard called "${board.name}" with ${stickyCount} stickies, ${connectorCount} connectors, and ${frameCount} frames.`
        ) +
        `## Sample of the content (max 60 items)\n\n${sample}\n${clusterBlock}\n${insightBlock}\n${context}\n## Questions\n\n` +
        `1. What are the 3 dominant themes on this board?\n` +
        `2. Suggest a one-sentence label for each detected cluster.\n` +
        `3. What's notably missing — what topic gaps would you expect to see?\n` +
        `4. Give a 2-sentence executive summary suitable for sharing in Slack.\n` +
        `5. What's the strongest signal of consensus vs disagreement across the stickies?`,
    },
    {
      id: "canvas-actions",
      title: "Synthesise → Actions",
      description: "Convert the brainstorm into a prioritised action list.",
      prompt:
        buildPreamble("Canvas Whiteboard", "Help turn this brainstorm into actionable next steps.") +
        `## Items\n\n${sample}\n${context}\n## Questions\n\n` +
        `1. Group the ideas into 5 themes. For each theme, name 1 owner role (PM / Eng / Design / Research / Ops).\n` +
        `2. Recommend a prioritised list of 5 actions to take next.\n` +
        `3. For each action: which existing tool in the toolkit should it land in (story / risk / OKR / decision-log / experiment)?\n` +
        `4. What additional sticky is missing from this board that would change the conclusion?\n` +
        `5. What's the one experiment that would falsify the dominant theme?`,
    },
    {
      id: "canvas-cross-tool",
      title: "Cross-Tool Nudge",
      description: "Identify which stickies should become risks, OKRs, decisions, or backlog items.",
      prompt:
        buildPreamble("Canvas Whiteboard", "Suggest where each idea should land in the toolkit.") +
        `## Items\n\n${sample}\n${context}\n## Questions\n\n` +
        `For each meaningful sticky, output a row in this format:\n\n` +
        `\`\`\`\nSticky → Target tool (risk / okr / decision / backlog / experiment / wait)\n  - Justification (one sentence)\n  - Suggested title in the target tool\n\`\`\`\n\n` +
        `Skip stickies that don't fit any tool ("wait"). Sort the output so the most actionable rows are first.`,
    },
  ];

  if (data.insights && data.insights.length > 0) {
    prompts.push({
      id: "canvas-cleanup",
      title: "Board Cleanup Plan",
      description: "Address detected anti-patterns: stale items, oversized stickies, scattered clusters, overcrowding.",
      prompt:
        buildPreamble("Canvas Whiteboard", "Generate a 15-minute cleanup plan for this board.") +
        `## Detected anti-patterns\n\n${data.insights.map((i) => `- ${i.title} — ${i.detail}`).join("\n")}\n${context}\n## Questions\n\n` +
        `1. Prioritise the anti-patterns 1–N. Which to fix first?\n` +
        `2. For each issue, list the concrete clicks/actions a user should take.\n` +
        `3. Estimate the time cost of cleanup (in minutes).\n` +
        `4. What habits would prevent these issues from recurring?\n` +
        `5. Recommend a board-hygiene cadence (e.g. weekly review).`,
    });
  }

  return prompts;
}

function countTypes(objects: readonly WhiteboardObject[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of objects) out[o.type] = (out[o.type] ?? 0) + 1;
  return out;
}
