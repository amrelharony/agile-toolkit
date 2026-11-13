/**
 * Audience Wall — tool-local actions.
 *
 * Category: Workshops & Facilitation (tools plan, phase 1)
 * Agent surface: tool.audience_wall.*
 * Backing store: the tool's own store of saved walls
 *   (`agile-toolkit:audience-wall`, lib/audience-wall/store; the user_state
 *   row of that key over MCP), and the live wall on the page
 *   (lib/audience-wall/live), which only the host's tab holds.
 *
 *   1. list_state      — the saved walls in short, and the live wall's counts.
 *   2. list_sessions   — the saved walls with their posts (anonymous).
 *   3. export_session  — one wall, or every wall, as Markdown.
 *   4. add_wall        — a wall typed in (sticky notes, a chat's answers).
 *   5. room_status     — the live wall's counts: prompt, posts, hands, scoring.
 *   6. open_round      — put a new prompt on the live wall.
 *   7. set_open        — stop or start taking posts.
 *   8. reveal          — show a hidden round's posts to the room.
 *   9. lower_hands     — lower every raised hand.
 *  10. scoring         — 25/10: start the scoring, or show the top ten.
 *
 * The room verbs reach other people's screens, so they're closed to
 * visitors (`visitor: false`), and they hand out counts only: no post a
 * participant wrote reaches Amr's chat from a live room. Each says when the
 * room didn't take the move (`ok: false` with why), and open_round won't
 * clear a round whose posts aren't saved unless asked to. Over MCP there is
 * no page, so they answer "browser_only".
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverGetUserStateBlob } from "../server-store";
import {
  AUDIENCE_WALL_STORE_KEY,
  WALL_KINDS,
  WALL_PROMPT_MAX,
  WALL_POST_MAX,
  WALL_POSTS_MAX,
  isScored,
  normalizeWallData,
  rankedPosts,
  sessionFromDraft,
  topTen,
  wallCounts,
  type WallSession,
} from "@/lib/audience-wall/model";
import { sessionMarkdown, wallsMarkdown } from "@/lib/audience-wall/markdown";
import { hydrateAudienceWall, readWalls, updateWalls } from "@/lib/audience-wall/store";
import { liveWall } from "@/lib/audience-wall/live";

const TOOL = "tool.audience_wall";

/** A write or room verb's answer: `ok`, and what changed or why not. */
type Answer = Record<string, unknown>;

/* ── Reading the walls ──────────────────────────────────────────────── */

async function browserWalls(): Promise<WallSession[]> {
  await hydrateAudienceWall();
  return readWalls();
}

async function serverWalls(userId: string): Promise<WallSession[]> {
  return normalizeWallData(await serverGetUserStateBlob(userId, AUDIENCE_WALL_STORE_KEY)).sessions;
}

function summary(s: WallSession) {
  const c = wallCounts(s);
  return {
    id: s.id,
    kind: s.kind,
    prompt: s.prompt,
    savedAt: s.savedAt,
    source: s.source,
    posts: c.posts,
    votes: c.votes,
    answered: c.answered,
    replies: c.replies,
    scored: isScored(s),
    themes: s.themes.map((t) => ({ name: t.name, posts: t.postIds.length })),
    sentToBacklog: s.sent.filter((x) => x.sentTo.length > 0).length,
    example: s.id.startsWith("example-"),
  };
}

function listState(walls: readonly WallSession[]) {
  const live = typeof window === "undefined" ? null : (liveWall()?.status() ?? null);
  return {
    total: walls.length,
    walls: walls.slice(0, 20).map(summary),
    live,
  };
}

function detail(s: WallSession) {
  const byId = new Map(s.posts.map((p) => [p.id, p]));
  return {
    ...summary(s),
    posts: rankedPosts(s).map((p) => ({
      id: p.id,
      text: p.text,
      votes: p.votes,
      ...(p.merged.length > 0 ? { merged: p.merged } : {}),
      ...(p.answered ? { answered: true } : {}),
      ...(p.re && byId.has(p.re) ? { buildsOn: p.re } : {}),
      ...(p.scorers !== undefined
        ? {
            score: p.score ?? 0,
            scorers: p.scorers,
            average: p.scorers ? (p.score ?? 0) / p.scorers : null,
          }
        : {}),
    })),
    ...(isScored(s) ? { topTen: topTen(s).map((p) => p.id) } : {}),
    themeGroups: s.themes,
  };
}

