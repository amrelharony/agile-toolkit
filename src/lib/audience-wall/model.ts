/**
 * Audience Wall: the walls a host saves, and the rules for reading them
 * back. Pure and server-safe (the page, Amr's actions and the MCP route all
 * read it), with no realtime import: a live room's result reaches it as a
 * plain object (`WallResultLike`).
 *
 * A saved wall is anonymous by construction: the prompt, each post's text,
 * its upvotes, the texts merged into it and what its kind adds (a "Yes,
 * and…" link, Answered, a 25/10 score). No member id, no name. Post ids are
 * this store's own (`p1`, `p2`…), made when the wall is saved.
 */

import type { HandoffLink } from "@/lib/stores/workspace-types";

// ── Kinds ────────────────────────────────────────────────────────────

/** What a wall is for: the page's five ways to run it. */
export const WALL_KINDS = ["answers", "questions", "hands", "brainwriting", "crowd"] as const;
export type WallKind = (typeof WALL_KINDS)[number];

export const WALL_KIND_LABEL: Record<WallKind, string> = {
  answers: "Open answers",
  questions: "Questions",
  hands: "Raised hands",
  brainwriting: "Brainwriting",
  crowd: "25/10",
};

/** One line on what each kind does, for the picker. */
export const WALL_KIND_HINT: Record<WallKind, string> = {
  answers: "Short answers to one question, as a list or a word cloud.",
  questions: "People ask and upvote; the most wanted rise. Mark each one answered.",
  hands: "A queue to speak, in the order hands went up.",
  brainwriting: "Everyone writes, then builds on each other's posts with Yes, and….",
  crowd: "Everyone writes one bold idea, scores five others from 1 to 5, and the top ten show.",
};

export function isWallKind(v: unknown): v is WallKind {
  return typeof v === "string" && (WALL_KINDS as readonly string[]).includes(v);
}

// ── Caps ─────────────────────────────────────────────────────────────

export const WALL_PROMPT_MAX = 280;
export const WALL_POST_MAX = 280;
export const WALL_POSTS_MAX = 200;
export const WALL_MERGED_MAX = 10;
export const WALL_THEMES_MAX = 8;
export const WALL_THEME_NAME_MAX = 60;
/** Walls kept: the newest. */
export const WALL_SESSIONS_MAX = 100;
/** Backlog items sent from one wall. */
export const WALL_SENT_MAX = 50;
export const WALL_SENT_TITLE_MAX = 200;
/** A post's upvotes or a 25/10 total, read back. */
const COUNT_MAX = 100_000;

// ── Shapes ───────────────────────────────────────────────────────────

export interface WallSessionPost {
  /** This store's id, unique in the wall ("p1"). */
  id: string;
  text: string;
  votes: number;
  /** Texts merged into it (duplicates), oldest first. */
  merged: string[];
  /** Brainwriting: the post (id) this one builds on. */
  re?: string;
  answered?: boolean;
  /** 25/10: the sum of its scores, and how many scored it. */
  score?: number;
  scorers?: number;
}

/** A group of posts the host accepted (Amr's grouping or the keyword one). */
export interface WallTheme {
  name: string;
  postIds: string[];
}

/** One backlog item sent from the wall, with its hand-off link. */
export interface WallSentItem {
  /** Stable key for the item (its title, slugged). */
  key: string;
  title: string;
  sentTo: HandoffLink[];
}

export interface WallSession {
  /** "wall_…", or "example-…" for the example. */
  id: string;
  kind: WallKind;
  prompt: string;
  /** ISO time it was saved. */
  savedAt: string;
  /** "room": saved from a live room; "manual": typed in (sticky notes, a chat). */
  source: "room" | "manual";
  posts: WallSessionPost[];
  themes: WallTheme[];
  sent: WallSentItem[];
}

export interface AudienceWallData {
  sessions: WallSession[];
}

export const AUDIENCE_WALL_INITIAL: AudienceWallData = { sessions: [] };

/** The store's key (createPersistedStore adds the prefix): the user_state row over MCP too. */
export const AUDIENCE_WALL_STORE = "audience-wall";
export const AUDIENCE_WALL_STORE_KEY = `agile-toolkit:${AUDIENCE_WALL_STORE}`;

