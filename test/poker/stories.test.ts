import { describe, it, expect } from "vitest";
import type { Session, Story } from "@/app/(tools)/planning-poker/types";
import { isValidSession } from "@/app/(tools)/planning-poker/types";
import {
  MAX_STORIES,
  STORY_DESCRIPTION_MAX,
  STORY_TITLE_MAX,
  appendStories,
  editStory,
  newStory,
  removeStory,
  restoreStory,
} from "@/app/(tools)/planning-poker/stories";

/**
 * The story-queue updaters behind add, edit and delete: the current story
 * stays current, Undo puts a story back in place, and nothing they produce
 * breaks the session validator guests run on every update.
 */

const story = (id: string, title = `Story ${id}`): Story => ({ id, title, finalEstimate: null });

function session(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: ["1", "2", "3", "5", "8"],
    scaleType: "fibonacci",
    host: "Sam",
    hostId: "host",
    participants: [
      { id: "host", name: "Sam", vote: null },
      { id: "p2", name: "Dev", vote: "3" },
    ],
    stories: [story("a"), story("b"), story("c")],
    currentStoryIdx: 1,
    revealed: false,
    ...overrides,
  };
}

const ids = (s: Session) => s.stories.map((st) => st.id);

describe("newStory / appendStories", () => {
  it("trims and caps to what the validator accepts", () => {
    const st = newStory(
      `  ${"x".repeat(STORY_TITLE_MAX + 20)}  `,
      "y".repeat(STORY_DESCRIPTION_MAX + 5)
    );
    expect(st.title).toHaveLength(STORY_TITLE_MAX);
    expect(st.description).toHaveLength(STORY_DESCRIPTION_MAX);
    expect(st.finalEstimate).toBeNull();
    expect("description" in newStory("Title", "   ")).toBe(false);
  });

  it("adds only as many as the queue still holds", () => {
    const full = session({
      stories: Array.from({ length: MAX_STORIES - 1 }, (_, i) => story(`s${i}`)),
      currentStoryIdx: 0,
    });
    const next = appendStories(full, [story("x"), story("y")]);
    expect(next.stories).toHaveLength(MAX_STORIES);
    expect(next.stories.at(-1)!.id).toBe("x");
    expect(isValidSession(next)).toBe(true);
    expect(appendStories(next, [story("z")])).toBe(next);
  });
});

describe("editStory", () => {
  it("changes the title and description, and removes an emptied description", () => {
    const s = session({ stories: [{ ...story("a"), description: "Old" }, story("b")] });
    const edited = editStory(s, "a", { title: "  Sign in  ", description: "New" });
    expect(edited.stories[0]).toEqual({
      id: "a",
      title: "Sign in",
      description: "New",
      finalEstimate: null,
    });
    const cleared = editStory(edited, "a", { title: "Sign in", description: "" });
    expect("description" in cleared.stories[0]).toBe(false);
    expect(cleared.stories[1]).toBe(s.stories[1]);
  });

  it("ignores an empty title", () => {
    const s = session();
    expect(editStory(s, "a", { title: "   " })).toBe(s);
  });
});

describe("removeStory / restoreStory", () => {
  it("keeps the current story current when an earlier one goes, and Undo restores it in place", () => {
    const s = session();
    const removed = removeStory(s, "a");
    expect(ids(removed)).toEqual(["b", "c"]);
    expect(removed.currentStoryIdx).toBe(0);
    // The round on the current story is untouched.
    expect(removed.participants[1].vote).toBe("3");

    const restored = restoreStory(removed, s.stories[0], 0, false);
    expect(ids(restored)).toEqual(["a", "b", "c"]);
    expect(restored.currentStoryIdx).toBe(1);
  });

  it("leaves the index alone when a later story goes", () => {
    const removed = removeStory(session(), "c");
    expect(ids(removed)).toEqual(["a", "b"]);
    expect(removed.currentStoryIdx).toBe(1);
    expect(restoreStory(removed, story("c"), 2, false).currentStoryIdx).toBe(1);
  });

  it("drops the round with the current story, and Undo makes it current again", () => {
    const s = session({ revealed: true });
    const removed = removeStory(s, "b");
    expect(ids(removed)).toEqual(["a", "c"]);
    expect(removed.currentStoryIdx).toBe(1);
    expect(removed.revealed).toBe(false);
    expect(removed.participants.every((p) => p.vote === null)).toBe(true);

    const restored = restoreStory(removed, s.stories[1], 1, true);
    expect(ids(restored)).toEqual(["a", "b", "c"]);
    expect(restored.currentStoryIdx).toBe(1);
    expect(isValidSession(restored)).toBe(true);
  });

  it("keeps a round that started since the delete on its story", () => {
    const removed = removeStory(session(), "b");
    const voting = {
      ...removed,
      participants: removed.participants.map((p) => ({ ...p, vote: "5" })),
    };
    const restored = restoreStory(voting, story("b"), 1, true);
    expect(ids(restored)).toEqual(["a", "b", "c"]);
    // "c" is still the story being voted on.
    expect(restored.stories[restored.currentStoryIdx].id).toBe("c");
  });

  it("handles the last story, and restores it once only", () => {
    const one = session({ stories: [story("a")], currentStoryIdx: 0 });
    const empty = removeStory(one, "a");
    expect(empty.stories).toEqual([]);
    expect(empty.currentStoryIdx).toBe(0);
    const back = restoreStory(empty, story("a"), 0, true);
    expect(ids(back)).toEqual(["a"]);
    expect(restoreStory(back, story("a"), 0, true)).toBe(back);
    expect(removeStory(back, "missing")).toBe(back);
  });
});
