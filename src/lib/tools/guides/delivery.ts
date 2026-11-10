import type { ToolGuide } from "./types";

/** Guides for the "Track delivery" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "sprint-metrics",
    summary:
      "Sprint Metrics shows how your sprints went over time: say/do, carry-over and scope churn across the last finished sprints, and where each number came from. The current sprint lives in the Sprint Cockpit.",
    whenToUse: [
      "Before a retrospective, to see whether the team keeps meeting its commitment.",
      "Before Sprint Planning, to check how much usually carries over or joins mid-sprint.",
      "Cleaning up sprint data: finished sprints without completed points, placeholder dates, or sprints made from older tool data.",
    ],
    steps: [
      "With no sprints yet, click Create your first sprint, or Load an example to see six closed sprints. Nothing in the example is saved.",
      "Under Look back over, pick Last 3, 6 or 12 sprints, or All sprints. Last 6 is the default, and this browser remembers your choice.",
      "Read the sentence at the top. Under it, Worth checking lists data to fix: Add completed points (with Undo), Set real dates or Check its details in the cockpit, or Looks right for a sprint made from older data.",
      "Read the Say/do by sprint chart (the green band is 90–110%, a met commitment) and Carry-over and scope change. View as table shows each chart's numbers.",
      "In Finished sprints, each row shows Committed, Completed, Say/do, Carried over, Scope +/− and the Source of those numbers. Click a sprint's name to open it in the cockpit. Beside Say/do, Retro follow-through shows how many retro actions got done.",
      "Open Advanced analysis: is it drifting? to see whether say/do or scope churn is trending, from 6 sprints.",
      "Use Open the cockpit for the running sprint, and the Sprint tools cards to open Burndown, Burnup, Velocity, Sprint Comparison or Release Planner on it. Export gives the trend as Markdown.",
    ],
    tips: [
      "A sprint counts once it is closed with its completed points. The sentence and charts appear from 3 of them.",
      "Say/do is completed ÷ committed: Met the commitment at 90–110%, Close to the commitment at 70–90%, Missed the commitment under 70%, Did more than committed above 110%.",
      "Carry-over and churn are exact when stories moved in the toolkit. For older sprints, carry-over falls back to the stories left in the sprint or committed − done, and churn to the daily log's scope. The Source column says which.",
      "New sprint suggests the end date from your cadence's sprint length.",
      "Cumulative Flow and Cycle Time track your board, not a sprint, so they sit under Flow, board-level.",
    ],
  },
  {
    toolId: "burnup",
    summary:
      "A burnup shows the points done climbing towards the sprint's scope. The scope line steps up when stories join and down when they leave, so scope change is easy to see and explain.",
    whenToUse: [
      "Tracking a sprint where scope is likely to change.",
      "Showing stakeholders how added or removed work moves the finish.",
      "Preparing the Sprint Review: what joined or left the sprint, and when.",
    ],
    steps: [
      "Pick the sprint under Sprint, or click New sprint. Burndown and the other sprint tools follow the same choice. No sprints yet? Click Create your first sprint, or Load an example for a read-only preview.",
      "Read the sentence at the top: points done of the current scope, how the scope grew or shrank since day 0, and when the work meets the scope at this pace.",
      "Read the tiles: Done, Scope added and Scope removed (with the days), and Projected done.",
      "On the Burnup chart, Done climbs and the Scope line steps up where work joined and down where it left, each step marked with its size.",
      "With pointed stories the numbers come from the sprint board, and Daily data lists each day with a note you can add. Without them, type the Scope (total pts) only on days it changes, and each day's Completed (pts). While the board has points that log waits under Daily log (fallback).",
      "When both hold numbers, switch with From the board and From the typed log. The bin clears a day and Clear log (it asks first) clears them all, with Undo. Sprint settings changes the Planned points, Length (days) and First day for every sprint tool.",
      "Export gives Markdown, CSV or PNG for the review. Next step under the tool may suggest checking added scope against the Sprint Goal or noting descoped work in the Sprint Review.",
    ],
    tips: [
      "Scope added and Scope removed are counted apart, so 8 points in and 5 out don't hide as a net 3.",
      "Completed is a running total, not the points finished that day. A note under it warns when it falls or passes the scope.",
      "A blank Scope carries the last one forward, starting from the Planned points. A dimmed Completed number was logged in Burndown: type over it to use your own.",
      "Advanced analysis adds a forecast from 4 working days, a trend test from 6 and pace shifts from 8.",
      "Only need the work left? Use the Burndown Generator.",
    ],
  },
  {
    toolId: "cycle-time",
    summary:
      "Cycle time is how many days an item takes from start to finish. The analyzer reads finished stories on the Sprint board and cards on the Flow board, plus items you type, so you can set a service level expectation (SLE) from real data and spot work that's ageing.",
    whenToUse: [
      "Answering “when will this be done?” with a likelihood instead of an estimate.",
      "Setting or reviewing the team's SLE.",
      "Finding work in progress that has been open longer than usual, before it's late.",
    ],
    steps: [
      "Move work to Done on the Sprint or Flow board: each story or card with a start shows here with its cycle time. With nothing yet, click Load an example; nothing in it is saved.",
      "For work tracked elsewhere, fill in Item, Started and Finished under Type an item and click Add item. Edit it in Finished items, or delete it with Undo.",
      "Pick what counts with the Include chips (Sprint board stories, Flow board cards, Typed), then read the sentence at the top: your SLE and how many items in progress are already older than it.",
      "Read the tiles. Average shows from 3 finished items; Median (50th %ile), 85th percentile and Spread (std dev) from 5.",
      "In Analysis, Histogram shows the spread and By completion date plots each item on the day it finished. On the SLE tab, pick a percentile under Stated at, and type a Target (days) to see how many items made it.",
      "Check Ageing work in progress: items in progress or in review, oldest first, tinted once older than the 85th percentile. On a Blocked one, click Send to… and pick Impediment.",
      "Click Export for a Markdown report, a CSV or JSON.",
    ],
    tips: [
      "Days are calendar days with the start and finish both counted, so an item started and finished on the same day took 1 day.",
      "Commit using the 85th percentile, not the average. The average hides the slow items.",
      "A card dropped straight into Done has no start, so it has no cycle time.",
      "Advanced analysis adds confidence ranges from 5 items, change points from 8 and a weekly trend from 6 weeks with a finish.",
      "Clear typed items asks first and offers Undo; stories and cards on the boards stay.",
    ],
    scales: [
      {
        name: "Percentiles",
        values: [
          { value: "50th", meaning: "half of items finish within this time" },
          { value: "85th", meaning: "the usual SLE, and the default for Stated at" },
          { value: "95th", meaning: "near the worst case seen" },
        ],
      },
    ],
  },
  {
    toolId: "cumulative-flow",
    summary:
      "A cumulative flow diagram stacks how many items sat in each stage, day by day. It builds itself from your Sprint board's or Flow board's moves, and a band that keeps widening is work piling up in that stage.",
    whenToUse: [
      "Checking whether work flows smoothly or piles up in one stage, such as Review.",
      "When work keeps starting but little finishes, before a Daily Scrum or a retro.",
      "Tracking a board the toolkit can't read, with snapshots typed by hand.",
    ],
    steps: [
      "With nothing to chart yet, Load an example shows a sample Sprint board without saving anything, or click Type snapshots instead.",
      "Under Chart from, pick Sprint board (and the sprint), Flow board (and the Last 14, 30 or 90 days) or Typed snapshots. It starts on the Sprint board if the sprint has stories, else the Flow board.",
      "Read the sentence above the tiles. It names a widening band first, then a stall (work in progress but nothing finished in the last 3 days or snapshots), else steady flow.",
      "The tiles show Work in progress against the limit, Throughput (items finished a day) and Lead time (Little's Law), average WIP ÷ throughput. On a board, its Measured line gives the real cycle time once 3 items have finished.",
      "For a board the toolkit can't read, choose Typed snapshots. Under Add a snapshot, pick the Date (backdating is fine), type a count for every column and click Add snapshot. Done is a running total.",
      "Edit dates, counts and notes in the Snapshots table, or delete a snapshot with Undo. Under Status columns, rename, add (it goes before Done) or remove a column, also with Undo. Set a limit under WIP limit (optional).",
      "Open Advanced analysis: WIP control chart and trend for control limits and change points. Export gives the daily counts as Markdown or CSV.",
    ],
    tips: [
      "Throughput and lead time appear from 3 days or snapshots; the WIP trend needs 6 and the control chart 8.",
      "On a board, the WIP limit is In progress and Review together, set on the Kanban board. Over the limit, the page says to finish something before pulling more in.",
      "In typed snapshots the first column is waiting work, the last is done and the ones between are work in progress, so keep at least three.",
      "Clear snapshots asks first and offers Undo. The snapshots and the WIP limit go; your columns stay.",
      "For the spread of how long items take, not just the average, use Cycle Time.",
    ],
  },
  {
    toolId: "sprint-compare",
    summary:
      "Sprint Comparison puts up to five sprints side by side on six scores from 1 to 10. Four are worked out from each sprint's data; Team Happiness and Quality are suggested by Mood Tracker and the Squad Health Check until the team rates them.",
    whenToUse: [
      "In a retrospective, to see what improved and what slipped against the last few sprints.",
      "Reviewing a quarter's sprints to spot patterns.",
      "Finding which sprint data is missing: every unscored dimension says what to add.",
    ],
    steps: [
      "With no sprints yet, click New sprint, or Load an example to see how each score is read. Nothing in the example is saved.",
      "With nothing pinned, the five newest finished sprints are compared (the three newest while none is finished). Use Pin and Unpin in the Sprints list to choose up to five. Reset comparison goes back to that default, with Undo.",
      "Under Scores, each dimension shows its value, a chip saying where it came from, and how it was worked out. Velocity, Predictability, Goal Achievement and Scope Stability are computed, so they can't be typed over.",
      "When a chip says Not scored, follow the link under it, such as Close it with its points, Answer “Did we meet the goal?” or Log scope in Burnup.",
      "Team Happiness and Quality show the suggestion in the box. Type a rating from 1 to 10 to override it, or clear the box to go back to the suggestion. Click Rate on any sprint in the list to rate it, even one that isn't pinned.",
      "Read the sentence at the top (what the newest sprint improved and slipped on most), the Sprint radar and the Dimension comparison table. Export gives the scores and where each came from as Markdown.",
    ],
    tips: [
      "Velocity, Predictability and Scope Stability wait until the sprint is closed with its completed points. Velocity is scored against the team's best once 3 sprints are finished.",
      "Happiness needs 3 Mood Tracker check-ins during the sprint. Quality reads Health of Codebase and Easy to Release from a Squad Health Check named after the sprint, or taken during it or the week after.",
      "The Average is the same number as the Sprint Cockpit's Average rating tile.",
      "Talk about the biggest drop, not the average.",
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
  },
  {
    toolId: "health-dashboard",
    summary:
      "The Team Dashboard works out six KPIs from your sprints, saved health checks, impediments, standups and the Sprint and Flow boards, and lights each one green, amber or red against your team's own limits, so you can see where to look first.",
    whenToUse: [
      "Before a sprint review or a check-in with leadership.",
      "Deciding which area needs attention first.",
      "Agreeing as a team where each light should turn amber and red.",
    ],
    steps: [
      "With no data yet, start in one of the tools listed (Sprint Cockpit, Health Check, Impediments, Standup or Kanban), or click Load an example; nothing in it is saved.",
      "Read the sentence at the top: the KPIs that need attention, worst first, each with its green limit.",
      "Check each card. It says where its number comes from and shows its green and amber limits; one without enough data says what to add, such as how many more pointed sprints to close. Its link (Velocity, Health Check, Impediments, Standup or Cycle Time) opens that tool.",
      "Traffic lights shows each KPI's light and the Overall score: the average of the KPIs with a light, counting green 100, amber 50 and red 0.",
      "Under Thresholds and windows, set each KPI's Green and Amber limits, and the Windows: Sprints predictability reads, Days a standup blocker stays recent and Days of finished work for cycle time. Click Save thresholds; Undo puts the old ones back. Reset thresholds asks first, goes back to the defaults and offers Undo.",
      "Open Advanced analysis for trend tests on predictability and team health, and for cross-tool signals.",
      "Click Export to copy or download the Markdown report for a review or a status update.",
    ],
    tips: [
      "Predictability is the share of the latest pointed sprints (6 by default) that delivered 90–110% of their commitment. It needs 3. Unpointed sprints are left out, and the card says how many.",
      "Team health uses the latest saved health check, never the unsaved draft.",
      "A standup blocker already raised as an impediment counts under impediments, not twice.",
      "Cycle time P85 needs 5 stories or cards with a start date finished in its window.",
      "Use the limits to choose what to talk about, not to judge or rank teams.",
    ],
    scales: [
      {
        name: "KPI status",
        values: [
          { value: "On track", meaning: "meets the green limit" },
          { value: "Needs attention", meaning: "past green, within the amber limit" },
          { value: "At risk", meaning: "past the amber limit" },
        ],
      },
    ],
  },
  {
    toolId: "value-stream",
    summary:
      "A value stream map follows work through each stage from request to delivery. It shows how much of the lead time is real work and how much is waiting, marks the bottleneck, and compares today's map with the one you want.",
    whenToUse: [
      "When delivery feels slow and nobody is sure where the time goes.",
      "Before an improvement workshop, to agree on how work flows today.",
      "To show what a planned change would do, by drafting the future state beside the current one.",
    ],
    steps: [
      "With no map yet, click Load an example to see one. Nothing in it is saved; click Clear example to start your own.",
      "Under Add a stage to the current state, enter the Stage name, Process time (days), Lead time (days) and %C/A (the share the next stage can use without rework), then click Add stage. Each stage goes at the end, so add them in order.",
      "Edit a stage card in place; under its numbers it shows how long work waits there. Use its arrows to move it earlier or later. Deleting a stage offers Undo.",
      "Read the sentence at the top and the tiles: Lead time, Process time, Flow efficiency (process ÷ lead) and Rolled %C/A (the share that passes every stage without rework). From 2 stages, the Bottleneck badge marks where work waits longest. Where the time goes charts work and wait per stage; click View as table for the numbers.",
      "Switch to Future state, click Start the future state from the current one, and change its stages to the flow you want. Current vs future compares the lead, process and wait times, flow efficiency and Rolled %C/A.",
      "To raise the bottleneck at the next retro, click Send to… under the current state's stages and pick Retro topic.",
      "Click Export for a Markdown report, a CSV or JSON.",
    ],
    tips: [
      "Map how the process really works today, not how it should work.",
      "Process time is the hands-on time. Lead time runs from arriving in the stage to leaving it, waiting included, so it can't be shorter: to raise both, raise the lead time first.",
      "Flow efficiency under 15% is common. Most of the gain comes from cutting waiting, not from working faster.",
      "When items moved on the boards in the last 7 days, a chip asks you to check the stage times still match.",
      "Clear the current state asks first and offers Undo; the future state stays.",
    ],
  },
  {
    toolId: "release-readiness",
    summary:
      "The Release Readiness Checklist checks each release against your team's gates, the nine built-ins until you change the list. Ship records the day a release went out and keeps its gates as they stood, so you see how often you ship on time and which gates get skipped.",
    whenToUse: [
      "In the days before a release, to see what's still open.",
      "When a release is rolled back, to record it and take it to the retro.",
      "Release reviews, to learn which checks the team tends to skip.",
    ],
    steps: [
      "Under Add a release, enter the Name and Planned date (it can be in the past), then click Add release.",
      "Tick each gate on the release's card as it passes. Feature flag ready is checked from the Feature Flag Tracker (the flags that ship with the release), and Definition of Done met, once you add it, from the Definition of Done Builder. When a check can tell, it sets the tick; with nothing to check, tick it by hand.",
      "Under Gates, add your own gates, rename them, reorder them with the arrows, or archive the ones you don't use. Click Add the Definition of Done gate to add the DoD check.",
      "When the release goes out, click Ship. Pick the Shipped on day (today unless you move it back), check the gates still open, then confirm.",
      "If it's reverted, click Mark rolled back and pick the day. Send to… takes the rollback to the retro. Reopen for planning gives it another try with your ticks kept, and its earlier ship still counts.",
      "Edit a release in place with its pencil button. Ship, Mark rolled back, Reopen for planning and Delete all offer Undo.",
      "Every few releases, read the verdict, % on time and Avg gates open at ship (they show after three ships) and the Most-skipped gates chart. Advanced analysis adds the gate-pass trend from 6 ships. Export it as Markdown or CSV.",
    ],
    tips: [
      "A ship on or before the planned date is on time. Every ship counts, rolled-back and reopened ones included.",
      "Adding, archiving or reordering gates never changes a shipped release: it keeps the gates it shipped with.",
      "For the flag gate, rollouts and experiments need an owner and a removal date that hasn't passed.",
      "Load an example from the empty page to see releases shipped, rolled back and reopened. Nothing in it is saved.",
      "A gate that is always skipped either needs support or doesn't belong on the list.",
    ],
  },
  {
    toolId: "feature-flag-tracker",
    summary:
      "The Feature Flag Tracker lists your flags with their purpose, owner and planned removal date, and shows which have outstayed their purpose. Rollouts go stale after 30 days, experiments after 60, permission flags once their removal date passes, and kill switches never.",
    whenToUse: [
      "Teams that release behind feature flags or run experiments.",
      "Planning a cleanup when nobody is sure which flags are still needed.",
      "Before a release, so its Feature flag ready gate in Release Readiness can pass.",
    ],
    steps: [
      "Under Add a flag, enter its Name as it appears in the code and pick its Purpose: Rollout, Experiment, Kill switch or Permission. Add the Owner, the Environment and the Created on day; backdate it for a flag that has been in the code a while.",
      "Set a Planned removal date if you have one; the hint says how long that kind of flag usually lives. Under Ships with, pick the release it goes out behind, then click Add flag.",
      "Keep each flag's status current with On and Off on its card. Edit changes any field, including the dates, and Delete offers Undo.",
      "When the flag leaves the code, click Retire, pick the Retired on day (today unless you move it back) and click Retire flag. A day in this quarter counts toward Retired this quarter. Undo puts it back, and Bring back turns a retired flag On again.",
      "Every sprint or two, read the verdict, the tiles and the cards, most overdue first (after a change, Re-sort puts them back in order). Each stale card says why; use Send to… to add a backlog story that plans its removal.",
      "Live flags by age shows how old your flags are. Once five flags are retired with their days, Advanced analysis shows how long flags usually live. Export the list as Markdown or CSV.",
    ],
    tips: [
      "Kill switches are meant to stay, so they are never stale. Give a permission flag a removal date only if it should go.",
      "A removal date takes priority over the typical lifetime: a rollout due next month isn't stale yet, however old it is.",
      "Release Readiness passes a release's flag gate only when each live rollout or experiment behind it has an owner and a removal date, and no flag behind it is past its removal date.",
      "Load an example from the empty page to see overdue, exempt and retired flags. Nothing in it is saved.",
      "Make flag removal part of your definition of done. The Definition of Done Builder can help.",
    ],
  },
  {
    toolId: "dora-scorecard",
    summary:
      "DORA's four key metrics measure software delivery: deploy frequency and lead time for speed, change failure rate and time to restore for stability. The scorecard keeps one sample per quarter, banded Elite, High, Medium or Low by the 2023 Accelerate State of DevOps Report.",
    whenToUse: [
      "Quarterly engineering reviews, to see whether delivery is getting faster and safer.",
      "Before and after a big change, such as a new CI/CD pipeline, to check its effect.",
    ],
    steps: [
      "Under Log a quarter, pick the Quarter: it starts on the latest finished quarter without a sample, and logged ones are marked. On an empty page, Load an example shows six quarters (not saved).",
      "Click Fill from your data to work the four numbers out from Release Readiness (deploys, rollbacks), the Sprint and Flow boards (lead time) and Incident Commander (time to restore). A metric it can't give stays empty, with why and a link.",
      "Check or type Deploys a week, Lead time (hours), Change failure rate (%) and Time to restore (hours), add what changed this quarter, and click Save quarter.",
      "The sentence names the latest quarter's weakest metric; the tiles show each band, and How they're set gives the ranges. Trend across quarters charts each metric from two quarters.",
      "Fix a quarter with the pencil on its row (Refill from your data works it out again). The bin deletes it with Undo; Clear all samples asks first, then offers Undo.",
      "Export it as Markdown or CSV, then agree one improvement to the weakest metric for next quarter.",
    ],
    tips: [
      "Read all four together: shipping faster while change failures climb isn't progress.",
      "Filled lead time runs from the start of work to the release that shipped it, the nearest the boards get to DORA's commit. It needs 3 items for a median.",
      "A quarter saved while it runs is marked In progress, then Partial quarter: edit it once it ends.",
      "Keep definitions the same every quarter. Advanced analysis adds trend tests from 6 quarters and control limits from 8.",
    ],
    scales: [
      {
        name: "Bands, 2023 report (deploys · lead time · change failure · restore)",
        values: [
          { value: "Elite", meaning: "7+ a week · up to 1 day · up to 5% · up to 1 h" },
          { value: "High", meaning: "1+ a week · up to 1 week · up to 10% · up to 1 day" },
          {
            value: "Medium",
            meaning: "monthly or more · up to 30 days · up to 15% · up to 1 week",
          },
          { value: "Low", meaning: "rarer than monthly · over 30 days · over 15% · over 1 week" },
        ],
      },
    ],
  },
];
