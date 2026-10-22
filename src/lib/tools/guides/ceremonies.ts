import type { ToolGuide } from "./types";

/** Guides for the "Run the sprint" and "Retrospect & improve" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "sprint",
    summary:
      "The Sprint Cockpit is the Scrum master's home page for the current sprint: the goal and day count, the burndown, who has posted today's update, the open blockers, the last retro's actions and when the next ceremony is. Everything on it comes from the other tools; nothing is typed twice.",
    whenToUse: [
      "First thing each day, to see what needs attention before the Daily Scrum.",
      "When someone asks how the sprint is going and you want one page to share.",
      "To start the sprint cycle for a new team: it walks you through the team, the first sprint and the ceremony times.",
    ],
    steps: [
      "With no sprint yet, add your team, create the sprint and set the ceremony times. Or load the example to look around first.",
      "Read the ceremony strip left to right: Planning, Daily, Refinement, Review, Retro. Each card says where that ceremony stands and opens the tool for it.",
      "Log today's points left under the burndown. Burndown, Sprint Metrics and the forecasts all use the same number.",
      "Check Open blockers and the actions from the last retro; open Impediments or the Retro board to work on them.",
      "At the end of the sprint, click Close sprint and copy the Sprint report into your review notes or wiki.",
    ],
    tips: [
      "The cockpit also appears at the top of the home page once a sprint exists.",
      "Ceremony times are kept in this browser (and synced for the owner); adjust them from the Next ceremony card.",
      "Pick a different sprint in the picker; every sprint tool follows the same choice.",
    ],
    timebox: "Two minutes a day; ten at the start and end of a sprint.",
  },
  {
    toolId: "async-standup",
    summary:
      "An async standup replaces the daily meeting with short written updates. Each person posts what they did, what's next and any blockers, and the tool rolls them into one daily digest with blockers at the top.",
    whenToUse: [
      "Teams spread across time zones, with little overlap for a daily call.",
      "To cut meeting load while keeping everyone informed, for example on focus days.",
    ],
    steps: [
      "Agree a time each day by which everyone posts their update.",
      "Each person enters their Member name, fills in Yesterday and Today, adds any Blockers, and clicks Post update.",
      "Check the Blockers banner. Anyone who is blocked gets a reply or a quick call the same day.",
      "Click Generate Digest to copy today's digest (blockers first, then each person) and paste it into your team channel.",
      "Look at the Last 14 days grid each week. Pale days mean people stopped posting, so ask why.",
    ],
    tips: [
      "Write for a reader who wasn't there: name the story or ticket, not just “continued work”.",
      "Async doesn't mean never meeting. Keep a short call for blockers that need discussion, or use the Standup Tracker for a live standup.",
      "Log blockers in the Impediment Tracker too. The digest shows how many were raised there in the last 7 days.",
    ],
  },
  {
    toolId: "sprint-review",
    summary:
      "In the sprint review, the team shows stakeholders what it built and gathers feedback that shapes the backlog. This kit helps you prepare a timed demo script, check the setup, record feedback and summarize velocity.",
    whenToUse: [
      "At the end of every sprint, before the retrospective.",
      "Before a release or milestone demo to stakeholders or customers.",
    ],
    steps: [
      "In Demo Script, set the sprint name and number, then click Add Feature for each item, with a description, acceptance criteria and minutes. The tool builds a timed script.",
      "Before the meeting, work through the Showcase Checklist: environment, demo data, invites, screen sharing and a backup plan.",
      "Demo working software, not slides, and check each feature against its acceptance criteria.",
      "In Stakeholder Feedback, set the Meeting Date and record each comment with the Stakeholder and a Category.",
      "In Velocity Summary, enter committed and completed points and backlog totals to show completion rate and release progress. Export the kit to share it.",
    ],
    scales: [
      {
        name: "Feedback category",
        values: [
          { value: "Positive", meaning: "works well, keep it" },
          { value: "Concern", meaning: "a problem or risk to address" },
          { value: "Suggestion", meaning: "an idea for a change or new item" },
        ],
      },
    ],
    tips: [
      "Invite real stakeholders. A review with only the team is a rehearsal.",
      "Leave at least half the time for discussion, not just demos.",
      "Turn concerns and suggestions into backlog items while they're fresh, for example in the Backlog Prioritizer.",
    ],
    timebox: "About 1 hour per sprint week, at most 4 hours for a month",
  },
  {
    toolId: "icebreaker",
    summary:
      "An icebreaker is a short activity at the start of a meeting that gets everyone talking. The generator picks one of more than 50 activities to fit your time, group size and energy.",
    whenToUse: [
      "Opening a retro, workshop or planning session, especially with new or remote members.",
      "When a meeting needs an energy lift or the room is quiet.",
    ],
    steps: [
      "Set the filters: Time (up to 2, 5, 10 or 15 min), Team Size, Energy Level and Category.",
      "Click Random Pick, or click one of the matching cards under Browse All.",
      "Read the Instructions aloud, then go first yourself to show how it works.",
      "Keep to the time on the card. Tap the heart on activities that worked so you can spot them later.",
    ],
    scales: [
      {
        name: "Team Size",
        values: [
          { value: "Small", meaning: "2–5 people" },
          { value: "Medium", meaning: "5–10 people" },
          { value: "Large", meaning: "10+ people" },
        ],
      },
    ],
    tips: [
      "Let people pass, and never make sharing personal details mandatory.",
      "Match the energy to the moment: Low before a reflective retro, High to wake up a long workshop.",
      "Agile activities double as a warm-up for the meeting's topic.",
    ],
    timebox: "2–15 minutes",
  },
  {
    toolId: "liberating-structures",
    summary:
      "Liberating Structures are simple meeting formats that get everyone contributing, not just the loudest voices. This picker holds 12 of the 33 structures, with purpose, timing and group size, so you can choose one for your next session.",
    whenToUse: [
      "Planning a workshop, retro or all-hands where you want input from everyone.",
      "When the same few people dominate discussions.",
      "When a regular meeting format has gone stale.",
    ],
    steps: [
      "Start from your purpose: what should the group leave with? Ideas, a decision, or help with a problem?",
      "Filter by Group size and Timing to see the structures that fit.",
      "Click a card to read how it runs, and Save the ones you want. They appear under Your favorites.",
      "For a longer session, chain two or three, for example Impromptu Networking to open, 1-2-4-All for ideas and 25/10 Crowd Sourcing to prioritize.",
      "Export your favorites to share the plan.",
    ],
    tips: [
      "Stick to the timings and the exact question. The tight structure is what makes them work.",
      "Start with 1-2-4-All. It fits almost any meeting and needs no preparation.",
      "Use the Ceremony Timer to keep each round on time.",
    ],
  },
  {
    toolId: "design-sprint",
    summary:
      "A design sprint is a five-day process from Google Ventures for answering a big product question. You map the problem, sketch solutions, decide, build a realistic prototype and test it with five users.",
    whenToUse: [
      "Before committing a team to a large or risky feature.",
      "When the team is stuck between competing solutions.",
    ],
    steps: [
      "Enter a Sprint name and Start date and click Start sprint. Name the Decider, who makes the final calls, and the Facilitator.",
      "Each day, select it on the timeline. Work through its preset tasks, add your own and tick them off.",
      "Set an Owner on the tasks that need one (the Decider or Facilitator).",
      "Log artifacts as you go, as links or notes: the map, sketches, storyboard, prototype and interview notes.",
      "On day 5, look for patterns across the five interviews, decide next steps and click Complete sprint.",
    ],
    scales: [
      {
        name: "The five days",
        values: [
          { value: "1 Map", meaning: "set the long-term goal, map the problem, pick a target" },
          { value: "2 Sketch", meaning: "gather ideas; everyone sketches a solution" },
          { value: "3 Decide", meaning: "vote, the Decider chooses, storyboard it" },
          { value: "4 Prototype", meaning: "build a realistic facade" },
          { value: "5 Test", meaning: "interview five users with the prototype" },
        ],
      },
    ],
    tips: [
      "Keep the team to seven people or fewer, and clear their calendars for all five days.",
      "Recruit the five test users early. It's a preset task on Sketch day.",
    ],
    timebox: "Five full days, Monday to Friday",
  },
  {
    toolId: "canvas",
    summary:
      "Canvas is an infinite whiteboard for visual sessions such as brainstorming, affinity mapping, retros and journey maps. Everyone adds stickies, shapes and drawings to the same board in real time.",
    whenToUse: [
      "Remote or hybrid workshops that need a shared wall of sticky notes.",
      "Brainstorming many ideas, then grouping them into themes (affinity mapping).",
      "Mapping a journey, process or system with frames, shapes and connectors.",
    ],
    steps: [
      "Click Templates for a ready layout (retro, journey map, empathy map and more), or draw a Frame for each area on a blank board.",
      "Write the question in a Text box. Add a Timer and give 5–10 minutes of silent writing, one idea per sticky.",
      "Affinity map: drag similar stickies together and label each group. With 4 or more stickies, Detected clusters in the AI insights panel (sparkle button) suggests groups.",
      "Prioritize: each person marks the groups that matter most with the Pen, then discuss the top ones.",
      "Share the board as a Viewer, Commenter or Editor link, walk through frames with Present (play button), and Export it.",
    ],
    scales: [
      {
        name: "Keyboard shortcuts",
        values: [
          { value: "N · T · F · C", meaning: "sticky, text, frame, connector (V to select)" },
          { value: "Space + drag", meaning: "pan the board; scroll to zoom" },
          { value: "Enter · Esc", meaning: "edit the selected object · cancel or deselect" },
          { value: "Ctrl/Cmd + Z", meaning: "undo; add Shift to redo" },
          { value: "Ctrl/Cmd + G", meaning: "group the selection; add Shift to ungroup" },
        ],
      },
    ],
    tips: [
      "Letter shortcuts only work while the board has focus, so click the board first.",
      "With others on the board, Bring all moves everyone to your view.",
      "The Vote widget runs a quick poll (Fibonacci, T-shirt or Dots). Votes stay hidden until you click the eye icon.",
    ],
    timebox: "45–60 minutes for a brainstorm with affinity mapping",
  },
  {
    toolId: "six-hats",
    summary:
      "Six Thinking Hats (Edward de Bono) has a group look at a problem from one angle at a time, together: facts, feelings, risks, benefits, new ideas and process. It avoids debates where one side attacks and the other defends.",
    whenToUse: [
      "Discussing a proposal where people keep talking past each other.",
      "Workshops that need both critical and creative thinking without one drowning out the other.",
    ],
    steps: [
      "Start with the Blue hat: state the question and agree the order of the hats.",
      "Everyone wears the same hat at the same time. Pick it in the Hat menu and Log each thought.",
      "Work through the White, Red, Black, Yellow and Green hats in the agreed order, a few minutes each.",
      "Finish with the Blue hat: summarize what came up and agree next steps.",
      "Review the thoughts grouped by hat, and export them for the record.",
    ],
    tips: [
      "Keep the Red hat short: gut reactions, with no need to justify them.",
      "Don't open with the Black hat, or new ideas die early.",
      "Use the Ceremony Timer to timebox each hat.",
    ],
    timebox: "30–60 minutes",
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
];
