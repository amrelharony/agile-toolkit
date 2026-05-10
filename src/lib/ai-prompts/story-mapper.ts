import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
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

  // Build text representation of the map
  const mapText = data.slices
    .map((sl) => {
      const stepEntries = data.steps
        .map((st) => {
          const cards = sl.cards[st.id] ?? [];
          return cards.length > 0
            ? `  ${st.name}: ${cards.map((c) => c.title).join(", ")}`
            : null;
        })
        .filter(Boolean);
      return `### ${sl.name}\n${stepEntries.length > 0 ? stepEntries.join("\n") : "  (empty)"}`;
    })
    .join("\n\n");

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  return [
    {
      id: "storymap-completeness",
      title: "Story Map Completeness Review",
      description: "Identify gaps in the user journey and missing stories.",
      prompt: buildPreamble("User Story Map", `It maps stories across ${data.steps.length} journey steps and ${data.slices.length} release slices.`) +
        `## Journey Steps: ${data.steps.map((s) => s.name).join(" → ")}\n\n## Story Map\n\n${mapText}\n\nTotal stories: ${totalCards}${context}\n\n## Questions\n\n1. Are there gaps in the user journey? Which steps are missing stories that would leave users stuck?\n2. Does the first slice (${data.slices[0]?.name}) form a complete enough experience to be usable?\n3. Are stories at the right level of granularity, or do some need splitting/combining?\n4. What error handling, edge cases, or non-happy-path stories are missing?\n5. Is the horizontal flow logical — does the user journey make sense end-to-end?`,
    },
    {
      id: "storymap-mvp",
      title: "MVP Slice Recommendation",
      description: "Evaluate which slice represents the optimal minimum viable product.",
      prompt: buildPreamble("User Story Map", "Help determine the right MVP scope.") +
        `## Journey Steps: ${data.steps.map((s) => s.name).join(" → ")}\n\n## Story Map\n\n${mapText}${context}\n\n## Questions\n\n1. Which slice represents the smallest viable product that delivers end-to-end value?\n2. Can any stories be moved to later slices without breaking the user journey?\n3. What is the critical path — which stories must be done first due to dependencies?\n4. What would users complain about most if we shipped only the first slice?\n5. Recommend an implementation order within the first slice that delivers value incrementally.`,
    },
  ];
}
