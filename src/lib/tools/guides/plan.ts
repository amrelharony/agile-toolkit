import type { ToolGuide } from "./types";

/** Guides for the "Plan & estimate" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "refinement",
    summary:
      "A Definition of Ready is a short list of checks a story must pass before the team takes it into a sprint. This checklist scores each story against it and tracks how often stories arrive ready.",
    whenToUse: [
      "During backlog refinement, to decide whether a story is ready for sprint planning.",
      "When stories often stall mid-sprint because details, designs or dependencies were missing.",
    ],
    steps: [
      "Agree your Definition of Ready as a team: edit, add or remove the criteria under Definition of Ready.",
      "In Check Story, enter the Story Name / ID and tick each criterion the story meets.",
      "Read the badge. Ready means every criterion is met; Partial or Not Ready means the story needs more refinement first.",
      "Click Save to History to record the result, then check the next story.",
      "Every few sprints, review the Pass Rate Trend against the 80% target line. A warning appears if the rate drifts over many stories.",
    ],
    tips: [
      "Keep the list short, around 5–8 checks. A long Definition of Ready becomes a gate that slows the team down.",
      "Save every story you check, not only the ready ones, so the pass rate stays honest.",
      "Ready is about starting a story; pair it with the Definition of Done Builder for finishing one.",
    ],
    scales: [
      {
        name: "Readiness",
        values: [
          { value: "Ready", meaning: "every criterion is met" },
          { value: "Partial", meaning: "some criteria are met" },
          { value: "Not Ready", meaning: "no criteria are met yet" },
        ],
      },
    ],
  },
  {
    toolId: "estimation-guide",
    summary:
      "An estimation reference guide says what each estimate means for your team, with a real story as an example of each size. It gives everyone the same yardstick, so estimates stay consistent.",
    whenToUse: [
      "When a team starts estimating, or new people join.",
      "When similar stories get very different estimates from one sprint to the next.",
      "As a reference to keep open during Planning Poker.",
    ],
    steps: [
      "Pick the scale your team uses: Fibonacci, T-Shirt, Powers of 2 or Linear.",
      "Read the Description on each card and rewrite it in your team's own words.",
      "Under Example, add a finished story the team agrees was that size.",
      "Click Share to copy a link to the guide, and keep it open whenever you estimate.",
      "Every few sprints, swap in fresher examples and adjust descriptions that no longer fit.",
    ],
    tips: [
      "Anchor on real, finished stories. People compare against examples far better than against definitions.",
      "Describe complexity, risk and unknowns rather than hours, so estimates stay relative.",
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
      "The Release Planner forecasts when a backlog will be finished by running 10,000 Monte Carlo simulations on your past velocity. Instead of one date, you get a range of dates and the chance of hitting each.",
    whenToUse: [
      "When stakeholders ask “when will it be done?” about a release or a large backlog.",
      "Before committing to a date, to see how likely it is.",
      "When scope changes and you need to show what that does to the date.",
    ],
    steps: [
      "In Configuration, enter the Backlog Size in story points, a Scope Buffer % for work not found yet, the Sprint Length and the Start Date.",
      "Under Historical Velocities, enter the points completed in each recent sprint.",
      "Read the Delivery Forecast: the number of sprints and the target date at 50%, 75%, 85% and 95% confidence.",
      "Drag the Scope Sensitivity slider to see how adding or cutting scope moves the dates.",
      "Optionally set Target sprints to release to see where your goal falls on the Simulation Histogram.",
      "Re-run the forecast every sprint with the remaining backlog and the latest velocity.",
    ],
    tips: [
      "Commit to the 85% date, not the 50% one. The 50% date is a coin flip.",
      "Use your last 6–10 sprints. If a warning says velocity has shifted, keep only the sprints since the change.",
      "Keep sprint history in the Velocity Tracker so the numbers are ready to paste.",
    ],
    scales: [
      {
        name: "Confidence",
        values: [
          { value: "50%", meaning: "a coin flip — half the simulations finished later" },
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
      "A job story captures what someone is trying to get done: “When [situation], I want to [motivation], so I can [outcome].” It focuses on the situation and the goal rather than a persona, which keeps the team on the real need.",
    whenToUse: [
      "In early discovery, to capture what users are trying to achieve before choosing features.",
      "When user stories read like “As a user, I want a button” and the reason has been lost.",
      "To break a big job into smaller jobs the team can design for.",
    ],
    steps: [
      "Under Add job story, fill in When (the situation), I want to (the motivation) and So I can (the outcome).",
      "Add a Description for context or evidence, such as a quote from an interview.",
      "To break a big job down, choose it as the Parent job when you add each smaller job.",
      "Click Add. Jobs nest under their parent, and the counters show how many are top-level and how deep the tree goes.",
      "Use Edit to sharpen the wording as you learn more from users.",
    ],
    tips: [
      "Describe the situation, not the person: “When I'm paying in a queue on my phone” says more than “As a customer”.",
      "Keep the solution out of “I want to”. Name the progress the user wants, not a feature.",
      "Removing a job also removes every job nested under it.",
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
      "Add the steps needed to make that path work, and set each step's layer: ui, api, data or infra.",
      "Check that every layer has at least one step. A skeleton that skips a layer doesn't prove the architecture.",
      "Tick each step as it's built; the bar under the Goal shows how close the skeleton is to walking.",
      "Once it runs end to end, add features in thin slices on top of it.",
    ],
    tips: [
      "Keep it simple. Hard-code what you can; the point is connecting the layers, not finishing features.",
      "Include deployment in the infra steps. A skeleton that only runs on one laptop hasn't proved much.",
      "The first slice of a User Story Mapper map is a good source for the Goal.",
    ],
  },
  {
    toolId: "pi-planning",
    summary:
      "In SAFe, PI Planning is the event where all teams on an Agile Release Train plan the next Program Increment together. This board lays out teams against iterations so you can place features, flag dependencies and risks, and spot overloaded teams.",
    whenToUse: [
      "At the start of each Program Increment, usually every 8–12 weeks.",
      "When several teams deliver one product and need to see each other's plans.",
      "To check a draft plan against each team's capacity before committing.",
    ],
    steps: [
      "Set Iterations in PI. The default of 5 matches SAFe's usual four development iterations plus one for innovation and planning.",
      "Add each team with its name and velocity per iteration.",
      "Click + in a team's iteration cell to add an item, then give it a title, points and a kind: feature, dep or risk.",
      "Watch each cell's planned / velocity count. Only features count, and a cell turns red above 115% of velocity.",
      "Fix red cells by cutting scope or adding the work to a later iteration, then review the dep and risk cards together.",
    ],
    tips: [
      "Keep the last iteration free of features. In SAFe it's for innovation, planning and buffer.",
      "Talk each dep card through with the other team, then track it in the Dependency Map.",
      "Sort each risk as Resolved, Owned, Accepted or Mitigated (ROAM), and log the open ones in the Risk Register.",
    ],
    timebox: "Usually two days, once per Program Increment",
  },
  {
    toolId: "epic-roadmap",
    summary:
      "An epic roadmap shows large pieces of work (epics) on a quarterly timeline, with how far along each one is. It gives stakeholders a simple view of what's coming and when.",
    whenToUse: [
      "In quarterly planning, to show which epics run when.",
      "To update stakeholders on progress across several large initiatives.",
      "To check whether too many epics overlap in the same quarter.",
    ],
    steps: [
      "Set View from and to in the form “2026 Q1” to choose which quarters the timeline shows.",
      "Each new epic spans the quarters in view, so set View from and to to the epic's quarters, then click Add Epic.",
      "Rename the epic, add a short description and enter its progress from 0 to 100%.",
      "Widen the view again to see all epics side by side; each bar fills as progress grows.",
      "Update progress every sprint or two. A note appears when sprints or OKRs changed in the last 14 days, as a prompt to review.",
    ],
    tips: [
      "Base progress on finished work, such as done stories or points, not on gut feel.",
      "Treat anything beyond the next quarter as a forecast, not a promise.",
      "Link each epic to an outcome in the OKR Tracker so the roadmap shows why, not just what.",
    ],
  },
  {
    toolId: "scrum-of-scrums",
    summary:
      "A Scrum of Scrums is a short meeting where one person from each team shares progress, blockers and dependencies that affect other teams. This tracker logs what comes up, so blockers get followed up and decisions aren't lost.",
    whenToUse: [
      "When several teams work on the same product and depend on each other.",
      "When cross-team blockers keep surfacing too late, for example at the sprint review.",
    ],
    steps: [
      "Each team sends one representative, who shares what the team did that affects others, what's next, and what is blocking them or might block another team.",
      "Under Log an entry, set the Meeting date and Team name, and choose a type: Update, Blocker, Dependency or Decision.",
      "Describe the entry. For a blocker, fill in Blocked by (team) so everyone knows who needs to act.",
      "Click Resolve when an item is closed. Resolved entries fade but stay in the log.",
      "Start each meeting with the open blockers. Any blocker open for 3 days or more is flagged at the top.",
    ],
    tips: [
      "Keep it about coordination between teams, not a status report from each team.",
      "Every blocker needs an owner and a next step before the meeting ends.",
      "Map dependencies that span several teams in the Dependency Map.",
    ],
    timebox: "15 minutes, with problem-solving afterwards for the people involved",
  },
  {
    toolId: "dependency-map",
    summary:
      "A dependency map lists the stories, teams or services that rely on each other and how. It flags circular dependencies and shows the longest chain of blocking work, the critical path, so you know where a delay hurts most.",
    whenToUse: [
      "Planning work that spans several teams, such as a PI or a large release.",
      "When work keeps stalling because another team or system isn't ready.",
      "Before committing to a date, to see which chain of work sets the pace.",
    ],
    steps: [
      "Under Add node, add each story, epic, service or team, with its Team if that helps.",
      "Under Add dependency, pick From, a type and To. “A blocks B” means B waits for A; “A needs B” means A waits for B.",
      "Read the Critical path: the longest chain of blocks and needs links. Its nodes are highlighted in the Nodes list.",
      "If Cycles is above zero, break the loop. The critical path can't be shown until every cycle is gone.",
      "Review the map at planning and weekly, and remove dependencies once they're resolved.",
    ],
    tips: [
      "Every dependency is a risk. Try to remove it first, by moving work or people, before managing it.",
      "Use “informs” for nice-to-know links. They don't count toward cycles or the critical path.",
      "The critical path here counts links, not duration, so check how long each step on it will take.",
    ],
  },
];
