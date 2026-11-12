/**
 * Audience Wall's AI tasks, the browser-safe half (prompts in
 * `audience-wall.server.ts`). Each one reads anonymous posts only (their
 * text, never who wrote them) and answers a draft the host previews:
 * nothing reaches the room, the saved wall or the backlog until the host
 * accepts it. Each has a fallback that needs no model.
 *
 *   audience-wall.cluster          posts → up to 8 themes, each with its post ids
 *   audience-wall.merge_questions  posts → groups of duplicates to merge
 *   audience-wall.to_backlog       feedback → up to 10 backlog items
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { duplicateGroups, keywordGroups } from "@/lib/audience-wall/words";

export const AW_POSTS_MAX = 200;
export const AW_THEMES_MAX = 8;
export const AW_GROUPS_MAX = 20;
export const AW_ITEMS_MAX = 10;
/**
 * The posts' text sent in one request, in all: under the visitor route's
 * 64 KB body cap with room to spare. `aiPosts` keeps the most upvoted
 * within it.
 */
export const AW_TEXT_BUDGET = 30_000;

const postId = z.string().trim().min(1).max(12);
const post = z.object({ id: postId, text: z.string().trim().min(1).max(280) });

// ── cluster ──────────────────────────────────────────────────────────

const clusterInput = z.object({
  prompt: z.string().trim().max(280),
  posts: z.array(post).min(2).max(AW_POSTS_MAX),
});

const clusterOutput = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        postIds: z.array(postId).min(1).max(AW_POSTS_MAX),
      })
    )
    .min(1)
    .max(AW_THEMES_MAX),
});

export type ClusterInput = z.infer<typeof clusterInput>;
export type ClusterOutput = z.infer<typeof clusterOutput>;

/** Themes without AI: posts that share a word; everything in one theme when none do. */
export function fallbackThemes({ posts }: ClusterInput): ClusterOutput {
  const groups = keywordGroups(posts, { maxGroups: AW_THEMES_MAX });
  if (groups.length > 0) return { themes: groups };
  return { themes: [{ name: "All posts", postIds: posts.map((p) => p.id) }] };
}

export const clusterTask = defineAiTask({
  id: "audience-wall.cluster",
  toolId: "audience-wall",
  tier: "full",
  effort: "low",
  maxTokens: 8192,
  input: clusterInput,
  output: clusterOutput,
  fallback: fallbackThemes,
  sample: {
    prompt: "What slows us down the most?",
    posts: [
      { id: "p1", text: "Waiting for code reviews" },
      { id: "p2", text: "Reviews sit for two days" },
      { id: "p3", text: "Flaky end-to-end tests" },
      { id: "p4", text: "Tests fail at random on CI" },
      { id: "p5", text: "Too many status meetings" },
      { id: "p6", text: "Unclear priorities from stakeholders" },
    ],
  },
});

// ── merge_questions ──────────────────────────────────────────────────

const mergeInput = z.object({
  posts: z.array(post).min(2).max(AW_POSTS_MAX),
});

const mergeOutput = z.object({
  groups: z
    .array(
      z.object({
        keep: postId,
        merge: z.array(postId).min(1).max(10),
        reason: z.string().trim().max(140),
      })
    )
    .max(AW_GROUPS_MAX),
});

export type MergeInput = z.infer<typeof mergeInput>;
export type MergeOutput = z.infer<typeof mergeOutput>;

/** Duplicates without AI: the same words, or most of them. */
export function fallbackMerges({ posts }: MergeInput): MergeOutput {
  return {
    groups: duplicateGroups(posts)
      .slice(0, AW_GROUPS_MAX)
      .map((g) => ({ ...g, reason: "Asks the same thing in nearly the same words." })),
  };
}

export const mergeQuestionsTask = defineAiTask({
  id: "audience-wall.merge_questions",
  toolId: "audience-wall",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: mergeInput,
  output: mergeOutput,
  fallback: fallbackMerges,
  sample: {
    posts: [
      { id: "p1", text: "When is the next release?" },
      { id: "p2", text: "When do we release next?" },
      { id: "p3", text: "Who owns the onboarding flow?" },
      { id: "p4", text: "Will the API change for partners?" },
    ],
  },
});

// ── to_backlog ───────────────────────────────────────────────────────