/** A live round's saved result, as the wall kit hands it over (no ids, no names). */
export interface WallResultLike {
  prompt: string;
  closedAt?: string;
  posts: readonly {
    text: string;
    votes: number;
    merged: readonly string[];
    /** The index of the post it builds on. */
    re?: number;
    answered?: boolean;
    score?: number;
    scorers?: number;
  }[];
}

// ── Reading back ─────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** One line of plain text, cut to `max`; "" when there's none. */
export function oneLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const flat = v
    // Control characters and bidi overrides never come back.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(COUNT_MAX, Math.max(0, Math.round(v))) : 0;

const POST_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

function normalizePost(raw: unknown): WallSessionPost | null {
  const p = obj(raw);
  if (!p || typeof p.id !== "string" || !POST_ID_RE.test(p.id)) return null;
  const text = oneLine(p.text, WALL_POST_MAX);
  if (!text) return null;
  const merged = Array.isArray(p.merged)
    ? p.merged
        .map((t) => oneLine(t, WALL_POST_MAX))
        .filter(Boolean)
        .slice(0, WALL_MERGED_MAX)
    : [];
  const post: WallSessionPost = { id: p.id, text, votes: count(p.votes), merged };
  if (typeof p.re === "string" && POST_ID_RE.test(p.re) && p.re !== p.id) post.re = p.re;
  if (p.answered === true) post.answered = true;
  if (typeof p.score === "number" && typeof p.scorers === "number") {
    post.score = count(p.score);
    post.scorers = count(p.scorers);
  }
  return post;
}

/** A saved wall, rebuilt field by field, or null when it can't be one. */
export function normalizeSession(raw: unknown): WallSession | null {
  const s = obj(raw);
  if (!s || typeof s.id !== "string" || !s.id || s.id.length > 64) return null;
  const prompt = oneLine(s.prompt, WALL_PROMPT_MAX);
  if (!prompt) return null;
  const savedAt =
    typeof s.savedAt === "string" && !Number.isNaN(Date.parse(s.savedAt)) ? s.savedAt : null;
  if (!savedAt) return null;
  const seen = new Set<string>();
  const posts: WallSessionPost[] = [];
  for (const rawPost of Array.isArray(s.posts) ? s.posts : []) {
    const post = normalizePost(rawPost);
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
    if (posts.length >= WALL_POSTS_MAX) break;
  }
  // Links only to posts that are there, one level deep.
  for (const p of posts) {
    if (p.re === undefined) continue;
    const parent = posts.find((x) => x.id === p.re);
    if (!parent || parent.re !== undefined) delete p.re;
  }
  const themes: WallTheme[] = [];
  const themed = new Set<string>();
  for (const rawTheme of Array.isArray(s.themes) ? s.themes : []) {
    const t = obj(rawTheme);
    const name = t ? oneLine(t.name, WALL_THEME_NAME_MAX) : "";
    if (!t || !name || !Array.isArray(t.postIds)) continue;
    const postIds = t.postIds.filter(
      (id): id is string => typeof id === "string" && seen.has(id) && !themed.has(id)
    );
    postIds.forEach((id) => themed.add(id));
    if (postIds.length === 0) continue;
    themes.push({ name, postIds });
    if (themes.length >= WALL_THEMES_MAX) break;
  }
  const sent: WallSentItem[] = [];
  for (const rawSent of Array.isArray(s.sent) ? s.sent : []) {
    const x = obj(rawSent);
    const title = x ? oneLine(x.title, WALL_SENT_TITLE_MAX) : "";
    if (!x || typeof x.key !== "string" || !x.key || x.key.length > 80 || !title) continue;
    if (sent.some((y) => y.key === x.key)) continue;
    const sentTo = Array.isArray(x.sentTo) ? x.sentTo.filter(isHandoffLink) : [];
    sent.push({ key: x.key, title, sentTo });
    if (sent.length >= WALL_SENT_MAX) break;
  }
  return {
    id: s.id,
    kind: isWallKind(s.kind) ? s.kind : "answers",
    prompt,
    savedAt,
    source: s.source === "manual" ? "manual" : "room",
    posts,
    themes,
    sent,
  };
}

