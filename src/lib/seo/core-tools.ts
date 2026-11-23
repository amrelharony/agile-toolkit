/**
 * The core Scrum tools: the ones a Scrum Master looks for by the job to do,
 * in the order a sprint runs. Each carries the name people type into a search
 * engine. Its page title is built from that name (lib/seo/tool-metadata.ts),
 * and /llms.txt lists these tools first (lib/seo/llms.ts). Every other tool
 * keeps its own name as its title.
 *
 * A search name says what the tool is in the words people search with, and
 * nothing the tool isn't: no "template" for a tool that is not one. It is in
 * sentence case, and short enough that the title fits a search result
 * (test/seo/page-titles.test.ts checks every one).
 */
export interface CoreTool {
  /** The tool's id in the registry (lib/constants/tools.ts). */
  id: string;
  /** The name people search for. */
  searchName: string;
}

export const CORE_SCRUM_TOOLS: readonly CoreTool[] = [
  // Plan the sprint
  { id: "sprint-planning", searchName: "Sprint planning tool" },
  { id: "capacity-planner", searchName: "Sprint capacity planner" },
  { id: "sprint-goal", searchName: "Sprint goal builder" },
  { id: "planning-poker", searchName: "Planning Poker online" },
  { id: "refinement", searchName: "Backlog refinement checklist" },
  { id: "story-mapper", searchName: "User story mapping tool" },
  // Run the sprint
  { id: "sprint", searchName: "Sprint dashboard" },
  { id: "standup", searchName: "Daily standup tracker" },
  { id: "impediments", searchName: "Scrum impediment tracker" },
  { id: "kanban", searchName: "Kanban board online" },
  { id: "ceremony-timer", searchName: "Scrum meeting timer" },
  { id: "sprint-review", searchName: "Sprint review tool" },
  // Retrospect and improve
  { id: "retro", searchName: "Retro board online" },
  { id: "retro-actions", searchName: "Retro action item tracker" },
  // Track delivery
  { id: "burndown", searchName: "Sprint burndown chart" },
  { id: "burnup", searchName: "Sprint burnup chart" },
  { id: "velocity", searchName: "Sprint velocity tracker" },
  { id: "cumulative-flow", searchName: "Cumulative flow diagram" },
  // Team and people
  { id: "health-check", searchName: "Team health check" },
  { id: "dod-builder", searchName: "Definition of Done builder" },
];

const SEARCH_NAMES = new Map(CORE_SCRUM_TOOLS.map((t) => [t.id, t.searchName]));

/** The name people search for, for a core Scrum tool; undefined for any other. */
export function coreSearchName(toolId: string): string | undefined {
  return SEARCH_NAMES.get(toolId);
}
