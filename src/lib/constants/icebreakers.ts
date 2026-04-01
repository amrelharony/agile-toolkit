export interface IceBreaker {
  id: string;
  name: string;
  description: string;
  instructions: string;
  timeMinutes: number;
  teamSize: "small" | "medium" | "large";
  energyLevel: "low" | "medium" | "high";
  category: "question" | "activity" | "game" | "creative" | "agile";
}

export const icebreakers: IceBreaker[] = [
  // ── Question ──────────────────────────────────────────────
  {
    id: "q-1",
    name: "Two Truths and a Lie",
    description: "Each person shares two true statements and one false one. The group guesses the lie.",
    instructions:
      "Go around the group. Each person states three things about themselves: two true and one made up. After each person shares, the rest of the group votes on which statement is the lie. Reveal the answer and move on.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "medium",
    category: "question",
  },
  {
    id: "q-2",
    name: "Desert Island Pick",
    description: "If you were stranded on a desert island, what three items would you bring?",
    instructions:
      "Ask each participant to name three items they would bring to a desert island and briefly explain why. Encourage creative or humorous answers. Allow the group to ask one follow-up question per person.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "question",
  },
  {
    id: "q-3",
    name: "Superpower Question",
    description: "If you could have any superpower, what would it be and why?",
    instructions:
      "Each person shares the superpower they would choose and gives a one-sentence reason. Optionally, the group votes on the most useful or funniest superpower at the end.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "question",
  },
  {
    id: "q-4",
    name: "Bucket List Share",
    description: "Share one item from your bucket list that the group might not expect.",
    instructions:
      "Each person reveals one surprising or lesser-known item from their bucket list. Encourage the group to ask one quick follow-up question. Keep it light and fun.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "low",
    category: "question",
  },
  {
    id: "q-5",
    name: "Would You Rather",
    description: "Answer a series of 'Would You Rather' dilemmas and discuss your choices.",
    instructions:
      "The facilitator reads out a Would You Rather question (e.g., 'Would you rather have unlimited money or unlimited time?'). Participants pick a side and briefly explain. Do 3-5 rounds.",
    timeMinutes: 10,
    teamSize: "large",
    energyLevel: "medium",
    category: "question",
  },
  {
    id: "q-6",
    name: "First Job Story",
    description: "Share a fun or embarrassing story from your very first job.",
    instructions:
      "Go around the group and have each person share a memorable moment from their first job. Keep stories to about 30 seconds each. Celebrate the most entertaining story.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "low",
    category: "question",
  },
  {
    id: "q-7",
    name: "One Word Check-In",
    description: "Describe how you are feeling right now in exactly one word.",
    instructions:
      "Each person shares a single word that captures their current mood or state. No explanations required unless they want to elaborate briefly. Great for pulse-checking the room.",
    timeMinutes: 2,
    teamSize: "large",
    energyLevel: "low",
    category: "question",
  },
  {
    id: "q-8",
    name: "Unpopular Opinion",
    description: "Share a mildly unpopular opinion and see if anyone agrees.",
    instructions:
      "Each person shares an unpopular opinion (keep it light and non-controversial, e.g., 'Pineapple belongs on pizza'). The group shows thumbs up or down. Most divisive opinion wins.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "medium",
    category: "question",
  },
  {
    id: "q-9",
    name: "Time Travel Destination",
    description: "If you could travel to any point in history, when and where would you go?",
    instructions:
      "Each participant picks a historical era or specific date to visit and explains why in one or two sentences. Great for sparking conversations about interests and passions.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "question",
  },
  {
    id: "q-10",
    name: "Peak and Pit",
    description: "Share the best and worst parts of your week so far.",
    instructions:
      "Each person shares their 'peak' (highlight) and 'pit' (lowlight) of the week. Keep each share to under 30 seconds. This builds empathy and connection within the team.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "low",
    category: "question",
  },

  // ── Activity ──────────────────────────────────────────────
  {
    id: "a-1",
    name: "Show Your Workspace",
    description: "Give the team a quick tour of your workspace or desk setup.",
    instructions:
      "Each person takes 30 seconds to show their workspace on camera (or describe it if audio-only). Point out one unique or personal item. Great for remote teams to feel more connected.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "low",
    category: "activity",
  },
  {
    id: "a-2",
    name: "Emoji Check-In",
    description: "Everyone drops an emoji in chat that represents their current mood.",
    instructions:
      "Ask everyone to simultaneously drop an emoji in the chat that represents how they feel. Then go around and have a few people explain their choice. Quick, visual, and inclusive.",
    timeMinutes: 2,
    teamSize: "large",
    energyLevel: "low",
    category: "activity",
  },
  {
    id: "a-3",
    name: "Photo Scavenger Hunt",
    description: "Find and share a photo on your phone that matches a given prompt.",
    instructions:
      "Give the group a prompt (e.g., 'a photo that makes you happy', 'your most recent meal'). Everyone has 60 seconds to find a matching photo and share it. Discuss the most interesting ones.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "medium",
    category: "activity",
  },
  {
    id: "a-4",
    name: "Stretch Break",
    description: "Lead the team through a 2-minute guided stretch routine.",
    instructions:
      "One person leads 4-5 simple stretches (neck rolls, shoulder shrugs, wrist stretches, standing stretch). Hold each for 15-20 seconds. Great for mid-meeting energy boosts.",
    timeMinutes: 2,
    teamSize: "large",
    energyLevel: "medium",
    category: "activity",
  },
  {
    id: "a-5",
    name: "Collaborative Drawing",
    description: "Take turns adding to a shared digital drawing in 10-second intervals.",
    instructions:
      "Open a shared whiteboard. The first person draws for 10 seconds, then passes to the next. Continue until everyone has contributed. See what masterpiece (or disaster) emerges.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "medium",
    category: "activity",
  },
  {
    id: "a-6",
    name: "Background Story",
    description: "Change your virtual background to something meaningful and explain it.",
    instructions:
      "Everyone sets a virtual background that represents something important to them (a favorite place, hobby, memory). Take turns explaining your choice in 30 seconds.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "low",
    category: "activity",
  },
  {
    id: "a-7",
    name: "Gratitude Round",
    description: "Share one thing you are grateful for today.",
    instructions:
      "Go around the group and have each person share one thing they are grateful for. It can be work-related or personal. Keep it quick. Builds a positive atmosphere before diving into work.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "activity",
  },
  {
    id: "a-8",
    name: "Skill Swap Spotlight",
    description: "Teach the group one quick skill or tip in 60 seconds.",
    instructions:
      "Pick 2-3 volunteers. Each person has exactly 60 seconds to teach the group a quick tip or skill (a keyboard shortcut, a cooking trick, a life hack). Vote on the most useful tip.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "medium",
    category: "activity",
  },
  {
    id: "a-9",
    name: "Pet (or Plant) Introduction",
    description: "Introduce your pet or favorite houseplant to the group.",
    instructions:
      "Anyone with a pet or plant nearby brings them on camera and introduces them (name, personality, fun fact). If you have neither, share a photo of a favorite animal. Keep it under 30 seconds each.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "low",
    category: "activity",
  },
  {
    id: "a-10",
    name: "Soundtrack of the Day",
    description: "Share a song that matches your mood today and why.",
    instructions:
      "Each person names a song that matches their mood or energy level today. Optionally play a 10-second clip. Compile a group playlist for the day.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "activity",
  },

  // ── Game ──────────────────────────────────────────────────
  {
    id: "g-1",
    name: "Rock Paper Scissors Tournament",
    description: "A quick bracket-style Rock Paper Scissors tournament.",
    instructions:
      "Pair everyone up. Play best-of-one Rock Paper Scissors. Winners advance, losers cheer. Continue the bracket until a champion is crowned. Works great on camera with countdown.",
    timeMinutes: 5,
    teamSize: "large",
    energyLevel: "high",
    category: "game",
  },
  {
    id: "g-2",
    name: "Trivia Lightning Round",
    description: "Five rapid-fire trivia questions. Fastest correct answer wins each round.",
    instructions:
      "The facilitator reads 5 trivia questions one at a time. Participants type their answers in chat. First correct answer wins the point. Tally scores at the end. Mix categories for variety.",
    timeMinutes: 5,
    teamSize: "large",
    energyLevel: "high",
    category: "game",
  },
  {
    id: "g-3",
    name: "Guess the Drawing",
    description: "One person draws, the rest guess what it is. Like Pictionary.",
    instructions:
      "One person draws a concept on a shared whiteboard or paper held to camera. The rest of the group guesses in chat or by unmuting. First correct guess earns a point. Rotate the artist.",
    timeMinutes: 10,
    teamSize: "medium",
    energyLevel: "high",
    category: "game",
  },
  {
    id: "g-4",
    name: "Word Association Chain",
    description: "Go around the group saying words associated with the previous one.",
    instructions:
      "Start with a random word. The next person says the first word that comes to mind. Continue around the group. If someone hesitates for more than 3 seconds or repeats a word, they are out. Last person standing wins.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "medium",
    category: "game",
  },
  {
    id: "g-5",
    name: "Emoji Charades",
    description: "Act out a concept using only emojis in chat for others to guess.",
    instructions:
      "One person uses a sequence of emojis in chat to represent a movie, song, or phrase. The rest of the group guesses. First to guess correctly goes next. Play 4-5 rounds.",
    timeMinutes: 10,
    teamSize: "medium",
    energyLevel: "medium",
    category: "game",
  },
  {
    id: "g-6",
    name: "Common Ground",
    description: "Find something unexpected that everyone in the group has in common.",
    instructions:
      "The group has 3 minutes to discover something they all share that is not obvious (not 'we all work here'). Someone proposes things, others confirm or deny. First universal match wins.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "medium",
    category: "game",
  },
  {
    id: "g-7",
    name: "Name That Tune",
    description: "Hum or play a few seconds of a song for others to guess.",
    instructions:
      "One person hums or plays 5 seconds of a song. The rest guess the title and artist. First correct answer wins a point. Rotate through 5 songs. Tally scores.",
    timeMinutes: 10,
    teamSize: "medium",
    energyLevel: "high",
    category: "game",
  },
  {
    id: "g-8",
    name: "Scattergories Sprint",
    description: "Name items in a category starting with a specific letter within 30 seconds.",
    instructions:
      "Pick a random letter and a category (e.g., 'animals starting with B'). Everyone has 30 seconds to write as many as they can. Share answers. Unique answers score a point. Play 3 rounds.",
    timeMinutes: 5,
    teamSize: "large",
    energyLevel: "high",
    category: "game",
  },
  {
    id: "g-9",
    name: "Story Builder",
    description: "Build a story one sentence at a time, each person adding to it.",
    instructions:
      "The first person says an opening sentence. The next person adds the next sentence, and so on. Try to keep the story coherent (or hilariously not). Go around twice.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "medium",
    category: "game",
  },
  {
    id: "g-10",
    name: "Heads Up Challenge",
    description: "One person guesses a word on their forehead from teammates' clues.",
    instructions:
      "One person holds a word (or sticky note) on their forehead so others can see it but they cannot. The team gives one-word clues. The guesser has 60 seconds. Rotate through a few players.",
    timeMinutes: 10,
    teamSize: "medium",
    energyLevel: "high",
    category: "game",
  },

  // ── Creative ──────────────────────────────────────────────
  {
    id: "c-1",
    name: "Six-Word Memoir",
    description: "Describe your life (or week) in exactly six words.",
    instructions:
      "Each person crafts a six-word memoir that captures their life, week, or current project experience. Share and discuss. Examples: 'Coffee fueled, deadline met, weekend earned.' Vote on the most creative.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "creative",
  },
  {
    id: "c-2",
    name: "Draw Your Mood",
    description: "Sketch your current mood in 60 seconds and share it.",
    instructions:
      "Everyone has 60 seconds to draw their current mood on paper or a whiteboard. No words allowed. Share your drawings and let the group guess the mood before you explain.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "medium",
    category: "creative",
  },
  {
    id: "c-3",
    name: "Haiku Challenge",
    description: "Write a haiku (5-7-5 syllables) about your work or team.",
    instructions:
      "Each person writes a haiku about their current project, the team, or their work life. Share them aloud. Vote on the most creative, funny, or accurate. Format: 5 syllables, 7 syllables, 5 syllables.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "low",
    category: "creative",
  },
  {
    id: "c-4",
    name: "Team Playlist Curator",
    description: "Collaboratively build a team playlist with one song per person.",
    instructions:
      "Each person suggests one song that represents the team or the current sprint vibe. Compile them into a shared playlist. Optionally listen to 15-second clips of each. Great for team bonding.",
    timeMinutes: 10,
    teamSize: "medium",
    energyLevel: "low",
    category: "creative",
  },
  {
    id: "c-5",
    name: "Alternate Universe Job",
    description: "Describe your dream job in an alternate universe.",
    instructions:
      "Each person describes what they would be doing if they lived in a completely different universe with no constraints. Encourage wild and creative answers. The group votes on the most interesting alternate life.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "creative",
  },
  {
    id: "c-6",
    name: "Team Mascot Design",
    description: "Collaboratively design a mascot for your team in 5 minutes.",
    instructions:
      "As a group, decide on a team mascot. Someone sketches while others call out features (hat, cape, catchphrase). Give it a name and backstory. Display it proudly during the next meeting.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "medium",
    category: "creative",
  },
  {
    id: "c-7",
    name: "Caption This",
    description: "Add a funny caption to a random stock photo.",
    instructions:
      "The facilitator shares a random or absurd stock photo. Everyone has 60 seconds to write a caption in the chat. Read them aloud and vote on the funniest one.",
    timeMinutes: 5,
    teamSize: "large",
    energyLevel: "medium",
    category: "creative",
  },
  {
    id: "c-8",
    name: "Invention Pitch",
    description: "Invent a ridiculous product and pitch it to the group in 30 seconds.",
    instructions:
      "Each person has 30 seconds to pitch a completely made-up product (e.g., 'Self-stirring coffee pants'). Include a name, what it does, and why the world needs it. Vote on the best pitch.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "high",
    category: "creative",
  },
  {
    id: "c-9",
    name: "Meme of the Sprint",
    description: "Create or find a meme that represents the current sprint.",
    instructions:
      "Everyone has 2 minutes to find or create a meme that captures the essence of the current sprint. Share in chat or on screen. Vote on the most accurate meme. Save the winner for the retro.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "medium",
    category: "creative",
  },
  {
    id: "c-10",
    name: "Team Acronym",
    description: "Create a fun acronym from the team or project name.",
    instructions:
      "Take the team name or project name and create a fun backronym (e.g., TEAM = 'Together Everyone Achieves More'). Each person suggests one and the group votes on the official acronym.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "low",
    category: "creative",
  },

  // ── Agile ─────────────────────────────────────────────────
  {
    id: "ag-1",
    name: "Agile Analogy",
    description: "Explain an Agile concept using a non-tech analogy.",
    instructions:
      "Each person picks an Agile concept (sprint, backlog, velocity, etc.) and explains it using a real-world analogy that has nothing to do with software. Examples: 'A sprint is like cooking a meal in 30 minutes.' Vote on the best analogy.",
    timeMinutes: 10,
    teamSize: "medium",
    energyLevel: "medium",
    category: "agile",
  },
  {
    id: "ag-2",
    name: "Sprint Retrospective Warm-Up",
    description: "Rate the last sprint using a weather metaphor before the retro starts.",
    instructions:
      "Each person describes the last sprint as a weather forecast (sunny, partly cloudy, thunderstorms, etc.) and gives a one-sentence reason. This sets the tone before diving into the full retrospective.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "agile",
  },
  {
    id: "ag-3",
    name: "Scrum Values Discussion",
    description: "Pick a Scrum value and share how you demonstrated it recently.",
    instructions:
      "The five Scrum values are: Commitment, Courage, Focus, Openness, and Respect. Each person picks one and shares a specific example of how they or a teammate demonstrated it in the last sprint.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "low",
    category: "agile",
  },
  {
    id: "ag-4",
    name: "User Story Mad Libs",
    description: "Fill in the blanks of a user story template with funny or absurd content.",
    instructions:
      "Use the template: 'As a [role], I want [feature] so that [benefit].' Fill in the blanks with ridiculous content (e.g., 'As a penguin, I want a jetpack so that I can attend standups on time.'). Share and laugh.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "medium",
    category: "agile",
  },
  {
    id: "ag-5",
    name: "Estimate This",
    description: "Story-point everyday objects or activities for practice and fun.",
    instructions:
      "The facilitator names a non-work task (e.g., 'making a sandwich', 'cleaning the garage'). Everyone estimates it in story points simultaneously. Discuss the variation. Great for calibrating estimation skills.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "medium",
    category: "agile",
  },
  {
    id: "ag-6",
    name: "Agile Jargon Bingo",
    description: "Create bingo cards with Agile buzzwords and play during the meeting.",
    instructions:
      "Before the meeting, create or distribute bingo cards with Agile terms (velocity, blocker, increment, etc.). During the meeting, mark off terms as they are used naturally. First to get a row wins. Keeps everyone engaged.",
    timeMinutes: 15,
    teamSize: "large",
    energyLevel: "medium",
    category: "agile",
  },
  {
    id: "ag-7",
    name: "Impediment Improv",
    description: "Brainstorm the most creative (or absurd) ways to solve a real blocker.",
    instructions:
      "Share a real (non-sensitive) impediment the team is facing. For 3 minutes, brainstorm the most creative, impractical, or hilarious solutions. Then discuss: are any of these crazy ideas actually viable?",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "high",
    category: "agile",
  },
  {
    id: "ag-8",
    name: "Definition of Done Debate",
    description: "Debate whether a funny real-world scenario meets its 'Definition of Done'.",
    instructions:
      "Present a scenario (e.g., 'I made my bed but left the decorative pillows off'). The group debates whether this meets the 'Definition of Done.' Relate it back to the importance of clear DoD in your own work.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "medium",
    category: "agile",
  },
  {
    id: "ag-9",
    name: "Kanban Life Board",
    description: "Map your personal to-do list onto a Kanban board and share.",
    instructions:
      "Each person quickly maps their personal (non-work) tasks onto a simple To Do / In Progress / Done board. Share your board. Discuss: are you carrying too much WIP in your personal life too?",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "low",
    category: "agile",
  },
  {
    id: "ag-10",
    name: "Agile Role Reversal",
    description: "Explain what another Agile role does from their perspective for a minute.",
    instructions:
      "Each person picks a different Agile role (Scrum Master, Product Owner, Developer, QA) and explains what a typical day looks like from that perspective. Others rate the accuracy. Builds cross-role empathy.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "medium",
    category: "agile",
  },
  {
    id: "ag-11",
    name: "Sprint Theme Song",
    description: "Pick a song that would be the theme song for the current sprint.",
    instructions:
      "Each person suggests a song that captures the energy of the current sprint (e.g., 'Eye of the Tiger' for a tough sprint, 'Happy' for a smooth one). Share your pick and reasoning. Vote on the official sprint anthem.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "agile",
  },
  {
    id: "ag-12",
    name: "Velocity Prediction Game",
    description: "Predict the team's velocity for the upcoming sprint and discuss reasoning.",
    instructions:
      "Before sprint planning, each person silently writes down their velocity prediction. Reveal simultaneously. Discuss the differences: what assumptions lead to high vs low predictions? Use this to set realistic expectations.",
    timeMinutes: 5,
    teamSize: "small",
    energyLevel: "low",
    category: "agile",
  },
  {
    id: "ag-13",
    name: "Agile Superhero",
    description: "If your team were superheroes, what Agile superpowers would each person have?",
    instructions:
      "Go around the group and assign each person an Agile superpower (e.g., 'The Unblocker', 'Captain Velocity', 'The Scope Shield'). The person being described cannot choose their own. Keep it positive and fun.",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "medium",
    category: "agile",
  },
  {
    id: "ag-14",
    name: "Ceremony Confession",
    description: "Share your honest opinion about which Agile ceremony you secretly enjoy most (or least).",
    instructions:
      "Each person anonymously (or openly) shares which Agile ceremony they find most valuable and which they would skip if they could. Discuss the results. This can surface improvements for how your team runs ceremonies.",
    timeMinutes: 5,
    teamSize: "medium",
    energyLevel: "low",
    category: "agile",
  },
  {
    id: "ag-15",
    name: "Backlog of Life",
    description: "Write three personal user stories for your life outside of work.",
    instructions:
      "Each person writes 2-3 'user stories' for their personal life using the format: 'As a [role], I want [goal] so that [benefit].' Share your favorites. Examples: 'As a home chef, I want to master sourdough so that I can impress my friends.'",
    timeMinutes: 10,
    teamSize: "small",
    energyLevel: "low",
    category: "agile",
  },
];
