/**
 * Audience Wall's example: three walls a Scrum Master might have saved in a
 * week (questions at a town hall, the Perfection Game's "what would make it
 * a ten" after a retro, a 25/10 round on bold ideas). Ids start with
 * "example-", so Clear example removes exactly these, and nothing from
 * them is ever sent to the backlog.
 */

import { exampleId } from "@/lib/utils/example-id";
import { normalizeSession, type WallSession } from "@/lib/audience-wall/model";

const DAY = 24 * 60 * 60 * 1000;

/** The example walls, dated from `now` back. */
export function buildExample(now = new Date()): WallSession[] {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString();
  const walls: unknown[] = [
    {
      id: exampleId("wall-townhall"),
      kind: "questions",
      prompt: "What do you want to ask about the new release train?",
      savedAt: at(1),
      source: "room",
      posts: [
        { id: "p1", text: "Do we still get a hotfix lane between releases?", votes: 9, merged: [] },
        {
          id: "p2",
          text: "Who decides what makes the train if two teams clash?",
          votes: 7,
          merged: ["Who breaks a tie between teams?"],
        },
        { id: "p3", text: "Will the demo day move with it?", votes: 4, merged: [] },
        { id: "p4", text: "How long is a release frozen before it ships?", votes: 3, merged: [] },
        {
          id: "p5",
          text: "Can we see the calendar for the next three trains?",
          votes: 2,
          merged: [],
          answered: true,
        },
      ],
      themes: [],
      sent: [],
    },
    {
      id: exampleId("wall-ten"),
      kind: "answers",
      prompt: "What would make our retros a ten?",
      savedAt: at(3),
      source: "room",
      posts: [
        { id: "p1", text: "Actions with an owner and a date", votes: 6, merged: [] },
        { id: "p2", text: "Check last retro's actions first", votes: 5, merged: [] },
        { id: "p3", text: "A new format now and then", votes: 4, merged: [] },
        { id: "p4", text: "Fewer actions, but ones we finish", votes: 4, merged: [] },
        { id: "p5", text: "Start on time, end on time", votes: 3, merged: [] },
        { id: "p6", text: "Everyone writes before anyone talks", votes: 3, merged: [] },
        { id: "p7", text: "Owners for actions picked in the room", votes: 2, merged: [] },
      ],
      themes: [
        { name: "Follow through on actions", postIds: ["p1", "p2", "p4", "p7"] },
        { name: "Keep the format fresh", postIds: ["p3", "p6"] },
      ],
      sent: [],
    },
    {
      id: exampleId("wall-crowd"),
      kind: "crowd",
      prompt: "What's the boldest thing we could do this quarter?",
      savedAt: at(5),
      source: "room",
      posts: [
        {
          id: "p1",
          text: "Ship to production every day",
          votes: 0,
          merged: [],
          score: 22,
          scorers: 5,
        },
        {
          id: "p2",
          text: "Spend a sprint with our support team",
          votes: 0,
          merged: [],
          score: 21,
          scorers: 5,
        },
        {
          id: "p3",
          text: "Delete the five least used features",
          votes: 0,
          merged: [],
          score: 17,
          scorers: 5,
        },
        {
          id: "p4",
          text: "Pair with a customer for a week",
          votes: 0,
          merged: [],
          score: 16,
          scorers: 4,
        },
        {
          id: "p5",
          text: "No meetings on Wednesdays",
          votes: 0,
          merged: [],
          score: 14,
          scorers: 5,
        },
        {
          id: "p6",
          text: "Rewrite the billing service",
          votes: 0,
          merged: [],
          score: 9,
          scorers: 4,
        },
      ],
      themes: [],
      sent: [],
    },
  ];
  return walls.map(normalizeSession).filter((s): s is WallSession => s !== null);
}
