/**
 * Example Mapping — tool-local actions.
 *
 * Category: Spec Quality (tools plan, phase 2)
 *
 * Agent surface: tool.example_mapping.*
 * Backing CRUD : workspace.example_map.* (create, list, update, delete): one
 *                ExampleMap per story, under its own id ("exmap_…"), kind
 *                EXAMPLE_MAP_KIND.
 *
 *   1. list_state      — every map with its counts, what the map says (the
 *                        page's signals), its verdict, and which rules were
 *                        split into stories of their own. Example maps are
 *                        listed and marked.
 *   2. add_rule        — a rule the story must follow.
 *   3. add_example     — a concrete example under a rule, optionally as
 *                        Given/When/Then (all three or none).
 *   4. add_question    — a question nobody can answer yet, with an owner.
 *   5. answer_question — answer it (or drop it).
 *   6. set_verdict     — ready, split or not yet (null clears).
 *   7. send_to_story   — the rules into the linked story's acceptance
 *                        criteria and the structured examples into its
 *                        Given/When/Then, each once.
 *
 * Every write goes through lib/example-mapping/model, so the caps are the
 * page's and the CRUD's (a map grown past one synced row is refused with
 * reason 'too_big', as the CRUD refuses it), and stamps updatedAt as the
 * page does. The page
 * logs history, not these verbs. Nothing here reaches other people: every
 * verb is the visitor's own data.
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  EXAMPLE_MAP_KIND,
  EXAMPLE_MAP_VERDICTS,
  type ExampleMap,
  type HandoffLink,
  type Story,
} from "@/lib/stores/workspace-types";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import { isExampleId } from "@/lib/utils/example-id";
import {
  ANSWER_MAX,
  CARD_ID_PREFIX,
  CARD_TEXT_MAX,
  GWT_MAX,
  MAP_TOO_BIG,
  examplesOf,
  exampleRoomProblem,
  mapCounts,
  mapSignals,
  newestFirst,
  questionRoomProblem,
  readMap,
  readMaps,
  rowTooBig,
  ruleRoomProblem,
  storyLink,
  storyWritePlan,
  touched,
  withExample,
  withQuestion,
  withQuestionPatch,
  withRule,
  withVerdict,
  type LinkIsLive,
} from "@/lib/example-mapping/model";

const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();
const KIND_STORY = "workspace:story";

/** Where the verbs read and write: the browser's store, or the user's rows on the server. */
interface Store {
  maps: () => Promise<ExampleMap[]>;
  map: (id: string) => Promise<ExampleMap | null>;
  putMap: (m: ExampleMap) => Promise<void>;
  stories: () => Promise<Story[]>;
  story: (id: string) => Promise<Story | null>;
  putStory: (s: Story) => Promise<void>;
}

const browserStore: Store = {
  maps: async () => ws().exampleMaps ?? [],
  map: async (id) => (ws().exampleMaps ?? []).find((m) => m.id === id) ?? null,
  putMap: async (m) => ws().upsertExampleMap(m),
  stories: async () => ws().stories ?? [],
  story: async (id) => (ws().stories ?? []).find((s) => s.id === id) ?? null,
  // The store stamps and cleans every story write itself.
  putStory: async (s) => ws().upsertStory(s),
};

const serverStore = (userId: string): Store => ({
  maps: () => serverListEntities<ExampleMap>(userId, EXAMPLE_MAP_KIND),
  map: (id) => serverGetEntity<ExampleMap>(userId, EXAMPLE_MAP_KIND, id),
  putMap: async (m) => {
    await serverUpsertEntity<ExampleMap>(userId, EXAMPLE_MAP_KIND, m);
  },
  stories: () => serverListEntities<Story>(userId, KIND_STORY),
  story: (id) => serverGetEntity<Story>(userId, KIND_STORY, id),
  putStory: async (s) => {
    // Stamped and cleaned as workspace.story.* does on the server.
    const current = await serverGetEntity<Story>(userId, KIND_STORY, s.id);
    await serverUpsertEntity<Story>(
      userId,
      KIND_STORY,
      stampStoryWrite(cleanStoryFields(s), current ?? undefined)
    );
  },
});

/** A link to a backlog story is live while the story is there. */
const liveIn = (stories: readonly Story[]): LinkIsLive => {
  const ids = new Set(stories.map((s) => s.id));
  return (l: HandoffLink) => l.route === "backlog-story" && ids.has(l.targetId);
};

async function load(store: Store, id: string): Promise<ExampleMap | null> {
  const raw = await store.map(id);
  return raw ? readMap(raw) : null;
}

const NOT_FOUND = { reason: "not_found" as const, message: "No example map has that id." };

