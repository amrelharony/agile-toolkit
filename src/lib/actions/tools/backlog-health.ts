/**
 * Backlog Health — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (tools plan, phase 1)
 *
 * Agent surface: tool.backlog_health.*
 * Backing CRUD : workspace.story.* and workspace.backlog_item.* (the stories
 *                and the backlog's decided order the page reads). The scan is
 *                lib/backlog/health, as on the page.
 *
 *   1. list_state   — the DEEP scan: the four checks with their reasons, the
 *                     score and verdict, and every flagged story.
 *   2. set_gwt      — write Given/When/Then scenarios on a story (replace or
 *                     add), beside its free-text acceptance criteria. This is
 *                     the story verb the plan calls `story.set_gwt`: the story
 *                     CRUD is a hot file, and this page is where scenarios are
 *                     suggested (workspace.story.update takes `gwt` too).
 *   3. split_story  — add smaller backlog stories for a big one; the original
 *                     stays for the person to drop.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type BacklogItem,
  type Story,
  type StoryGwt,
} from "@/lib/stores/workspace-types";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields, newGwtId, withStoryGwt } from "@/lib/stories/fields";
import { STORY_TITLE_MAX } from "@/lib/handoffs/targets/backlog-story";
import { DEEP_TOP_N, backlogForHealth, backlogHealth } from "@/lib/backlog/health";

const KIND_STORY = "workspace:story";
const KIND_BACKLOG_ITEM = "workspace:backlogItem";

const ws = () => useWorkspaceStore.getState();

/** Server-side "today" (UTC): an MCP agent has no locale. */
const todayUTC = () => new Date().toISOString().slice(0, 10);

interface StoryStore {
  stories: () => Promise<Story[]>;
  items: () => Promise<BacklogItem[]>;
  get: (id: string) => Promise<Story | null>;
  put: (story: Story) => Promise<void>;
}

const browserStore: StoryStore = {
  stories: async () => ws().stories ?? [],
  items: async () => ws().backlogItems ?? [],
  get: async (id) => (ws().stories ?? []).find((s) => s.id === id) ?? null,
  // The store stamps and cleans every story write itself.
  put: async (story) => ws().upsertStory(story),
};

const serverStore = (userId: string): StoryStore => ({
  stories: () => serverListEntities<Story>(userId, KIND_STORY),
  items: () => serverListEntities<BacklogItem>(userId, KIND_BACKLOG_ITEM),
  get: (id) => serverGetEntity<Story>(userId, KIND_STORY, id),
  put: async (story) => {
    // Stamped and cleaned as workspace.story.* does on the server.
    const current = await serverGetEntity<Story>(userId, KIND_STORY, story.id);
    await serverUpsertEntity<Story>(
      userId,
      KIND_STORY,
      stampStoryWrite(cleanStoryFields(story), current ?? undefined)
    );
  },
});

async function listState(store: StoryStore, topN: number, today: string) {
  const backlog = backlogForHealth(await store.stories(), await store.items());
  const health = backlogHealth(backlog, { today, topN });
  return {
    today,
    total: health.total,
    topN: health.topN,
    score: health.score,
    verdict: health.verdict,
    summary: health.summary,
    checks: health.checks,
    flagged: health.stories
      .filter((s) => s.flags.length > 0)
      .map((s) => ({
        id: s.story.id,
        title: s.story.title,
        place: s.place,
        points: s.story.points ?? null,
        flags: s.flags,
      })),
  };
}

// ──────── tool.backlog_health.list_state ────────
registry.register({
  id: "tool.backlog_health.list_state",
  toolId: "tool.backlog_health",
  name: "list_state",
  category: "read",
  description:
    "Run the DEEP scan on the backlog (stories with status backlog in no sprint, in the backlog's order). Returns {today, total, topN, score (0-100) | null, verdict: healthy|needs-work|unhealthy|empty, summary, checks: {id: detailed|estimated|emergent|prioritized, label, score (0-1) | null, reasons}[], flagged: {id, title, place, points, flags: {id: vague|no-criteria|no-points|too-big|stale, reason}[]}[]}. Only the top stories need criteria and points.",
  paramsSchema: z.object({
    topN: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe(`The top of the backlog; default ${DEEP_TOP_N}.`),
    today: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("YYYY-MM-DD. Defaults to today (UTC)."),
  }),
  handler: async ({ topN, today }) =>
    listState(browserStore, topN ?? DEEP_TOP_N, today ?? todayUTC()),
  mcpHandler: async ({ topN, today }, ctx) =>
    listState(serverStore(ctx.userId), topN ?? DEEP_TOP_N, today ?? todayUTC()),
});

