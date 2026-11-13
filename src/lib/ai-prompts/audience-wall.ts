import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import {
  WALL_KIND_LABEL,
  rankedPosts,
  type WallSession,
  type WallSessionPost,
} from "../audience-wall/model";

/**
 * Copyable prompts for the newest saved wall (the AI Prompts drawer): read
 * the room's answers, plan the answers to its questions, or turn its
 * feedback into backlog items. The posts are anonymous; at most 60 go in,
 * the most upvoted (or best scored) first, and a cut list says so.
 */

const MAX_POSTS = 60;

function postLine(p: WallSessionPost): string {
  const score = p.scorers ? `, average ${Math.round(((p.score ?? 0) / p.scorers) * 10) / 10}` : "";
  const answered = p.answered ? ", answered" : "";
  return `- ${sanitizePromptCell(p.text, 280)} (${p.votes} ${p.votes === 1 ? "vote" : "votes"}${score}${answered})`;
}

export function generateAudienceWallPrompts(sessions: readonly WallSession[]): PromptDefinition[] {
  const wall = sessions[0];
  if (!wall || wall.posts.length === 0) return [];
  const ranked = rankedPosts(wall);
  const shown = ranked.slice(0, MAX_POSTS);
  const cut =
    ranked.length > shown.length ? `\n(${ranked.length - shown.length} more posts left out.)` : "";
  const data = wrapUserContent(
    `Question: ${sanitizePromptCell(wall.prompt, 280)}\nKind: ${WALL_KIND_LABEL[wall.kind]}\n\nPosts:\n${shown
      .map(postLine)
      .join("\n")}${cut}`
  );
  const preamble = buildPreamble(
    "Audience Wall",
    "It holds anonymous answers a room posted to one question, with their upvotes."
  );
  return [
    {
      id: "audience-wall-read",
      title: "What the room is saying",
      description: "The themes in the answers, and what to do about them.",
      prompt:
        preamble +
        `${data}\n\n## Questions\n\n` +
        "1. Group the posts into three to six themes, each with a plain name and the posts in it.\n" +
        "2. Which theme carries the most weight, counting the upvotes?\n" +
        "3. What would you ask the room next to go deeper on it?\n" +
        "4. Suggest one small experiment the team could try next sprint.",
    },
    {
      id: "audience-wall-answer-plan",
      title: "Plan the answers",
      description: "An order to take the questions in, and who should answer each.",
      prompt:
        preamble +
        `${data}\n\n## Questions\n\n` +
        "1. Merge questions that ask the same thing, and say which you merged.\n" +
        "2. Put the rest in the order to answer them, most wanted first, skipping the answered ones.\n" +
        "3. For each, name the role best placed to answer it (Product Owner, Scrum Master, developers, a stakeholder).\n" +
        "4. Which questions point to a gap the team should fix rather than answer?",
    },
    {
      id: "audience-wall-backlog",
      title: "Feedback to backlog items",
      description: "Backlog items from the feedback most worth acting on.",
      prompt:
        preamble +
        `${data}\n\n## Questions\n\n` +
        "1. Write up to ten backlog items for the feedback most worth acting on, each with a short title and one or two sentences on the need behind it.\n" +
        "2. Leave out praise that asks for nothing, and say what you left out.\n" +
        "3. Which item would you put first, and why?",
    },
  ];
}
