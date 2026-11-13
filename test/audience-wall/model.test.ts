// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  WALL_POSTS_MAX,
  WALL_SESSIONS_MAX,
  mergeSessionPosts,
  normalizeSession,
  normalizeWallData,
  rankedPosts,
  sentKey,
  sessionFromDraft,
  sessionFromResult,
  topTen,
  unmergeSessionPosts,
  validateWallDraft,
  withThemes,
  type WallSession,
} from "@/lib/audience-wall/model";
import { duplicateGroups, keywordGroups, postWords, wordCloud } from "@/lib/audience-wall/words";
import { sessionMarkdown, wallsMarkdown } from "@/lib/audience-wall/markdown";

/**
 * Audience Wall's pure logic: saved walls rebuilt field by field (anonymous
 * by construction), a live result and a typed draft turned into walls,
 * merges and themes on a saved wall, the word cloud and the keyword and
 * duplicate fallbacks, and the Markdown.
 */

const AT = "2026-11-12T10:00:00.000Z";

function wall(over: Partial<WallSession> = {}): WallSession {
  return {
    id: "wall_one",
    kind: "questions",
    prompt: "What should we ask the CTO?",
    savedAt: AT,
    source: "room",
    posts: [
      { id: "p1", text: "When is the next release?", votes: 4, merged: [] },
      { id: "p2", text: "When do we release next?", votes: 1, merged: [] },
      { id: "p3", text: "Who owns onboarding?", votes: 2, merged: [], answered: true },
    ],
    themes: [],
    sent: [],
    ...over,
  };
}

describe("reading saved walls back", () => {
  it("keeps a clean wall as it is", () => {
    expect(normalizeSession(wall())).toEqual(wall());
  });

  it("drops what can't be a wall, a post, a link or a theme", () => {
    expect(normalizeSession({ ...wall(), prompt: "  " })).toBeNull();
    expect(normalizeSession({ ...wall(), savedAt: "yesterday" })).toBeNull();
    const messy = normalizeSession({
      ...wall(),
      kind: "nonsense",
      author: "Alex",
      posts: [
        { id: "p1", text: "Fine", votes: -3, merged: ["x", 7], memberId: "alice" },
        { id: "p1", text: "Same id", votes: 0, merged: [] },
        { id: "bad id!", text: "Bad id", votes: 0, merged: [] },
        { id: "p2", text: "‮hidden\u0007", votes: 1e9, merged: [], re: "p9" },
      ],
      themes: [
        { name: "Mine", postIds: ["p1", "p9"] },
        { name: "", postIds: ["p2"] },
      ],
      sent: [{ key: "k", title: "T", sentTo: [{ route: "backlog-story" }] }],
    })!;
    expect(messy.kind).toBe("answers");
    expect(messy.posts).toEqual([
      { id: "p1", text: "Fine", votes: 0, merged: ["x"] },
      { id: "p2", text: "hidden", votes: 100_000, merged: [] },
    ]);
    expect(JSON.stringify(messy)).not.toContain("alice");
    expect(JSON.stringify(messy)).not.toContain("Alex");
    expect(messy.themes).toEqual([{ name: "Mine", postIds: ["p1"] }]);
    expect(messy.sent).toEqual([{ key: "k", title: "T", sentTo: [] }]);
  });

  it("keeps each wall once, newest first, at most a hundred", () => {
    const many = Array.from({ length: WALL_SESSIONS_MAX + 5 }, (_, i) =>
      wall({ id: `wall_${i}`, savedAt: new Date(Date.parse(AT) + i * 60_000).toISOString() })
    );
    const data = normalizeWallData({ sessions: [...many, many[0]] });
    expect(data.sessions).toHaveLength(WALL_SESSIONS_MAX);
    expect(data.sessions[0].id).toBe(`wall_${WALL_SESSIONS_MAX + 4}`);
    expect(normalizeWallData(null)).toEqual({ sessions: [] });
  });
});

describe("making a wall", () => {
  it("saves a live result with its own post ids, links kept by place", () => {
    const s = sessionFromResult(
      {
        prompt: "Ideas for onboarding",
        posts: [
          { text: "A buddy", votes: 2, merged: [] },
          { text: "and a checklist", votes: 0, merged: [], re: 0 },
          { text: "Pair on day one", votes: 1, merged: ["Pairing first"], re: 7 },
        ],
      },
      "brainwriting",
      { id: "wall_b", savedAt: AT }
    );
    expect(s.posts).toEqual([
      { id: "p1", text: "A buddy", votes: 2, merged: [] },
      { id: "p2", text: "and a checklist", votes: 0, merged: [], re: "p1" },
      { id: "p3", text: "Pair on day one", votes: 1, merged: ["Pairing first"] },
    ]);
    expect(s).toMatchObject({ kind: "brainwriting", source: "room" });
  });

  it("checks a typed draft: a question, one post per line, within the caps", () => {
    expect(validateWallDraft({ prompt: "", posts: "" })).toEqual({
      prompt: "Write the question you asked.",
      posts: "Add at least one answer, one per line.",
    });
    expect(validateWallDraft({ prompt: "Q", posts: "x".repeat(281) }).posts).toMatch(/280/);
    const tooMany = Array.from({ length: WALL_POSTS_MAX + 1 }, (_, i) => `p${i}`).join("\n");
    expect(validateWallDraft({ prompt: "Q", posts: tooMany }).posts).toMatch(/200/);
    const s = sessionFromDraft(
      { prompt: " Stop or keep? ", posts: "Stop the standup\n\n  Keep demos  " },
      "answers",
      { id: "wall_d", savedAt: AT }
    )!;
    expect(s).toMatchObject({ prompt: "Stop or keep?", source: "manual" });
    expect(s.posts.map((p) => p.text)).toEqual(["Stop the standup", "Keep demos"]);
    expect(sessionFromDraft({ prompt: "", posts: "x" }, "answers", { id: "w", savedAt: AT })).toBe(
      null
    );
  });
});

