import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
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
  const list = data.catalog
    .map((s) => {
      // Truncate description to 100 chars so the catalog stays scannable but
      // the model still sees what each structure actually *does*.
      const desc = s.description.length > 100
        ? `${s.description.slice(0, 97)}...`
        : s.description;
      return `- ${s.name} (${s.timing}, ${s.groupSize}) — ${s.purpose} · ${desc}`;
    })
    .join("\n");
  const favs = data.favoriteIds
    .map((id) => data.catalog.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n));
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
        `## Catalog\n\n${list}\n\n## Your Task\n\nThe user will describe their workshop goal (e.g. "surface unspoken concerns about a layoff", "generate ideas for retention", "decide a roadmap split"). For their goal:\n\n1. Recommend 2-3 structures from the catalog that fit the purpose, timing window, and group size they have.\n2. For each recommendation, justify the choice in 1 sentence and call out one risk (e.g. "needs a strong facilitator").\n3. If two structures could be sequenced, suggest the order.${context}`,
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
        `## Catalog\n\n${list}\n\n## Your Task\n\nDesign a 60-minute workshop arc using 3-4 of the structures above. The user will tell you the workshop topic. For each step:\n\n1. Name the structure, the duration (must sum to ≤ 60 min including a 5-min buffer), and what input it produces for the next step.\n2. Explain the divergence/convergence rhythm of the overall arc.\n3. Call out the single biggest facilitation risk and the contingency plan.${context}`,
    },
  ];
}