// ──────── tool.backlog_health.set_gwt ────────
const Part = z.string().trim().min(1).max(TOOL_TEXT_MAX.text);

const GwtParams = z.object({
  storyId: z.string().min(1),
  scenarios: z
    .array(z.object({ given: Part, when: Part, then: Part }))
    .max(TOOL_LIST_MAX.gwt)
    .describe("Given/When/Then scenarios, in order. An empty list with replace clears them."),
  mode: z
    .enum(["replace", "append"])
    .optional()
    .describe(
      "replace (default): these become the story's scenarios; append: added after its own."
    ),
});

async function setGwt(store: StoryStore, p: z.infer<typeof GwtParams>) {
  const story = await store.get(p.storyId);
  if (!story) return { updated: false as const, reason: "No such story." };
  const kept = p.mode === "append" ? (story.gwt ?? []) : [];
  const taken = new Set(kept.map((g) => g.id));
  const added: StoryGwt[] = p.scenarios.map((s) => {
    const id = newGwtId(taken);
    taken.add(id);
    return { id, ...s };
  });
  const all = [...kept, ...added];
  if (all.length > TOOL_LIST_MAX.gwt) {
    return {
      updated: false as const,
      reason: `A story keeps at most ${TOOL_LIST_MAX.gwt} scenarios; it has ${kept.length}.`,
    };
  }
  const next = withStoryGwt(story, all);
  await store.put(next);
  return { updated: true as const, count: next.gwt?.length ?? 0 };
}

registry.register({
  id: "tool.backlog_health.set_gwt",
  toolId: "tool.backlog_health",
  name: "set_gwt",
  category: "write",
  description:
    "Write Given/When/Then acceptance criteria on a story: mode replace (default) or append. They sit beside the story's free-text acceptanceCriteria, which stay as they are. At most 20 per story. Returns {updated: true, count} or {updated: false, reason}.",
  paramsSchema: GwtParams,
  handler: async (p) => setGwt(browserStore, p),
  mcpHandler: async (p, ctx) => setGwt(serverStore(ctx.userId), p),
});

// ──────── tool.backlog_health.split_story ────────
const SplitParams = z.object({
  storyId: z.string().min(1).describe("The big story to split."),
  titles: z
    .array(z.string().trim().min(1).max(STORY_TITLE_MAX))
    .min(2)
    .max(6)
    .describe("The smaller stories' titles, in order; each should still deliver something."),
});

async function splitStory(store: StoryStore, p: z.infer<typeof SplitParams>) {
  const story = await store.get(p.storyId);
  if (!story) return { split: false as const, reason: "No such story." };
  const ids: string[] = [];
  for (const title of p.titles) {
    const next: Story = {
      id: `story_${nanoid(8)}`,
      title: title.replace(/\s+/g, " "),
      status: "backlog",
      ...(typeof story.priorityScore === "number" ? { priorityScore: story.priorityScore } : {}),
      ...(story.epicId ? { epicId: story.epicId } : {}),
      ...(story.tags?.length ? { tags: [...story.tags] } : {}),
      ...(story.owner ? { owner: story.owner } : {}),
    };
    await store.put(next);
    ids.push(next.id);
  }
  return { split: true as const, ids, original: story.id };
}

registry.register({
  id: "tool.backlog_health.split_story",
  toolId: "tool.backlog_health",
  name: "split_story",
  category: "write",
  description:
    "Add 2-6 smaller backlog stories for a big one, keeping its priority score, epic, tags and owner (not its points or rank: size and order them after). The original story stays; drop it with workspace.story.delete once the team agrees. Returns {split: true, ids, original} or {split: false, reason}.",
  paramsSchema: SplitParams,
  handler: async (p) => splitStory(browserStore, p),
  mcpHandler: async (p, ctx) => splitStory(serverStore(ctx.userId), p),
});
