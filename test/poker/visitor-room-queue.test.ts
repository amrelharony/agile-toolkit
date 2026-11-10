import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story as WorkspaceStory } from "@/lib/stores/workspace-types";
import { takeQueuedStories } from "@/lib/handoffs/poker-writeback";
import { pokerQueueRoute, storyQueueSource } from "@/lib/handoffs/targets/poker-queue";
import { isWithinJsonSize } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { STORY_CRITERIA_MAX, STORY_NOTES_MAX } from "@/lib/stories/fields";
import { isValidSession, type Session, type Story } from "@/app/(tools)/planning-poker/types";
import {
  SHORTENED_MARK,
  fitStoriesToVisitorRoom,
  isVisitorRoomSession,
  toVisitorWire,
} from "@/app/(tools)/planning-poker/visitor-session";

/**
 * A queued backlog story brings its notes and acceptance criteria to
 * Planning Poker as one description of up to about 4,000 characters. A
 * visitor live room doesn't send a session over 100,000 JSON characters, so
 * a queue of well-described stories has its descriptions shortened to fit
 * before it joins one. Other sessions keep them whole.
 */

const CODE = "ABCDEFGHJKMN";
const HOST = "hostmember000001";

const room = (stories: Story[] = []): Session => ({
  roomCode: CODE,
  sessionName: "Refinement",
  scale: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
  scaleType: "fibonacci",
  host: "Ana",
  hostId: HOST,
  participants: [{ id: HOST, name: "Ana", vote: null }],
  stories,
  currentStoryIdx: 0,
  revealed: false,
});

/** Lines of text adding up to exactly `length` characters. */
const lines = (length: number, word: string) => {
  const line = `- ${word} `.repeat(6).trim();
  return Array.from({ length: Math.ceil(length / (line.length + 1)) }, () => line)
    .join("\n")
    .slice(0, length);
};

const detailed = (i: number): WorkspaceStory => ({
  id: `st${i}`,
  title: `Story ${i}: ${"a title as long as a backlog story's can be ".repeat(5)}`.slice(0, 200),
  status: "backlog",
  notes: lines(STORY_NOTES_MAX, "note"),
  acceptanceCriteria: lines(STORY_CRITERIA_MAX, "criterion"),
});

/** What the host's browser sends for `session` in a visitor room. */
const envelope = (session: Session) => ({ state: toVisitorWire(session), by: HOST });
const fits = (session: Session) =>
  isWithinJsonSize(envelope(session), VISITOR_LIMITS.maxPayloadChars);

beforeEach(() => {
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [] });
});

/** Queue `n` fully described backlog stories and pull them into a session. */
function queued(n: number) {
  for (let i = 0; i < n; i++) pokerQueueRoute.send(storyQueueSource(detailed(i)));
  return takeQueuedStories();
}

describe("queued stories joining a visitor live room", () => {
  it("still fit the room's size limit when 100 arrive with full notes and criteria", () => {
    const taken = queued(100);
    expect(taken).toHaveLength(100);
    expect(taken[0].description).toHaveLength(STORY_NOTES_MAX + STORY_CRITERIA_MAX + 23);
    // As they are, the room would refuse to send the session at all.
    expect(fits(room(taken))).toBe(false);

    const fitted = fitStoriesToVisitorRoom(room(), taken);
    const session = room(fitted);
    expect(fits(session)).toBe(true);
    expect(isValidSession(session)).toBe(true);
    expect(isVisitorRoomSession(session, CODE)).toBe(true);
    // Every story is there, each with the start of its text and a line
    // saying the rest was left out.
    expect(fitted.map((st) => [st.id, st.title])).toEqual(taken.map((st) => [st.id, st.title]));
    for (const st of fitted) {
      expect(st.description?.startsWith("- note - note")).toBe(true);
      expect(st.description?.endsWith(`\n${SHORTENED_MARK}`)).toBe(true);
    }
  });

  it("leaves room for the estimates and votes of a whole session", () => {
    const fitted = fitStoriesToVisitorRoom(room(), queued(100));
    // Every story estimated after two rounds of twenty voters, and a full room.
    const played = room(
      fitted.map((st) => ({
        ...st,
        finalEstimate: "13",
        rounds: [Array<string>(20).fill("13"), Array<string>(20).fill("21")],
      }))
    );
    played.participants = Array.from({ length: VISITOR_LIMITS.maxMembers }, (_, i) => ({
      id: `member${String(i).padStart(10, "0")}`,
      name: "A name of thirty characters ok",
      vote: "13",
    }));
    expect(fits(played)).toBe(true);
  });

  it("keeps a small queue's descriptions whole", () => {
    const taken = queued(10);
    const fitted = fitStoriesToVisitorRoom(room(), taken);
    // Nothing to change: the same stories, not copies.
    expect(fitted).toBe(taken);
    expect(fits(room(fitted))).toBe(true);
  });

  it("shares the room between the long descriptions and keeps the short ones whole", () => {
    const long = (id: string): Story => ({
      id,
      title: id,
      description: lines(4_000, "criterion"),
      finalEstimate: null,
    });
    const short: Story = {
      id: "short",
      title: "short",
      description: "Two lines.\nOnly.",
      finalEstimate: null,
    };
    const none: Story = { id: "none", title: "none", finalEstimate: null };
    const fitted = fitStoriesToVisitorRoom(room(), [long("a"), short, none, long("b")], 12_000);
    const [a, kept, bare, b] = fitted;
    expect(kept).toBe(short);
    expect(bare).toBe(none);
    expect(a.description).toHaveLength(b.description!.length);
    expect(a.description!.length).toBeGreaterThan(1_500);
    expect(a.description!.length).toBeLessThan(4_000);
    expect(a.description?.endsWith(SHORTENED_MARK)).toBe(true);
    expect(isWithinJsonSize({ state: room(fitted), by: HOST }, 12_000)).toBe(true);
  });

  it("counts what the session already holds, and drops a description left too little room", () => {
    const held: Story = {
      id: "typed",
      title: "Typed here",
      description: "x".repeat(5_000),
      finalEstimate: null,
    };
    const added: Story[] = [
      { id: "q1", title: "Queued", description: lines(3_000, "note"), finalEstimate: null },
    ];
    // The host's own story takes nearly all of it.
    const fitted = fitStoriesToVisitorRoom(room([held]), added, 10_000);
    expect(fitted[0]).toEqual({ id: "q1", title: "Queued", finalEstimate: null });
    expect("description" in fitted[0]).toBe(false);
    // The story already in the session is never touched.
    expect(held.description).toHaveLength(5_000);
  });

  it("never cuts through a line break's escape or half an emoji", () => {
    const text = "✅ done when\n".repeat(400);
    const story: Story = { id: "e", title: "Emoji", description: text, finalEstimate: null };
    for (const max of [6_000, 6_001, 6_002, 6_003]) {
      const [fitted] = fitStoriesToVisitorRoom(room(), [story], max);
      const cut = fitted.description!;
      expect(cut.endsWith(`\n${SHORTENED_MARK}`)).toBe(true);
      // Valid text on the wire: it survives a round trip unchanged.
      expect(JSON.parse(JSON.stringify(cut))).toBe(cut);
      expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(cut)).toBe(false);
      expect(isWithinJsonSize({ state: room([fitted]), by: HOST }, max)).toBe(true);
    }
  });
});
