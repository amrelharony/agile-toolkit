import type { ToolGuide } from "./types";

/** Guides for the 16 most-used tools. Loaded on demand (see ./index.ts). */
export const CORE_GUIDES: ToolGuide[] = [
  {
    toolId: "retro",
    summary:
      "Run the retrospective for one sprint. The board opens with what the toolkit already knows about that sprint, then the team writes, votes, discusses and agrees a few actions, each with an owner.",
    whenToUse: [
      "At the end of every sprint, before planning the next one.",
      "After a release, a hard week or any event the team wants to learn from.",
      "When the Sprint Cockpit says No retro for this sprint yet: its Open the retro board link picks that sprint for you.",
    ],
    steps: [
      "Under Retro for, check the sprint this retro looks back on: the one you came from, else the sprint ending nearest today. Pick another or press Unlink, then choose a format, or Quick Start: Start / Stop / Continue. First time? Load an example shows a finished board.",
      "In Write, read Facts from your sprint: goal, say/do, burndown, impediments, mood, kudos and how the last retro's actions went, each linked to its tool. Under Actions from the last retro, Carry over the ones still open, and add the sprint's kudos as cards.",
      "Add cards to each column; pasting several lines adds one card per line. Click a card's text to fix it. In Write, Group with… puts a card under a similar one in its column, and the bin deletes a card, with Undo. From 10 cards, Common words rings the cards that share a word.",
      "Press Next Phase to vote. Everyone has 3 votes: on a shared screen, pick who is voting under Voting as. Previous phase goes back and keeps the votes.",
      "In Discuss the cards are sorted by votes. Click one to mark it as discussing, and timebox it: pick 5m, 10m, 15m or 30m on the timer and press Start.",
      "In Actions, tick the cards the team will act on, pick each one's owner from the team, and use Send to… to raise it as an Impediment or a Kanban card. Retro Actions follows them up.",
      "Export gives the board as Markdown or JSON. New Retro moves the board to Past retros, below the format picker; Undo in the toast brings it back.",
    ],
    tips: [
      'A fact with no data says what\'s missing (for example "No mood check-ins this sprint"); follow its link to fill it in.',
      "Fewer, owned actions beat a long list nobody follows up.",
      "Example cards can't be sent to other tools, and Clear example removes only them.",
      "Past retros keep the latest 20. The New Retro confirmation names any that will drop off.",
    ],
    timebox: "45 minutes for a one-week sprint, up to 90 for a month",
  },
  {
    toolId: "planning-poker",
    summary:
      "Planning Poker gets the team to estimate a story together. Everyone picks a card privately and reveals at once, so the first voice doesn't anchor the rest, and the agreed points go back to the story.",
    whenToUse: [
      "During refinement or sprint planning, for stories the team understands well enough to size.",
      "When estimates swing widely and you want the reasons to come out.",
      "When Refinement, Sprint Planning or the Story Mapper queued unsized stories.",
    ],
    steps: [
      "Under Start a Session, name it, pick the Estimation scale (Fibonacci, T-Shirt or Custom card values) and your display name, then click Start Session. Start with the queue brings in the stories other tools queued; Start a live room lets everyone vote from their own device.",
      "Add stories in the Story Queue (or Add queued stories), then read the current one and its acceptance criteria aloud and answer questions.",
      "Everyone picks a card without showing it: under Your vote, or record each person's card under Votes, or click Next voter to pass the screen round.",
      "Click Reveal. The verdict says how close the votes are, with Average, Median, Mode and Cards apart.",
      "If votes differ, the highest and lowest explain their thinking, then click Vote Again.",
      "Pick the agreed card under Accept estimate and click Accept. Queued stories get their points back where they came from; Save to backlog adds the stories you typed here.",
    ],
    tips: [
      "Estimate relative size and uncertainty, not hours.",
      "If a story needs more than two rounds, it probably needs splitting or more refinement.",
      "“?” means “I need more information”, and is a useful signal.",
      "Under the deck, the Estimation Guide shows what the picked card means and its reference stories.",
    ],
    scales: [
      {
        name: "Consensus",
        values: [
          { value: "Full consensus", meaning: "everyone picked the same card" },
          { value: "Near consensus", meaning: "the votes are on neighbouring cards" },
          {
            value: "Discussion needed",
            meaning: "the votes are two or more cards apart: talk, then vote again",
          },
        ],
      },
    ],
    timebox: "2–5 minutes per story",
  },
  {
    toolId: "kanban",
    summary:
      "Two boards. The Sprint board shows the selected sprint's stories by status and saves every move on the story, so the Sprint Cockpit, the standup and the Sprint Review read it. The Flow board holds free cards with WIP limits, classes of service, cycle time and throughput.",
    whenToUse: [
      "During the sprint, to move stories as work starts and finishes.",
      "When work seems stuck: each card shows its days in the column, and a column over its WIP limit is flagged.",
      "For work outside a sprint, or a team that doesn't run sprints, on the Flow board.",
    ],
    steps: [
      "Pick Sprint board or Flow board at the top. It opens on the Sprint board while a sprint is active, otherwise on the Flow board, and remembers your choice in this browser.",
      "On the Sprint board, pick the sprint under Sprint. Drag a story by its grip, or use Move to… on the card, to put it in To do, In progress, Review or Done. Each move offers Undo.",
      "Click No owner (Unassigned on the Flow board) to pick who has the card, then Save. Click Flag blocked when it's stuck and Unblock once it moves again.",
      "Type WIP limits in the column headers. A column over its limit shows a warning but never blocks a move: finish something there before pulling more.",
      "On the Flow board, type a New card title and click Add; paste several lines to add one card per line. Retro actions sent with Send to… land in Backlog too.",
      "Above the Flow board, Cycle avg needs three finished cards and 85% within needs five; the Weekly throughput chart and Advanced analysis follow as history builds. Export gives the board on screen as Markdown, CSV or JSON.",
    ],
    tips: [
      "The two boards share their WIP limits: the Sprint board's To do uses the Flow board's Ready limit.",
      "A completed or cancelled sprint's board is read-only. Pick an open sprint to keep moving stories.",
    ],
    scales: [
      {
        name: "Class of service (Flow board)",
        values: [
          { value: "Standard", meaning: "the usual work, pulled in order" },
          { value: "Expedite", meaning: "urgent work that jumps the queue; keep it rare" },
          { value: "Fixed Date", meaning: "has to be done by a set date, so start it in time" },
          {
            value: "Intangible",
            meaning: "no visible value yet but costly to put off, such as an upgrade",
          },
        ],
      },
    ],
  },
  {
    toolId: "standup",
    summary:
      "The Standup Tracker runs the Daily Scrum person by person over the sprint board, with a clock for each turn. You get one update per person per day and the open blockers with their age, each one ready to raise as an impediment.",
    whenToUse: [
      "Every working day, for the 15-minute Daily Scrum on a shared screen or call.",
      "When the standup turns into a status report: each turn starts from the person's own cards and what they planned last time.",
      "When blockers come up at standup and then get forgotten.",
    ],
    steps: [
      "The speaking order is your team from the Team page. On Walk the board, check the sprint (it opens on the active one), leave Each turn on Auto or pick a length, and click Start the standup.",
      "Each turn shows that person's stories by status, the blocked ones flagged, and what they planned last time. Click Next speaker, or Skip for now if they're not here yet (they come round again after everyone else). Click End standup to finish.",
      "Type their update in Today's Standup as they talk. Yesterday is filled in from their last plan, and Today is required. Click Submit Standup, or press Ctrl/⌘+Enter.",
      "Someone on leave? Click Not in today's standup next to their name. It lasts for today in this browser and the team stays as it is; Back in returns them.",
      "In the Blockers tab, Open blockers are listed oldest first with their age. Send to… then Impediment raises one; Resolve closes it and Reopen brings it back.",
      "History shows past days by day or person; the Export menus next to Day digest and Week copy that summary or save it as Markdown.",
    ],
    tips: [
      "The turn's clock stays on the docked timer while you open the sprint board to move cards. Reloading the page ends the walk.",
      "A story shows in its owner's turn, so one with no owner shows in nobody's. Set owners on the sprint board.",
      "Part of the team writes instead? Switch to Async: both modes share the same entries.",
    ],
    timebox: "15 minutes",
  },
  {
    toolId: "sprint-goal",
    summary:
      "A sprint goal is one sentence that says why the sprint matters. It gives the team focus and a way to decide what to drop when things change. The goal is saved on the sprint, so Sprint Planning and the Sprint Cockpit show it.",
    whenToUse: ["During sprint planning.", "When a sprint feels like a list of unrelated tickets."],
    steps: [
      "Pick the sprint under Goal for. One goal per sprint.",
      "Business Objective: write the outcome you want for users or the business, not a list of tasks.",
      "Sprint Goal: write the one sentence. The SMART badges show whether it reads as Specific, Measurable, Achievable, Relevant and Time-bound.",
      "Acceptance Criteria: click Add criterion for each thing you'll check at the review, and tick the ones that serve the goal.",
      "Key Results: link the OKRs this sprint moves forward, or set them up in the OKR Tracker first.",
      "Check the Preview, then plan the sprint around the goal in Sprint Planning.",
      "On the sprint's last day, or once it's over, answer Did we meet the sprint goal? (Met, Partly met or Not met) with a note. The answer goes in the export, for the Sprint Review.",
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
      "A user story map lays out the user's journey as steps, with stories under each step, so you can slice releases that deliver value end to end. Each slice totals its points and can go to the backlog or the Release Planner.",
    whenToUse: [
      "Planning a new product or a big feature.",
      "When the backlog is a flat list and the big picture is lost.",
    ],
    steps: [
      "Along the top, click Add step for each step of the user's journey, left to right (the backbone), and press Enter after each name.",
      "Down the side, click Add slice for each release. The first slice is the smallest version that works end to end.",
      "In each cell, click Add card, type the story and press Enter. Edit a card to add a description, its Points and a colour; drag cards to reorder or move them.",
      "Use a card's Send or move menu to move it to another slice, Estimate in Planning Poker, or Add to the backlog.",
      "Read each slice's total at its foot. Send N to backlog makes a backlog story per card, with its points.",
      "Click Plan this release to open the Release Planner on that slice and see when it can ship.",
    ],
    tips: [
      "Map with the people who know the users, not alone.",
      "The first slice is your walking skeleton.",
      "Cards without points are left out of the slice total and the release forecast, so size them first.",
    ],
  },
  {
    toolId: "burndown",
    summary:
      "A burndown shows the points left in the sprint each day against an ideal line that only burns on the team's working days. The numbers come from the sprint board, or from a typed daily log when the stories have no points.",
    whenToUse: [
      "Checking each day, before the Daily Scrum, whether the sprint is on track.",
      "Spotting early that work has stalled or scope has joined, while there's time to act.",
      "Looking back at a closed sprint in the Sprint Review or the retro.",
    ],
    steps: [
      "Pick the sprint under Sprint, or click New sprint. Burnup, Velocity, Sprint Metrics and the Sprint cockpit follow the same choice. No sprints yet? Click Create your first sprint, or Load an example for a read-only preview.",
      "Read the sentence at the top: the day of the sprint, points done of the current scope, how far ahead or behind the ideal line, and when it finishes at this pace.",
      "Read the tiles: Remaining, Pace vs ideal, Done (as a % of the current scope) and Projected finish.",
      "With pointed stories the badge reads From the sprint board: use Move stories on the sprint board to update it. A story moved to Done counts that day; one added or taken out mid-sprint moves the scope, not the burn. Daily progress lists each day, with a note you can add.",
      "With no pointed stories, type the Points remaining each day in the Daily log, and press Mark change on a day work was added. While the board has points the log waits under Daily log (fallback); when both hold numbers, switch with From the board and From the typed log.",
      "The bin clears a day, and Clear log (it asks first) clears them all. Undo brings either back. Sprint settings changes the Planned points, Length (days) and First day for every sprint tool.",
      "Export gives Markdown, CSV or PNG. Next step under the tool may suggest closing an ended sprint, estimating unsized stories or talking through a gap at the Daily Scrum.",
    ],
    tips: [
      "The ideal line counts working days only, so it stays flat on the shaded weekends and holidays.",
      "Can't tell yet means every pointed story is done but open stories have no points. Estimate them in Planning Poker.",
      "A closed sprint shows its typed log, as it was recorded; with no log it is rebuilt from the stories' sprint moves.",
      "Advanced analysis needs 4 working days for a forecast and 8 for pace shifts. Day 0 counts.",
      "A flat line for several days usually means work is too big or blocked.",
    ],
  },
  {
    toolId: "velocity",
    summary:
      "Velocity is the average completed points of your last three finished sprints, by end date. Each finished sprint is graded on say/do, and its points per person-day come from its capacity plan.",
    whenToUse: [
      "Sprint Planning: deciding how much to commit to next.",
      "Closing a sprint with the points the team finished.",
      "Spotting a trend, or repeated missed commitments, to take to the retro.",
    ],
    steps: [
      "No sprints yet? Click Create your first sprint, or Load an example: four finished sprints and one running, never saved.",
      "Under Sprint data, each row is a shared sprint, oldest first by end date. Edit its name, goal and Committed points in place, or click Add sprint. The bin removes a sprint from every sprint tool, with Undo.",
      "Type the Completed points when the work is counted. That only saves the points: a sprint counts once it is done, and when it has ended the row asks to close it.",
      "Click Close sprint (or Mark done) and check the Completed points, suggested from the sprint board or the daily log. Choose where the unfinished stories go: into the next sprint, Back to the backlog or Decide later in Sprint Planning. Undo puts the sprint and its stories back.",
      "Read the sentence and the tiles: Velocity, Met the commitment (90–110%), Per person-day and Spread. On the Velocity chart each Completed bar is coloured by its grade; View as table shows the numbers.",
      "Under Plan next sprint, type the Points to commit or leave it blank to use the velocity, and click Commit. Check the name and dates in New sprint, then click Create sprint.",
      "Export gives the summary and every sprint as Markdown, or a CSV or PNG.",
    ],
    tips: [
      "Grades: met is 90–110% of the commitment, close 70–90%, missed under 70%. Over 110% is Did more than committed: the team said less than it could do.",
      "A sprint without a capacity plan has no points per person-day: use Plan its capacity for points per person-day on its row. The Per person-day tile needs a plan for each of the last 3 finished sprints.",
      "The forecast needs 4 finished sprints, Spread 5, the trend line and trend test 6, and change points 8. Until then the page says how many more to close.",
      "Next step under the tool may suggest closing an ended sprint or taking missed commitments to the retro.",
      "Velocity is a planning tool for the team, not a performance target. Don't compare it between teams.",
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
      "The capacity planner works out how many hours the team really has in a sprint once days off, team holidays, Scrum events and other work are taken out, and turns that into a points suggestion for Sprint Planning.",
    whenToUse: [
      "Before Sprint Planning, to know what the team can take on.",
      "Sprints with holidays, days off or part-time people.",
    ],
    steps: [
      "Pick the sprint under Plan for, or click New sprint. Each sprint keeps its own plan; General plan is the fallback for sprints without one.",
      "For a sprint with no plan yet, click Start from your last plan (people and settings copied, days off back to 0), Use your general plan as is when offered, or Start empty.",
      "Under Sprint Configuration, check the Sprint length (from the sprint's dates and team holidays), Ceremony overhead, Focus factor and Hours per day.",
      "Under Team Members, click Sync from team to add everyone on the Team page, or Add member, and set each person's Availability and Days off.",
      "Read Where the hours go and the Points forecast, then click Plan [sprint] in Sprint Planning to use it there.",
    ],
    tips: [
      "Ceremony overhead is time in the Scrum events; the focus factor is the share of what's left that goes to sprint work. A focus factor of 0.6–0.8 is typical.",
      "Reset asks first and can be undone.",
    ],
  },
  {
    toolId: "health-check",
    summary:
      "A squad health check asks the team to rate areas like delivering value, speed and fun as green, yellow or red, to start a conversation about what to improve. Health counts green as 1, yellow as ½ and red as 0, over the areas rated.",
    whenToUse: [
      "Once a sprint or once a month, at the same point each time.",
      "When something feels off and you want the team's view.",
    ],
    steps: [
      "Under Current check, pick the Sprint this check is for, or type a Check name. Change Taken on to enter an earlier check.",
      "Talk each dimension through and press Green, Yellow or Red. Type what the team said in its note.",
      "To vote anonymously, press Run a live round under Vote anonymously, give your name, tick the consent, then share the link with Copy link. People answer on their phones; you see only how many have. Press Reveal results once 3 have answered, then Save round: the votes set each light, which you can still change.",
      "Counting hands or paper instead? Press Enter counts instead (where live rounds aren't available, the count boxes show on their own), type how many picked each light, then Show totals and Save round.",
      "Each row's trend, Up, Same or Down, comes from the previous saved check. Health over time charts the saved checks from 2.",
      "Press Save check. It saves once every dimension is rated, and names any still missing.",
      "Under Saved checks, Send reds to retro puts each red dimension on the retro board as a topic. Under Your own dimensions, Add dimension adds one; archive it to leave it out of new checks.",
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
    tips: [
      "Only the vote totals are kept, never who voted what, and a dimension's votes count only from 3 answers.",
      "A Split view, green and red votes on one dimension, is worth a conversation whatever the light says.",
      "It's for the team's own learning: don't use it to compare teams.",
      "Delete a saved check with Undo. Clear all asks first and can be undone too.",
    ],
  },
  {
    toolId: "premortem",
    summary:
      "A premortem imagines the project has already failed and asks why, so the team can spot and prevent risks while there's still time. You get the top causes ranked, each with a preventive action and an owner, ready for the Risk Register.",
    whenToUse: [
      "Before a big release, epic or project starts, while the plan can still change.",
      "When the plan feels optimistic and nobody is saying what could go wrong.",
    ],
    steps: [
      "Click New premortem (on a first visit the form is already open, and Load an example shows one already voted and rated). Give it a Name and the Imagined failure, pick the release or epic it is For or leave Not linked, then click Start premortem.",
      "Write: pick 3 min, 5 min or 10 min to start the silent-writing timer. Type one reason in A reason it failed and press Enter (or Add cause). Causes stay hidden until you click Show causes or move on, so nobody anchors on the first idea.",
      "Click Next: Group and read the causes out. Use Group with… to fold a duplicate into the cause it repeats; Split brings it back. Grouping or deleting a cause offers Undo.",
      "Click Next: Vote. Set Dots per person if you like (it is only a guide), then use + and − on each cause. The top 3 get a Top 3 badge, and a tie at the cut-off is named. Re-sort brings the order up to date; Clear votes asks first and offers Undo.",
      "Click Next: Act. Rate Likelihood and Impact from 1 to 5 for each cause, write what would prevent it, and pick an Owner from the team.",
      "Click Send the top 3 to the Risk Register once each of them is rated; Undo takes them back. Send to… sends one rated cause on its own. Export copies or downloads the premortem as Markdown, or as CSV.",
    ],
    tips: [
      "Assuming failure makes it safe to raise concerns people might otherwise hold back.",
      "Every step stays clickable: go back to Write to add a cause someone remembers late.",
      "The silent-writing timer runs on the docked timer, so it keeps going if you open another tool, and stops when you move on from Write. If another tool's timer is on the dock, stop it there first.",
      "Example causes never go to the Risk Register: start a premortem of your own to send risks.",
      "Use the Premortem picker at the top to go back to an earlier premortem. The icons beside its name edit its details, or delete it with Undo.",
    ],
    timebox: "45–60 minutes",
  },
  {
    toolId: "ceremony-timer",
    summary:
      "The Ceremony Timer runs a ceremony to its agenda, with a time-box for each segment and fair turns for each speaker. When you finish, you get planned against actual for every segment and turn, ready to export.",
    whenToUse: [
      "A Daily Scrum where everyone should get a fair share of the 15 minutes.",
      "A retro, planning or review where one part of the agenda keeps running over.",
      "Any time-boxed meeting, or a 1-2-4-All, on a shared screen.",
    ],
    steps: [
      "Under Agenda, pick the ceremony: Daily Scrum, Sprint Planning, Backlog Refinement, Sprint Review, Sprint Retrospective, 1-2-4-All or Custom time-box. Planning, Review and Retrospective scale with your sprint length.",
      "To change it for your team, click Edit agenda. Rename segments, change their minutes or the Total minutes, tick Speakers take turns where people go in turn, then click Save agenda. A Custom time-box can't start until you save its Minutes. Once it's changed, Reset to defaults puts it back.",
      "Under Speakers, add each name with Add speaker, or click Load team for everyone on the Team page. The list is the speaking order. Only the Daily Scrum takes turns by default; switch on Speakers take turns here for the segment that's on.",
      "Click Start timer (the play button) or press Space. At zero it shows Over time and counts up; it never moves on by itself. In a round of turns, use Next speaker (N), or Skip speaker (S) for someone absent. Next segment (Shift+N) moves on. Each offers Undo.",
      "On the last segment the button reads Finish. How it went then shows planned against actual for each segment and each speaker's turn. Use Export to copy or download it as Markdown. Start over clears the run.",
    ],
    tips: [
      "Turns are worked out as you go: each speaker gets an even share of the time left when their turn starts. Finish early and the others get more; run over and they get less, never under half a minute.",
      "Leave the page mid-meeting and the timer docks at the bottom left. Pause or resume it there while you use other tools; closing it pauses the meeting.",
      "On a shared screen or call, use Enter fullscreen. Chime when time is up is off until you turn it on.",
      "Export before the meeting too. The Markdown lists when each segment starts and, for a round of turns, the speaking order, ready for the invite.",
    ],
    timebox:
      "Set by the agenda. For a two-week sprint: Daily Scrum 15 min, Planning 4 h, Refinement 1 h, Review 2 h, Retrospective 1 h 30 min, 1-2-4-All 12 min.",
  },
];
