import type { ToolGuide } from "./types";

/** Guides for the "Track delivery" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "sprint-metrics",
    summary:
      "Sprint Metrics is the home of your shared sprints. Pick a sprint to see what was committed, how much is done and left, how it tracks against the ideal line, and when it's likely to finish. Burndown, Burnup, Velocity and Sprint Comparison all use the same sprints.",
    whenToUse: [
      "Checking where the current sprint stands at stand-up or mid-sprint.",
      "Closing a sprint with the points the team finished, so Velocity and forecasts use it.",
      "Cleaning up sprint data: missing completed points, placeholder dates, or sprints moved in from older tool data.",
    ],
    steps: [
      "Pick a sprint, or click New sprint and enter its name, first and last day, and planned points.",
      "Log the daily numbers in Burndown or Burnup. The tiles here update from the same log.",
      "Read the tiles: Pace vs ideal shows how far ahead or behind the sprint is, and Projected finish shows the day the trend reaches zero.",
      "Use Edit details to change the name, goal, status, committed points or dates.",
      "On the last day, click Close sprint. The completed points are suggested from the daily log; change them if needed.",
      "Fix anything under Worth checking, then open a sprint tool from its card. It opens on the same sprint.",
    ],
    tips: [
      "Day 0 is the first day of the sprint, as in Burndown.",
      "Plan vs average compares this sprint's commitment with what your last three sprints delivered. Committing well above it is a risk.",
      "Cumulative Flow and Cycle Time track your board, not a sprint, so they are linked separately.",
    ],
  },
  {
    toolId: "burnup",
    summary:
      "A burnup chart shows two lines: total scope and work completed. The gap between them is the work left, and a rising scope line makes scope creep easy to see.",
    whenToUse: [
      "Tracking a sprint or release where scope is likely to change.",
      "Showing stakeholders how added work moves the finish date.",
    ],
    steps: [
      "Pick a sprint, or create one with its first day, last day and planned points. The planned points are the scope on Day 0.",
      "Each day, enter the Completed (pts) total so far. Enter Scope only on days it changes; the chart carries the last value forward.",
      "Add a Note when something explains a jump or a flat spell, such as an outage or new work from a stakeholder.",
      "Watch the Scope Creep and Projected Done cards. If Projected Done reads “After sprint”, discuss scope early.",
    ],
    tips: [
      "Completed is a running total, not the points finished that day.",
      "Numbers logged in the Burndown Generator show dimmed here; type over one to use your own.",
      "Only need the work remaining in a sprint? Use the Burndown Generator.",
    ],
  },
  {
    toolId: "cycle-time",
    summary:
      "Cycle time is how many days an item takes from start to finish. The analyzer shows the spread of your cycle times so you can set a Service Level Expectation (SLE) from real data instead of guesses.",
    whenToUse: [
      "Answering “when will this be done?” with a likelihood instead of an estimate.",
      "Setting or reviewing the team's SLE.",
      "Spotting items that took much longer than usual.",
    ],
    steps: [
      "Under Work Items, click Add Item and enter each finished item's name, Start Date and End Date. The cycle time is worked out for you.",
      "Use the Histogram tab to see the spread, and the Scatter Plot tab to find items above the P85 and P95 lines.",
      "On the SLE tab, set the Target Percentile to get a statement like “85% of items complete within 8 days”.",
      "Add items as they finish and review the SLE about once a month.",
    ],
    scales: [
      {
        name: "Percentiles",
        values: [
          { value: "50th", meaning: "half of items finish within this time" },
          { value: "85th", meaning: "the usual SLE target" },
          { value: "95th", meaning: "very high confidence, close to worst case" },
        ],
      },
    ],
    tips: [
      "Commit using the 85th percentile, not the average. The average hides the slow items.",
      "Use the same start and end points for every item, such as “In Progress” to “Done”.",
      "With fewer than about 10 items the percentiles jump around, so treat them as rough.",
    ],
  },
  {
    toolId: "cumulative-flow",
    summary:
      "A cumulative flow diagram (CFD) stacks the number of items in each stage of your workflow over time. The width of each band is the work sitting in that stage, so a band that keeps widening points to a bottleneck.",
    whenToUse: [
      "Checking whether work flows smoothly or piles up in one stage.",
      "Teams using a Kanban board or any board with clear stages.",
    ],
    steps: [
      "Set up the Status Columns to match your board, in order. The first column is the start and the last is done.",
      "Click Add Date for today's snapshot and enter how many items sit in each column. Done is the running total of finished items.",
      "Add a snapshot at the same time every day, or at least weekly. Change a row's date to fill in past days.",
      "Read the Flow Diagram: a band that keeps widening means work arrives in that stage faster than it leaves.",
      "Optionally set a WIP Limit. It shows as a dashed line on the WIP control chart, which adds control limits once you have 8 or more snapshots.",
    ],
    tips: [
      "Count items, not points, so the bands stay comparable.",
      "WIP Items counts everything between the first and last columns, so keep at least three columns.",
      "To see how long items take, not just how many are waiting, use the Cycle Time Analyzer.",
    ],
  },
  {
    toolId: "sprint-compare",
    summary:
      "Sprint Comparison scores up to five sprints on six dimensions and overlays them on a radar chart, so you can see at a glance what improved and what slipped.",
    whenToUse: [
      "In a retrospective, to compare this sprint with the last few.",
      "Reviewing a quarter's sprints to spot patterns.",
    ],
    steps: [
      "Pin up to five sprints from the Sprints list, or create one with New sprint.",
      "As a team, score each dimension from 1 to 10: Velocity, Quality, Scope Stability, Team Happiness, Goal Achievement and Predictability. Leave a box empty if you haven't rated it.",
      "Look at the Sprint Radar for shapes that shrink or grow from one sprint to the next.",
      "Use the Dimension Comparison table and its Average row to pick one dimension to improve next sprint.",
    ],
    scales: [
      {
        name: "Dimension score",
        values: [
          { value: "1–3", meaning: "well below what the team wants" },
          { value: "4–6", meaning: "acceptable, with room to improve" },
          { value: "7–10", meaning: "strong (shown in color in the table)" },
        ],
      },
    ],
    tips: [
      "Agree what a 5 and a 10 mean for each dimension, and keep that the same every sprint.",
      "Base scores on data where you can, such as the Velocity Tracker or Squad Health Check.",
      "Talk about the biggest drop, not the average.",
      "Ratings are saved on the shared sprint, so Sprint Metrics shows the average too.",
    ],
  },
  {
    toolId: "health-dashboard",
    summary:
      "The Team Dashboard pulls headline numbers from other toolkit tools into one traffic-light view, so you can check team health without opening each tool.",
    whenToUse: [
      "Before a sprint review or a check-in with leadership.",
      "Deciding which area needs attention first.",
    ],
    steps: [
      "Check Data Source Status. Each card marked No data links to the tool to fill in: Velocity Tracker, Squad Health Check, Impediment Tracker, Standup Tracker or Cycle Time Analyzer.",
      "Read the six KPI cards. Each is rated against fixed limits, such as 80% velocity predictability or a cycle time P85 of 7 days or less.",
      "Check the Overall Health Score in the Traffic Light Summary. It counts only the KPIs that have data.",
      "Read Active Signals and any Cross-tool signals, then open the linked tool to dig in.",
      "Click Generate Summary, then Copy, to paste a short health report into an email or chat.",
    ],
    scales: [
      {
        name: "KPI status",
        values: [
          { value: "On Track", meaning: "within the healthy range" },
          { value: "Needs Attention", meaning: "close to the limit; keep an eye on it" },
          { value: "At Risk", meaning: "past the limit; act on it" },
        ],
      },
    ],
    tips: [
      "The dashboard is only as current as the tools behind it, so update those first.",
      "Use it to choose what to talk about, not to judge or rank teams.",
      "Cross-tool signals are hints to look into, not proof of cause.",
    ],
  },
  {
    toolId: "value-stream",
    summary:
      "A value stream map follows work through each stage from request to delivery. It shows how much of the total lead time is real work and how much is waiting, so you know where to cut delays.",
    whenToUse: [
      "When delivery feels slow and nobody is sure where the time goes.",
      "Before an improvement workshop, to agree on how work flows today.",
    ],
    steps: [
      "Click Add Stage for each step in order, for example Analysis, Development, Review, Test and Release.",
      "For each stage, enter Process Time (d), the hands-on work time, and Lead Time (d), the total time from arriving at the stage to leaving it, waiting included.",
      "Enter %C/A: the share of work that leaves the stage complete and accurate, with no rework needed downstream.",
      "Read the totals. Flow Efficiency is total process time ÷ total lead time; Rolled %C/A is the share of work that gets through every stage without rework.",
      "Look at each stage's Wait time and any outlier warning, and tackle the biggest delay first.",
    ],
    tips: [
      "Map how the process really works today, not how it should work.",
      "Flow efficiency under 15% is common. Most of the gain comes from cutting waiting, not from working faster.",
      "Use real numbers where you can, for example from the Cycle Time Analyzer.",
    ],
  },
  {
    toolId: "release-readiness",
    summary:
      "The Release Readiness Checklist tracks nine pre-release gates for each release, from accessibility and performance to rollback and sign-offs. Over time it shows how often you ship on time and which gates get skipped.",
    whenToUse: [
      "In the days before a release, to see what's still open.",
      "Release reviews, to learn which checks the team tends to skip.",
    ],
    steps: [
      "Under Add a release, enter the Name and Planned date, then click Add release.",
      "Tick each gate as it passes: A11y audit, Perf baseline, Monitoring dashboards, Alerts tuned, Rollback tested, Runbook linked, SRE review, Security review and Feature flag ready.",
      "Click Ship on release day. If gates are still open you'll be asked to confirm, and the number left open is saved.",
      "If the release is reverted, click Mark rolled back; use Reopen for planning when you're ready to try again.",
      "Every few releases, review % on time (it counts releases that were later rolled back), Avg gates open at ship and the Most-skipped gates chart.",
    ],
    tips: [
      "Gates lock once a release ships, so tick them as you go.",
      "Ship records today's date, so click it on the day you actually release.",
      "A gate that is always skipped either needs support or doesn't belong on the list.",
    ],
  },
  {
    toolId: "feature-flag-tracker",
    summary:
      "The Feature Flag Tracker lists your feature flags with their owner, purpose and age, and warns when a flag has been active for more than 90 days. It helps the team remove flags before they become hidden technical debt.",
    whenToUse: [
      "Teams that release behind feature flags or run experiments.",
      "Planning a cleanup when nobody is sure which flags are still needed.",
    ],
    steps: [
      "Add each flag with its Name, Owner, Environment (Dev, Staging, Prod or All) and Purpose (Rollout, Experiment, Kill switch or Permission).",
      "Keep its status current: Active, On, Off or Deprecated.",
      "Click Retire when the flag is removed from the code (or set its status to Deprecated). This records the date and counts toward Retired this quarter.",
      "Review the list every sprint or two. Flags older than 90 days are marked stale; agree with each owner whether to remove them.",
      "Use Flags by age and, once a few flags are retired, the survival curve to see how long flags usually live.",
    ],
    tips: [
      "Add a flag the day it's created. The tracker counts a flag's age from the day you add it.",
      "Kill switch and Permission flags are often meant to stay. They still show as stale after 90 days, so say why in the description when you add them.",
      "Make flag removal part of your definition of done. The Definition of Done Builder can help.",
    ],
  },
];
