import type { ToolGuide } from "./types";

/**
 * Guides for the "Plan the sprint" tools. Loaded on demand (see ./index.ts).
 * Planning Poker, Sprint Goal, Story Mapper and Capacity Planner are among
 * the most-used tools, so theirs live in ./core. Steps name the controls by
 * their on-screen labels, in the order a Scrum Master uses them.
 */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "sprint-planning",
    summary:
      "Sprint Planning is the one page for the planning meeting: capacity and velocity, the sprint goal, the stories and the commitment. It writes to the shared sprint and stories, so the Sprint Cockpit, Burndown and the agent see the same plan.",
    whenToUse: [
      "In the Sprint Planning meeting, on the shared screen.",
      "The day before, to settle last sprint's leftovers and pre-fill the stories so the meeting is about choices.",
      "When a sprint is under way and the commitment changed.",
    ],
    steps: [
      "Pick the sprint, or click New sprint. With no sprint yet, click Create the sprint, or See an example plan to look around without saving anything.",
      "Under 1. Capacity and commitment, read Team capacity (from the Capacity Planner), Recent velocity and the forecast under them. Leave Commit to blank to use the suggested points, or type your own.",
      "Under 2. Sprint goal, write one sentence the team can say yes or no to at the review, or word it in the Sprint Goal Builder.",
      "Under 3. Stories, settle anything Left over from a closed sprint: Carry over moves the unfinished stories into this sprint, Back to the backlog returns them.",
      "Pull work in: tick backlog stories, click Fill to capacity for the highest-priority sized stories that fit, Import from the backlog for the Backlog Prioritizer's items, or type a new story and press Enter.",
      "Type points in a story's row, or click Estimate N in Planning Poker to queue the unsized ones for a session.",
      "Under 4. Commit, read the warnings, then click Start the sprint (Update the commitment once it runs). The Sprint Cockpit opens on it.",
    ],
    tips: [
      "Commit to the goal, not the list: a sprint with every story done but the goal missed is not a success.",
      "The suggestion scales velocity by the share of a normal sprint the team has, so holidays and days off lower it. Plan each sprint's capacity to keep it honest.",
      "A warning shows when the stories add up to more than 10% over the points you commit to, or some aren't sized or refined. Size them, or check them in Refinement first.",
    ],
    timebox: "Up to two hours for a two-week sprint; much less when the backlog is refined.",
  },
  {
    toolId: "refinement",
    summary:
      "A Definition of Ready is a short list of checks a story must pass before the team takes it into a sprint. This page walks the stories that aren't ready yet against it, sends unsized ones to Planning Poker and marks the rest ready for Sprint Planning.",
    whenToUse: [
      "In backlog refinement, to get the next sprint's stories ready before planning.",
      "When stories often stall mid-sprint because details, designs or dependencies were missing.",
      "When the Sprint Cockpit's Refine the backlog card shows stories to size.",
    ],
    steps: [
      "Agree your Definition of Ready as a team: in the Definition of Ready card, edit or delete the criteria, or add one with Add criterion.",
      "Under Refinement session, take the stories one at a time with Previous story and Next story, or pick one from the list. Needs points narrows it to stories without points.",
      "Tick each criterion the story meets. Mark ready needs every criterion ticked and some points; Save checks keeps the ticks to come back to.",
      "For a story without points, click Queue for Poker, or Queue N unsized for Planning Poker under Backlog readiness to send them all, then Open Planning Poker.",
      "Ready stories move to the Ready list; use Re-check if something changed. Plan the sprint with the ready stories opens Sprint Planning.",
      "To check a story that isn't on the backlog, use Check a story by name under Earlier checks, then Add to backlog if it belongs there.",
    ],
    tips: [
      "Keep the list short, around 5–8 checks. A long Definition of Ready becomes a gate that slows the team down.",
      "Ready is about starting a story; pair it with the Definition of Done Builder for finishing one.",
      "The pass-rate trend sits under Advanced analysis at the bottom, once enough checks are saved.",
      "Reset checklist restores the default criteria and clears the earlier checks, with Undo. Readiness saved on stories stays.",
    ],
    scales: [
      {
        name: "Readiness",
        values: [
          { value: "Ready", meaning: "marked ready: every criterion met and the story has points" },
          { value: "Ready once sized", meaning: "every criterion is met, but no points yet" },
          { value: "Partial", meaning: "some or all criteria met, not marked ready yet" },
          { value: "Not ready", meaning: "no criteria are met yet" },
          { value: "Not checked", meaning: "not checked against the list yet" },
        ],
      },
    ],
  },
  {
    toolId: "estimation-guide",
    summary:
      "An estimation reference guide says what each card means for your team, with stories the team finished as examples of each size. It gives everyone the same yardstick, so estimates stay consistent.",
    whenToUse: [
      "When a team starts estimating, or new people join.",
      "When similar stories get very different estimates from one sprint to the next.",
      "During Planning Poker, which shows the guide under the deck for the card being discussed.",
    ],
    steps: [
      "Pick the scale your team uses: Fibonacci, T-Shirt, Powers of 2 or Linear.",
      "Read the Description on each card and rewrite it in your team's own words.",
      "Under Example, write a story the team agrees was that size.",
      "On a points scale, done stories with those points appear under Reference stories. Click one to pin it as the reference for that card, up to three per card.",
      "Click Share to copy a link to the guide, or Export it as Markdown, and keep it open whenever you estimate.",
      "Every few sprints, pin fresher stories and adjust descriptions that no longer fit.",
    ],
    tips: [
      "Anchor on real, finished stories. People compare against examples far better than against definitions.",
      "Describe complexity, risk and unknowns rather than hours, so estimates stay relative.",
      "A pinned story whose points or status changed is flagged, for example “now 5 pts”. Unpin it or pin a better one.",
      "Reset this scale puts one scale back to the built-in meanings and clears its examples and pins, with Undo. Other scales stay.",
    ],
    scales: [
      {
        name: "Fibonacci (default descriptions)",
        values: [
          { value: "1–2", meaning: "trivial or simple, clear approach, low risk" },
          { value: "3–5", meaning: "moderate to complex, some unknowns" },
          { value: "8", meaning: "very complex, significant unknowns" },
          { value: "13–21", meaning: "major unknowns or too big — spike or split it" },
        ],
      },
      {
        name: "T-Shirt (default descriptions)",
        values: [
          { value: "XS–S", meaning: "minutes to a few hours" },
          { value: "M", meaning: "about a day" },
          { value: "L–XL", meaning: "several days to most of a sprint" },
          { value: "XXL", meaning: "too large — break it down" },
        ],
      },
    ],
  },
  {
    toolId: "release-planner",
    summary:
      "The Release Planner forecasts when a release will be done by replaying your past sprints 10,000 times (a Monte Carlo simulation). Instead of one date you get a range, the date to commit to, and the chance of hitting the date stakeholders ask about.",
    whenToUse: [
      "When stakeholders ask “when will it be done?” about a release or a story-map slice.",
      "Before committing to a date, to see how likely it is.",
      "When scope changes and you need to show what that does to the date.",
    ],
    steps: [
      "Under Scope, choose where it comes from: Backlog (the open stories' points), Story-map slice (pick one; Plan this release in the Story Mapper opens it here) or Type it.",
      "Set Expected scope change for work not found yet (negative for planned cuts). Scope to forecast shows the total.",
      "Under Velocity, use From completed sprints, or Type them: points per sprint, oldest first.",
      "Under Dates, check the Start and the Sprint length (from the team's cadence unless you type one), and add a Target date (optional) if stakeholders have one.",
      "Read the Forecast: the verdict, Coin flip (P50), Commit (P85), the chart of sprints needed, and the dates at 50%, 75%, 85% and 95% confidence.",
      "With a target date, read the Probability of finishing by then and the Scope we can deliver by then.",
      "Re-run it every sprint as the remaining scope and the velocity change.",
    ],
    tips: [
      "Commit to the P85 date, not the P50 one. P50 is a coin flip.",
      "It needs at least 4 sprints of velocity, completed or typed. Stories or cards without points are left out of the scope, so estimate them first.",
      "If Change in pace (CUSUM) under Advanced analysis says the velocity shifted, forecast from the sprints since the change.",
    ],
    scales: [
      {
        name: "Confidence",
        values: [
          { value: "50%", meaning: "a coin flip — half the simulated runs finished later" },
          { value: "75%", meaning: "likely, but a real chance of slipping" },
          { value: "85%", meaning: "a common choice for commitments" },
          { value: "95%", meaning: "very safe — use it when the date can't move" },
        ],
      },
    ],
  },
  {
    toolId: "jtbd-mapper",
    summary:
      "A job story captures what someone is trying to get done: “When [situation], I want to [motivation], so I can [outcome].” It focuses on the situation and the goal rather than a persona, and the jobs worth building become backlog stories.",
    whenToUse: [
      "In early discovery, to capture what users are trying to achieve before choosing features.",
      "When user stories read like “As a user, I want a button” and the reason has been lost.",
      "To break a big job into smaller jobs the team can design for.",
    ],
    steps: [
      "Under Add a job story, fill in all three clauses: When (the situation), I want to (the motivation) and So I can (the outcome). The Reads line shows the sentence.",
      "Add Notes for context or evidence, such as a quote from an interview. To break a big job down, choose it as the Under job.",
      "Click Add job story. Jobs nest under their parent in Job stories; Add a job under, on a row, starts a smaller job beneath it.",
      "Use Edit to sharpen the wording as you learn more. An older job with a missing clause shows Complete the job.",
      "When a job is worth building, click Create story to put it on the backlog. The row then shows the story's status and links to it in Sprint Planning.",
      "Click Link to opportunity to tie a job to the opportunity it serves on the Opportunity Tree; Unlink takes it off.",
    ],
    tips: [
      "Describe the situation, not the person: “When I'm paying in a queue on my phone” says more than “As a customer”.",
      "Keep the solution out of “I want to”. Name the progress the user wants, not a feature.",
      "Removing a job with nested jobs asks whether to remove them too or move them up a level.",
    ],
  },
  {
    toolId: "walking-skeleton",
    summary:
      "A walking skeleton is the thinnest version of a system that works end to end: one simple path through every layer, from the user interface to the data and infrastructure. It proves the architecture fits together before you add features.",
    whenToUse: [
      "At the start of a new product, service or major rebuild.",
      "When the team is about to build one layer at a time and integration is the big risk.",
    ],
    steps: [
      "Write the Goal: the smallest happy path a user could complete end to end.",
      "Under Add step, write each step in the order a request takes and pick its Layer: UI, API, Data or Infra. Press Enter or click Add step.",
      "Check the layer coverage under End-to-end path. Every layer needs a step; the verdict names any not touched yet.",
      "Reorder steps with Move up and Move down, and edit or delete them in place. Click a step to mark it built; the bar shows how close the skeleton is to walking.",
      "Click Send N steps to backlog to turn the open steps into backlog stories, then pull them into a sprint in Sprint Planning.",
      "Once it runs end to end, add features in thin slices on top of it.",
    ],
    tips: [
      "Keep it simple. Hard-code what you can; the point is connecting the layers, not finishing features.",
      "Include deployment in the Infra steps. A skeleton that only runs on one laptop hasn't proved much.",
      "The first slice of a User Story Mapper map is a good source for the Goal.",
    ],
  },
  {
    toolId: "pi-planning",
    summary:
      "In SAFe, PI Planning is the event where all teams on an Agile Release Train plan the next Program Increment together. This board lays out teams against iterations so you can place features against each team's velocity, track dependencies on the Dependency Map and agree PI objectives.",
    whenToUse: [
      "At the start of each Program Increment, usually every 8–12 weeks.",
      "When several teams deliver one product and need to see each other's plans.",
      "To check a draft plan against each team's capacity before committing.",
    ],
    steps: [
      "Under Add a team, add each team with its name and Velocity (points per iteration).",
      "Under Board, set Iterations in the PI. Five is SAFe's usual four development iterations plus one for innovation and planning.",
      "Click Add item in a team's iteration and choose its Kind: Feature, Dependency or Risk. Only features count toward the team's load.",
      "For a dependency, pick the team it Waits on and, if it has a deadline, the date it's Due: it goes on the Dependency Map, and its status shows on the card. Use Move to put any item in another cell.",
      "Watch each cell's planned / velocity points. A cell over capacity turns red: cut scope or move work to a later iteration. Load vs capacity charts every team.",
      "Under PI objectives, add each team's objectives as Committed or Uncommitted, and score Business value once the business owners have.",
    ],
    tips: [
      "Keep the last iteration free of features. In SAFe it's for innovation, planning and buffer.",
      "Chase each open dependency's owner and due date on the Dependency Map.",
      "Sort each risk as Resolved, Owned, Accepted or Mitigated (ROAM), and log the open ones in the Risk Register.",
    ],
    scales: [
      {
        name: "Business value",
        values: [
          { value: "1–3", meaning: "nice to have" },
          { value: "4–6", meaning: "clear value to the business" },
          { value: "7–8", meaning: "high value" },
          { value: "9–10", meaning: "critical to the business" },
        ],
      },
    ],
    timebox: "Usually two days, once per Program Increment",
  },
  {
    toolId: "epic-roadmap",
    summary:
      "An epic roadmap shows large pieces of work (epics) on a quarterly timeline, with how far along each one is. Progress rolls up from the stories linked to each epic, so stakeholders see what's coming and how much is done.",
    whenToUse: [
      "In quarterly planning, to show which epics run when.",
      "To update stakeholders on progress across several large initiatives.",
      "To check whether too many epics overlap in the same quarter.",
    ],
    steps: [
      "Under Add an epic, name it, pick its Start quarter and End quarter, an Owner and a Colour, and describe the outcome. Click Add epic.",
      "Under Epics, each epic shows its schedule, such as Under way or Past its end quarter. Open Stories on an epic and use Link a story to attach its stories. Progress then rolls up from their points, or from story counts while some aren't estimated.",
      "If some linked stories have no points, click Queue N for Planning Poker so progress can count points.",
      "With no stories linked, edit the epic and type Progress, typed (%); the row marks it as typed.",
      "Under Roadmap, set View from and View to to choose the quarters shown. Fit to epics then puts the view back on every epic's quarters.",
      "Review it every sprint or two. A note appears when sprints or OKRs changed in the last 14 days.",
    ],
    tips: [
      "Link stories rather than typing progress: done points are harder to argue with than a guess.",
      "Treat anything beyond the next quarter as a forecast, not a promise.",
      "Name the outcome in the description, ideally an objective from the OKR Tracker, so the roadmap shows why, not just what.",
    ],
  },
  {
    toolId: "scrum-of-scrums",
    summary:
      "A Scrum of Scrums is a short meeting where one person from each team shares progress, blockers and dependencies that affect other teams. This tracker keeps an agenda per meeting and carries open blockers and dependencies forward until they're resolved.",
    whenToUse: [
      "When several teams work on the same product and depend on each other.",
      "When cross-team blockers keep surfacing too late, for example at the sprint review.",
    ],
    steps: [
      "Each team sends one representative, who shares what the team did that affects others, what's next, and what is blocking them or might block another team.",
      "Under Meeting, set New meeting on and click Start a meeting, or use Show meeting to open an earlier one. Open items carry forward to the new meeting.",
      "Under Log an entry, set the Meeting date and Team, pick a Kind (Blocker, Dependency, Decision or Update), write the Details and click Log entry. A dependency names the team it Waits on.",
      "Start the Agenda with Carried forward: the open blockers and dependencies from earlier meetings. Resolve one when it's closed; it resolves everywhere.",
      "Click Raise impediment on a blocker that needs action beyond the room, and Add dependency on a dependency to track it on the Dependency Map.",
      "Any blocker open for 3 days or more is flagged at the top, so start there.",
    ],
    tips: [
      "Keep it about coordination between teams, not a status report from each team.",
      "Every blocker needs an owner and a next step before the meeting ends.",
      "Only blockers and dependencies are resolved; decisions and updates stay as a record.",
    ],
    timebox: "15 minutes, with problem-solving afterwards for the people involved",
  },
  {
    toolId: "dependency-map",
    summary:
      "A dependency map shows which teams, services or pieces of work wait on each other, who chases each dependency and by when. It flags circular waits and the critical path, the longest chain of blocking work, so you know where a delay hurts most.",
    whenToUse: [
      "Planning work that spans several teams, such as a PI or a large release.",
      "When work keeps stalling because another team or system isn't ready.",
      "Before committing to a date, to see which chain of work sets the pace.",
    ],
    steps: [
      "Under Nodes, add each team, service, epic or story with its Owning team if that helps, and click Add node.",
      "Under Dependencies, pick From, a Type and To, then an Owner, the date it's Due and a Note, and click Add dependency. Check the Reads line: “A blocks B” means B waits for A; “A needs B” means A waits for B.",
      "Read the Map: the verdict, then the graph with the critical path highlighted.",
      "Read the Critical path: the longest chain of open blocks and needs links in delivery order, with flags such as Overdue, At risk or Due before the link it waits on.",
      "If Circular waits is above zero, resolve one of the links in the loop. There's no critical path until it's gone.",
      "As things move, edit a dependency to set its Status, or use Resolve and Reopen. Filter with Show dependencies and Overdue only.",
    ],
    tips: [
      "Every dependency is a risk. Try to remove it first, by moving work or people, before managing it.",
      "Use “informs” for nice-to-know links. They don't count toward circular waits or the critical path.",
      "Dependencies from PI Planning and the Scrum of Scrums land here too and link back. Take overdue ones to the next Scrum of Scrums.",
    ],
  },
];
