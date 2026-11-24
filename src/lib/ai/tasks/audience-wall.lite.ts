/**
 * Audience Wall's AI tasks, the lite half pages import (no zod; the defs,
 * with their schemas, are `audience-wall.ts` and load on first AI use):
 * the caps, the fallbacks, building the input, reading the answer against
 * the wall, and one ref per task.
 */

import { lazyAiTask } from "../task-ref";
import { duplicateGroups, keywordGroups } from "@/lib/audience-wall/words";
import type {
  BacklogInput,
  BacklogOutput,
  ClusterInput,
  ClusterOutput,
  MergeInput,
  MergeOutput,
} from "./audience-wall";
export type {
  BacklogInput,
  BacklogOutput,
  ClusterInput,
  ClusterOutput,
  MergeInput,
  MergeOutput,
} from "./audience-wall";

export const AW_POSTS_MAX = 200;
export const AW_THEMES_MAX = 8;
export const AW_GROUPS_MAX = 20;
export const AW_ITEMS_MAX = 10;
/**
 * The posts sent in one request, in all, as the UTF-8 bytes of their JSON
 * (what the route counts): under the visitor route's 64 KiB body cap
 * (`TOOL_AI_VISITOR_MAX_BODY_BYTES`), with room for the prompt and the
 * request around them. Counted in bytes, not characters, so a wall in
 * Chinese or Hindi (three bytes a character) fits as surely as one in
 * English. `aiPosts` keeps the most upvoted within it.
 */
export const AW_TEXT_BUDGET = 56_000;

const utf8 = new TextEncoder();

/** A post's share of the request: its JSON in bytes, with the longest id and a vote count. */
export function aiPostBytes(p: { text: string; votes?: number }): number {
  return utf8.encode(JSON.stringify({ id: "p".repeat(12), text: p.text, votes: p.votes ?? 0 }))
    .length;
}

// ── cluster ──────────────────────────────────────────────────────────

/**
 * Themes without AI: posts that share a word; everything in one theme when
 * none do. With no posts there is nothing to sort: it throws (the schema
 * refuses that input, and the button then asks to fill the tool in first).
 */
export function fallbackThemes({ posts }: ClusterInput): ClusterOutput {
  if (posts.length === 0) throw new Error("There are no posts to sort.");
  const groups = keywordGroups(posts, { maxGroups: AW_THEMES_MAX });
  if (groups.length > 0) return { themes: groups };
  return { themes: [{ name: "All posts", postIds: posts.map((p) => p.id) }] };
}

export const clusterTask = lazyAiTask<ClusterInput, ClusterOutput>(
  { id: "audience-wall.cluster", toolId: "audience-wall", fallback: fallbackThemes },
  () => import("./audience-wall").then((m) => m.clusterTask)
);

// ── merge_questions ──────────────────────────────────────────────────

/** Duplicates without AI: the same words, or most of them. */
export function fallbackMerges({ posts }: MergeInput): MergeOutput {
  return {
    groups: duplicateGroups(posts)
      .slice(0, AW_GROUPS_MAX)
      .map((g) => ({ ...g, reason: "Asks the same thing in nearly the same words." })),
  };
}

export const mergeQuestionsTask = lazyAiTask<MergeInput, MergeOutput>(
  { id: "audience-wall.merge_questions", toolId: "audience-wall", fallback: fallbackMerges },
  () => import("./audience-wall").then((m) => m.mergeQuestionsTask)
);

// ── to_backlog ───────────────────────────────────────────────────────

/** A post as a story title: one line, a capital first letter, no end stop, at most 120 characters. */
export function titleFromPost(text: string): string {
  const flat = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  const cut = flat.length > 120 ? `${flat.slice(0, 119).trimEnd()}…` : flat;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/**
 * Backlog items without AI: the most upvoted posts (five at most), as
 * written. With no posts it throws, as `fallbackThemes` does.
 */
export function fallbackBacklog({ prompt, posts }: BacklogInput): BacklogOutput {
  if (posts.length === 0) throw new Error("There are no posts to turn into backlog items.");
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

export const toBacklogTask = lazyAiTask<BacklogInput, BacklogOutput>(
  { id: "audience-wall.to_backlog", toolId: "audience-wall", fallback: fallbackBacklog },
  () => import("./audience-wall").then((m) => m.toBacklogTask)
);

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
    const n = aiPostBytes(p);
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
