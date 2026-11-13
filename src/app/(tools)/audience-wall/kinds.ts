/**
 * Audience Wall's five kinds of wall, as the live room runs them: the
 * prompt they start with, whether posts show as they arrive or stay hidden
 * until Reveal, and what the room adds (Answered, "Yes, and…", 25/10).
 * Plus a few starter prompts per kind, in our own words.
 */

import type { WallMode } from "@/lib/realtime/wall-room/protocol";
import type { WallRoundOptions } from "@/lib/realtime/wall-room/host";
import type { WallKind } from "@/lib/audience-wall/model";

export interface WallKindSetup {
  /** The prompt the room opens with. */
  prompt: string;
  /** "hidden": nobody sees a post until Reveal, so the first answers don't steer the rest. */
  mode: WallMode;
  roundOptions?: WallRoundOptions;
  /** The host marks questions answered. */
  answerable: boolean;
  /** The start button's words. */
  startLabel: string;
  /** Starter prompts to pick from. */
  starters: readonly string[];
}

export const WALL_KIND_SETUP: Record<WallKind, WallKindSetup> = {
  answers: {
    prompt: "What would make this session a ten for you?",
    mode: "hidden",
    answerable: false,
    startLabel: "Open a live wall",
    starters: [
      "What would make this session a ten for you?",
      "In one word, how is the sprint going?",
      "What should we stop doing?",
      "What surprised you in the demo?",
    ],
  },
  questions: {
    prompt: "What do you want to ask?",
    mode: "live",
    answerable: true,
    startLabel: "Open live questions",
    starters: [
      "What do you want to ask?",
      "What's still unclear about the plan?",
      "What should we cover in the next review?",
    ],
  },
  hands: {
    prompt: "Raise your hand to speak",
    mode: "live",
    // A queue to speak: phones show Raise my hand, not a post box.
    roundOptions: { takePosts: false },
    answerable: false,
    startLabel: "Open a raise-hand queue",
    starters: ["Raise your hand to speak", "Raise your hand for the open floor"],
  },
  brainwriting: {
    prompt: "How might we make onboarding faster?",
    mode: "live",
    roundOptions: { build: true },
    answerable: false,
    startLabel: "Open a brainwriting wall",
    starters: [
      "How might we make onboarding faster?",
      "How might we cut the time a fix waits for review?",
      "What could we try next sprint?",
    ],
  },
  crowd: {
    prompt: "What's the boldest thing we could do this quarter?",
    mode: "hidden",
    answerable: false,
    startLabel: "Open a 25/10 wall",
    starters: [
      "What's the boldest thing we could do this quarter?",
      "If you were in charge for a week, what would you change first?",
      "What one change would help our customers most?",
    ],
  },
};

/** What the host does next in each kind, in one line under the start button. */
export const WALL_KIND_HOW: Record<WallKind, string> = {
  answers:
    "People post short answers from their phones. Keep them hidden until everyone has written, then reveal them and switch to the word cloud.",
  questions:
    "People post questions and upvote others' as they go. Take the most wanted first and mark each one answered.",
  hands:
    "People raise a hand from their phone and join the queue. Call on the first in line, then lower their hand. The wall takes no posts until you press Take posts again.",
  brainwriting:
    "Everyone writes ideas, then builds on each other's with Yes, and…. The replies show under the post they build on.",
  crowd:
    "Each person writes one bold idea. When the wall is full, start the scoring: everyone scores five posts from 1 to 5, then show the top ten.",
};
