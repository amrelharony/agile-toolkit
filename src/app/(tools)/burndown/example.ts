import { exampleId } from "@/components/tool-frame/example-data";
import { exampleSprints, type ExampleSprints } from "@/lib/sprints/example";
import { dayDate, todayIso } from "@/lib/sprints/series";
import type { Story, StorySprintChange, StoryStatusChange } from "@/lib/stores/workspace-types";

/**
 * The example Burndown and Burnup preview, in memory only: it is never
 * written to the workspace (fake sprints and stories would feed velocity,
 * the dashboard and agents). Sprint 5 of lib/sprints/example is on day 5 of
 * 14 today, with a short typed daily log (the fallback) and a board:
 *
 *   - 35 points planned in on day 0, the commitment;
 *   - "Save a card at checkout" (8) done on day 2, "Pay with a saved card"
 *     (5) on day 4;
 *   - "Refund flow" (8) added on day 3, "Saved-card analytics" (5) taken
 *     back out on day 4;
 *
 * so today 13 of 38 points are done, 25 left, with 8 added and 5 removed.
 */
export interface BurnExample extends ExampleSprints {
  stories: Story[];
}

export function exampleBurndown(today: string = todayIso()): BurnExample {
  const base = exampleSprints(today);
  const { current } = base;
  // Noon UTC is the same calendar day in nearly every time zone.
  const onDay = (day: number) => `${dayDate(current, day) ?? today}T12:00:00.000Z`;
  const joined = (day: number, points: number): StorySprintChange => ({
    sprintId: current.id,
    at: onDay(day),
    points,
  });
  const moves = (...steps: [StoryStatusChange["status"], number][]): StoryStatusChange[] => {
    let from: StoryStatusChange["status"] = "backlog";
    return steps.map(([status, day]) => {
      const change = { status, from, at: onDay(day) };
      from = status;
      return change;
    });
  };

  const story = (
    key: string,
    title: string,
    points: number,
    fields: Partial<Story> & Pick<Story, "status">
  ): Story => ({
    id: exampleId(`burn-${key}`),
    title,
    points,
    sprintId: current.id,
    createdAt: onDay(0),
    sprintHistory: [joined(0, points)],
    ...fields,
  });

  const stories: Story[] = [
    story("s1", "Save a card at checkout", 8, {
      status: "done",
      owner: "Amira",
      startedAt: onDay(0),
      doneAt: onDay(2),
      statusHistory: moves(["todo", 0], ["in_progress", 0], ["done", 2]),
    }),
    story("s2", "Pay with a saved card", 5, {
      status: "done",
      owner: "Ben",
      startedAt: onDay(1),
      doneAt: onDay(4),
      statusHistory: moves(["todo", 0], ["in_progress", 1], ["done", 4]),
    }),
    story("s3", "Remove a saved card", 5, {
      status: "review",
      owner: "Chloé",
      startedAt: onDay(3),
      statusHistory: moves(["todo", 0], ["in_progress", 3], ["review", 5]),
    }),
    story("s4", "Refund flow", 8, {
      status: "in_progress",
      owner: "Dev",
      startedAt: onDay(3),
      createdAt: onDay(3),
      sprintHistory: [joined(3, 8)],
      statusHistory: moves(["todo", 3], ["in_progress", 3]),
    }),
    story("s5", "Card expiry reminders", 5, {
      status: "todo",
      statusHistory: moves(["todo", 0]),
    }),
    story("s6", "Saved-card analytics", 5, {
      status: "backlog",
      sprintId: undefined,
      sprintHistory: [joined(0, 5), { from: current.id, at: onDay(4), points: 5 }],
      statusHistory: moves(["todo", 0], ["backlog", 4]),
    }),
    story("s7", "Fraud checks on saved cards", 7, {
      status: "todo",
      statusHistory: moves(["todo", 0]),
    }),
  ].map((s) => {
    // A story back in the backlog has no sprint at all.
    if (s.sprintId !== undefined) return s;
    const copy = { ...s };
    delete copy.sprintId;
    return copy;
  });

  return { ...base, stories };
}
