import type { ToolGuide } from "./types";

/** Guides for the "Team health" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "psych-safety",
    summary:
      "Psychological safety is the shared belief that it's safe to take interpersonal risks on the team, like admitting a mistake or asking for help. This tool runs Amy Edmondson's seven-question survey and shows a team score, a per-question radar and the weakest area.",
    whenToUse: [
      "When people stay quiet in meetings or problems surface late.",
      "Every quarter, or after a reorg, a new manager or a hard incident.",
    ],
    steps: [
      "Ask each person to rate the seven statements privately, from 1 (strongly disagree) to 5 (strongly agree).",
      "Enter each person's answers with the sliders and click Submit response. Leave the respondent name blank to keep answers anonymous.",
      "Read the Team score against the 4.0 benchmark. Statements marked “reversed” are flipped, so a higher score always means more safety.",
      "Discuss the Lowest question as a team and agree one small change to try.",
      "Repeat each quarter. With four or more responses, the Anomaly card flags a drop of more than 0.5 between older and newer responses.",
    ],
    tips: [
      "Collect answers anonymously, for example on paper or in a form, then enter them in one sitting.",
      "Never use the score to rank teams or judge a manager. Once it's a target, people stop answering honestly.",
      "A low score on mistakes being held against people is a good opener for a blameless session on the Retro Board.",
    ],
    scales: [
      {
        name: "Agreement",
        values: [
          { value: "1–2", meaning: "disagree with the statement" },
          { value: "3", meaning: "neither agree nor disagree" },
          { value: "4–5", meaning: "agree with the statement" },
        ],
      },
    ],
    timebox: "5 minutes to answer, 30–45 minutes to discuss the results",
  },
  {
    toolId: "mood-tracker",
    summary:
      "A mood tracker is a quick daily check-in where each person picks how they feel, from Rough to Great. Over two weeks it shows patterns in team energy that are easy to miss day to day.",
    whenToUse: [
      "During a demanding period, such as a release crunch or a reorg, to spot strain early.",
      "As a warm-up at the start of standup.",
      "When you want some data on morale to bring to a retro.",
    ],
    steps: [
      "Add each team member under Today's check-in.",
      "Once a day, each person clicks the label that matches how they feel and can add an optional note. You can only log today, so do it at the same time each day.",
      "Check the 14-day Heatmap for runs of Rough or Low days for one person.",
      "Check the Trend card and the Daily-average mood chart for the whole team. Regime markers on the chart flag a sustained rise or drop, not one bad day.",
      "Bring patterns, not individual scores, to the retro and ask what's behind them.",
    ],
    tips: [
      "Make it optional, and never ask someone to explain a low score in front of the group. Follow up privately, for example in a 1:1.",
      "Names are visible to everyone with access, so agree as a team how the data will be used.",
      "One bad day is noise. Three in a row is worth a conversation.",
    ],
    scales: [
      {
        name: "Mood",
        values: [
          { value: "Rough / Low", meaning: "a hard or below-par day" },
          { value: "Neutral", meaning: "an okay day" },
          { value: "Good / Great", meaning: "a good or great day" },
        ],
      },
    ],
  },
  {
    toolId: "kudos",
    summary:
      "A kudos wall is a shared place to thank teammates in public. Each kudos is a themed card with a short message, so recognition becomes a regular habit instead of an afterthought.",
    whenToUse: [
      "Right after someone helps you, unblocks the team or goes beyond their role.",
      "At the end of a sprint or retro, to close on appreciation.",
      "In remote teams, where good work is easy to miss.",
    ],
    steps: [
      "Pick a Kudos type, such as Thank You or Great Job.",
      "Choose the person in To, or pick “Type a name…” for someone who isn't listed. Add a Team if you like.",
      "Write a Message of up to 50 words that says what they did and why it mattered. Check the Live preview.",
      "Click Send kudos to post it to Recent kudos, or Download PNG to share it outside the toolkit.",
      "React with an emoji or reply to cards others send. Use Invite squad so the whole team can see the wall.",
    ],
    tips: [
      "Be specific. “Your test fixes halved our build time” means more than “Great job”.",
      "Spread it around. Quiet work like reviews, docs and support often goes unthanked.",
      "Add a short kudos round to the end of your retro.",
    ],
  },
  {
    toolId: "impediments",
    summary:
      "An impediment is anything slowing the team down that it can't easily fix on its own. The tracker logs each one with a category, severity and owner, and shows how long items stay open and how fast they get resolved.",
    whenToUse: [
      "When blockers come up at standup and need follow-up afterwards.",
      "When the same problems keep coming back and you need evidence to escalate them.",
    ],
    steps: [
      "Click Log Impediment. Add a Title, a Description of the impact, a Category (Technical, Organizational, External or Process) and a Severity.",
      "Fill in Raised By, Assigned To and Expected Resolution (days).",
      "Review open items at standup or at least weekly. The age badge turns amber after 3 days and red after 7.",
      "Click Escalate when the team can't remove it alone, and Resolve when it's gone. The tool records the resolved date.",
      "Use the filters and the Weekly raised chart to spot recurring categories, and watch the resolution time card.",
    ],
    tips: [
      "Describe the blocker, not a person: “test environment down for two days”, not “Ops is slow”.",
      "Every impediment needs an owner, even if their job is only to escalate it.",
      "Recurring impediments make good retro topics. Ones that might happen again belong in the Risk Register.",
    ],
    scales: [
      {
        name: "Severity",
        values: [
          { value: "Low", meaning: "a nuisance; work carries on" },
          { value: "Medium", meaning: "slows the team down" },
          { value: "High", meaning: "blocks a story or a person" },
          { value: "Critical", meaning: "blocks the sprint goal or a release" },
        ],
      },
    ],
  },
  {
    toolId: "maturity",
    summary:
      "An agile maturity assessment rates how established the team's practices are across eight areas, such as Scrum Practices and Technical Excellence. You get a radar of strengths and gaps and a roadmap toward a target level.",
    whenToUse: [
      "When a team wants a baseline at the start of its agile journey.",
      "Every 3–6 months, to choose where to focus improvement.",
    ],
    steps: [
      "As a team, read the description under each dimension and move its slider to the level that matches today, not where you'd like to be.",
      "If people disagree, discuss the evidence. When in doubt, pick the lower level.",
      "Look at the Maturity Radar for the weakest dimensions.",
      "Set a Target level. The Improvement Roadmap lists each dimension below it, with what the next level looks like.",
      "Pick one or two roadmap items to work on. The tool keeps one current assessment, so export it before you re-score in a few months.",
    ],
    scales: [
      {
        name: "Maturity level",
        values: [
          { value: "1 Initial", meaning: "ad hoc and inconsistent" },
          { value: "2 Developing", meaning: "in place but uneven" },
          { value: "3 Defined", meaning: "consistent, timeboxed and documented" },
          { value: "4 Managed", meaning: "measured, visible and followed up" },
          { value: "5 Optimizing", meaning: "continuously experimenting and improving" },
        ],
      },
    ],
    tips: [
      "It's a conversation starter, not a grade. Scores used as targets get inflated.",
      "Move one level at a time. Jumping from 1 to 4 rarely sticks.",
      "Pair it with the Squad Health Check to hear how the team feels about its work.",
    ],
    timebox: "45–60 minutes",
  },
  {
    toolId: "skills-matrix",
    summary:
      "A skills matrix maps who knows what on the team. It shows knowledge gaps and skills that depend on a single person (a bus factor of 1), so you can plan pairing and learning.",
    whenToUse: [
      "When planning cross-training or onboarding.",
      "Before someone leaves, goes on long leave or changes team.",
      "When work keeps queuing behind one specialist.",
    ],
    steps: [
      "Add skills as rows with Add Skill and people as columns with the + button. Click a name to rename it.",
      "Each person rates themselves. Click a cell to step through None, Beginner, Intermediate, Advanced and Expert.",
      "Check the Risk Analysis. A knowledge gap means nobody is Intermediate or above; bus factor 1 means only one person is Advanced or above.",
      "Plan pairing, shadowing or training for the flagged skills, starting with the work the team needs most.",
      "Review the matrix every quarter and whenever someone joins or leaves.",
    ],
    scales: [
      {
        name: "Proficiency",
        values: [
          { value: "Beginner", meaning: "learning; needs help" },
          { value: "Intermediate", meaning: "handles routine work alone" },
          { value: "Advanced", meaning: "handles complex work and helps others" },
          { value: "Expert", meaning: "the go-to person; can teach and set direction" },
        ],
      },
    ],
    tips: [
      "Agree what each level means for your team before rating, since self-ratings vary.",
      "Coverage counts any filled cell, so a high percentage can still hide a bus factor.",
      "Turn each flag into an action, such as a pairing rotation or a learning goal next sprint.",
    ],
  },
  {
    toolId: "raci",
    summary:
      "A RACI matrix makes clear who does what for each activity: who is Responsible for doing the work, who is Accountable for the result, who is Consulted and who is Informed.",
    whenToUse: [
      "When ownership is unclear or work falls between roles.",
      "When setting up a new team, project or process that involves several roles.",
      "After a handoff went wrong because someone wasn't told.",
    ],
    steps: [
      "List the activities as rows and the roles as columns. Use Add Activity and Add role, and click a name to rename it.",
      "In each cell, pick R, A, C, I or None.",
      "Give every activity exactly one A. The validation box flags any activity with none or more than one.",
      "Check that each activity has at least one R, and keep the C and I lists short.",
      "Review the matrix with everyone named in it, and update it when roles change.",
    ],
    scales: [
      {
        name: "RACI",
        values: [
          { value: "R", meaning: "Responsible: does the work" },
          { value: "A", meaning: "Accountable: owns the result and signs off; one per activity" },
          { value: "C", meaning: "Consulted: gives input before or during the work" },
          { value: "I", meaning: "Informed: kept up to date on progress or decisions" },
        ],
      },
    ],
    tips: [
      "Too many Cs slows everything down. Consult only people whose input changes the result.",
      "A role with an A on most rows is a bottleneck. Spread accountability where you can.",
      "For a one-off decision rather than ongoing work, try the DACI Decision Doc.",
    ],
    timebox: "30–60 minutes",
  },
  {
    toolId: "onboarding-tracker",
    summary:
      "The onboarding tracker follows each new hire through six milestones, from first commit to mentoring a peer. It shows time-to-first-PR, time-to-productivity and an average ramp curve, so you can see where onboarding slows down.",
    whenToUse: [
      "From a new team member's first day.",
      "When ramp-up feels slow and you want to see where people get stuck.",
      "To check whether onboarding changes, like better docs or a buddy, actually help.",
    ],
    steps: [
      "Enter the person's name, role and Start date, then click Add. The six milestones appear with target days.",
      "Tick a milestone on the day it's reached. The tool records today's date and shows “done in Xd”.",
      "Add a short note to a milestone when something helped or got in the way.",
      "Check weekly. A milestone shows “at risk” once half its target time has passed and “overdue” after the target.",
      "Compare the average time-to-first-PR, time-to-productivity (Independent feature) and the ramp curve across hires.",
    ],
    scales: [
      {
        name: "Milestone targets (days from start)",
        values: [
          { value: "3–7", meaning: "first commit, first PR" },
          { value: "14–30", meaning: "first merge, first production deploy" },
          { value: "60–90", meaning: "independent feature, mentor a peer" },
        ],
      },
    ],
    tips: [
      "Tick milestones on the day they happen. Ticking later records the wrong date.",
      "A slow first PR usually points to setup and access problems. Fix them before the next hire.",
      "Give each new hire a buddy. The Team Skills Matrix helps you pick one.",
    ],
  },
  {
    toolId: "devex-survey",
    summary:
      "Developer experience (DevEx) is how developers feel about their daily work. This survey covers its three core dimensions, flow state, feedback loops and cognitive load, to find what slows the team down.",
    whenToUse: [
      "Every month or quarter, to track how working conditions change.",
      "When delivery slows and you want the developers' view of why.",
      "Before and after a tooling or process change, to see if it helped.",
    ],
    steps: [
      "Ask each developer to rate the three areas from 1 to 5, ideally anonymously.",
      "Log each answer: set the Date, leave Respondent blank to keep it anonymous, move the sliders, add Comments and click Submit response.",
      "Read the averages. Higher is better for flow and feedback; lower is better for cognitive load.",
      "Use the Score distribution chart to see whether a low average comes from a few people or the whole team.",
      "Read the comments, pick the weakest area and agree one fix before the next round. Averages cover every response logged, so export after each round to compare.",
    ],
    scales: [
      {
        name: "Flow state",
        values: [
          { value: "1", meaning: "constantly interrupted" },
          { value: "5", meaning: "uninterrupted deep work" },
        ],
      },
      {
        name: "Feedback loops",
        values: [
          { value: "1", meaning: "slow or stale" },
          { value: "5", meaning: "fast and trusted" },
        ],
      },
      {
        name: "Cognitive load",
        values: [
          { value: "1", meaning: "low (good)" },
          { value: "5", meaning: "overwhelming (bad)" },
        ],
      },
    ],
    tips: [
      "Share the results and the fix you chose, or people stop answering.",
      "Pair perceptions with system data, such as the DORA Scorecard.",
    ],
  },
  {
    toolId: "space-pulse",
    summary:
      "SPACE looks at developer productivity from five angles: Satisfaction and well-being, Performance, Activity, Communication and collaboration, and Efficiency and flow. This pulse records one team rating per quarter so you can see where to invest.",
    whenToUse: [
      "Once a quarter, as a team-level productivity check-in.",
      "When leaders want a view of productivity that isn't just output counts.",
    ],
    steps: [
      "Collect each person's 1–5 rating for the five dimensions, then agree on or average them into one team score. Performance means outcomes like quality and impact; Activity means volume, like commits and reviews.",
      "Enter the Quarter as YYYY-Q1 to Q4 (for example 2026-Q1), set the sliders and add a Description of the quarter.",
      "Click Add pulse. Logging the same quarter again replaces the earlier entry.",
      "Each card shows the score with an arrow against the prior quarter, and the Radar shows the latest shape.",
      "Pick the lowest or fastest-falling dimension and agree one investment for next quarter.",
    ],
    scales: [
      {
        name: "Score",
        values: [
          { value: "1–2", meaning: "a real problem (shown in red)" },
          { value: "3", meaning: "okay" },
          { value: "4–5", meaning: "a strength (shown in green)" },
        ],
      },
    ],
    tips: [
      "Never judge productivity by Activity alone. SPACE says to read several dimensions together.",
      "For a closer look at flow and cognitive load, run the DevEx Survey.",
      "Always write the Description. Without context, old scores are hard to explain.",
    ],
  },
  {
    toolId: "tech-radar",
    summary:
      "A tech radar shows which technologies the team uses, is trying, is exploring or wants to avoid. Each item, called a blip, sits in one of four rings (Adopt, Trial, Assess, Hold) and one of four quadrants.",
    whenToUse: [
      "When the team needs a shared view of its tech choices, for onboarding or architecture talks.",
      "When the same “should we use X?” debate keeps coming back.",
      "Every few months, to review and retire tools.",
    ],
    steps: [
      "Add a blip: type its Name, pick a Ring and a Quadrant (Languages & Frameworks, Tools, Platforms or Techniques), and write the rationale.",
      "Put new items in Assess or Trial. Move a blip to Adopt only after real use on a project.",
      "Use the ring menu on each blip to move it as your view changes. Recently moved counts moves in the last 30 days.",
      "Review the radar as a team every few months, and question anything in Hold that is still in use.",
    ],
    scales: [
      {
        name: "Rings",
        values: [
          { value: "Adopt", meaning: "proven here; the default choice" },
          { value: "Trial", meaning: "use on a project that can handle the risk" },
          { value: "Assess", meaning: "worth exploring to understand the impact" },
          { value: "Hold", meaning: "don't start new work with it" },
        ],
      },
    ],
    tips: [
      "Always write the rationale. A blip without a reason invites the same debate again.",
      "Record big moves, like adopting a new framework, in the Decision Log (ADR).",
      "Keep it small. A radar with a hundred blips stops being read.",
    ],
  },
];
