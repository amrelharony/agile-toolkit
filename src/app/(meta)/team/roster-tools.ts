/**
 * The tools that read the team roster, and what each does with it. Names,
 * paths and icons come from the tool registry, so only the use is kept here.
 */
export const ROSTER_TOOLS: readonly { toolId: string; use: string }[] = [
  { toolId: "standup", use: "Lists everyone so you can log each person's update." },
  {
    toolId: "mood-tracker",
    use: "Gives each person a row for daily check-ins by name, or keeps team pulses only in the anonymous mode.",
  },
  { toolId: "kudos", use: "Offers teammates as people to thank." },
  { toolId: "capacity-planner", use: "“Sync from team” adds a capacity row for each person." },
  { toolId: "ceremony-timer", use: "“Load team” fills the speaking order." },
  { toolId: "canvas", use: "Suggests names for card assignees and @mentions." },
  { toolId: "health-dashboard", use: "Counts the team for standup participation." },
  { toolId: "sprint", use: "Counts who has posted today's standup update." },
  { toolId: "working-agreement", use: "Asks each person for consent to every rule." },
  { toolId: "raci", use: "Offers teammates as columns of the matrix." },
  { toolId: "skills-matrix", use: "Gives each person a column to rate their skills." },
  {
    toolId: "one-on-one",
    use: "Offers teammates as manager and report, and lists anyone with no 1:1 yet.",
  },
  { toolId: "onboarding-tracker", use: "Offers teammates as new joiners and their buddies." },
  {
    toolId: "decision-log",
    use: "Offers teammates as each decision's decider and its DACI or RAPID roles.",
  },
  {
    toolId: "daci",
    use: "Offers teammates as each decision's Approver, Driver, Contributors and Informed.",
  },
  {
    toolId: "rapid-decision",
    use: "Offers teammates as each decision's Decide, Recommend, Agree, Perform and Input roles.",
  },
  { toolId: "eisenhower", use: "Offers teammates as who takes a Delegate task." },
  { toolId: "buy-a-feature", use: "Offers the team's size as the number of players." },
];
