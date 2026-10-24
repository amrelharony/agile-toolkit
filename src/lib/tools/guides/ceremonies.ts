import type { ToolGuide } from "./types";

/** Guides for the "Run the sprint" and "Retrospect & improve" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "retro-actions",
    summary:
      "Retro Actions is the follow-up list: every action item the team agreed in a retro — this one and the past ones — with an owner, a due date and whether it is done. An action sent to Impediments or Kanban counts as done when that item is finished.",
    whenToUse: [
      "Between retros, to chase the actions the team agreed and keep them visible.",
      "Before the next retro, to see which actions are still open and carry them over.",
      "When someone asks what the team changed after its last few retros.",
    ],
    steps: [
      "In the Retro board, mark cards as action items with an owner. They appear here under their retro, newest first.",
      "Give each action a due date and tick it when it's done; overdue actions are flagged.",
      "Send an action to Impediments or the Kanban backlog with Send to; when that item is resolved or reaches Done, the action closes itself.",
      "Carry a still-open action from a past retro onto the current board so the team looks at it again.",
      "Filter by Open, Overdue, Done or owner, and copy the list as Markdown for the team channel.",
    ],
    tips: [
      "Three actions per retro that get done beat ten that don't; close or drop the stale ones.",
      "An action without an owner isn't an action. Name one person, even for team-wide changes.",
      "The Sprint Cockpit's Retro card shows how many actions are open and overdue.",
    ],
    timebox: "Five minutes a week, and the first five minutes of every retro.",
  },
  {
    toolId: "sprint",
    summary:
      "The Sprint Cockpit is the current sprint on one page: a one-line verdict, the next ceremony, a card for each ceremony, the numbers, the burndown and what is blocking the team. It reads the sprint board, the standup, Impediments, the review and the retro, so nothing is typed twice.",
    whenToUse: [
      "First thing each day, to see what needs attention before the Daily Scrum.",
      "When someone asks how the sprint is going and you want one page to share.",
      "On the sprint's last day, to close it and decide where the unfinished stories go.",
    ],
    steps: [
      "With no sprint yet, follow Set up your sprint: add your team, create the sprint and check the ceremony times. Or click See an example first.",
      "Read the sentence under the sprint header, then the five ceremony cards. Each says where that ceremony stands and links to the tool that runs it.",
      "Done, Remaining and the Burndown come from the sprint board when its stories have points. Without pointed stories, type the points in Points left today under Burndown and click Log.",
      "Check Open blockers: the impediments open during the sprint, escalated and overdue ones first, and the stories Blocked on the board.",
      "When the sprint is over, click Close sprint, check the Completed points, and choose where unfinished stories go: the next sprint, Back to the backlog, or Decide later in Sprint Planning. Undo on the message that follows puts the sprint and its stories back.",
      "Click Export for a Markdown status report for the Sprint Review or a stakeholder update.",
    ],
    tips: [
      "Give the stories points in Sprint Planning or Planning Poker: the numbers then follow the board, with nothing to type.",
      "Pick another sprint under Sprint and the other sprint tools open on the same one.",
      "Ceremony times are the team's: change them under Next ceremony, or in the charter on the Team page.",
    ],
    timebox: "Two minutes a day; ten at the start and end of a sprint.",
  },
  {
    toolId: "async-standup",
    summary:
      "The Async Standup Digest is the standup's written mode: each person posts one update a day, you see who hasn't posted yet, and you copy a daily digest with blockers first. It uses the same entries as the live Standup Tracker, so both modes show the same day.",
    whenToUse: [
      "Teams spread across time zones, with little overlap for a daily call.",
      "To cut meeting load on focus days while keeping everyone informed.",
      "When someone misses the live Daily Scrum and posts their update later.",
    ],
    steps: [
      "Pick your name under Team member, or click Post for next to your name in Who hasn't posted. Yesterday is filled in from your last Today; change it if plans changed.",
      "Fill in Today (required), any Blockers and Notes, and click Post update, or press Ctrl/⌘+Enter. Change the Day to backdate a missed update. Posting again for the same day asks first, and Replace entry swaps in the new one.",
      "Who hasn't posted lists the team from the Team page, minus anyone who is out. For someone who is off today, click Not in today's standup next to their name. It counts for today only, in this browser, and Back in undoes it.",
      "On the Today tab, click Copy digest and paste today's digest, blockers first, into your team channel.",
      "On the Blockers tab, chase the Open blockers, oldest first. Each shows its age and turns red at 3 days. Click Send to… and pick Impediment to raise it in the Impediment Tracker. Resolving it there doesn't close it here, so click Resolve once it's cleared.",
      "Each week, check the Last 14 days strip on the History tab. Pale days mean people stopped posting, so ask why. Export next to Week gives the last 7 days per person.",
    ],
    tips: [
      "Write for a reader who wasn't there: name the story or ticket, not just “continued work”.",
      "Switch to Live at the top to run the Daily Scrum over the same entries. Async posts show there with an Async badge.",
      "When blockers have been logged in the Impediment Tracker in the last 7 days, a Recent blocker activity badge at the top shows how many. Bring them up with the team too.",
      "The Sprint Cockpit's Daily Scrum card shows how many people have updated today, live and async together.",
    ],
    timebox: "A few minutes per person, posted by an agreed time each day.",
  },
  {
    toolId: "sprint-review",
    summary:
      "The Sprint Review Kit keeps one review per sprint, built from its goal, its done stories and its points. You get a timed demo script, stakeholder feedback that can become backlog stories, a showcase checklist and the numbers.",
    whenToUse: [
      "Before the review, to build the demo from the sprint's done stories.",
      "In the Sprint Review, on the shared screen, to note what stakeholders say and turn it into backlog stories.",
    ],
    steps: [
      "Pick the sprint under Review of. The Sprint goal card says whether the goal was met; if nobody has answered, click Answer it in Sprint Goal. With nothing to show yet, try See an example review; nothing in it is saved.",
      "In Demo Script, click Add to demo on each done story you'll show, or add your own under Add an item. Stories come in not timed: use an item's pencil to set Minutes. Order items with the arrows; the Demo script heading adds up the minutes.",
      "In Showcase Checklist, click Use the standard checklist or add your own under New checklist item, and tick each item as it's ready.",
      "In Stakeholder Feedback, set the Review date. For each comment, fill in Stakeholder, Kind of feedback and What they said (all required), then click Add feedback.",
      "To act on feedback, click Send to… and choose Backlog story: the story joins the backlog Sprint Planning works from, and the feedback shows On the backlog.",
      "Velocity Summary reads Committed, Completed and Say/do from the sprint's stories; without pointed stories, from Typed numbers or the sprint's points in Velocity. To share, click Export at the top, then Copy as Markdown.",
    ],
    tips: [
      "With no sprint, the review is a draft: fill in Sprint info and Sprint velocity yourself. Start from the draft later copies its demo items, feedback and checklist into a sprint's empty review.",
      "Stories under Not done stay in the sprint; closing it in the Sprint Cockpit asks where they go.",
      "Reset deletes the review's demo items, feedback, checklist, date and typed numbers, with Undo. Stories and the goal stay.",
      "Leave at least half the time for stakeholders' questions. A review with only the team is a rehearsal.",
    ],
    scales: [
      {
        name: "Kind of feedback",
        values: [
          { value: "Positive", meaning: "works for them as it is" },
          { value: "Concern", meaning: "a problem or risk they see" },
          { value: "Suggestion", meaning: "something they'd add or change" },
        ],
      },
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
      "An impediment is anything slowing the team down that it can't easily remove on its own. The tracker keeps each one with a severity, owner and due date, flags old and overdue ones, and measures how long they take to resolve.",
    whenToUse: [
      "When blockers raised at the Daily Scrum need follow-up.",
      "When the same problems keep coming back and you need evidence to escalate them.",
      "Before a retro, to see what got in the team's way and how fast it was cleared.",
    ],
    steps: [
      "Click Log impediment. Write what is in the way under Impediment and pick a Severity. Both are required. Add a Category and a Description if they help.",
      "Pick the Owner and Raised by from the team, or type a name. Move Raised on back if it started before today, and set Due by. Once 3 are resolved, a button under Due by offers a date from your average. Click Log impediment to save.",
      "Review open items at the Daily Scrum or weekly. The sentence above the list names the one to chase first. The age badge turns amber at 3 days old and red at 7, and past its due date a card says Overdue by N days.",
      "Click Escalate when the team can't remove it alone; De-escalate moves it back to open. Click Resolve when it's gone, move Resolved on back if it went before today, then click Mark resolved. Click Reopen if it comes back.",
      "Use Show (All, Open, Escalated, Overdue, Resolved) and the Category and Severity filters to spot recurring problems. Once the list spans three weeks, Raised per week compares new impediments with those open at week end.",
      "Click Export, then Copy as Markdown for the team channel or a status report, or Export CSV. Both include every impediment, filtered or not.",
    ],
    tips: [
      "Describe the blocker, not a person: “test environment down for two days”, not “Ops is slow”.",
      "Every impediment needs an owner, even if their job is only to escalate it. A card without one says Nobody yet.",
      "Items sent from Standup, Retro, Retro Actions and Scrum of Scrums arrive at Medium severity with no category, so check both. Resolving one sent from a retro closes that action.",
      "The Sprint Cockpit's Open blockers card lists the unresolved ones in the sprint's way. Deleting a card offers Undo.",
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
