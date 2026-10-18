import type { ToolGuide } from "./types";

/** Guides for the "Run ceremonies" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
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
      "Set the filters: Time (2, 5, 10 or 15 min), Team Size, Energy Level and Category.",
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
    toolId: "one-on-one",
    summary:
      "A 1:1 is a regular private conversation between a manager and a team member about their work, wellbeing and growth. The tracker keeps a rolling agenda, so open topics carry over and agreed actions get followed up.",
    whenToUse: [
      "Every week or two between a manager and each direct report.",
      "When follow-ups from past 1:1s keep getting lost.",
    ],
    steps: [
      "Enter the Manager, Report and Date, then click Start meeting. Open items from your last 1:1 with the same person carry over automatically.",
      "Add agenda items before or during the meeting. Let the report bring most of them.",
      "Click an item's status to cycle it from Open to Discussed to Action. For an Action, fill in the action, Owner and due date.",
      "Write Notes as you talk. They save when you click out of the box.",
      "Before the next 1:1, check Action items overdue and open the last meeting under Past meetings to follow up.",
    ],
    scales: [
      {
        name: "Agenda status",
        values: [
          { value: "Open", meaning: "not covered yet; carries over to the next 1:1" },
          { value: "Discussed", meaning: "covered, nothing more to do" },
          { value: "Action", meaning: "needs follow-up with an owner and due date" },
        ],
      },
    ],
    tips: [
      "It's the report's meeting. Talk about growth and blockers, not a status update.",
      "Only Open items carry over. Follow up Actions from Past meetings, or re-add them.",
      "Mention “growth” in career topics; the Growth themes count picks up that word.",
    ],
    timebox: "30–60 minutes",
  },
  {
    toolId: "working-agreement",
    summary:
      "A working agreement is a short set of rules the team writes together about how it communicates, meets, decides and handles conflict. Because the team wrote it, the team can hold itself to it.",
    whenToUse: [
      "When a new team forms or several people join.",
      "When the same friction keeps coming up in retros, like slow reviews or meetings without agendas.",
      "Every few months, to check the rules still fit.",
    ],
    steps: [
      "Add a Team name and purpose, then pick rules from the Starter catalog or add your own under Add custom rule.",
      "Discuss each rule and reword it until everyone can live with it. Remove rules nobody will follow.",
      "Enter names in Agreed by, then click Publish to save a new version (v1, v2…).",
      "Every month or so, run a check-in: click each rule's status to mark it Working or Not working, and watch Adherence.",
      "Rewrite or drop the rules that aren't working and publish the next version.",
    ],
    scales: [
      {
        name: "Check-in status",
        values: [
          { value: "Check in", meaning: "not reviewed yet" },
          { value: "Working", meaning: "the team follows it and it helps" },
          { value: "Not working", meaning: "ignored, or no longer useful" },
        ],
      },
    ],
    tips: [
      "Keep it short. Five to ten rules people remember beat thirty nobody reads.",
      "Write behaviors (“PRs reviewed within one working day”), not values (“be respectful”).",
      "A check-in fits well at the start of a retro.",
    ],
    timebox: "60–90 minutes for the first version",
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
];
