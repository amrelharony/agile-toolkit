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
  {
    toolId: "picker",
    use: "Spins the team on its wheel and rotates facilitator, scribe and timekeeper among them.",
  },
  {
    toolId: "team-mixer",
    use: "Puts everyone in the mix at once, and balances groups by each person's role or skills.",
  },
  { toolId: "parking-lot", use: "Offers teammates to pick who raised each point." },
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
  { toolId: "eisenhower", use: "Offers teammates to pick who takes a Delegate task." },
  { toolId: "buy-a-feature", use: "Offers the team's size as the number of players." },
  { toolId: "okrs", use: "Offers teammates as each objective's owner." },
  { toolId: "risk-register", use: "Offers teammates as each risk's owner." },
  { toolId: "flaky-tests", use: "Offers teammates to pick who owns fixing a flaky test." },
  { toolId: "code-review-metrics", use: "Offers teammates as each pull request's author." },
  {
    toolId: "kickoff",
    use: "Fills the Team Canvas with each person and their role, and offers teammates as who takes part and as owners.",
  },
  {
    toolId: "team-time",
    use: "Gives each person a time zone, working hours and office days, to find the hours you share.",
  },
  {
    toolId: "planning-poker",
    use: "Seats everyone at the table in one click, and offers teammates for who should reply to a round without a meeting.",
  },
  { toolId: "relative-sizing", use: "Fills the names the cards are dealt to." },
  {
    toolId: "notes-to-actions",
    use: "Offers teammates as each item's owner, and spells an owner as the team list does when the notes name a teammate.",
  },
  { toolId: "facilitator-timers", use: "“Count the team” fills how many people are in the room." },
  { toolId: "retro-actions", use: "Offers teammates as each action's owner." },
  { toolId: "sprint-review", use: "Suggests teammates' names for who gave the feedback." },
  {
    toolId: "premortem",
    use: "Offers teammates as each cause's owner, and sets the dot-voting budget from how many people are on the team.",
  },
  { toolId: "icebreaker", use: "Counts the team for how many people play." },
  { toolId: "liberating-structures", use: "Offers the team's size to pick a structure that fits." },
  { toolId: "adkar", use: "Offers teammates as each initiative's owner." },
  { toolId: "bug-triage", use: "Offers teammates to pick who found each bug." },
  { toolId: "dependency-map", use: "Offers teammates as each dependency's owner." },
  {
    toolId: "design-sprint",
    use: "Offers teammates as the sprint's Decider and Facilitator, and each task's owner.",
  },
  { toolId: "epic-roadmap", use: "Offers teammates as each epic's owner." },
  {
    toolId: "example-mapping",
    use: "Offers teammates to pick who finds out each question's answer.",
  },
  { toolId: "feature-flag-tracker", use: "Offers teammates as each flag's owner." },
  { toolId: "impediments", use: "Offers teammates as each impediment's owner and who raised it." },
  {
    toolId: "improve",
    use: "Offers teammates to lead each improvement, coach a Kata and own each countermeasure.",
  },
  { toolId: "kanban", use: "Offers teammates as each card's assignee and each story's owner." },
  { toolId: "pi-planning", use: "Offers teammates as each risk's owner under Risks: ROAM." },
  { toolId: "product-metrics", use: "Offers teammates as each metric's owner." },
  {
    toolId: "retro",
    use: "Offers teammates as each action item's owner, and lists them under “Voting as” so each person spends their own votes.",
  },
  { toolId: "strategy-tree", use: "Offers teammates as owners on the levels with an Owner field." },
  { toolId: "test-sessions", use: "Offers teammates as each session's tester." },
];
