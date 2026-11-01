/**
 * What the 26 book episodes say, for the transcript under each panel. The book's
 * panel files carry no lettering: the speech and captions are a separate layer of
 * the finished posters, so without this the words wouldn't exist anywhere on the
 * page.
 *
 * Taken once from Agile_At_Work_Building_01_Revised_26_Posters_A2.pdf with pypdf:
 * the balloon font gives the lines, their position gives the panel, and the PDF's
 * own drawing order gives the reading order. Other text at caption size is `signs`.
 * The words are exactly as printed, so don't edit them here. `speaker` isn't in the
 * PDF: it was read by eye from where each balloon's tail points, using the names in
 * the canon's speaking_character_labels_as_recorded, and the portal's review queue
 * can correct one.
 */

import type { DialogueLine } from "./types";

export interface BookPanelText {
  dialogue: readonly DialogueLine[];
  signs: readonly string[];
}

export interface BookEpisodeText {
  /** speaking_character_labels_as_recorded in the canon. */
  cast: readonly string[];
  panels: readonly [BookPanelText, BookPanelText, BookPanelText, BookPanelText];
}

export const BOOK_DIALOGUE: Readonly<Record<number, BookEpisodeText>> = {
  1: {
    cast: ["Amr", "Dinosaur"],
    panels: [
      {
        dialogue: [
          { speaker: "Amr", line: "I tidied the board." },
          { speaker: "Dinosaur", line: "I called everything first." },
        ],
        signs: ["TAP", "REPORT", "POSTER", "FIRST"],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "One job now. Which one?" },
          { speaker: "Dinosaur", line: "The tap." },
        ],
        signs: ["TAP", "REPORT", "POSTER", "FIRST"],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "What can wait?" },
          { speaker: "Dinosaur", line: "The report. The poster." },
        ],
        signs: ["FIRST", "LATER", "TAP", "REPORT", "POSTER"],
      },
      {
        dialogue: [{ speaker: "Dinosaur", line: "Dry socks. Priority one." }],
        signs: ["FIRST", "LATER", "REPORT", "POSTER"],
      },
    ],
  },
  2: {
    cast: ["Camel", "Cat", "Visitor"],
    panels: [
      {
        dialogue: [
          { speaker: "Cat", line: "Big letters. One arrow. Easy!" },
          { speaker: "Camel", line: "Visitors need a sign. I can finish it before lunch." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Cat", line: "Can you squeeze through?" },
          { speaker: "Camel", line: "My nose can. The boxes can’t." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Camel", line: "What can we leave for later?" },
          { speaker: "Cat", line: "The music. The lights. The confetti." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Visitor", line: "Found it!" },
          { speaker: "Cat", line: "And we finished before lunch!" },
        ],
        signs: [],
      },
    ],
  },
  3: {
    cast: ["Beaver", "Rabbit"],
    panels: [
      {
        dialogue: [
          { speaker: "Rabbit", line: "It works!" },
          { speaker: "Beaver", line: "Now try it with the books." },
        ],
        signs: ["12:00"],
      },
      {
        dialogue: [],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Beaver", line: "This wheel wasn’t tight." },
          { speaker: "Rabbit", line: "I should’ve waited for the test." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Rabbit", line: "All four wheels!" },
          { speaker: "Beaver", line: "Let’s deliver the books." },
        ],
        signs: [],
      },
    ],
  },
  4: {
    cast: ["Duck", "Monkey"],
    panels: [
      {
        dialogue: [
          {
            speaker: "Duck",
            line: "I keep stopping work to answer photo questions. Did we send the details?",
          },
          { speaker: "Monkey", line: "No. I haven’t sent the message." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Duck", line: "What do we still need to decide?" },
          { speaker: "Monkey", line: "Nothing. We know when and where." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Duck", line: "Then send one group message." },
          { speaker: "Monkey", line: "Right. I’ll cancel the review meeting." },
        ],
        signs: [],
      },
      {
        dialogue: [],
        signs: [],
      },
    ],
  },
  5: {
    cast: ["Amr", "Ox"],
    panels: [
      {
        dialogue: [
          { speaker: "Amr", line: "It’s been there for three days." },
          { speaker: "Ox", line: "We’re waiting for approval." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Ox", line: "The building manager. Today at two o’clock? Thank you." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "And you’ll make sure it happens?" },
          {
            speaker: "Ox",
            line: "Yes. If nobody comes by two-fifteen, I’ll call the building office.",
          },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Amr", line: "Finally! The books have a home." }],
        signs: ["LATER, AFTER THE WALL CHECK AND APPROVAL"],
      },
    ],
  },
  6: {
    cast: ["Amr", "Camel", "Duck", "Falcon"],
    panels: [
      {
        dialogue: [
          {
            speaker: "Falcon",
            line: "Duck from Analytics is visiting. Let’s make him feel welcome!",
          },
          { speaker: "Falcon", line: "A job for everyone. Every minute full!" },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Duck", line: "Hello! I’m a little early." },
          { speaker: "Falcon", line: "One moment!" },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Camel", line: "Amr could fold more decorations." },
          { speaker: "Falcon", line: "Let’s keep Amr free in case someone needs help." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Duck", line: "My laptop’s out of charge. Is there a charger?" },
          { speaker: "Amr", line: "Here you go." },
        ],
        signs: [],
      },
    ],
  },
  7: {
    cast: ["Beaver", "Monkey", "Ox"],
    panels: [
      {
        dialogue: [
          { speaker: "Monkey", line: "Ox thinks you’re looking after it." },
          { speaker: "Beaver", line: "I’m waiting for Ox to show me." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Ox", line: "I’ll own this job until it’s fixed." }],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Ox", line: "Beaver, can you help me fix it?" },
          { speaker: "Beaver", line: "Yes. Show me the problem." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Ox", line: "It works! Thanks, Beaver." },
          { speaker: "Beaver", line: "Happy to help." },
        ],
        signs: [],
      },
    ],
  },
  8: {
    cast: ["Duck", "Hedgehog"],
    panels: [
      {
        dialogue: [{ speaker: "Hedgehog", line: "Clear floor first. Storage next." }],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Hedgehog", line: "My room’s clear!" },
          { speaker: "Duck", line: "All clear? I can’t get into either room." },
        ],
        signs: [],
      },
      {
        dialogue: [],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Hedgehog", line: "All clear! No climbing required." }],
        signs: [],
      },
    ],
  },
  9: {
    cast: ["Duck", "Hamster"],
    panels: [
      {
        dialogue: [
          { speaker: "Hamster", line: "Music! Lights! Weather reports!" },
          { speaker: "Duck", line: "Which button gives me water?" },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Hamster", line: "I counted the buttons. I never counted the drinks." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Hamster", line: "The water button works. It’s just hard to find." },
          { speaker: "Duck", line: "Then make it easy to find!" },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Duck", line: "Ah! That’s what I needed." }],
        signs: [],
      },
    ],
  },
  10: {
    cast: ["Amr", "Hamster", "Peacock"],
    panels: [
      {
        dialogue: [{ speaker: "Peacock", line: "Sixty cones served!" }],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Hamster", line: "Six people are waiting." }],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "So what should six waiting mean?" },
          { speaker: "Peacock", line: "Six waiting: I open counter two!" },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Peacock", line: "Zero! My smallest number yet!" }],
        signs: [],
      },
    ],
  },
  11: {
    cast: ["Amr", "Hippo", "Mouse"],
    panels: [
      {
        dialogue: [
          { speaker: "Hippo", line: "One size. One order. Easy." },
          { speaker: "Mouse", line: "Can we try it first?" },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Hippo", line: "Can you wave in it?" },
          { speaker: "Mouse", line: "Let me find my hands first." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Hippo", line: "Fair point. Let’s check everyone’s size before we order." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "Ready?" },
          { speaker: "Hippo", line: "Ready." },
          { speaker: "Mouse", line: "Found my hands!" },
        ],
        signs: [],
      },
    ],
  },
  12: {
    cast: ["Chameleon", "Mouse", "Parrot"],
    panels: [
      {
        dialogue: [
          { speaker: "Mouse", line: "I always come after work." },
          { speaker: "Chameleon", line: "We thought nobody needed us after three." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Mouse", line: "Who did you ask?" },
          { speaker: "Parrot", line: "The morning visitors." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Mouse", line: "I’m working then. I can only come at four." },
          { speaker: "Parrot", line: "I missed the afternoon readers." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Chameleon", line: "We’ll stay open till five while we ask them too." },
        ],
        signs: [],
      },
    ],
  },
  13: {
    cast: ["Amr", "Beaver", "Rabbit"],
    panels: [
      {
        dialogue: [{ speaker: "Amr", line: "Right name. Clear photo. Good print." }],
        signs: [],
      },
      {
        dialogue: [],
        signs: ["BZZT"],
      },
      {
        dialogue: [
          { speaker: "Beaver", line: "Access is approved. The card still needs activating." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Rabbit", line: "Made it! We can start." }],
        signs: [],
      },
    ],
  },
  14: {
    cast: ["Amr", "Technical Debt Termite"],
    panels: [
      {
        dialogue: [{ speaker: "Technical Debt Termite", line: "The drainpipe’s cracked!" }],
        signs: ["MONDAY"],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "The new pipe’s here. Shall we fit it?" },
          {
            speaker: "Technical Debt Termite",
            line: "After this poster. The visitors come tomorrow afternoon.",
          },
        ],
        signs: ["TUESDAY MORNING"],
      },
      {
        dialogue: [
          {
            speaker: "Technical Debt Termite",
            line: "I keep putting off the repair to finish this.",
          },
          { speaker: "Amr", line: "Another bucket. We could have fixed the pipe by now." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Amr", line: "Dry!" }],
        signs: [],
      },
    ],
  },
  15: {
    cast: ["Deadline Rabbit", "Experiment Mouse", "Perfectionist Owl"],
    panels: [
      {
        dialogue: [
          { speaker: "Experiment Mouse", line: "Can Rabbit try our new room-booking form?" },
          { speaker: "Perfectionist Owl", line: "After I tidy up the heading." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Deadline Rabbit", line: "It starts at ten. Where do I put twelve?" },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Perfectionist Owl", line: "I left out the end-time box." },
          { speaker: "Deadline Rabbit", line: "Could you add one?" },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Deadline Rabbit", line: "Tomorrow, ten to twelve. Got it." }],
        signs: [],
      },
    ],
  },
  16: {
    cast: ["Amr", "Deadline Rabbit", "Dependable Beaver"],
    panels: [
      {
        dialogue: [
          { speaker: "Deadline Rabbit", line: "Five minutes! I promised music!" },
          { speaker: "Dependable Beaver", line: "We still need music and a mic check." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "Which matters more: music or hearing the talk?" },
          { speaker: "Deadline Rabbit", line: "Music can wait. Let’s check the mic." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Dependable Beaver", line: "The batteries are dead." }],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Dependable Beaver", line: "Testing!" },
          { speaker: "Deadline Rabbit", line: "Now I can hear you!" },
        ],
        signs: [],
      },
    ],
  },
  17: {
    cast: ["Firefighter Fox", "Retrospective Turtle"],
    panels: [
      {
        dialogue: [
          { speaker: "Firefighter Fox", line: "I can’t find the remote!" },
          { speaker: "Retrospective Turtle", line: "Everyone’s waiting for the film." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Firefighter Fox", line: "Found it!" }],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Firefighter Fox", line: "On a chair. Again." },
          { speaker: "Retrospective Turtle", line: "Then let’s give it a home." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Firefighter Fox", line: "Found it!" }],
        signs: ["NEXT MONTH"],
      },
    ],
  },
  18: {
    cast: ["Blame Game Wolf", "Retrospective Turtle", "Rubber Duck Analyst"],
    panels: [
      {
        dialogue: [
          { speaker: "Rubber Duck Analyst", line: "Twenty signed up. Ten cards." },
          { speaker: "Blame Game Wolf", line: "Who packed them?" },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Blame Game Wolf", line: "Copying ten was my mistake." },
          { speaker: "Retrospective Turtle", line: "I should have checked the sign-ups." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Blame Game Wolf", line: "I’ll use each event’s sign-ups." },
          { speaker: "Retrospective Turtle", line: "I’ll match the cards before we open." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Blame Game Wolf", line: "Twenty-four signed up? I’ll print four more." },
          { speaker: "Rubber Duck Analyst", line: "Case reopened. Before opening." },
        ],
        signs: ["NEXT EVENT · BEFORE OPENING"],
      },
    ],
  },
  19: {
    cast: ["Fox", "Monkey", "Turtle"],
    panels: [
      {
        dialogue: [{ speaker: "Monkey", line: "One quick question..." }],
        signs: ["4:55 PM"],
      },
      {
        dialogue: [
          { speaker: "Fox", line: "Third taxi this week." },
          { speaker: "Turtle", line: "And we keep saying ‘next meeting’." },
          { speaker: "Turtle", line: "Today, I’ll finish at 4:50. Even if I’m talking." },
        ],
        signs: ["NEXT MORNING"],
      },
      {
        dialogue: [
          { speaker: "Turtle", line: "This reminds me of something that happened in..." },
          { speaker: "Turtle", line: "That can wait. We’re done." },
          { speaker: "Fox", line: "Really?" },
          { speaker: "Turtle", line: "Really." },
        ],
        signs: ["LATER: DECISIONS MADE"],
      },
      {
        dialogue: [
          { speaker: "Monkey", line: "One quick question..." },
          { speaker: "Monkey", line: "Want one?" },
        ],
        signs: ["5:00 PM"],
      },
    ],
  },
  20: {
    cast: ["Blame Game Wolf", "Data Ghost", "Rubber Duck Analyst"],
    panels: [
      {
        dialogue: [{ speaker: "Data Ghost", line: "It’s just hot water." }],
        signs: ["MONDAY"],
      },
      {
        dialogue: [
          { speaker: "Rubber Duck Analyst", line: "Which requests feed this report?" },
          { speaker: "Blame Game Wolf", line: "Only web forms. Emails never reach it." },
        ],
        signs: [],
      },
      {
        dialogue: [
          {
            speaker: "Blame Game Wolf",
            line: "I’m sorry. I’ve added it. I’ll make sure emailed requests reach the report too.",
          },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Data Ghost", line: "That’s coffee!" }],
        signs: ["THAT AFTERNOON"],
      },
    ],
  },
  21: {
    cast: ["Daughter", "Tired Zombie", "Value Falcon", "Vanity Metrics Peacock"],
    panels: [
      {
        dialogue: [
          { speaker: "Daughter", line: "Dad! Guess what!" },
          { speaker: "Tired Zombie", line: "Sorry, love. I can’t hear you." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Vanity Metrics Peacock", line: "It’s three years old." },
          { speaker: "Value Falcon", line: "The team still needs this every day." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Value Falcon", line: "Just for this call?" },
          { speaker: "Vanity Metrics Peacock", line: "No. It’s our call room now." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Daughter", line: "I got the main part in the school play!" },
          { speaker: "Tired Zombie", line: "You did? Tell me everything." },
        ],
        signs: ["INSIDE THE CALL ROOM"],
      },
    ],
  },
  22: {
    cast: ["Amr", "Chameleon", "Paper character", "Parrot"],
    panels: [
      {
        dialogue: [
          { speaker: "Chameleon", line: "New entry rule. Every guest must show a pass." },
          { speaker: "Amr", line: "I’ve just emailed the passes." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Chameleon", line: "We need printed passes here too." },
          { speaker: "Amr", line: "But we agreed: no paper!" },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Parrot", line: "His phone can’t show the pass." },
          { speaker: "Paper character", line: "Assumption?" },
          {
            speaker: "Amr",
            line: "I thought you were just changing your mind. I should’ve asked why.",
          },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Chameleon", line: "Phone or paper. Same guest list." },
          { speaker: "Amr", line: "I’ll update the invitation." },
        ],
        signs: [],
      },
    ],
  },
  23: {
    cast: ["Amr", "Dinosaur", "Hedgehog", "Spider"],
    panels: [
      {
        dialogue: [
          { speaker: "Spider", line: "We’re falling behind." },
          { speaker: "Dinosaur", line: "I’ll get two more people." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Dinosaur", line: "Why is nothing moving?" },
          { speaker: "Spider", line: "Every request still comes through me." },
        ],
        signs: ["LATER"],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "We can handle routine deliveries and returns." },
          { speaker: "Spider", line: "No need for my approval. Bring me the tricky cases." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Amr", line: "Address updated." },
          { speaker: "Hedgehog", line: "Return arranged." },
        ],
        signs: ["THE SAME TWO HELPERS"],
      },
    ],
  },
  24: {
    cast: ["Dinosaur", "Mouse", "Octopus"],
    panels: [
      {
        dialogue: [
          { speaker: "Mouse", line: "Twenty minutes. Tomorrow, you only get five." },
          { speaker: "Octopus", line: "This presentation day should help." },
        ],
        signs: ["THIS MORNING"],
      },
      {
        dialogue: [
          {
            speaker: "Mouse",
            line: "I asked. No speaking practice. Just software demos all afternoon.",
          },
        ],
        signs: ["LUNCH BREAK"],
      },
      {
        dialogue: [
          { speaker: "Octopus", line: "But we paid for the whole day." },
          { speaker: "Dinosaur", line: "Would staying help your presentation?" },
          { speaker: "Octopus", line: "No." },
        ],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Dinosaur", line: "Come on. We’ll be your audience." },
          { speaker: "Octopus", line: "Let’s go." },
        ],
        signs: [],
      },
    ],
  },
  25: {
    cast: ["Rabbit", "Turtle"],
    panels: [
      {
        dialogue: [{ speaker: "Rabbit", line: "No time! All four at once is faster!" }],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Rabbit", line: "Nearly done! They’re all ninety per cent." },
          { speaker: "Turtle", line: "How many can someone sit on?" },
        ],
        signs: ["8:58 AM"],
      },
      {
        dialogue: [
          { speaker: "Rabbit", line: "Forget four. Finish one!" },
          { speaker: "Turtle", line: "Your parts are ready." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Rabbit", line: "Someone’s sitting!" }],
        signs: ["9:03 AM"],
      },
    ],
  },
  26: {
    cast: ["Camel", "Dinosaur", "Mouse"],
    panels: [
      {
        dialogue: [
          { speaker: "Mouse", line: "The printer’s out of paper." },
          { speaker: "Dinosaur", line: "Good catch, Mouse! You’re in charge of the printer now." },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Camel", line: "Say it, and you’ll end up like Mouse." }],
        signs: [],
      },
      {
        dialogue: [
          { speaker: "Mouse", line: "The printer’s out of paper again." },
          {
            speaker: "Dinosaur",
            line: "You told me. I gave you more work. Thank you, Mouse. I’ll handle the printer.",
          },
        ],
        signs: [],
      },
      {
        dialogue: [{ speaker: "Dinosaur", line: "Any questions? One at a time." }],
        signs: [],
      },
    ],
  },
};