const backlogInput = z.object({
  prompt: z.string().trim().max(280),
  posts: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(280),
        votes: z.number().int().min(0).max(100_000),
      })
    )
    .min(1)
    .max(AW_POSTS_MAX),
});

const backlogOutput = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500),
      })
    )
    .min(1)
    .max(AW_ITEMS_MAX),
});

export type BacklogInput = z.infer<typeof backlogInput>;
export type BacklogOutput = z.infer<typeof backlogOutput>;

/** A post as a story title: one line, a capital first letter, no end stop, at most 120 characters. */
export function titleFromPost(text: string): string {
  const flat = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  const cut = flat.length > 120 ? `${flat.slice(0, 119).trimEnd()}…` : flat;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Backlog items without AI: the most upvoted posts (five at most), as written. */
export function fallbackBacklog({ prompt, posts }: BacklogInput): BacklogOutput {
  const ranked = posts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.votes - a.p.votes || a.i - b.i)
    .slice(0, 5)
    .map(({ p }) => p);
  const asked = prompt.trim() ? `Asked: “${prompt.trim()}”. ` : "";
  return {
    items: ranked.map((p) => ({
      title: titleFromPost(p.text) || "Feedback from the wall",
      description:
        `${asked}From the Audience Wall, ${p.votes} ${p.votes === 1 ? "upvote" : "upvotes"}.`.slice(
          0,
          500
        ),
    })),
  };
}

export const toBacklogTask = defineAiTask({
  id: "audience-wall.to_backlog",
  toolId: "audience-wall",
  tier: "full",
  effort: "low",
  maxTokens: 6144,
  input: backlogInput,
  output: backlogOutput,
  fallback: fallbackBacklog,
  sample: {
    prompt: "What did you think of the new checkout?",
    posts: [
      { text: "The promo code box is hard to find", votes: 6 },
      { text: "Loved the one-page flow", votes: 4 },
      { text: "Card errors don't say what went wrong", votes: 5 },
      { text: "Can we save a second address?", votes: 2 },
    ],
  },
});

// ── Building the input ───────────────────────────────────────────────

/**
 * The posts to send, most upvoted first, within the text budget and the
 * post cap: `{posts, left}`, where `left` is how many didn't fit (the page
 * says so).
 */
export function aiPosts<T extends { text: string; votes?: number }>(
  posts: readonly T[],
  { budget = AW_TEXT_BUDGET, max = AW_POSTS_MAX }: { budget?: number; max?: number } = {}
): { posts: T[]; left: number } {
  const ranked = posts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.votes ?? 0) - (a.p.votes ?? 0) || a.i - b.i);
  const out: T[] = [];
  let used = 0;
  for (const { p } of ranked) {
    const n = p.text.length;
    if (out.length >= max || used + n > budget) break;
    out.push(p);
    used += n;
  }
  return { posts: out, left: posts.length - out.length };
}

/**
 * An answer's themes against the posts that exist: unknown ids dropped,
 * each post in one theme at most (the first that names it), empty themes
 * gone.
 */
export function cleanThemes(
  themes: ClusterOutput["themes"],
  known: ReadonlySet<string>
): ClusterOutput["themes"] {
  const taken = new Set<string>();
  const out: ClusterOutput["themes"] = [];
  for (const t of themes) {
    const postIds = t.postIds.filter((id) => known.has(id) && !taken.has(id));
    postIds.forEach((id) => taken.add(id));
    if (postIds.length > 0) out.push({ name: t.name, postIds });
  }
  return out;
}

/**
 * An answer's merge groups against the posts that exist: unknown ids and
 * self-merges dropped, each post in one group at most, groups with nothing
 * left to merge gone.
 */
export function cleanMerges(
  groups: MergeOutput["groups"],
  known: ReadonlySet<string>
): MergeOutput["groups"] {
  const taken = new Set<string>();
  const out: MergeOutput["groups"] = [];
  for (const g of groups) {
    if (!known.has(g.keep) || taken.has(g.keep)) continue;
    const merge = Array.from(new Set(g.merge)).filter(
      (id) => id !== g.keep && known.has(id) && !taken.has(id)
    );
    if (merge.length === 0) continue;
    taken.add(g.keep);
    merge.forEach((id) => taken.add(id));
    out.push({ ...g, merge });
  }
  return out;
}
