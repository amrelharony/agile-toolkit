import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface CatalogEntry {
  id: string;
  name: string;
  purpose: string;
  timing: string;
  groupSize: string;
  description: string;
}

export function generateLiberatingStructuresPrompts(
  data: {
    catalog: CatalogEntry[];
    favoriteIds: string[];
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // R5: catalog entries are user-editable today (workspace-saved
  // templates extend the catalog in Phase 31). Sanitize every cell and
  // wrap the composed list so a determined entry can't close the
  // <user_content> wrapper.
  const list = data.catalog
    .map((s) =>
      `- ${sanitizePromptCell(s.name, 60)} (${sanitizePromptCell(s.timing, 40)}, ${sanitizePromptCell(s.groupSize, 40)}) — ${sanitizePromptCell(s.purpose, 120)} · ${sanitizePromptCell(s.description, 100)}`,
    )
    .join("\n");
  const wrappedList = wrapUserContent(list);
  const favs = data.favoriteIds
    .map((id) => data.catalog.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n))
    .map((n) => sanitizePromptCell(n, 60));
  const favLine = favs.length > 0 ? favs.join(", ") : "(none yet)";

  return [
    {
      id: "ls-pick",
      title: "Pick a structure for my goal",
      description: "Recommend 2-3 structures that match a workshop goal you describe.",
      prompt:
        buildPreamble(
          "Liberating Structures Picker",
          `${data.catalog.length} structures available. Saved favorites: ${favLine}.`
        ) +
        `## Catalog\n\n${wrappedList}${context}\n\n## Your Task\n\nThe user will describe their workshop goal (e.g. "surface unspoken concerns about a layoff", "generate ideas for retention", "decide a roadmap split"). For their goal:\n\n1. Recommend 2-3 structures from the catalog that fit the purpose, timing window, and group size they have.\n2. For each recommendation, justify the choice in 1 sentence and call out one risk (e.g. "needs a strong facilitator").\n3. If two structures could be sequenced, suggest the order.`,
    },
    {
      id: "ls-sequence",
      title: "Sequence for a 60-min workshop",
      description: "Compose 3-4 structures into a coherent 60-minute workshop arc.",
      prompt:
        buildPreamble(
          "Liberating Structures Picker",
          `Use the catalog of ${data.catalog.length} structures below. Saved favorites: ${favLine}.`
        ) +
        `## Catalog\n\n${wrappedList}${context}\n\n## Your Task\n\nDesign a 60-minute workshop arc using 3-4 of the structures above. The user will tell you the workshop topic. For each step:\n\n1. Name the structure, the duration (must sum to ≤ 60 min including a 5-min buffer), and what input it produces for the next step.\n2. Explain the divergence/convergence rhythm of the overall arc.\n3. Call out the single biggest facilitation risk and the contingency plan.`,
    },
  ];
}