/** A change that would take the map past one synced row, refused as the CRUD and the page refuse it. */
const TOO_BIG = { reason: "too_big" as const, message: MAP_TOO_BIG };

/* ── list_state ──────────────────────────────────────────────────────── */

async function listState(store: Store) {
  const [rows, stories] = await Promise.all([store.maps(), store.stories()]);
  const isLive = liveIn(stories);
  const byId = new Map(stories.map((s) => [s.id, s]));
  const maps = newestFirst(readMaps(rows));
  return {
    total: maps.filter((m) => !isExampleId(m.id)).length,
    maps: maps.map((m) => {
      const story = m.storyId ? byId.get(m.storyId) : undefined;
      return {
        id: m.id,
        example: isExampleId(m.id),
        title: m.title,
        storyId: m.storyId ?? null,
        storyTitle: story?.title ?? null,
        verdict: m.verdict ?? null,
        timeboxMinutes: m.timeboxMinutes ?? null,
        sentAt: m.sentAt ?? null,
        counts: mapCounts(m),
        signals: mapSignals(m).map((s) => s.text),
        rules: m.rules.map((r) => ({
          id: r.id,
          text: r.text,
          splitInto: storyLink(r.sentTo, isLive)?.targetId ?? null,
          examples: examplesOf(m, r.id).map((e) => ({
            id: e.id,
            text: e.text,
            ...(e.given ? { given: e.given, when: e.when, then: e.then } : {}),
          })),
        })),
        questions: m.questions.map((q) => ({
          id: q.id,
          text: q.text,
          ruleId: q.ruleId ?? null,
          owner: q.owner ?? null,
          status: q.status,
          answer: q.answer ?? null,
        })),
        updatedAt: m.updatedAt,
      };
    }),
  };
}

// ──────── tool.example_mapping.list_state ────────
registry.register({
  id: "tool.example_mapping.list_state",
  toolId: "tool.example_mapping",
  name: "list_state",
  category: "read",
  description:
    "Summarise the example maps, newest change first. Returns {total (example maps left out), maps:{id, example (true for one from Load example), title, storyId|null (the backlog story it maps), storyTitle|null, verdict ('ready'|'split'|'not-yet')|null, timeboxMinutes|null, sentAt|null (when its rules and examples last went to the story), counts:{rules, examples, structured, open, answered, dropped}, signals:string[] (what the map says, as the page shows it), rules:{id, text, splitInto|null (the story 'Split by rule' made), examples:{id, text, given?, when?, then?}[]}[], questions:{id, text, ruleId|null, owner|null, status, answer|null}[], updatedAt}[]}. Create, rename or delete a map with workspace.example_map.*.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_p, ctx) => listState(serverStore(ctx.userId)),
});

/* ── add_rule ────────────────────────────────────────────────────────── */

const MapId = z.string().min(1).describe("The map's id (see list_state).");
const CardText = (what: string) => z.string().trim().min(1).max(CARD_TEXT_MAX).describe(what);

const AddRuleParams = z.object({
  mapId: MapId,
  text: CardText("The rule, one short sentence a tester could check."),
});

async function addRule(store: Store, p: z.infer<typeof AddRuleParams>) {
  const map = await load(store, p.mapId);
  if (!map) return { added: false as const, ...NOT_FOUND };
  const id = `${CARD_ID_PREFIX.rule}${nanoid(8)}`;
  const next = withRule(map, p.text, id, nowIso());
  if (!next) {
    return { added: false as const, reason: "full" as const, message: ruleRoomProblem(map) ?? "" };
  }
  if (rowTooBig(next, map)) return { added: false as const, ...TOO_BIG };
  await store.putMap(next);
  return { added: true as const, ruleId: id, rules: next.rules.length };
}

registry.register({
  id: "tool.example_mapping.add_rule",
  toolId: "tool.example_mapping",
  name: "add_rule",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a rule (a business rule or acceptance criterion) to an example map. Returns {added: true, ruleId, rules}, or {added: false, reason: 'not_found' | 'full' | 'too_big', message} (12 rules at most: more is several stories; too_big: the map would pass one saved row).",
  paramsSchema: AddRuleParams,
  handler: (p) => addRule(browserStore, p),
  mcpHandler: (p, ctx) => addRule(serverStore(ctx.userId), p),
});

/* ── add_example ─────────────────────────────────────────────────────── */

const GwtPart = z.string().trim().min(1).max(GWT_MAX);

