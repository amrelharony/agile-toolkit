import type { ToolGuide } from "./types";

/** Guides for the "Team & people" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "psych-safety",
    summary:
      "Psychological safety is the shared belief that it's safe to take interpersonal risks on the team, like admitting a mistake or asking for help. This tool runs Amy Edmondson's seven-statement survey in anonymous rounds, each keeping only how many people chose each answer.",
    whenToUse: [
      "When people stay quiet in meetings or problems surface late.",
      "Every quarter, or after a reorg, a new manager or a hard incident.",
    ],
    steps: [
      "Under Run a round, type a Round name (left blank, it's Round N), set Taken on and, if you like, the Sprint.",
      "Press Run a live round, give your name, tick the consent, then share the link with Copy link. Everyone answers the seven statements on their own phone; you see only how many have answered.",
      "Press Reveal results once 5 have answered, then Save round. With paper answers, press Enter counts instead (where live rounds aren't available, the count boxes show on their own), type how many chose each answer, then Show totals and Save round.",
      "Under Results, read the Team score, the Lowest statement and the Change since the round before. Q1, Q3 and Q5 are reverse-scored, so a higher score always means more safety.",
      "When a statement falls by more than 0.5, Send to… → Retro topic (no names) raises it. Compare rounds puts any two rounds side by side with From and To.",
      "Discuss the lowest or falling statement as a team, without asking who answered what, and agree one small change to try.",
    ],
    tips: [
      "A round keeps nothing per person. Results wait for 5 responses, and a statement with fewer than 5 answers is withheld: in a small team, three answers can point at a person.",
      "Never use the score to rank teams or judge a manager. Once it's a target, people stop answering honestly.",
      "Under Rounds, rename or redate a round, or delete it with Undo. Answer sheets saved one by one before rounds, with any names typed on them, are still stored and show as one round, Earlier responses. Delete it to remove them.",
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
      "A mood tracker is a quick daily check-in where each person picks how they feel, from Rough to Great, by name or anonymously. Over two weeks it shows patterns in team energy that are easy to miss day to day.",
    whenToUse: [
      "During a demanding period, such as a release crunch or a reorg, to spot strain early.",
      "As a warm-up at the start of standup.",
      "When you want some data on morale to bring to a retro.",
    ],
    steps: [
      "Under How the team checks in, pick By name or Anonymous. Anonymous records only team pulses: how many picked each face on a day, never who.",
      "By name: under Check-ins by name, each person (or you, for them) picks a face; a note typed first is saved with it. To fill in a missed day, change Check-ins for or click the day in the heatmap.",
      "For a pulse, in either mode: under Anonymous pulse, set Pulse for and press Run a live round, give your name, tick the consent, then share the link with Copy link. Everyone picks a face on their phone; press Reveal results once 3 have answered, then Save round. Or press Enter counts instead (where live rounds aren't available, the count boxes show on their own), type how many picked each face, then Show totals and Save round.",
      "Read the 14-day average (from 3 check-ins, pulse answers included) and the Trend (from 6 days with check-ins). Daily team average charts it; its Advanced analysis adds shifts and the weekly trend.",
      "When the team averages 2.5 or less on 3 check-in days in a row, each with 3 or more check-ins, the Low mood callout offers Send to… → Retro topic (no names).",
    ],
    tips: [
      "One bad day is noise. Three in a row is worth a conversation.",
      "Make it optional, and never ask someone to explain a low score in front of the group. Follow up privately, for example in a 1:1.",
      "By name, everyone with access sees each face and note. If that doesn't suit the team, check in anonymously. Check-ins by name already saved stay, hidden but still in the team average: clear them with the eraser under By name first if they should go.",
      "A second check-in for the same day replaces the first. Clear one with the eraser on its row, or delete a pulse; Undo puts it back.",
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
      "A kudos wall is a shared place to thank teammates for what they did. Each kudos is an Agile at Work card, like the printed ones, with a short message, and Not thanked yet shows who nobody has thanked lately.",
    whenToUse: [
      "Right after someone helps you, unblocks the team or goes beyond their role.",
      "At the end of a sprint, to bring appreciation to the retro.",
      "In remote teams, where good work is easy to miss.",
    ],
    steps: [
      "Under Card, pick the habit (Focus, Ownership, Real needs or Trust), then the episode card that matches what they did. If nothing matches, pick Open for Thank you! or Great teamwork!, and, if you like, the episode it reminds you of. A link with ?ep=NN starts on that episode's card.",
      "Choose the person in To. Nobody is picked for you, though a Suggested name may appear. Pick “Type a name…” for someone who isn't listed; a name that isn't on the team offers Add to the team.",
      "In Thank you for, write up to 50 words on exactly what they did, then click Send kudos or press Ctrl+Enter. First names and general thanks only: no customer names or internal details.",
      "Signed out, your kudos stays private: Send gives a link and a card image to pass on, and nothing is saved unless you tick Keep a copy on this device.",
      "Signed in, Not thanked yet names the teammates no kudos has reached in the Window (Sprint, Last 30 days or All time). Click Send to <name> to write them one.",
      "Click Add to retro on a card to put it in the current retro's appreciations, and read the week's kudos out there. React or reply to a card, and use Export for Markdown, CSV or a PNG of the wall.",
    ],
    tips: [
      "Thank what the person did, not who they are. “You asked what could wait” means more than “You're great”.",
      "Don't count or rank kudos. They are thanks, not a scoreboard, and never feed into performance reviews.",
      "Replies thank the sender and don't count as kudos for anyone.",
      "Example kudos are never posted, shared with the room or added to the retro.",
    ],
  },
  {
    toolId: "maturity",
    summary:
      "An agile maturity assessment rates how established the team's practices are across eight areas, such as Scrum Practices and Technical Excellence. Each saved, dated assessment gives a level and an overall score from 0% to 100%, a trend over time and a roadmap toward a target level.",
    whenToUse: [
      "When a team wants a baseline at the start of its agile journey.",
      "Every 3–6 months, to choose where to focus improvement.",
    ],
    steps: [
      "As a team, pick each dimension's level as it is today, not where you'd like to be; the text under it says what that level looks like. A dimension stays Not scored until you pick, and Clear takes a pick back.",
      "If people disagree, discuss the evidence. When in doubt, pick the lower level.",
      "Set Taken on to the day you scored it (backdate if needed) and click Save assessment. It saves once all eight are scored.",
      "Read the latest assessment: the radar against the previous one, and what changed since. From two assessments, Trend charts the overall score.",
      "Pick a Target level. The Improvement roadmap lists a step for each dimension below it, weakest first; Send to… → Retro action makes a step a retro action to follow up.",
      "Re-score every 3–6 months: Start from the last assessment copies its scores into the new draft. Edit a saved assessment's day or note in place, or delete it with Undo.",
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
      "Until an assessment is saved, the team has no maturity level, so other tools don't assume level 1.",
      "Pair it with the Squad Health Check to hear how the team feels about its work.",
    ],
    timebox: "45–60 minutes",
  },
  {
    toolId: "skills-matrix",
    summary:
      "A skills matrix maps who on the team can do what. It shows the skills nobody can do (gaps) and the ones that hang on one person (single points of failure), and plans who learns what.",
    whenToUse: [
      "When planning cross-training or onboarding.",
      "Before someone leaves, goes on long leave or changes team.",
      "When work keeps queuing behind one specialist.",
    ],
    steps: [
      "Add your team on the Team page first: each person becomes a column. People from an older matrix whose names match the team are merged; anyone else shows as Not on the team, with Add to the team or remove.",
      "Under Add a skill, type the Skill and click Add skill. Set Target people and At level when it needs more than one person, for example 2 at Advanced or above. Skills listed on the Team page but missing here are offered with Add all (Add it for one).",
      "Each person rates themselves: click their cell and pick a level. Clear takes a rating back to Not rated, which never counts.",
      "Read each skill's row: Gap means nobody is at Intermediate or above, Single point of failure names the one person who is, and Below target compares with the target.",
      "Under Cross-training plan, click Add to plan on a suggested pair, or add your own with a Learner, an optional Mentor (none means outside help), the level and a Due day. Click Done once the learner has got there.",
      "Review it every quarter and whenever someone joins or leaves. Reset clears the skills, ratings and plan after you confirm, with Undo; the team stays.",
    ],
    scales: [
      {
        name: "Proficiency",
        values: [
          { value: "None", meaning: "hasn't worked with it" },
          { value: "Beginner", meaning: "learning; needs help" },
          { value: "Intermediate", meaning: "handles routine work alone" },
          { value: "Advanced", meaning: "handles complex work and helps others" },
          { value: "Expert", meaning: "the go-to person; can teach and set direction" },
        ],
      },
    ],
    tips: [
      "Agree what each level means for your team before rating, since self-ratings vary.",
      "A single point of failure is one person at Intermediate or above, even if they're only Intermediate.",
      "When a learner's rating reaches the level, the plan asks “mark it done?”. Done is never ticked for you.",
    ],
  },
  {
    toolId: "raci",
    summary:
      "A RACI matrix makes clear who does what for each activity: who is Responsible for doing the work, who is Accountable for the result, who is Consulted and who is Informed. Your teammates or group roles are the columns, and the checks show where the load piles up.",
    whenToUse: [
      "When ownership is unclear or work falls between roles.",
      "When setting up a new team, project or process that involves several roles.",
      "After a handoff went wrong because someone wasn't told.",
    ],
    steps: [
      "Under Add to the matrix, pick a teammate in Person or role (or type a group like Dev Team) and click Add column. Add everyone on the team adds the rest of the roster. An empty matrix offers Start from the Scrum roles.",
      "Name an Activity and click Add activity for each piece of work.",
      "In each cell, press R, A, C or I; press it again to clear it. A and R can go together (A/R); C or I stands alone.",
      "Give every activity exactly one A and at least one R. Checks flags any that don't, and load warnings: someone Accountable for more than half of 4 or more activities, or more than 3 roles consulted on one.",
      "Letters per role counts each role's R, A, C and I. Review the matrix with everyone named in it, and update it when roles change.",
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
      "Click a name to rename it; a column renamed to a teammate's name links to them.",
      "Delete a row or a column with Undo. Clear the matrix asks first and can be undone too.",
      "An activity with no letters yet is not assigned, not an error.",
    ],
    timebox: "30–60 minutes",
  },
  {
    toolId: "onboarding-tracker",
    summary:
      "The onboarding tracker follows each new joiner through milestones from a template you can edit, from first commit to mentoring a peer. It shows the time to a first PR and to productivity, and a ramp curve that counts each day only for the people who have been there that long.",
    whenToUse: [
      "From a new team member's first day.",
      "When ramp-up feels slow and you want to see where people get stuck.",
      "To check whether onboarding changes, like better docs or a buddy, actually help.",
    ],
    steps: [
      "Under Add a new joiner, pick their Name from the team (or type it and choose Add to the team), their Role, an optional Buddy and their Start date (backdating is fine), then click Add onboardee.",
      "Tick a milestone when it's reached. It records today; change Reached on to the day it really happened.",
      "Click a milestone's name to rename it, or change its target days, for that person only. Add a note when something helped or got in the way.",
      "Check weekly. A milestone is “at risk” once more than half its target time has passed, and “overdue” after the target.",
      "Read the KPIs: each average shows once 3 people have reached that milestone.",
      "Under Milestone template, rename, retarget, add or remove (with Undo) the milestones new joiners start with, and set KPI to mark which one counts as the First PR or as Productive. Use the built-ins goes back to the six defaults.",
    ],
    scales: [
      {
        name: "Built-in targets (days from start)",
        values: [
          { value: "3–7", meaning: "first commit, first PR" },
          { value: "14–30", meaning: "first merge, first production deploy" },
          { value: "60–90", meaning: "independent feature, mentor a peer" },
        ],
      },
    ],
    tips: [
      "Template changes apply to people you add afterwards; everyone already here keeps their own copy.",
      "The KPIs follow the milestone marked First PR or Productive, so renaming it never breaks them.",
      "A slow first PR usually points to setup and access problems. Fix them before the next hire.",
      "Give each new joiner a buddy. The Team Skills Matrix helps you pick one.",
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
  {
    toolId: "dod-builder",
    summary:
      "The Definition of Done (DoD) is the shared checklist every backlog item must meet before the team calls it done. Write the criteria here, tick them on each story's Sprint board card, and see how many done stories meet them, sprint by sprint.",
    whenToUse: [
      "Forming a new team, or when “done” means different things to different people.",
      "When bugs or rework keep coming back from work that was marked done.",
      "At a retro, to check whether the team is living up to its own quality bar.",
    ],
    steps: [
      "Write a Criterion, pick a Category and keep Required ticked unless it's optional, then click Add criterion. With none yet, Start from common criteria adds a starter set.",
      "On the Kanban Sprint board, open DoD on a story's card (“DoD 3 of 5”) and tick each criterion the story meets. Moving a story to Done with required criteria open says so; it never blocks.",
      "Pick a Sprint. The sentence, Meeting the DoD and Adherence say how many of its done stories meet every required criterion, and Done stories in <sprint> lists what each still needs, with Tick them on the Sprint board.",
      "Adherence by sprint charts it from 2 sprints with done stories. Its Advanced analysis adds a trend test from 6 sprints and control limits from 8.",
      "On Release Readiness, Add the Definition of Done gate to check the done stories each release links against these criteria.",
    ],
    tips: [
      "Keep the Required list short enough that the team really meets it every time. Add criteria as the team's skills grow.",
      "Click a criterion's words to edit it. Delete has Undo, and the stories keep their ticks; Clear the criteria asks first.",
      "Every sprint is checked against today's required criteria, so a criterion added later counts against earlier sprints too.",
      "The DoD applies to every item; acceptance criteria apply to one story. You need both.",
    ],
  },
  {
    toolId: "one-on-one",
    summary:
      "A 1:1 is a regular private conversation between a manager and a team member about their work, wellbeing and growth. The tracker keeps a rolling agenda per pair, follows actions through to Done and flags a report whose next 1:1 is late. No agent can read the notes.",
    whenToUse: [
      "Every week or two between a manager and each direct report.",
      "When follow-ups from past 1:1s keep getting lost.",
    ],
    steps: [
      "Under Start a new 1:1, pick the Manager and the Report from the team (or type them) and the Date (backdate it to log a past 1:1), then click Start meeting. Open items and Actions from your last 1:1 with the same person carry over.",
      "Add agenda items before or during the meeting. Let the report bring most of them.",
      "Pick each item's status. For an Action, fill in the action, Owner and due date. Done records today; change Done on to backdate it.",
      "Click an item's text to edit it, use Edit details for the people, date or description, and write Notes (saved when you click out of the box).",
      "Under Cadence per report, pick each report's Cadence (every 1 to 4 weeks). Without one, their usual gap counts once they've had four 1:1s. A late 1:1 shows “→ N days overdue”, and the timeline shows the rhythm.",
      "Delete a 1:1 or an item with Undo. Export gives the cadence and the 1:1s as Markdown, or each 1:1's agenda and actions as CSV.",
    ],
    scales: [
      {
        name: "Agenda status",
        values: [
          { value: "Open", meaning: "not covered yet; carries over to the next 1:1" },
          { value: "Discussed", meaning: "covered, nothing more to do" },
          { value: "Action", meaning: "needs follow-up by an owner; carries over until done" },
          { value: "Done", meaning: "the follow-up is finished, on the day in Done on" },
        ],
      },
    ],
    tips: [
      "It's the report's meeting. Talk about growth and blockers, not a status update.",
      "Mark a finished action Done: it's never overdue and never carried over again.",
      "A carried-over action counts once, in the 1:1 it was carried to.",
    ],
    timebox: "30–60 minutes",
  },
  {
    toolId: "working-agreement",
    summary:
      "A working agreement is a short set of rules the team writes together about how it communicates, meets, decides and handles conflict. The builder records each person's consent, saves check-ins on whether the rules work in practice, and keeps published versions you can compare.",
    whenToUse: [
      "When a new team forms or several people join.",
      "When the same friction keeps coming up in retros, like slow reviews or meetings without agendas.",
      "Every few months, to check the rules still fit.",
    ],
    steps: [
      "Under Add a rule, pick a Category, write the Rule (and an optional Description) and click Add rule, or pick one from the Starter catalog.",
      "Open a rule's Consent and answer for each teammate: Consent, Concern (with a note) or Object. For someone not on the team, type them under Someone else, pick Their answer and click Record answer.",
      "Every month or so, mark each rule Working, Partly or Not working on its card, then under Check-in round set the Day of the check-in (and a Sprint) and click Save check-in round.",
      "Adherence by check-in charts the saved rounds from two, a rule partly working counting as half; its Advanced analysis adds a trend test from six.",
      "Under Publish and versions, add the team name and purpose and click Publish vN to keep the rules as a version. Changes since vN lists what moved, and Compare … with … shows any two versions or the draft.",
    ],
    tips: [
      "Keep it short. Five to ten rules people remember beat thirty nobody reads.",
      "Write behaviors (“PRs reviewed within one working day”), not values (“be respectful”).",
      "A concern still counts as consent; one objection means the rule doesn't have everyone's consent.",
      "A rule not working, or only partly, in the last check-in can go to the retro with Send to… → Retro topic.",
      "Delete a rule or a saved round with Undo. Clear the charter asks first and can be undone too.",
    ],
    timebox: "60–90 minutes for the first version",
  },
  {
    toolId: "stakeholder-map",
    summary:
      "A stakeholder map places people on an Interest × Authority grid, often called a power/interest grid. Each quadrant suggests how closely to engage that person, and each stakeholder's card compares how they feel now with how you need them to feel.",
    whenToUse: [
      "At the start of a project, product or change initiative.",
      "When decisions stall or someone keeps being surprised by plans.",
    ],
    steps: [
      "Under Add a stakeholder, type the Stakeholder name and Role. Optionally set Place in, Sentiment now and Sentiment you need, then click Add stakeholder. Nobody lands in a quadrant until you place them.",
      "Place the people under Not placed yet by dragging them onto the map, or with Place in…. Drag a dot to move it, or focus it and use the arrow keys (Shift moves 3).",
      "Tap a dot to see their details beside the map. The quadrant cards count only placed stakeholders.",
      "On each stakeholder's card, set Now and Need to see the gap, such as “2 steps short”. Log the Last contact and plan the Next touch, or click Contacted today.",
      "Check Touches due for who to reach out to next, and review the map monthly or at each milestone. All stakeholders is the full table; Export gives it as Markdown or CSV.",
    ],
    scales: [
      {
        name: "Quadrants (5 or more counts as high)",
        values: [
          {
            value: "Manage Closely",
            meaning: "high authority, high interest: engage often, plan together",
          },
          {
            value: "Keep Satisfied",
            meaning: "high authority, low interest: brief them, avoid surprises",
          },
          { value: "Keep Informed", meaning: "low authority, high interest: share progress" },
          {
            value: "Monitor",
            meaning: "low authority, low interest: light touch, watch for changes",
          },
        ],
      },
    ],
    tips: [
      "Start with the Manage Closely stakeholders who are short of where you need them.",
      "A next touch is due within 7 days, and overdue once its day has passed.",
      "Be careful where you share the map. Sentiment labels can hurt if the wrong person reads them.",
      "Remove a stakeholder with Undo. Clear all asks first and can be undone too.",
    ],
  },
  {
    toolId: "adkar",
    summary:
      "ADKAR (from Prosci) names five things people need for a change to stick: Awareness, Desire, Knowledge, Ability and Reinforcement. The tracker moves each change through these stages on dated moves, and scores the groups it affects to find each group's barrier point: where adoption is stuck, and for whom.",
    whenToUse: [
      "Rolling out a new process, tool or way of working.",
      "When a change has been announced but people aren't adopting it.",
    ],
    steps: [
      "Under Add an initiative, name the change, pick an Owner from the team and set the Start date (backdate it if it started earlier). It starts at Awareness on that day.",
      "Under Groups, add each group the change affects with Add group, and score it 1–5 on the five elements. Clear takes a score back.",
      "Read the barrier: a group's first element scored 3 or lower is its barrier point, named on the card. Work on it before the later elements; an unscored element before it needs a score first.",
      "When most people have reached the next stage, set Moved on to the day it happened and click Advance stage. If adoption slips, click Step back. Undo takes a move back.",
      "Review every few weeks. Stage history shows the days spent in each stage, and the cards say how long each change has been in its stage. Click Edit to change an initiative's details.",
      "Keep going until Reinforcement, and keep reinforcing after that so people don't slip back.",
    ],
    scales: [
      {
        name: "ADKAR stages",
        values: [
          { value: "Awareness", meaning: "people understand why the change is needed" },
          { value: "Desire", meaning: "people choose to take part" },
          { value: "Knowledge", meaning: "people know how to change" },
          { value: "Ability", meaning: "people can do it in real work" },
          { value: "Reinforcement", meaning: "the change is sustained so it sticks" },
        ],
      },
    ],
    tips: [
      "Don't skip stages: training (Knowledge) won't help if people don't want the change (Desire).",
      "If the tracker warns that the change is past a group's barrier, step back or work on that element with them.",
      "ADKAR describes individuals. Score a group by how many people in it are there, and follow up with the rest.",
    ],
  },
];
