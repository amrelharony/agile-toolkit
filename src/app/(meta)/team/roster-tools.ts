/**
 * The tools that read the team roster, and what each does with it. Names,
 * paths and icons come from the tool registry, so only the use is kept here.
 */
export const ROSTER_TOOLS: readonly { toolId: string; use: string }[] = [
  { toolId: "standup", use: "Lists everyone so you can log each person's update." },
  { toolId: "mood-tracker", use: "Gives each person a row for daily check-ins." },
  { toolId: "kudos", use: "Offers teammates as people to thank." },
  { toolId: "capacity-planner", use: "“Sync from team” adds a capacity row for each person." },
  { toolId: "ceremony-timer", use: "“Load team” fills the speaking order." },
  { toolId: "canvas", use: "Suggests names for card assignees and @mentions." },
  { toolId: "health-dashboard", use: "Counts the team for standup participation." },
  { toolId: "sprint", use: "Counts who has posted today's standup update." },
  { toolId: "working-agreement", use: "Asks each person for consent to every rule." },
  { toolId: "raci", use: "Offers teammates as columns of the matrix." },
  { toolId: "skills-matrix", use: "Gives each person a column to rate their skills." },
];