const listSessionsSchema = z.object({
  kind: z.enum(WALL_KINDS).optional().describe("Only walls of this kind."),
  sessionId: z.string().max(64).optional().describe("Only this wall."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("How many walls, newest first (default 5)."),
});

function listSessions(walls: readonly WallSession[], params: z.infer<typeof listSessionsSchema>) {
  const picked = walls
    .filter((s) => (params.kind ? s.kind === params.kind : true))
    .filter((s) => (params.sessionId ? s.id === params.sessionId : true))
    .slice(0, params.limit ?? 5);
  if (params.sessionId && picked.length === 0) return { error: "unknown_session" as const };
  return { total: walls.length, sessions: picked.map(detail) };
}

const exportSchema = z.object({
  sessionId: z.string().max(64).optional().describe("One wall's id; omit for every wall."),
});

function exportSession(walls: readonly WallSession[], sessionId?: string) {
  if (!sessionId) return { markdown: wallsMarkdown(walls) };
  const s = walls.find((x) => x.id === sessionId);
  if (!s) return { markdown: "", error: "unknown_session" as const };
  return { markdown: `# Audience Wall\n\n${sessionMarkdown(s)}` };
}

// ──────── tool.audience_wall.list_state ────────
registry.register({
  id: `${TOOL}.list_state`,
  toolId: TOOL,
  name: "list_state",
  category: "read",
  description:
    "Audience Wall: the saved walls in short (kind, prompt, posts, votes, themes, what went to the backlog), newest first, and the live wall on the page (counts only) if one is open.",
  paramsSchema: z.object({}),
  handler: async () => listState(await browserWalls()),
  mcpHandler: async (_params, ctx) => ({ ...listState(await serverWalls(ctx.userId)), live: null }),
});

// ──────── tool.audience_wall.list_sessions ────────
registry.register({
  id: `${TOOL}.list_sessions`,
  toolId: TOOL,
  name: "list_sessions",
  category: "read",
  description:
    "Audience Wall: saved walls with their posts (anonymous text, votes, merged duplicates, Answered, Yes-and links, 25/10 scores and top ten) and themes. Filter by kind or one wall's id.",
  paramsSchema: listSessionsSchema,
  handler: async (params) => listSessions(await browserWalls(), params),
  mcpHandler: async (params, ctx) => listSessions(await serverWalls(ctx.userId), params),
});

// ──────── tool.audience_wall.export_session ────────
registry.register({
  id: `${TOOL}.export_session`,
  toolId: TOOL,
  name: "export_session",
  category: "read",
  description:
    "Audience Wall: one saved wall (by id), or every wall, as Markdown: the prompt, the posts best first with votes or scores, themes and backlog items. Anonymous.",
  paramsSchema: exportSchema,
  handler: async (params) => exportSession(await browserWalls(), params.sessionId),
  mcpHandler: async (params, ctx) => exportSession(await serverWalls(ctx.userId), params.sessionId),
});

// ──────── tool.audience_wall.add_wall ────────
const addWallSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(WALL_PROMPT_MAX)
    .describe("The question the room was asked."),
  kind: z.enum(WALL_KINDS).optional().describe('The kind of wall (default "answers").'),
  posts: z
    .array(z.string().trim().min(1).max(WALL_POST_MAX))
    .min(1)
    .max(WALL_POSTS_MAX)
    .describe("The answers, one each, as people wrote them."),
});

registry.register({
  id: `${TOOL}.add_wall`,
  toolId: TOOL,
  name: "add_wall",
  category: "write",
  description:
    "Audience Wall: save a wall typed in by hand (sticky notes, answers from a chat): the question and the answers. No upvotes, no names. Saved in this browser's Audience Wall.",
  paramsSchema: addWallSchema,
  handler: async (params): Promise<Answer> => {
    await hydrateAudienceWall();
    const session = sessionFromDraft(
      { prompt: params.prompt, posts: params.posts.map((p) => p.replace(/\s+/g, " ")).join("\n") },
      params.kind ?? "answers",
      { id: `wall_${nanoid(10)}`, savedAt: new Date().toISOString() }
    );
    if (!session) return { ok: false as const, error: "invalid_wall" as const };
    updateWalls((list) => [session, ...list]);
    return { ok: true as const, id: session.id, posts: session.posts.length };
  },
  // The walls live in the browser's tool store; there is no server write for it.
  mcpHandler: async (): Promise<Answer> => ({ ok: false as const, error: "browser_only" as const }),
});

/* ── The live wall ──────────────────────────────────────────────────── */

const NO_ROOM = {
  ok: false as const,
  error: "no_live_wall" as const,
  hint: "Open a live wall on the Audience Wall page first.",
};
const BROWSER_ONLY = {
  ok: false as const,
  error: "browser_only" as const,
  hint: "A live wall runs in the host's browser tab.",
};

function withRoom<R>(run: (room: NonNullable<ReturnType<typeof liveWall>>) => R) {
  const room = typeof window === "undefined" ? null : liveWall();
  return room ? run(room) : NO_ROOM;
}

// ──────── tool.audience_wall.room_status ────────
registry.register({
  id: `${TOOL}.room_status`,
  toolId: TOOL,
  name: "room_status",
  category: "read",
  visitor: false,
  description:
    "Audience Wall: the live wall on the page, in counts: its prompt, kind, whether it takes posts, how many posts, hands and people, and the 25/10 scoring. Never the posts' text.",
  paramsSchema: z.object({}),
  handler: async (): Promise<Answer> =>
    withRoom((room) => ({ ok: true as const, ...room.status() })),
  mcpHandler: async (): Promise<Answer> => BROWSER_ONLY,
});

