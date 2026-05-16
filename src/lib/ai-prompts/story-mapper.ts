import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface StoryMapperData {
  steps: { id: string; name: string }[];
  slices: { id: string; name: string; cards: Record<string, { title: string }[]> }[];
}

export function generateStoryMapperPrompts(data: StoryMapperData, workspace?: Workspace | null): PromptDefinition[] {
  if (data.steps.length === 0 || data.slices.length === 0) return [];

  const totalCards = data.slices.reduce(
    (sum, sl) => sum + data.steps.reduce((s2, st) => s2 + (sl.cards[st.id]?.length ?? 0), 0),
    0
  );
  if (totalCards === 0) return [];

  // Build text representation of the map. Step names, slice names, and
  // card titles are all user-typed. Sanitize each and clamp card lists
  // to 20 per step so a slice with 500 cards can't blow the budget.
  const mapText = data.slices
    .slice(0, 30)
    .map((sl) => {
      const stepEntries = data.steps
        .map((st) => {
          const cards = sl.cards[st.id] ?? [];
          if (cards.length === 0) return null;
          const shown = cards.slice(0, 20);
          const more = cards.length > 20 ? `, …+${cards.length - 20} more` : "";
          return `  ${sanitizePromptCell(st.name, 60)}: ${shown.map((c) => sanitizePromptCell(c.title, 120)).join(", ")}${more}`;
        })
        .filter(Boolean);
      return `### ${sanitizePromptCell(sl.name, 60)}\n${stepEntries.length > 0 ? stepEntries.join("\n") : "  (empty)"}`;
    })
    .join("\n\n");

  const safeMap = wrapUserContent(mapText);
  const safeSteps = data.steps.map((s) => sanitizePromptCell(s.name, 60)).join(" → ");
  const firstSliceName = sanitizePromptCell(data.slices[0]?.name ?? "", 60);

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  return [
    {
      id: "storymap-completeness",
      title: "Story Map Completeness Review",
      description: "Identify gaps in the user journey and missing stories.",
      prompt: buildPreamble("User Story Map", `It maps stories across ${data.steps.length} journey steps and ${data.slices.length} release slices.`) +
        `## Journey Steps: ${safeSteps}\n\n## Story Map\n\n${safeMap}\n\nTotal stories: ${totalCards}${context}\n\n## Questions\n\n1. Are there gaps in the user journey? Which steps are missing stories that would leave users stuck?\n2. Does the first slice (${firstSliceName}) form a complete enough experience to be usable?\n3. Are stories at the right level of granularity, or do some need splitting/combining?\n4. What error handling, edge cases, or non-happy-path stories are missing?\n5. Is the horizontal flow logical — does the user journey make sense end-to-end?`,
    },
    {
      id: "storymap-mvp",
      title: "MVP Slice Recommendation",
      description: "Evaluate which slice represents the optimal minimum viable product.",
      prompt: buildPreamble("User Story Map", "Help determine the right MVP scope.") +
        `## Journey Steps: ${safeSteps}\n\n## Story Map\n\n${safeMap}${context}\n\n## Questions\n\n1. Which slice represents the smallest viable product that delivers end-to-end value?\n2. Can any stories be moved to later slices without breaking the user journey?\n3. What is the critical path — which stories must be done first due to dependencies?\n4. What would users complain about most if we shipped only the first slice?\n5. Recommend an implementation order within the first slice that delivers value incrementally.`,
    },
  ];
}
