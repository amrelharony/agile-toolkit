import type { PromptDefinition } from "./types";
import { sanitizePromptCell, wrapUserContent } from "./prompt-utils";

/**
 * Copyable prompts for Team Mixer: what the groups could do once they're
 * mixed. They carry the shape of the session (how many groups, how big,
 * how many rounds, what it's for) and never a name: nobody's place in a
 * group goes to an AI.
 */
export interface TeamMixerPromptInput {
  mode: "groups" | "pairs" | "cafe";
  /** People in the mix. */
  people: number;
  /** Groups or pairs in the newest round, or café tables. */
  groups: number;
  /** World Café rounds. */
  rounds?: number;
  /** What the groups are for, as the facilitator typed it. */
  title?: string;
}

export function generateTeamMixerPrompts(input: TeamMixerPromptInput): PromptDefinition[] {
  if (input.people < 2) return [];
  const purpose = input.title?.trim()
    ? `The session is about:\n${wrapUserContent(sanitizePromptCell(input.title, 200))}\n`
    : "The facilitator hasn't said what the session is about; ask one question about it first if you need to.\n";
  const coach =
    "You are an experienced agile coach and workshop facilitator. Plain words, short steps, no jargon.\n\n";
  const size = input.groups > 0 ? Math.round(input.people / input.groups) : input.people;

  if (input.mode === "cafe") {
    const rounds = input.rounds ?? 3;
    return [
      {
        id: "team-mixer-cafe-questions",
        title: "World Café questions",
        description: "One question per round, each building on the last, and what hosts capture.",
        prompt:
          coach +
          `We are running a World Café: ${input.people} people at ${input.groups} tables, ${rounds} rounds of about 20 minutes. Table hosts stay; everyone else moves to a new table each round.\n` +
          purpose +
          `\nSuggest:\n1. One question per round (${rounds} in all), each going deeper than the one before.\n` +
          "2. What each host should say in one minute to welcome a new group.\n" +
          "3. What hosts should capture on paper, and how to share it with everyone at the end in 10 minutes.",
      },
    ];
  }

  if (input.mode === "pairs") {
    return [
      {
        id: "team-mixer-pair-starters",
        title: "Conversation starters for pairs",
        description: "Starters for coffee chats or a pair rotation, light to deeper.",
        prompt:
          coach +
          `We pair ${input.people} colleagues for 15-minute conversations (${input.groups} pairs), with new partners every round.\n` +
          purpose +
          "\nSuggest 10 conversation starters, from light to deeper, that help people who don't usually work together find out how they could help each other. None should ask for anything private.",
      },
    ];
  }

  return [
    {
      id: "team-mixer-breakout",
      title: "Breakout activity",
      description: "A timed activity for the groups, with a short report back.",
      prompt:
        coach +
        `We split ${input.people} people into ${input.groups} groups of about ${size}.\n` +
        purpose +
        "\nDesign a 20-minute breakout:\n1. A one-line goal for every group.\n2. Three questions each group works through, with minutes for each.\n3. How each group reports back in 1 minute, and how to spot themes across groups.",
    },
  ];
}
