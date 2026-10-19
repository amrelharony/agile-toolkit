import type { ToolGuide } from "./types";

/** Guides for the 16 most-used tools. Loaded on demand (see ./index.ts). */
export const CORE_GUIDES: ToolGuide[] = [
  {
    toolId: "retro",
    summary:
      "A retrospective helps the team look back at the last sprint and agree a few concrete improvements for the next one.",
    whenToUse: [
      "At the end of every sprint, before planning the next one.",
      "After a release, a hard week or any event the team wants to learn from.",
    ],
    steps: [
      "Pick a format. Start / Stop / Continue suits most teams; Sailboat and 4Ls help when the team needs a fresh angle.",
      "Write: everyone adds cards silently for 5–10 minutes, one idea per card.",
      "Vote: each person gets three votes for the cards they most want to discuss.",
      "Discuss the top-voted cards in order, timeboxing each one.",
      "Agree one to three actions, each with an owner, and check them at the next retro.",
    ],
    tips: [
      "Keep it safe: discuss situations and processes, not people.",
      "Fewer, owned actions beat a long list nobody follows up.",
      "Rotate the facilitator so it isn't always the Scrum Master.",
    ],
    timebox: "45 minutes for a one-week sprint, up to 90 for a month",
  },
  {
    toolId: "planning-poker",
    summary:
      "Planning Poker gets the team to estimate a story together. Everyone picks a card privately and reveals at once, so the first voice doesn't anchor the rest.",
    whenToUse: [
      "During refinement or sprint planning, for stories the team understands well enough to size.",
      "When estimates swing widely and you want the reasons to come out.",
    ],
    steps: [
      "Read the story and its acceptance criteria aloud; answer questions.",
      "Everyone picks a card without showing it.",
      "Reveal together.",
      "If votes differ, the highest and lowest explain their thinking, then vote again.",
      "Accept the agreed estimate and move to the next story.",
    ],
    tips: [
      "Estimate relative size and uncertainty, not hours.",
      "If a story needs more than two rounds, it probably needs splitting or more refinement.",
      "“?” means “I need more information”, and is a useful signal.",
    ],
    scales: [
      {
        name: "Fibonacci",
        values: [
          { value: "1–3", meaning: "small and well understood" },
          { value: "5–8", meaning: "medium, some unknowns" },
          { value: "13+", meaning: "large or risky — consider splitting" },
        ],
      },
    ],
    timebox: "2–5 minutes per story",
  },
  {
    toolId: "kanban",
    summary:
      "A Kanban board shows work flowing from idea to done. Work-in-progress (WIP) limits stop the team starting more than it can finish.",
    whenToUse: [
      "For continuous work like support, operations or platform teams.",
      "Inside a sprint, to see where work gets stuck.",
    ],
    steps: [
      "Add cards to Backlog.",
      "Set a WIP limit for each in-progress column (start with roughly the team size).",
      "Pull a card forward only when the next column has room.",
      "When a column hits its limit, help finish work there instead of starting new work.",
      "Review cycle time and throughput weekly.",
    ],
    tips: [
      "Stop starting, start finishing.",
      "A card that sits in one column for days is a conversation to have at standup.",
    ],
  },
  {
    toolId: "standup",
    summary:
      "The daily standup is a short check-in where the team syncs on progress towards the sprint goal and surfaces blockers early.",
    whenToUse: ["Every working day, same time and place.", "For co-located or call-based teams."],
    steps: [
      "Each person shares what they finished, what they'll do next and anything blocking them.",
      "Record blockers so they're followed up after the standup.",
      "Take detailed discussions offline with only the people involved.",
    ],
    tips: [
      "Keep it to 15 minutes. Use the Ceremony Timer if it drifts.",
      "Talk about the sprint goal, not just task lists.",
      "Spread across time zones? Try the Async Standup Digest.",
    ],
    timebox: "15 minutes",
  },
  {
    toolId: "sprint-goal",
    summary:
      "A sprint goal is one sentence that says why the sprint matters. It gives the team focus and a way to decide what to drop when things change.",
    whenToUse: ["During sprint planning.", "When a sprint feels like a list of unrelated tickets."],
    steps: [
      "Start from the outcome you want for users or the business, not a list of tasks.",
      "Make it specific and testable: how will you know you achieved it?",
      "Check that the selected backlog items support the goal.",
      "Share it where the team sees it every day.",
    ],
    tips: ["One goal. If you have three, you have none.", "Review it at every standup."],
  },
  {
    toolId: "okrs",
    summary:
      "OKRs pair an inspiring Objective with 3–5 measurable Key Results that show whether you got there.",
    whenToUse: [
      "Quarterly goal setting for a team or product.",
      "Aligning several teams on outcomes.",
    ],
    steps: [
      "Write the Objective as a qualitative, ambitious outcome.",
      "Add 3–5 Key Results that are measurable outcomes, not tasks.",
      "Set a baseline and a target for each Key Result.",
      "Check in weekly: update progress and confidence.",
      "Score honestly at the end of the quarter and carry the lessons forward.",
    ],
    tips: [
      "Key Results measure outcomes (“churn below 3%”), not output (“ship feature X”).",
      "Reaching about 70% of an ambitious OKR is a good result.",
    ],
  },
  {
    toolId: "wsjf",
    summary:
      "Weighted Shortest Job First ranks work by its cost of delay divided by its size, so small, urgent, valuable items rise to the top.",
    whenToUse: [
      "Prioritizing features or epics, especially in SAFe.",
      "When several stakeholders disagree on what comes first.",
    ],
    steps: [
      "Score each item's business value, time criticality and risk reduction relative to the others.",
      "Cost of delay = business value + time criticality + risk reduction.",
      "Score job size relative to the others.",
      "WSJF = cost of delay ÷ job size. Highest first.",
    ],
    scales: [
      {
        name: "Relative scores (modified Fibonacci)",
        values: [
          { value: "1", meaning: "smallest in the set" },
          { value: "3–8", meaning: "in between" },
          { value: "13–20", meaning: "largest in the set" },
        ],
      },
    ],
    tips: [
      "Score one column at a time across all items — relative comparison is the point.",
      "Give the smallest item a 1 in each column and size the others against it.",
    ],
  },
  {
    toolId: "rice-scoring",
    summary:
      "RICE scores ideas by Reach × Impact × Confidence ÷ Effort, to compare very different ideas on one scale.",
    whenToUse: ["Comparing product ideas or features with a data-informed estimate of value."],
    steps: [
      "Reach: how many people it affects in a period (e.g. users per quarter).",
      "Impact: how much it moves the goal for each of them (use the scale below).",
      "Confidence: how sure you are of the other numbers.",
      "Effort: person-months of work.",
      "RICE = Reach × Impact × Confidence ÷ Effort. Highest first.",
    ],
    scales: [
      {
        name: "Impact",
        values: [
          { value: "3", meaning: "massive" },
          { value: "2", meaning: "high" },
          { value: "1", meaning: "medium" },
          { value: "0.5", meaning: "low" },
          { value: "0.25", meaning: "minimal" },
        ],
      },
      {
        name: "Confidence",
        values: [
          { value: "100%", meaning: "backed by data" },
          { value: "80%", meaning: "some evidence" },
          { value: "50%", meaning: "mostly a guess" },
        ],
      },
    ],
  },
  {
    toolId: "story-mapper",
    summary:
      "A user story map lays out the user's journey as steps, with stories under each step, so you can slice releases that deliver value end to end.",
    whenToUse: [
      "Planning a new product or a big feature.",
      "When the backlog is a flat list and the big picture is lost.",
    ],
    steps: [
      "Write the user's journey left to right as steps (the backbone).",
      "Under each step, add the stories that make it possible, most important at the top.",
      "Draw slices across the map: the first slice is the smallest version that works end to end.",
      "Plan releases from the slices.",
    ],
    tips: [
      "Map with the people who know the users, not alone.",
      "The first slice is your walking skeleton.",
    ],
  },
  {
    toolId: "burndown",
    summary:
      "A burndown chart shows the work remaining in the sprint each day against an ideal line, so you can see early if the sprint is at risk.",
    whenToUse: ["Tracking a sprint's progress day by day."],
    steps: [
      "Pick or create a sprint. Its planned points, length and first day are shared with Burnup, Velocity and Sprint Metrics.",
      "Each day, record the points remaining.",
      "Compare the actual line to the ideal line; note scope changes when they happen.",
    ],
    tips: [
      "A flat line for several days usually means work is too big or blocked.",
      "Scope added mid-sprint makes the line go up; mark the scope change and say why, and Burnup's scope line rises with it.",
    ],
  },
  {
    toolId: "velocity",
    summary:
      "Velocity is the amount of work a team completes per sprint. Tracking it over time helps forecast what fits in future sprints.",
    whenToUse: ["Forecasting releases.", "Spotting trends in the team's delivery."],
    steps: [
      "Add each sprint with its committed points; enter the completed points when it ends.",
      "Look at the average and range of the last 3–6 sprints.",
      "Use the range, not one number, to forecast.",
    ],
    tips: [
      "The rows are your shared sprints: edits show in Burndown, Burnup, Sprint Comparison and Sprint Metrics. Removing a sprint removes it everywhere (Undo puts it back).",
      "Velocity is a planning tool for the team, not a performance target.",
      "Don't compare velocity between teams — their points mean different things.",
    ],
  },
  {
    toolId: "risk-register",
    summary:
      "A risk register lists what could go wrong, how likely and how bad each risk is, and what you're doing about it.",
    whenToUse: [
      "Projects with deadlines, dependencies or compliance needs.",
      "Reviewing risks each sprint.",
    ],
    steps: [
      "Describe each risk as “because of X, Y may happen, leading to Z”.",
      "Rate likelihood and impact from 1 to 5.",
      "Agree a response (avoid, reduce, transfer or accept) and an owner.",
      "Review the top risks regularly and close the ones that pass.",
    ],
    tips: [
      "Focus on the few risks with high likelihood × impact.",
      "A risk without an owner is a wish.",
    ],
  },
  {
    toolId: "capacity-planner",
    summary:
      "The capacity planner works out how many hours the team really has in a sprint once time off, meetings and interruptions are taken out.",
    whenToUse: [
      "Sprint planning, before committing to work.",
      "Sprints with holidays or part-time people.",
    ],
    steps: [
      "Set sprint length, hours per day and ceremony overhead.",
      "Add each team member with their availability and days off.",
      "Use the focus factor (typically 0.6–0.8) to allow for interruptions.",
      "Commit to work that fits the capacity, ideally checked against past velocity.",
    ],
    tips: ["Plan to about 80% of capacity to leave room for the unexpected."],
  },
  {
    toolId: "health-check",
    summary:
      "A squad health check asks the team to rate areas like delivering value, speed and fun as green, yellow or red, to start a conversation about what to improve.",
    whenToUse: [
      "Every month or quarter.",
      "When something feels off and you want the team's view.",
    ],
    steps: [
      "For each area, discuss briefly and agree a color together.",
      "Note the trend: better, the same or worse than last time.",
      "Pick one or two red or yellow areas to improve.",
      "Save the check and compare with the next one.",
    ],
    scales: [
      {
        name: "Traffic light",
        values: [
          { value: "Green", meaning: "we're happy with this" },
          { value: "Yellow", meaning: "some problems, not urgent" },
          { value: "Red", meaning: "this really needs attention" },
        ],
      },
    ],
    tips: ["It's for the team's own learning — don't use it to compare teams."],
  },
  {
    toolId: "premortem",
    summary:
      "A premortem imagines the project has already failed and asks why, so the team can spot and prevent risks while there's still time.",
    whenToUse: ["Before starting a big project or release.", "When the plan feels optimistic."],
    steps: [
      "Say: “It's six months from now and this has failed. What went wrong?”",
      "Everyone writes causes silently for a few minutes.",
      "Share and group the causes.",
      "Rate likelihood and impact; pick the top few.",
      "Agree preventive actions and owners — and add the big ones to the risk register.",
    ],
    tips: ["Assuming failure makes it safe to raise concerns people might otherwise hold back."],
    timebox: "45–60 minutes",
  },
  {
    toolId: "ceremony-timer",
    summary:
      "The ceremony timer keeps meetings on time, with fair turns for each speaker and a visible countdown.",
    whenToUse: ["Standups, retros and any timeboxed meeting."],
    steps: [
      "Pick a preset or set the total time.",
      "Add participants to share the time equally.",
      "Start the timer and move to the next speaker when their time is up.",
    ],
    tips: ["Show it full screen during calls so everyone sees the time."],
  },
];