function isHandoffLink(v: unknown): v is HandoffLink {
  const l = obj(v);
  return Boolean(
    l &&
    typeof l.route === "string" &&
    typeof l.targetId === "string" &&
    l.targetId.length > 0 &&
    typeof l.at === "string"
  );
}

/** The saved walls: valid ones, each id once, newest first, at most 100. */
export function normalizeWallData(raw: unknown): AudienceWallData {
  const r = obj(raw);
  const list = Array.isArray(r?.sessions) ? r.sessions : [];
  const seen = new Set<string>();
  const sessions: WallSession[] = [];
  for (const row of list) {
    const s = normalizeSession(row);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    sessions.push(s);
  }
  sessions.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return { sessions: sessions.slice(0, WALL_SESSIONS_MAX) };
}

// ── Making a wall ────────────────────────────────────────────────────

const postId = (i: number) => `p${i + 1}`;

/** A live round's result as a saved wall: its own post ids, the links kept by place. */
export function sessionFromResult(
  result: WallResultLike,
  kind: WallKind,
  { id, savedAt }: { id: string; savedAt: string }
): WallSession {
  const posts: WallSessionPost[] = result.posts.slice(0, WALL_POSTS_MAX).map((p, i) => {
    const post: WallSessionPost = {
      id: postId(i),
      text: oneLine(p.text, WALL_POST_MAX),
      votes: count(p.votes),
      merged: p.merged.map((t) => oneLine(t, WALL_POST_MAX)).slice(0, WALL_MERGED_MAX),
    };
    if (typeof p.re === "number" && p.re >= 0 && p.re < result.posts.length && p.re !== i) {
      post.re = postId(p.re);
    }
    if (p.answered) post.answered = true;
    if (typeof p.score === "number") {
      post.score = count(p.score);
      post.scorers = count(p.scorers);
    }
    return post;
  });
  return (
    normalizeSession({
      id,
      kind,
      prompt: result.prompt,
      savedAt,
      source: "room",
      posts,
      themes: [],
      sent: [],
    }) ?? {
      id,
      kind,
      prompt: oneLine(result.prompt, WALL_PROMPT_MAX) || "Untitled wall",
      savedAt,
      source: "room",
      posts: [],
      themes: [],
      sent: [],
    }
  );
}

/** The form for a wall typed in by hand: the prompt, and one post per line. */
export interface WallDraft {
  prompt: string;
  posts: string;
}

export type WallDraftErrors = Partial<Record<keyof WallDraft, string>>;

/** The posts of a draft: one per line, blank lines dropped. */
export function draftLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** What's wrong with a draft (nothing: an empty object). */
export function validateWallDraft(d: WallDraft): WallDraftErrors {
  const errors: WallDraftErrors = {};
  const prompt = d.prompt.trim();
  if (!prompt) errors.prompt = "Write the question you asked.";
  else if (prompt.length > WALL_PROMPT_MAX) {
    errors.prompt = `Keep the question to ${WALL_PROMPT_MAX} characters.`;
  }
  const lines = draftLines(d.posts);
  if (lines.length === 0) errors.posts = "Add at least one answer, one per line.";
  else if (lines.length > WALL_POSTS_MAX) {
    errors.posts = `A wall holds ${WALL_POSTS_MAX} posts at most.`;
  } else if (lines.some((l) => l.length > WALL_POST_MAX)) {
    errors.posts = `Keep each line to ${WALL_POST_MAX} characters.`;
  }
  return errors;
}

/** A valid draft as a saved wall (no upvotes: they weren't counted). */
export function sessionFromDraft(
  d: WallDraft,
  kind: WallKind,
  { id, savedAt }: { id: string; savedAt: string }
): WallSession | null {
  if (Object.keys(validateWallDraft(d)).length > 0) return null;
  return normalizeSession({
    id,
    kind,
    prompt: d.prompt,
    savedAt,
    source: "manual",
    posts: draftLines(d.posts).map((text, i) => ({ id: postId(i), text, votes: 0, merged: [] })),
    themes: [],
    sent: [],
  });
}

// ── Reading a wall ───────────────────────────────────────────────────