const AddExampleParams = z
  .object({
    mapId: MapId,
    ruleId: z.string().min(1).describe("The rule it illustrates (see list_state)."),
    text: CardText("The example in one line, with real names and numbers."),
    given: GwtPart.optional(),
    when: GwtPart.optional(),
    then: GwtPart.optional(),
  })
  .refine(
    (p) =>
      [p.given, p.when, p.then].every((v) => v === undefined) ||
      [p.given, p.when, p.then].every((v) => v !== undefined),
    { message: "Give Given, When and Then all three, or none." }
  );

async function addExample(store: Store, p: z.infer<typeof AddExampleParams>) {
  const map = await load(store, p.mapId);
  if (!map) return { added: false as const, ...NOT_FOUND };
  const problem = exampleRoomProblem(map, p.ruleId);
  if (problem) return { added: false as const, reason: "refused" as const, message: problem };
  const id = `${CARD_ID_PREFIX.example}${nanoid(8)}`;
  const next = withExample(map, p, id, nowIso());
  if (!next)
    return { added: false as const, reason: "refused" as const, message: "Nothing to add." };
  if (rowTooBig(next, map)) return { added: false as const, ...TOO_BIG };
  await store.putMap(next);
  return { added: true as const, exampleId: id, examples: next.examples.length };
}

registry.register({
  id: "tool.example_mapping.add_example",
  toolId: "tool.example_mapping",
  name: "add_example",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a concrete example under one rule of an example map, optionally written as Given/When/Then (all three or none). Returns {added: true, exampleId, examples}, or {added: false, reason: 'not_found' | 'refused' | 'too_big', message} (10 examples a rule, 60 a map; too_big: the map would pass one saved row).",
  paramsSchema: AddExampleParams,
  handler: (p) => addExample(browserStore, p),
  mcpHandler: (p, ctx) => addExample(serverStore(ctx.userId), p),
});

/* ── add_question ────────────────────────────────────────────────────── */

const AddQuestionParams = z.object({
  mapId: MapId,
  text: CardText("The question nobody in the room can answer yet."),
  ruleId: z.string().min(1).optional().describe("The rule it is about, when it is about one."),
  owner: z
    .string()
    .trim()
    .max(CARD_TEXT_MAX)
    .optional()
    .describe("Who will find the answer: a name from the team, spelled as on the Team page."),
});

async function addQuestion(store: Store, p: z.infer<typeof AddQuestionParams>) {
  const map = await load(store, p.mapId);
  if (!map) return { added: false as const, ...NOT_FOUND };
  if (p.ruleId && !map.rules.some((r) => r.id === p.ruleId)) {
    return {
      added: false as const,
      reason: "refused" as const,
      message: "That rule isn't on the map.",
    };
  }
  const id = `${CARD_ID_PREFIX.question}${nanoid(8)}`;
  const next = withQuestion(map, p, id, nowIso());
  if (!next) {
    return {
      added: false as const,
      reason: "full" as const,
      message: questionRoomProblem(map) ?? "",
    };
  }
  if (rowTooBig(next, map)) return { added: false as const, ...TOO_BIG };
  await store.putMap(next);
  return { added: true as const, questionId: id, open: mapCounts(next).open };
}

registry.register({
  id: "tool.example_mapping.add_question",
  toolId: "tool.example_mapping",
  name: "add_question",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an open question to an example map, optionally about one rule and with the owner who will find the answer. Returns {added: true, questionId, open}, or {added: false, reason: 'not_found' | 'refused' | 'full' | 'too_big', message} (20 questions at most; too_big: the map would pass one saved row).",
  paramsSchema: AddQuestionParams,
  handler: (p) => addQuestion(browserStore, p),
  mcpHandler: (p, ctx) => addQuestion(serverStore(ctx.userId), p),
});

/* ── answer_question ─────────────────────────────────────────────────── */

const AnswerParams = z.object({
  mapId: MapId,
  questionId: z.string().min(1).describe("The question's id (see list_state)."),
  answer: z
    .string()
    .trim()
    .max(ANSWER_MAX)
    .optional()
    .describe("The answer. Needed to mark it answered."),
  status: z
    .enum(["answered", "dropped", "open"])
    .optional()
    .describe("answered (default with an answer), dropped (no longer matters), or open again."),
});

async function answerQuestion(store: Store, p: z.infer<typeof AnswerParams>) {
  const map = await load(store, p.mapId);
  if (!map) return { updated: false as const, ...NOT_FOUND };
  const q = map.questions.find((x) => x.id === p.questionId);
  if (!q)
    return { updated: false as const, reason: "not_found" as const, message: "No such question." };
  const status = p.status ?? (p.answer ? "answered" : undefined);
  if (!status) {
    return {
      updated: false as const,
      reason: "refused" as const,
      message: "Give an answer or a status.",
    };
  }
  if (status === "answered" && !(p.answer || q.answer)) {
    return {
      updated: false as const,
      reason: "refused" as const,
      message: "An answered question needs its answer.",
    };
  }
  const next = withQuestionPatch(
    map,
    p.questionId,
    { status, ...(p.answer !== undefined ? { answer: p.answer } : {}) },
    nowIso()
  );
  if (!next)
    return { updated: false as const, reason: "not_found" as const, message: "No such question." };
  if (rowTooBig(next, map)) return { updated: false as const, ...TOO_BIG };
  await store.putMap(next);
  return { updated: true as const, status, open: mapCounts(next).open };
}

