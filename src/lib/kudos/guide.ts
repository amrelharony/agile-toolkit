/**
 * The printed Scrum Master guide's words, as the Kudos page's "How kudos
 * cards work" section shows them. Kept here, not in the component, so the
 * page and anything else that quotes the guide say the same thing.
 *
 * Pure, and free of client modules: the MCP server may read it too.
 */

import { printTheme, type PrintThemeName } from "@/lib/comics/print-themes";

export interface GuideColour {
  /** The colour's name as the guide prints it: "Teal". */
  colour: string;
  habit: PrintThemeName;
  /** What a card of this colour thanks. */
  thanks: string;
  /** The printed fill and the ink on it, as on the cards. */
  fill: string;
  ink: string;
}

function row(colour: string, habit: PrintThemeName, thanks: string): GuideColour {
  const theme = printTheme(habit);
  return { colour, habit, thanks, fill: theme.colour, ink: theme.ink };
}

export const KUDOS_GUIDE = {
  title: "How kudos cards work",
  intro: "Saw someone do something the book talks about? Say thank you.",
  give: {
    heading: "How to give one",
    steps: [
      "Pick the card that matches what they did. The colour shows the theme. If nothing matches, use a “Thank you!” or “Great teamwork!” card.",
      "On the back, write who it is for and exactly what they did. One sentence is enough, for example: “You told the customer about the delay on Monday, not on Friday.”",
      "Sign it, then give it in person or pin it on the kudos wall.",
    ],
    /** What Send kudos does on this site: the owner's room, or a visitor's link. */
    online: {
      owner: "Online, Send kudos pins it on your squad's wall.",
      visitor: "Online, Send kudos gives you a link and an image to pass on.",
    },
  },
  scrumMasters: {
    heading: "For Scrum Masters",
    tips: [
      "Keep a stack at every retro and next to the kudos wall.",
      "Anyone can give a card to anyone, including their manager.",
      "Thank what the person did, not who they are. “You asked what could wait” means more than “You’re great.”",
      "In each retro, take five minutes to read out the week’s kudos.",
      "Don’t count or rank kudos. They are thanks, not a scoreboard, and they never feed into performance reviews.",
      "Restock the cards your team gives most.",
    ],
  },
  colours: {
    heading: "The four colours",
    columns: ["Colour", "Theme", "What it thanks"] as const,
    rows: [
      row("Teal", "Focus", "Choosing priorities, leaving room, finishing before starting"),
      row("Coral", "Ownership", "Seeing work through, fixing causes, owning mistakes"),
      row("Blue", "Real needs", "Testing with real people and checking that the work helped"),
      row("Mustard", "Trust", "Sharing decisions, asking why, letting others decide, speaking up"),
    ] as readonly GuideColour[],
  },
  book: "Every card names an episode. The book is the full story. Borrow it from your Scrum Master.",
  privacy: "First names and general thanks only. No customer names or internal details.",
} as const;
