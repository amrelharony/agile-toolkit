import type { ToolGuide } from "./types";

/** Guides for the "Run the sprint" and "Retrospect & improve" tools. Loaded on demand (see ./index.ts). */
export const GUIDES: ToolGuide[] = [
  {
    toolId: "retro-actions",
    summary:
      "Retro Actions follows up every action your retros agreed, this one and the past ones, until it's really done, and shows whether the team does what it agrees.",
    whenToUse: [
      "Between retros, to chase the actions the team agreed and keep them visible.",
      "Before the next retro, to see which actions are still open and carry them over.",
      "When an action is agreed outside the retro, in a 1:1 or a team chat.",
    ],
    steps: [
      "Actions marked on the Retro board appear here under their retro. To add one agreed elsewhere, fill in Action, pick an Owner (or type a name and choose Add to the team), set a Due date if it has one and press Add action. It goes on the current retro, or the latest one when none is in progress.",
      "Tick the box when an action is done; Undo in the toast takes it back. The row stays put until you change the filter. Click the Done date under it to change the day it was done (today or earlier).",
      "Click an action's text to reword it, or its owner (No owner when nobody has it) to change who has it. Enter saves, Escape cancels. The due date saves when you leave the field, and the bin deletes the action, with Undo.",
      "Use Show (Open, Overdue, Done, All) and Filter by owner to see one person's actions, or No owner for the ones nobody has taken.",
      "On a past retro's open action, Carry over copies it onto the current retro. Send to… raises it as an Impediment, a Kanban card or a Backlog story (Sprint Planning can add it to a sprint); once that is resolved, reaches Done or is done, the action counts as done.",
      "Follow-through per retro shows how many of each past retro's actions were done, carried over or left open; View as table lists the numbers. Export copies or downloads it all as Markdown, or the actions as a CSV file.",
    ],
    tips: [
      "If follow-through stays under half, agree fewer actions, each with an owner, at the next retro.",
      "A retro isn't rated until the next one starts, so its actions have time to get done. The chart needs two past retros with actions.",
      "On an empty page, Load an example shows a checkout team's last three retros. Nothing in it is saved, and Clear example removes it.",
      "The Sprint Cockpit's retro card shows how many actions are open and overdue. Add to calendar, under Next ceremony there, can add open actions to the calendar file on their due dates.",
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
      "Under Next ceremony, Add to calendar downloads the sprint's ceremonies, each asking for a reminder 10 minutes before. Open retro actions with a due date go in unless you untick them; tick the weekly Agile at Work story to add it. Each teammate imports the file, or you forward it; download it again when times change.",
      "Read the sentence under the sprint header and any notes under it (a goal still unanswered, how many retro actions are in the sprint), then the five ceremony cards. Each says where that ceremony stands and links to the tool that runs it.",
      "Done, Remaining and the Burndown come from the sprint board when its stories have points. Without pointed stories, type the points in Points left today under Burndown and click Log.",
      "Check Open blockers: the impediments open during the sprint, escalated and overdue ones first, and the stories Blocked on the board.",
      "When the sprint is over, click Close sprint, check the Completed points, and choose where unfinished stories go: the next sprint, Back to the backlog, or Decide later in Sprint Planning. The last step asks Did we meet the sprint goal? when it has no answer yet, and offers Download backup. Undo on the message that follows puts the sprint, its stories and that answer back.",
      "Click Export for a Markdown status report for the Sprint Review or a stakeholder update.",
    ],
    tips: [
      "Give the stories points in Sprint Planning or Planning Poker: the numbers then follow the board, with nothing to type.",
      "Pick another sprint under Sprint and the other sprint tools open on the same one.",
      "Ceremony times are the team's: change them under Next ceremony, or in the charter on the Team page, which has Add to calendar too.",
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
      "An icebreaker is a short activity at the start of a meeting that gets everyone talking. The generator picks one of more than 50 activities to fit your group, time and energy, can skip what the team did lately, and times it for you.",
    whenToUse: [
      "Opening a retro, workshop or planning session, especially with new or remote members.",
      "When a meeting needs an energy lift or the room is quiet.",
      "When the team is tired of the same warm-up every sprint.",
    ],
    steps: [
      'Check People: with a team roster it starts at your team\'s size ("7 people, from your team"). Click Change to type another number, or leave it blank for any size.',
      "Set Time (up to 2, 5, 10 or 15 min), Energy Level and Category. Show adds Favorites only once you have favorites, and Hide used in the last 2 weeks once you have recent uses. The sentence by Random Pick says how many fit.",
      "Click Random Pick, or click a card under Browse All. The activity opens above Browse All with its Instructions.",
      "Click Start N-min timer (Start 5-min timer, say). It keeps counting in the docked timer at the bottom left while you open the retro board, and the activity is recorded as used, with Undo. If another page's timer is running, such as the Ceremony Timer's, the card says so and leaves it alone.",
      "Ran it without the timer? Click Mark as used, set Used on and click Record use. History lists every use: change a date with the pencil, or remove one with Undo.",
      "Tap the heart on activities that worked. Click Export, then Copy as Markdown, for a facilitation card with your favorites and history. When an event in your active sprint starts within the hour, Next step under the tool links to it.",
    ],
    tips: [
      "Let people pass, and never make sharing personal details mandatory.",
      "Match the energy to the moment: Low before a reflective retro, High to wake up a long workshop.",
      "Random Pick never repeats the activity just shown. With Hide used on, it skips the last two weeks too; if that leaves nothing, click Include the recent ones.",
      "New here? Load an example, below Browse All, adds a team's past warm-ups, two of them recent. Clear example removes them.",
    ],
    timebox: "2–15 minutes",
  },
  {
    toolId: "liberating-structures",
    summary:
      "Liberating Structures are simple meeting formats that get everyone contributing, not just the loudest voices. This picker holds 12 of the 33 structures, with their purpose, people, timing and steps, and runs the steps on a timer.",
    whenToUse: [
      "Planning a workshop, retro or all-hands where you want input from everyone.",
      "When the same few people dominate discussions.",
      "When a regular meeting format has gone stale.",
    ],
    steps: [
      "Start from Purpose: what should the group leave with? Ideas, Prioritize, Get help, Make sense, Stop doing, Plan, Connect or Self-organize.",
      "Type the number of People (or click Use team size), then pick the Ceremony (Planning, Refinement, Review or Retro) and the Timing. The sentence under the filters says how many fit and which is quickest.",
      "Click a card to see its steps and minutes. Click Save (or the heart) on the ones you want. They appear under Your favorites, where you can open one or remove it with Undo.",
      "Click Start step timer. The step timer at the top of the page counts down each step on the docked timer, so it keeps going while you're on the retro board. It waits at Time's up: click Next step (Finish on the last), or use Pause and Stop.",
      "For a longer session, chain two or three, for example Impromptu Networking to open, 1-2-4-All for ideas and 25/10 Crowd Sourcing to prioritize. With no favorites yet, Load an example retro plan saves these three and sets Ceremony to Retro.",
      "Click Export, then Copy as Markdown, for the open structure's timed plan and your favorites, ready for the invite. Export CSV lists the favorites.",
    ],
    tips: [
      "Stick to the timings and the exact question. The tight structure is what makes them work.",
      "Start with 1-2-4-All. It fits almost any meeting and needs no preparation. Its card can also Open in the Ceremony Timer.",
      "The step timer never replaces a timer another page is running. Stop that one first; the card links to it.",
      "Discovery & Action Dialogue and Open Space Technology run at the group's pace, so they have no step timer.",
      "With a sprint running, save a structure that suits your next Scrum event: in the two days before it, Next step under the tool suggests using it there.",
    ],
  },
  {
    toolId: "design-sprint",
    summary:
      "A design sprint is a five-day process from Google Ventures for answering a big product question with a realistic prototype, tested on five customers. The tracker works out which day it is, keeps what each day produces, and sends Test-day findings on as hypotheses or backlog stories.",
    whenToUse: [
      "Before committing a team to a large or risky feature.",
      "When the team is stuck between competing solutions.",
      "To get customers' reactions to an idea before anyone builds it.",
    ],
    steps: [
      "Enter a Sprint name and a Start date (backdate it if the sprint has begun). Name the Decider, who makes the final calls, and the Facilitator, then click Start sprint. Or click Load an example to see a sprint on Test day.",
      "Today's day comes from the start date and the team's working days; the timeline marks it Today. Click a day to open it; that never moves the sprint on.",
      "Tick off each day's tasks. The pencil edits a task and its Owner, the bin deletes it (with Undo), and Add task adds your own.",
      "Record each day's output in its own place, such as Set the long-term goal and Add a sprint question on Map day, Record the decision on Decide day and Add the prototype, with its link. Notes take the rest.",
      "On Test day, Add a finding for each pattern, with its Signal and how many of the five interviews it was Seen in. Then answer each sprint question Yes, No or Unclear.",
      "Use Send to… on a finding to make it a Hypothesis to test or a Backlog story; the finding links to it.",
      "When the team has decided what's next, click Complete sprint (Undo or Reopen if it was too early). Export it as Markdown, CSV or JSON.",
    ],
    tips: [
      "Keep the team to seven people or fewer, and clear their calendars for all five days.",
      "Recruit the five test users early. It's a preset task on Sketch day.",
      "Phrase sprint questions so Test day can answer them yes or no.",
      "Reset asks first and can be undone; hypotheses and stories already sent stay.",
    ],
    scales: [
      {
        name: "The five days",
        values: [
          { value: "1 Map", meaning: "set the long-term goal, map the problem, pick a target" },
          { value: "2 Sketch", meaning: "gather ideas; everyone sketches a solution" },
          { value: "3 Decide", meaning: "vote, the Decider chooses, storyboard it" },
          { value: "4 Prototype", meaning: "build a realistic facade" },
          { value: "5 Test", meaning: "interview five customers with the prototype" },
        ],
      },
    ],
    timebox: "Five full working days, usually Monday to Friday",
  },
  {
    toolId: "canvas",
    summary:
      "Canvas is an infinite whiteboard for visual sessions such as brainstorming, affinity mapping, retros and journey maps. Everyone adds stickies, shapes and drawings to the same board in real time, and live boards mirror your sprint and story map.",
    whenToUse: [
      "Remote or hybrid workshops that need a shared wall of sticky notes.",
      "Brainstorming many ideas, then grouping them into themes (affinity mapping).",
      "Mapping a journey or process, or reviewing the sprint or story map.",
    ],
    steps: [
      "Click Templates for a ready layout (retro, journey map, empathy map and more), or draw a Frame for each area on a blank board.",
      "Write the question in a Text box. Add a Timer and give 5–10 minutes of silent writing, one idea per sticky.",
      "Affinity map: drag similar stickies together and label each group. With 4 or more stickies, Detected clusters in the AI insights panel (sparkle button) suggests groups.",
      "Prioritize: each person marks the groups that matter most with the Pen, then discuss the top ones.",
      "Under Live boards in Templates, pick the Sprint and click Add sprint board, or click Add story map. It goes beside your content, with Undo.",
      "Drag a Sprint board card to another column to move its story; Kanban, the Sprint Cockpit and Burndown follow. Select a card and press Ctrl/Cmd + E or click Details to edit the story's title, points, assignee or status.",
      "Share the board as a Viewer, Commenter or Editor link, walk through frames with Present (play button), and Export it.",
    ],
    tips: [
      "Letter shortcuts only work while the board has focus, so click the board first.",
      "With others on the board, Bring all moves everyone to your view.",
      "The Vote widget runs a quick poll (Fibonacci, T-shirt or Dots). Votes stay hidden until you click the eye icon.",
      "A live Story map is read-only: use Edit in Story Mapper on its frame. To take a card off a Sprint board, remove its story from the sprint in Sprint Planning.",
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
    timebox: "45–60 minutes for a brainstorm with affinity mapping",
  },
  {
    toolId: "six-hats",
    summary:
      "Six Thinking Hats (Edward de Bono) has a group look at one topic through one hat at a time: facts, feelings, risks, benefits, new ideas and process. You get timed rounds, thoughts grouped by hat and a Blue-hat summary for the Decision Log.",
    whenToUse: [
      "Discussing a proposal where people keep talking past each other.",
      "Workshops that need both critical and creative thinking without one drowning out the other.",
      "Before a team decision you want written down in the Decision Log.",
    ],
    steps: [
      "Under Start a session, type the Topic, check the Order of the hats, enter Minutes per round and click Start session. Move a hat earlier or later, remove it, or use Add; Use the common order puts it back. On a first visit, Load an example shows a finished session.",
      "Click Start round 1. The clock runs on the docked timer, so it keeps going if you open another tool. Pause, resume or restart it beside the clock.",
      "Everyone wears the same hat at the same time. Under Add a thought the current hat is already picked: type the Thought and press Enter or click Log thought (Shift+Enter starts a new line).",
      "When the round is done, click Next hat; a round never moves on by itself. Skip the … hat passes over one, and Back to … returns to the previous one.",
      "In the last round, click Write the summary. Write what the team concluded and what happens next, and click Save summary (or press Ctrl+Enter). Close session saves it too.",
      "Once the summary is saved, use Send to… → Decision record to put it in the Decision Log as a proposed decision. Undo takes it back.",
      "Each thought has Edit, Move to another hat and Delete (with Undo). The icons by the topic edit the session, or delete it with Undo. Export copies or downloads it as Markdown or CSV.",
    ],
    tips: [
      "Keep the Red hat short: its round shows a half-time hint, but the clock keeps the full time.",
      "Don't open with the Black hat, or new ideas die early. The common order keeps Black after Yellow and Green.",
      "If another tool's timer is on the dock, the round isn't timed until you click Stop it and time this round.",
      "New session starts another; Open a session switches between them. Reopen session takes a closed one back to its last round, to add thoughts or run more rounds.",
      "Thoughts from before sessions existed show under Earlier thoughts; Give these a topic makes them a session of their own, with Undo.",
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
  // ── Phase 42: the meeting widgets and the research top 10 (Run and Retro) ──
  {
    toolId: "picker",
    summary:
      "Picker chooses fairly from your team or any list: spin a wheel, rotate standing roles, roll dice or flip a coin, and find a team or sprint name. Spin it in a live room and everyone sees the same spin stop on the same name.",
    whenToUse: [
      "To pick who speaks first, who facilitates the next retro or who takes notes, without asking the same people every time.",
      "To choose a team or sprint name, a topic or a winner at random, in front of the group.",
    ],
    steps: [
      "On Wheel, spin the team from the Team page, or make a list by typing or pasting names. Give a name more weight if it should come up more often.",
      "Leave Everyone once on so nobody comes up twice until everyone has had a turn. Turn on Take a name off to drop each name once it is picked. Each list keeps its own round when you switch.",
      "Press Spin. The wheel turns for a moment and lands on one name, and Amr cheers the result.",
      "On Roles, give facilitator, scribe, timekeeper or your own roles to whoever is due, one at a time or all at once. Nobody gets two roles in a day while someone else is free. Mark anyone away today without losing their place.",
      "Roles go to the team on the Team page. To rotate them among a saved list instead, choose it under Who takes the roles.",
      "On Quick, roll dice, flip a coin, answer yes or no, or pick a number or a letter.",
      "On Names, draw names from a theme such as planets or rivers, or ask Amr for names on your own theme, and shortlist the ones you like. Copy the shortlist into a Quick Vote poll, or spin it on the wheel.",
      "To spin with the whole team, open a live room, share its code and press Spin for the room: every phone shows the same spin.",
    ],
    tips: [
      "Every result is a fair random draw: weights change the odds, nothing else does.",
      "Lists, turns and picks are saved with your other tool data. A live room shows the spin and keeps nothing.",
    ],
    timebox: "Seconds.",
  },
  {
    toolId: "quick-vote",
    summary:
      "Quick Vote runs a fast poll in any meeting: fist of five, Roman vote, confidence, ROTI, a custom scale, multiple choice, dot votes or a ranking. Run it in a live room, where people see only the totals, or with hold-up cards on phones.",
    whenToUse: [
      "To check agreement before moving on: is everyone at least a three on this plan?",
      "At the end of a meeting, to ask whether it was worth the time (ROTI).",
      "To choose between options, or rank them, with the whole group.",
    ],
    steps: [
      "Pick a format, such as fist of five, confidence, ROTI, a poll, a ranking, dot voting or guess the number.",
      "Type the question and, for a poll or a ranking, its options. Ask Amr can suggest options from the question; you keep, change or drop each one.",
      "Open a live room and share its code, or use phone cards: each person holds up their number or colour full screen and you count.",
      "When everyone has voted, reveal the result. People see the totals, never who voted what.",
      "Talk about the spread, not just the average: ask the lowest and the highest votes what they see.",
      "Save the result with the meeting, or vote again after the discussion.",
    ],
    tips: [
      "A vote starts a conversation. Agree what a low score means before you ask.",
      "Run a confidence vote on the sprint plan before Sprint Planning ends.",
    ],
    timebox: "Two to five minutes per question.",
  },
  {
    toolId: "audience-wall",
    summary:
      "Audience Wall collects open answers from the whole room: ideas on a wall or in a word cloud, questions with upvotes, and a queue for raised hands. People add to it from their phones in a live room.",
    whenToUse: [
      "Brainwriting, or a 1-2-4-All or 25/10 round, where everyone writes before anyone talks.",
      "Questions at a Sprint Review, a town hall or a training, so the most wanted come first.",
      "Feedback on a demo, or what would make a session a ten.",
    ],
    steps: [
      "Type the question and choose the kind of wall: answers, questions or raised hands.",
      "Open a live room and share its code. People join from their phones and post short answers; the wall doesn't show who wrote what.",
      "For questions, everyone upvotes and the most wanted rise to the top. Mark a question answered once you've covered it.",
      "For raised hands, people join a queue to speak and you call the next one.",
      "Switch to the word cloud to see which words come up most.",
      "Ask Amr groups the answers into themes, merges duplicate questions or turns feedback into backlog items. You see the draft first, and nothing reaches the room or the backlog until you accept it.",
      "Export the wall as Markdown, or save it.",
    ],
    tips: [
      "Ask for one idea per post: the answers are easier to group.",
      "Time the writing, so it stops before the talking starts.",
    ],
    timebox: "Five to fifteen minutes per round.",
  },
  {
    toolId: "parking-lot",
    summary:
      "Parking Lot keeps the points that come up off topic, so the meeting stays on track and nothing is forgotten. Afterwards each point goes where it belongs: the backlog, the impediments or the retro actions.",
    whenToUse: [
      "A Daily Scrum or a planning that keeps drifting into side discussions.",
      "A workshop, where good ideas come up at the wrong time.",
    ],
    steps: [
      "Type the point and park it. Add the meeting and who raised it if that will help later.",
      "Keep the list on screen during the meeting, so people see their point was heard.",
      "At the end, go through the open points: mark each one discussed, send it to the backlog, the Impediment Tracker or Retro Actions, or drop it.",
      "A sent point links to where it went, and the item there links back to the parking lot.",
      "Ask Amr suggests where each open point should go. You decide, one point at a time or all at once, and Undo takes a send back.",
    ],
    tips: [
      "Agree when the parking lot is reviewed, such as the last five minutes, or points go there to be forgotten.",
      "Drop points nobody cares about any more: an empty parking lot is the goal.",
    ],
    timebox: "Five minutes at the end of the meeting.",
  },
  {
    toolId: "facilitator-timers",
    summary:
      "Facilitator Timers are the timers a session needs beyond its agenda: Pomodoro focus blocks, a big “Back at 10:45” break screen, Crazy 8s rounds, a meeting cost ticker and calm focus sounds made in the browser.",
    whenToUse: [
      "Workshops and long sessions that need breaks and focused rounds.",
      "Design sessions with Crazy 8s: eight sketches in eight minutes.",
      "When the people in a meeting should see what it costs.",
    ],
    steps: [
      "Choose a timer: Pomodoro, break, Crazy 8s or meeting cost.",
      "For a break, set the time to come back. The screen shows it in large type, ready to share or present.",
      "For Crazy 8s, start the rounds: a chime marks each of the eight minutes.",
      "For the cost ticker, enter how many people are there and an average hourly rate. The cost grows while the meeting runs.",
      "Turn on a focus sound for quiet work, such as rain or a soft hum. The browser makes it, so nothing downloads.",
      "In Present mode, the soundboard plays a drumroll, a gong, applause and a cheer from Amr.",
      "Ask Amr drafts an agenda from the meeting's goal, which you can change and then run in the Ceremony Timer.",
    ],
    tips: [
      "Sounds play only when you turn them on, and only after you press a button.",
      "Keep the cost ticker friendly: it helps the room decide, it isn't there to blame anyone.",
    ],
    timebox: "As long as the session.",
  },
  {
    toolId: "interrupt-buffer",
    summary:
      "Interrupt Buffer keeps part of each sprint free for unplanned work, logs every interrupt as it lands, and shows how much of the buffer is used. When it runs out, it walks the team through its emergency procedure.",
    whenToUse: [
      "A team that supports a live product and gets bugs, support requests and incidents during the sprint.",
      "When the sprint goal keeps slipping because of work nobody planned.",
    ],
    steps: [
      "Set the sprint's buffer, as a share of its planned points or in points. Sprint Planning plans the rest.",
      "Log each interrupt when it arrives: a title, its kind (bug, support, request, incident or other) and its size if you know it. Mark it an emergency if it can't wait.",
      "Mark interrupts resolved once they're done. The gauge shows how much of the buffer they used.",
      "When the buffer is gone, the Emergency Procedure walks the team through it in order: stop and look, tell the Product Owner, change how the work is done, get help, re-plan with the Product Owner (ending the sprint early only if the goal can't be kept), then review it at the retro.",
      "At the retro, look at the kinds of interrupts and where they came from, and decide what to fix at the source.",
      "Ask Amr suggests the kind of each new interrupt from its title; you confirm or change it.",
    ],
    tips: [
      "Start with the unplanned work of the last three sprints, then adjust.",
      "An unused buffer isn't waste: pull in the next item from the backlog once it's clear nothing else is coming.",
    ],
    timebox: "Seconds per interrupt; ten minutes at planning and at the retro.",
  },
  {
    toolId: "root-cause",
    summary:
      "Root Cause takes a problem back to its causes with 5 Whys or a fishbone diagram, shows which causes matter most on a Pareto chart, and ends with a countermeasure the team can act on.",
    whenToUse: [
      "A problem that keeps coming back after a retro said it was fixed.",
      "After an incident or a missed sprint goal, before deciding what to change.",
      "When the team disagrees about the cause and needs to see all of them.",
    ],
    steps: [
      "Write the problem as a fact: what happened, where and how often, with no blame.",
      "For 5 Whys, ask why it happened and write the answer, then ask why again, usually about five times, until you reach a cause the team can change.",
      "For a fishbone, add causes under categories such as people, process, tools and environment, and count how often each one happens.",
      "The Pareto chart puts the causes in order of their count, so you see the few behind most of the problem.",
      "Mark the root cause and write a countermeasure. Send it to Retro Actions so someone owns it, and link the analysis to the retro or post-mortem it came from.",
      "Ask Amr suggests the next why, categories for the fishbone or a countermeasure. You pick what fits; nothing is added on its own.",
    ],
    tips: [
      "Stop at a cause you can act on. “People make mistakes” isn't a root cause; the process that let the mistake through is.",
      "Most problems have more than one cause, and a fishbone shows them side by side.",
    ],
    timebox: "Twenty to forty-five minutes.",
  },
  {
    toolId: "card-decks",
    summary:
      "Card Decks deals prompt cards one at a time: retro questions, coaching questions, storytelling prompts, story-splitting patterns and appreciation cards, all written for this toolkit. Deal them on your screen or to a live room.",
    whenToUse: [
      "To open a retro or a check-in with a fresh question.",
      "In refinement, to try one splitting pattern at a time on a big story.",
      "In a coaching conversation, when you need a good question.",
    ],
    steps: [
      "Pick a deck: retro prompts, coaching, storytelling, story splitting, appreciation, or the check-in and check-out questions from the Ice Breaker.",
      "Deal one card at a time, shuffle to mix the deck, or go back to the last card.",
      "In a live room, everyone sees the card you deal on their own screen.",
      "Star the cards you like to find them again, and hide the ones that don't fit your team.",
      "Ask Amr writes a short deck on a theme you give, or picks a card that fits the team's mood. You keep the cards you want.",
    ],
    tips: [
      "One good question beats five quick ones: give people time to think before anyone answers.",
      "The story-splitting cards follow the SPIDR patterns: spikes, paths, interfaces, data and rules.",
    ],
    timebox: "Two to ten minutes per card.",
  },
];