// ──────── tool.audience_wall.open_round ────────
registry.register({
  id: `${TOOL}.open_round`,
  toolId: TOOL,
  name: "open_round",
  category: "write",
  visitor: false,
  description:
    'Audience Wall: put a new prompt on the live wall. A new round clears the one before, so it refuses ("unsaved_round") while that round holds posts not yet saved or still hidden: ask the host to save it on the page first, and pass discard true only when they say to throw those posts away. mode "hidden" (default) keeps posts hidden until the host reveals them; "live" shows them as they arrive.',
  paramsSchema: z.object({
    prompt: z.string().trim().min(1).max(WALL_PROMPT_MAX),
    mode: z.enum(["hidden", "live"]).optional(),
    discard: z
      .boolean()
      .optional()
      .describe("True only when the host said to throw away the current round's unsaved posts."),
  }),
  handler: async (params): Promise<Answer> =>
    withRoom((room) => {
      const before = room.status();
      if (before.unsaved && params.discard !== true) {
        return {
          ok: false as const,
          error: "unsaved_round" as const,
          posts: before.posts,
          hint: "Save the round on the page first, or pass discard: true if the host wants it gone.",
        };
      }
      return room.openRound(params.prompt, params.mode ?? "hidden")
        ? { ok: true as const, ...room.status() }
        : { ok: false as const, error: "not_ready" as const };
    }),
  mcpHandler: async (): Promise<Answer> => BROWSER_ONLY,
});

// ──────── tool.audience_wall.set_open ────────
registry.register({
  id: `${TOOL}.set_open`,
  toolId: TOOL,
  name: "set_open",
  category: "write",
  visitor: false,
  description:
    "Audience Wall: stop (open false) or start again (open true) taking posts and votes on the live wall.",
  paramsSchema: z.object({ open: z.boolean() }),
  handler: async (params): Promise<Answer> =>
    withRoom((room) => {
      const before = room.status();
      if (!before.prompt) return { ok: false as const, error: "no_round" as const };
      room.setOpen(params.open);
      const after = room.status();
      if (after.open !== params.open) {
        // A 25/10 round being scored keeps its posts as they are.
        return {
          ok: false as const,
          error: after.scoring ? ("scoring" as const) : ("refused" as const),
          ...after,
        };
      }
      return { ok: true as const, ...after };
    }),
  mcpHandler: async (): Promise<Answer> => BROWSER_ONLY,
});

// ──────── tool.audience_wall.reveal ────────
registry.register({
  id: `${TOOL}.reveal`,
  toolId: TOOL,
  name: "reveal",
  category: "write",
  visitor: false,
  description:
    "Audience Wall: show a hidden round's posts to the room (and on the host's page), all at once. It also stops new posts and votes; set_open true takes them again, and each then shows as it arrives.",
  paramsSchema: z.object({}),
  handler: async (): Promise<Answer> =>
    withRoom((room) => {
      if (!room.status().prompt) return { ok: false as const, error: "no_round" as const };
      room.reveal();
      const after = room.status();
      return after.shown
        ? { ok: true as const, ...after }
        : { ok: false as const, error: "refused" as const, ...after };
    }),
  mcpHandler: async (): Promise<Answer> => BROWSER_ONLY,
});

// ──────── tool.audience_wall.lower_hands ────────
registry.register({
  id: `${TOOL}.lower_hands`,
  toolId: TOOL,
  name: "lower_hands",
  category: "write",
  visitor: false,
  description: "Audience Wall: lower every raised hand on the live wall.",
  paramsSchema: z.object({}),
  handler: async (): Promise<Answer> =>
    withRoom((room) => {
      room.lowerAllHands();
      return { ok: true as const, ...room.status() };
    }),
  mcpHandler: async (): Promise<Answer> => BROWSER_ONLY,
});

// ──────── tool.audience_wall.scoring ────────
registry.register({
  id: `${TOOL}.scoring`,
  toolId: TOOL,
  name: "scoring",
  category: "write",
  visitor: false,
  description:
    'Audience Wall, 25/10 walls only: phase "open" starts the scoring (no new posts, for good; each person scores five posts 1 to 5; it needs two posts or more), "shown" shows the totals and the top ten. Forward only.',
  paramsSchema: z.object({ phase: z.enum(["open", "shown"]) }),
  handler: async (params): Promise<Answer> =>
    withRoom((room) => {
      if (!room.setScoring) return { ok: false as const, error: "not_a_25_10_wall" as const };
      const before = room.status();
      if (!before.prompt) return { ok: false as const, error: "no_round" as const };
      if (before.scoring === params.phase) return { ok: true as const, ...before };
      if (params.phase === "open") {
        if (before.scoring === "shown") {
          return { ok: false as const, error: "already_shown" as const, ...before };
        }
        // Scoring closes the posts for good: it needs something to score.
        if (before.posts < 2) {
          return { ok: false as const, error: "needs_two_posts" as const, ...before };
        }
      } else if (before.scoring === null) {
        return { ok: false as const, error: "scoring_not_started" as const, ...before };
      }
      room.setScoring(params.phase);
      const after = room.status();
      return after.scoring === params.phase
        ? { ok: true as const, ...after }
        : { ok: false as const, error: "refused" as const, ...after };
    }),
  mcpHandler: async (): Promise<Answer> => BROWSER_ONLY,
});