registry.register({
  id: "tool.example_mapping.answer_question",
  toolId: "tool.example_mapping",
  name: "answer_question",
  category: "write",
  requiresConfirmation: false,
  description:
    "Answer an example map's question (status answered, the default when an answer is given), drop it, or open it again. Returns {updated: true, status, open}, or {updated: false, reason: 'not_found' | 'refused' | 'too_big', message}.",
  paramsSchema: AnswerParams,
  handler: (p) => answerQuestion(browserStore, p),
  mcpHandler: (p, ctx) => answerQuestion(serverStore(ctx.userId), p),
});

/* ── set_verdict ─────────────────────────────────────────────────────── */

const VerdictParams = z.object({
  mapId: MapId,
  verdict: z
    .enum(EXAMPLE_MAP_VERDICTS)
    .nullable()
    .describe(
      "ready (to build), split (by rule: too big), not-yet (waiting on answers); null clears."
    ),
});

async function setVerdict(store: Store, p: z.infer<typeof VerdictParams>) {
  const map = await load(store, p.mapId);
  if (!map) return { updated: false as const, ...NOT_FOUND };
  const next = withVerdict(map, p.verdict, nowIso());
  if (rowTooBig(next, map)) return { updated: false as const, ...TOO_BIG };
  await store.putMap(next);
  return { updated: true as const, verdict: p.verdict };
}

registry.register({
  id: "tool.example_mapping.set_verdict",
  toolId: "tool.example_mapping",
  name: "set_verdict",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set what the team decided about an example map's story: ready, split or not-yet (null clears). Splitting into stories is done on the page. Returns {updated: true, verdict} or {updated: false, reason: 'not_found' | 'too_big', message}.",
  paramsSchema: VerdictParams,
  handler: (p) => setVerdict(browserStore, p),
  mcpHandler: (p, ctx) => setVerdict(serverStore(ctx.userId), p),
});

/* ── send_to_story ───────────────────────────────────────────────────── */

const SendParams = z.object({ mapId: MapId });

async function sendToStory(store: Store, p: z.infer<typeof SendParams>) {
  const map = await load(store, p.mapId);
  if (!map) return { sent: false as const, ...NOT_FOUND };
  if (isExampleId(map.id)) {
    return {
      sent: false as const,
      reason: "example" as const,
      message: "Example maps aren't sent.",
    };
  }
  if (!map.storyId) {
    return {
      sent: false as const,
      reason: "no_story" as const,
      message: "The map isn't linked to a backlog story. Add it to the backlog on the page first.",
    };
  }
  const story = await store.story(map.storyId);
  if (!story) {
    return {
      sent: false as const,
      reason: "no_story" as const,
      message: "Its story is no longer in the workspace.",
    };
  }
  const plan = storyWritePlan(story, map);
  if (!plan.ok) return { sent: false as const, reason: "too_long" as const, message: plan.problem };
  const stamped = touched(map, { sentAt: nowIso() }, nowIso());
  // Checked before the story is written, so a refusal changes nothing.
  if (rowTooBig(stamped, map)) return { sent: false as const, ...TOO_BIG };
  if (!plan.unchanged) await store.putStory(plan.next);
  await store.putMap(stamped);
  return {
    sent: true as const,
    storyId: story.id,
    rules: plan.rules,
    examples: plan.examples,
    notSent: plan.notSent.length,
  };
}

registry.register({
  id: "tool.example_mapping.send_to_story",
  toolId: "tool.example_mapping",
  name: "send_to_story",
  category: "write",
  requiresConfirmation: false,
  description:
    "Write an example map's rules into its linked story's acceptance criteria (as '- rule' lines, each once) and its Given/When/Then examples into the story's scenarios (each once, 20 at most). Returns {sent: true, storyId, rules, examples, notSent} or {sent: false, reason: 'not_found' | 'example' | 'no_story' | 'too_long' | 'too_big', message}. Refused when no story is linked or the criteria would pass 2,000 characters.",
  paramsSchema: SendParams,
  handler: (p) => sendToStory(browserStore, p),
  mcpHandler: (p, ctx) => sendToStory(serverStore(ctx.userId), p),
});