describe("a saved wall's views and changes", () => {
  it("ranks by upvotes with answered questions last, or by average score for 25/10", () => {
    expect(rankedPosts(wall()).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    const crowd = wall({
      kind: "crowd",
      posts: [
        { id: "p1", text: "A", votes: 0, merged: [], score: 9, scorers: 3 },
        { id: "p2", text: "B", votes: 0, merged: [], score: 5, scorers: 1 },
        { id: "p3", text: "C", votes: 0, merged: [], score: 0, scorers: 0 },
      ],
    });
    expect(rankedPosts(crowd).map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
    expect(topTen(crowd).map((p) => p.id)).toEqual(["p2", "p1"]);
  });

  it("merges a duplicate into another: texts, votes, links and themes follow", () => {
    const s = wall({
      posts: [
        ...wall().posts,
        { id: "p4", text: "and when after that?", votes: 0, merged: [], re: "p2" },
      ],
      themes: [{ name: "Releases", postIds: ["p2", "p1"] }],
    });
    const merged = mergeSessionPosts(s, "p2", "p1");
    expect(merged.posts.map((p) => p.id)).toEqual(["p1", "p3", "p4"]);
    expect(merged.posts[0]).toMatchObject({ votes: 5, merged: ["When do we release next?"] });
    expect(merged.posts[2].re).toBe("p1");
    expect(merged.themes).toEqual([{ name: "Releases", postIds: ["p1"] }]);
    expect(mergeSessionPosts(s, "p1", "p1")).toBe(s);
    expect(mergeSessionPosts(s, "p9", "p1")).toBe(s);
  });

  it("puts each post in one theme at most", () => {
    const s = withThemes(wall(), [
      { name: "Releases", postIds: ["p1", "p2"] },
      { name: "Again", postIds: ["p2"] },
    ]);
    expect(s.themes).toEqual([{ name: "Releases", postIds: ["p1", "p2"] }]);
  });

  it("makes a stable key of a title, in any script, one per item", () => {
    expect(sentKey("Fix the flaky build!")).toMatch(/^fix-the-flaky-build-[0-9a-z]{7}$/);
    expect(sentKey("Fix the flaky build!")).toBe(sentKey("Fix the flaky build!"));
    // Two Arabic items and a Cyrillic one: three keys, none of them a lossy "item".
    const keys = [
      sentKey("تسهيل العثور على كود الخصم"),
      sentKey("توضيح رسائل خطأ البطاقة"),
      sentKey("Ускорить проверку"),
    ];
    expect(new Set(keys).size).toBe(3);
    expect(keys[0].startsWith("تسهيل-العثور")).toBe(true);
    // Case and punctuation alone make the same item, on purpose: sent once.
    expect(sentKey("Fix CI")).toBe(sentKey("fix CI!"));
    expect(sentKey("Fix CI")).not.toBe(sentKey("Fix CD"));
    // No letter at all: still one key per title, and every key fits the stored cap.
    expect(sentKey("¿?")).not.toBe(sentKey("!!"));
    expect(sentKey("ж".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("undoes one merge only: later merges, themes and sent items stay", () => {
    const s = wall({
      posts: [
        { id: "p1", text: "When is the next release?", votes: 4, merged: [] },
        { id: "p2", text: "When do we release next?", votes: 1, merged: ["Release date?"] },
        { id: "p3", text: "Who owns onboarding?", votes: 2, merged: [], answered: true },
        { id: "p4", text: "Who runs onboarding?", votes: 3, merged: [] },
        { id: "p5", text: "and the date after that?", votes: 0, merged: [], re: "p2" },
      ],
      themes: [{ id: "t_rel", name: "Releases", postIds: ["p2"] }],
    });
    const before1 = s;
    const one = mergeSessionPosts(s, "p2", "p1");
    const before2 = one;
    const two = mergeSessionPosts(one, "p4", "p3");
    // Something else changed after both: an item went to the backlog.
    const later: WallSession = {
      ...two,
      sent: [{ key: "k", title: "Pick a release date", sentTo: [] }],
    };
    const undone = unmergeSessionPosts(later, before1, "p1", ["p2"]);
    expect(undone.posts.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p5"]);
    expect(undone.posts[0]).toMatchObject({ votes: 4, merged: [] });
    expect(undone.posts[0].answered).toBeUndefined();
    expect(undone.posts[1]).toMatchObject({ votes: 1, merged: ["Release date?"] });
    expect(undone.posts[3].re).toBe("p2");
    expect(undone.themes).toEqual([{ id: "t_rel", name: "Releases", postIds: ["p2"] }]);
    // The second merge and the sent item are still there.
    expect(undone.posts[2]).toMatchObject({ votes: 5, merged: ["Who runs onboarding?"] });
    expect(undone.sent).toHaveLength(1);
    // Then the second one's Undo: the first stays undone.
    const both = unmergeSessionPosts(undone, before2, "p3", ["p4"]);
    expect(both.posts.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(both.posts[2]).toMatchObject({ votes: 2, merged: [], answered: true });
    expect(both.posts[3]).toMatchObject({ votes: 3, merged: [] });
    // Nothing to put back, or the kept post merged on since: unchanged.
    expect(unmergeSessionPosts(both, before2, "p3", ["p4"])).toBe(both);
    const gone = mergeSessionPosts(two, "p1", "p3");
    expect(unmergeSessionPosts(gone, before1, "p1", ["p2"])).toBe(gone);
  });

  it("keeps a theme's id, once each, so Undo can take back that theme alone", () => {
    const s = withThemes(wall(), [
      { id: "t_a", name: "Releases", postIds: ["p1"] },
      { id: "t_a", name: "Releases", postIds: ["p2"] },
      { id: "bad id!", name: "Owners", postIds: ["p3"] },
    ]);
    expect(s.themes).toEqual([
      { id: "t_a", name: "Releases", postIds: ["p1"] },
      { name: "Releases", postIds: ["p2"] },
      { name: "Owners", postIds: ["p3"] },
    ]);
  });
});

describe("words without AI", () => {
  const posts = [
    { id: "a", text: "Code reviews take too long" },
    { id: "b", text: "Waiting on reviews again" },
    { id: "c", text: "I think the tests are flaky" },
    { id: "d", text: "Flaky tests block the deploy" },
    { id: "e", text: "More pairing please" },
  ];

  it("drops the wall's filler words", () => {
    expect(postWords("I think maybe the tests would pass")).toEqual(["tests", "pass"]);
  });

  it("counts each word once per post for the cloud, biggest first", () => {
    const cloud = wordCloud(posts.map((p) => p.text));
    expect(cloud.slice(0, 3).map((w) => [w.word, w.count])).toEqual([
      ["flaky", 2],
      ["reviews", 2],
      ["tests", 2],
    ]);
    expect(cloud.every((w) => w.count > 1)).toBe(true);
    expect(cloud[0].weight).toBe(3);
    // Nothing repeats: every word shows ("one" and "answer" are filler).
    expect(wordCloud(["One lonely reply about deploys"]).map((w) => w.word)).toEqual([
      "deploys",
      "lonely",
      "reply",
    ]);
    expect(wordCloud([])).toEqual([]);
  });

  it("groups posts that share a word", () => {
    const groups = keywordGroups(posts);
    expect(groups.map((g) => g.name)).toEqual(expect.arrayContaining(["Reviews"]));
    const ids = groups.flatMap((g) => g.postIds);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds duplicate questions, keeping the most upvoted", () => {
    expect(
      duplicateGroups([
        { id: "q1", text: "When is the next release?", votes: 1 },
        { id: "q2", text: "when is the NEXT release", votes: 3 },
        { id: "q3", text: "Who owns onboarding?", votes: 0 },
      ])
    ).toEqual([{ keep: "q2", merge: ["q1"] }]);
  });
});

describe("Markdown", () => {
  it("lists the posts with votes, answered and merged texts, never a name", () => {
    const md = sessionMarkdown(
      wall({
        posts: [{ id: "p1", text: "When | how?", votes: 4, merged: ["When*"] }],
        sent: [
          {
            key: "k",
            title: "Publish a release calendar",
            sentTo: [{ route: "backlog-story", targetId: "story_1", at: AT }],
          },
        ],
      })
    );
    expect(md).toContain("## What should we ask the CTO?");
    expect(md).toContain("Questions, 2026-11-12. 1 post, anonymous.");
    expect(md).toContain("- When \\| how? (also: When\\*) — 4 votes");
    expect(md).toContain("### Sent to the backlog");
    expect(md).toContain("- Publish a release calendar");
  });

  it("shows brainwriting threads and the 25/10 top ten", () => {
    const md = sessionMarkdown(
      wall({
        kind: "crowd",
        posts: [
          { id: "p1", text: "Ship weekly", votes: 0, merged: [], score: 9, scorers: 2 },
          { id: "p2", text: "and demo it", votes: 1, merged: [], re: "p1" },
        ],
      })
    );
    expect(md).toContain("### Top ten");
    expect(md).toContain("1. Ship weekly — 4.5 from 2 scores");
    expect(md).toContain("  - Yes, and… and demo it — 1 vote");
    expect(wallsMarkdown([])).toContain("No saved walls yet.");
  });
});