/** 25/10: whether the wall's totals were saved. */
export const isScored = (s: Pick<WallSession, "posts">) =>
  s.posts.some((p) => p.score !== undefined);

/** 25/10: a post's average score, or -1 when nobody scored it. */
export const averageScore = (p: Pick<WallSessionPost, "score" | "scorers">) =>
  p.scorers ? (p.score ?? 0) / p.scorers : -1;

/**
 * The wall's posts best first: by average score once 25/10 totals were
 * saved, else by upvotes; answered questions after the rest. Ties keep the
 * saved order.
 */
export function rankedPosts(s: Pick<WallSession, "posts">): WallSessionPost[] {
  const scored = isScored(s);
  return s.posts
    .map((p, i) => ({ p, i }))
    .sort((a, b) =>
      scored
        ? averageScore(b.p) - averageScore(a.p) ||
          (b.p.scorers ?? 0) - (a.p.scorers ?? 0) ||
          a.i - b.i
        : Number(a.p.answered === true) - Number(b.p.answered === true) ||
          b.p.votes - a.p.votes ||
          a.i - b.i
    )
    .map((x) => x.p);
}

/** 25/10: the top ten (only posts someone scored). */
export function topTen(s: Pick<WallSession, "posts">): WallSessionPost[] {
  return rankedPosts(s)
    .filter((p) => (p.scorers ?? 0) > 0)
    .slice(0, 10);
}

/** The "Yes, and…" posts under each post, by the post's id. */
export function repliesByPost(s: Pick<WallSession, "posts">): Map<string, WallSessionPost[]> {
  const out = new Map<string, WallSessionPost[]>();
  for (const p of s.posts) {
    if (p.re) out.set(p.re, [...(out.get(p.re) ?? []), p]);
  }
  return out;
}

/** Counts for a wall's summary line. */
export function wallCounts(s: Pick<WallSession, "posts">) {
  return {
    posts: s.posts.length,
    votes: s.posts.reduce((n, p) => n + p.votes, 0),
    answered: s.posts.filter((p) => p.answered).length,
    replies: s.posts.filter((p) => p.re).length,
  };
}

// ── Changing a wall (the page's store applies these, with Undo) ──────

/**
 * Merge post `fromId` into `intoId` (a duplicate question): its text and
 * merged texts go under the other, the upvotes add up (a person who voted
 * for both counts twice: the saved wall has no voters), and what pointed
 * at it points at the other. Unchanged when either is missing, they're the
 * same, or the merged texts would pass the cap.
 */
export function mergeSessionPosts(s: WallSession, fromId: string, intoId: string): WallSession {
  const from = s.posts.find((p) => p.id === fromId);
  const into = s.posts.find((p) => p.id === intoId);
  if (!from || !into || from === into) return s;
  const merged = [...into.merged, from.text, ...from.merged];
  if (merged.length > WALL_MERGED_MAX) return s;
  // What built on `from` builds on `into`'s thread now (threads are one level deep).
  const root = into.re && into.re !== fromId ? into.re : intoId;
  const posts = s.posts
    .filter((p) => p.id !== fromId)
    .map((p) => {
      const next: WallSessionPost =
        p.id === intoId
          ? {
              ...p,
              merged,
              votes: p.votes + from.votes,
              ...(p.answered || from.answered ? { answered: true } : {}),
            }
          : { ...p };
      if (next.re === fromId) {
        // `into` never builds on itself.
        if (next.id === intoId) delete next.re;
        else next.re = root;
      }
      return next;
    });
  const themes = s.themes
    .map((t) => ({
      ...t,
      postIds: Array.from(new Set(t.postIds.map((id) => (id === fromId ? intoId : id)))),
    }))
    .filter((t) => t.postIds.length > 0);
  return normalizeSession({ ...s, posts, themes }) ?? s;
}

/** The wall with `themes` (each post in one theme at most, the first that names it). */
export function withThemes(s: WallSession, themes: readonly WallTheme[]): WallSession {
  return normalizeSession({ ...s, themes }) ?? s;
}

/** "Fix the flaky build!" → "fix-the-flaky-build", for a sent item's key. */
export function sentKey(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}
