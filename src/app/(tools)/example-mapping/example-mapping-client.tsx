"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { nanoid } from "nanoid";
import { CircleHelp, ListChecks, Plus, StickyNote, Trash2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { generateExampleMappingPrompts } from "@/lib/ai-prompts/example-mapping";
import {
  EXAMPLE_MAPPING_AI,
  mapExamplesTask,
  keepKnownRules,
  mapQuestionsTask,
  mapRulesTask,
  type ExamplesInput,
  type QuestionsInput,
  type RulesInput,
  type SuggestedExample,
} from "@/lib/ai/tasks/example-mapping.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { cheer } from "@/lib/celebrate/cheer";
import {
  CARD_ID_PREFIX,
  CARD_TEXT_MAX,
  EXAMPLE_MAPPING_PATH,
  EXAMPLE_MAP_ID_PREFIX,
  MAP_TOO_BIG,
  TIMEBOX_DEFAULT,
  VERDICT_LABEL,
  blankMap,
  examplesOf,
  exampleRoomProblem,
  mapCounts,
  mapSignals,
  newestFirst,
  questionRoomProblem,
  readMaps,
  rowTooBig,
  ruleFromQuestion,
  ruleOf,
  ruleRemoval,
  ruleRoomProblem,
  shortText,
  splitDescription,
  splitTitle,
  storyLink,
  storyWritePlan,
  touched,
  validateMapDraft,
  withCardRestored,
  withExample,
  withExampleEdit,
  withQuestion,
  withQuestionPatch,
  withRule,
  withRuleLinks,
  withRuleRestored,
  withRuleText,
  withVerdict,
  withoutExample,
  withoutQuestion,
  withoutRule,
  type MapDraft,
} from "@/lib/example-mapping/model";
import { findLink, getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { sendHandoff, sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
import { EXAMPLE_MAPPING_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { withRefinedPutBack } from "@/lib/sprints/story-status";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  type ExampleMap,
  type ExampleMapRule,
  type ExampleMapVerdict,
  type HandoffLink,
  type Story,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { undoable } from "@/lib/utils/undoable";
import {
  CaptureLine,
  ExampleCard,
  QuestionCard,
  QuestionForm,
  RuleCard,
  SELECT_CLASS,
  type QuestionValues,
} from "./cards";
import { DecidePanel } from "./decide-panel";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { currentMaps, findMap, findStory, patchMap, removeMap, saveMap } from "./store";
import { DockTimebox } from "./timebox";

export const TOOL_ID = "example-mapping";

const nowIso = () => new Date().toISOString();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cap = (t: string | undefined, max: number) => (t ?? "").slice(0, max);

const EXAMPLE_BLOCKED =
  "The example map stays here: clear it and map your own story to send rules and examples on.";
const TIMEBOX_CHOICES = [10, 15, 20, 25, 30, 45, 60] as const;

/** The backlog stories a map can be for: not done, not the example's. */
const pickable = (stories: readonly Story[]) =>
  stories.filter((s) => s.status !== "done" && !isExampleId(s.id) && s.title.trim());

/** Whether a link a send recorded still has its story. */
const storyExists = (l: HandoffLink) =>
  l.route === "backlog-story" && getHandoffRoute("backlog-story").exists(l.targetId);

type RuleSuggestion = { kind: "rule" | "question"; text: string };

/**
 * Example Mapping: one story's rules (blue cards), a concrete example or
 * two under each (green), and the questions nobody can answer yet (red),
 * mapped in a short timebox on the docked timer. What the map says (pure
 * signals) helps the team decide: ready, split by rule, or not yet. Then
 * the rules and the Given/When/Then examples go to the story's criteria
 * and scenarios, with one Undo; a typed story goes to the backlog first;
 * picked rules can become stories of their own. Amr suggests rules,
 * examples and questions, and the person picks what to keep; every
 * suggestion has a way without AI. Everything lives in
 * workspace.exampleMaps, which Amr's verbs and the next step read too.
 */
export function ExampleMappingClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.exampleMaps);
  const stories = useWorkspaceStore((s) => s.stories);
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();

  const maps = useMemo(() => newestFirst(readMaps(raw ?? [])), [raw]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingQuery, setPendingQuery] = useState<URLSearchParams | null>(null);
  const ruleInput = useRef<HTMLInputElement>(null);

  const current = maps.find((m) => m.id === currentId) ?? maps[0] ?? null;
  const story = current?.storyId ? stories.find((s) => s.id === current.storyId) : undefined;
  const hasExample = maps.some((m) => isExampleId(m.id));

  const markdown = useMemo(
    () => (current ? toMarkdown(current, story?.title) : ""),
    [current, story?.title]
  );
  const promptConfig = useMemo(
    () => ({ toolName: "Example Mapping", prompts: generateExampleMappingPrompts(current) }),
    [current]
  );

  /* ── Writing ───────────────────────────────────────────────────────── */

  // The example's maps aren't the team's history.
  const record = useCallback(
    (mapId: string, action: string, payload: Record<string, unknown>) => {
      if (!isExampleId(mapId)) log(action, { mapId, ...payload });
    },
    [log]
  );

  /**
   * Write a change to a map, refusing (and saying so inline) a map that
   * would no longer fit one synced row. Returns the saved map, or null.
   */
  const write = (id: string, fn: (m: ExampleMap) => ExampleMap | null): ExampleMap | null => {
    const now = findMap(id);
    if (!now) return null;
    const next = fn(now);
    if (!next) return null;
    if (rowTooBig(next, now)) {
      setStatus(MAP_TOO_BIG);
      announce(MAP_TOO_BIG);
      return null;
    }
    return saveMap(next);
  };

  const say = (text: string) => {
    setStatus(text);
    announce(text);
  };

  const openMap = (id: string) => {
    setCurrentId(id);
    setCreating(false);
    setStatus(null);
  };

  const createMap = (values: { title: string; storyId?: string }) => {
    const picked = values.storyId ? findStory(values.storyId) : undefined;
    const map = blankMap(
      {
        title: picked?.title ?? values.title,
        ...(picked ? { storyId: picked.id } : {}),
        timeboxMinutes: TIMEBOX_DEFAULT,
      },
      `${EXAMPLE_MAP_ID_PREFIX}${nanoid(8)}`,
      nowIso()
    );
    saveMap(map);
    record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_CREATED, picked ? { storyId: picked.id } : {});
    openMap(map.id);
    announce(`Started a map for “${shortText(map.title)}”. Add its first rule.`);
    requestAnimationFrame(() => ruleInput.current?.focus());
  };

  /** `?map=<id>` opens a map; `?story=<id>` opens that story's map, or starts one. */
  const onQuery = useCallback((params: URLSearchParams) => {
    if (params.has("map") || params.has("story")) setPendingQuery(params);
  }, []);

  useEffect(() => {
    if (!hydrated || !pendingQuery) return;
    const mapId = pendingQuery.get("map");
    const storyId = pendingQuery.get("story");
    setPendingQuery(null);
    if (mapId) {
      if (findMap(mapId)) openMap(mapId);
      dropSearchParam("map");
    }
    if (storyId) {
      const s = findStory(storyId);
      const existing = newestFirst(currentMaps()).find((m) => m.storyId === storyId);
      if (existing) openMap(existing.id);
      else if (s && !isExampleId(s.id)) createMap({ title: s.title, storyId: s.id });
      dropSearchParam("story");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per query
  }, [hydrated, pendingQuery]);

  const renameMap = (map: ExampleMap, title: string) => {
    if (write(map.id, (m) => touched(m, { title }, nowIso()))) {
      record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["title"] });
    }
  };

  const setTimebox = (map: ExampleMap, minutes: number) => {
    if (write(map.id, (m) => touched(m, { timeboxMinutes: minutes }, nowIso()))) {
      record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["timeboxMinutes"] });
    }
  };

  const deleteMap = (map: ExampleMap) => {
    let snapshot: ExampleMap | null = null;
    const label = `Deleted the map of “${shortText(map.title)}”`;
    undoable({
      label,
      apply: () => {
        snapshot = removeMap(map.id);
        record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_REMOVED, {});
      },
      revert: () => {
        if (snapshot) saveMap(snapshot);
        setCurrentId(map.id);
      },
    });
    setCurrentId(null);
    announce(label);
  };

  /* Rules */

  const addRule = (map: ExampleMap, text: string): string | null => {
    const id = `${CARD_ID_PREFIX.rule}${nanoid(8)}`;
    const saved = write(map.id, (m) => withRule(m, text, id, nowIso()));
    if (!saved) return null;
    record(map.id, EXAMPLE_MAPPING_ACTIONS.RULE_ADDED, { ruleId: id, rules: saved.rules.length });
    announce(`Added the rule “${shortText(text)}”`);
    return id;
  };

  const editRule = (map: ExampleMap, ruleId: string, text: string) => {
    if (write(map.id, (m) => withRuleText(m, ruleId, text, nowIso()))) {
      record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["rules"] });
    }
  };

  const deleteRule = (map: ExampleMap, rule: ExampleMapRule) => {
    const removal = ruleRemoval(map, rule.id);
    if (!removal) return;
    const n = removal.examples.length;
    const label = `Deleted the rule “${shortText(rule.text)}”${n > 0 ? ` and ${plural(n, "example", "examples")}` : ""}`;
    undoable({
      label,
      apply: () => {
        patchMap(map.id, (m) => withoutRule(m, rule.id, nowIso()));
        record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["rules"] });
      },
      revert: () => {
        patchMap(map.id, (m) => withRuleRestored(m, removal, nowIso()));
      },
    });
    announce(label);
  };

  /* Examples */

  const addExample = (
    map: ExampleMap,
    ruleId: string,
    input: { text: string; given?: string; when?: string; then?: string }
  ): string | null => {
    const id = `${CARD_ID_PREFIX.example}${nanoid(8)}`;
    const saved = write(map.id, (m) => withExample(m, { ruleId, ...input }, id, nowIso()));
    if (!saved) return null;
    const gwt = Boolean(input.given && input.when && input.then);
    record(map.id, EXAMPLE_MAPPING_ACTIONS.EXAMPLE_ADDED, { ruleId, exampleId: id, gwt });
    announce(`Added the example “${shortText(input.text)}”`);
    return id;
  };

  const editExample = (
    map: ExampleMap,
    exampleId: string,
    edit: Parameters<typeof withExampleEdit>[2]
  ) => {
    if (write(map.id, (m) => withExampleEdit(m, exampleId, edit, nowIso()))) {
      record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["examples"] });
      if (edit.gwt !== undefined) {
        announce(edit.gwt ? "Saved it as Given, When, Then" : "Kept it as a line");
      }
    }
  };

  const deleteExample = (map: ExampleMap, exampleId: string) => {
    const index = map.examples.findIndex((e) => e.id === exampleId);
    const item = map.examples[index];
    if (!item) return;
    const label = `Deleted the example “${shortText(item.text)}”`;
    undoable({
      label,
      apply: () => {
        patchMap(map.id, (m) => withoutExample(m, exampleId, nowIso()));
        record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["examples"] });
      },
      revert: () => {
        patchMap(map.id, (m) => withCardRestored(m, { kind: "example", item, index }, nowIso()));
      },
    });
    announce(label);
  };

  /* Questions */

  const addQuestion = (map: ExampleMap, v: { text: string; owner?: string; ruleId?: string }) => {
    const id = `${CARD_ID_PREFIX.question}${nanoid(8)}`;
    const saved = write(map.id, (m) => withQuestion(m, v, id, nowIso()));
    if (!saved) return null;
    record(map.id, EXAMPLE_MAPPING_ACTIONS.QUESTION_ADDED, { questionId: id });
    announce(`Added the question “${shortText(v.text)}”`);
    return id;
  };

  const patchQuestion = (
    map: ExampleMap,
    questionId: string,
    patch: Parameters<typeof withQuestionPatch>[2]
  ) => {
    const saved = write(map.id, (m) => withQuestionPatch(m, questionId, patch, nowIso()));
    if (!saved) return;
    if (patch.status === "answered" || patch.status === "dropped") {
      record(map.id, EXAMPLE_MAPPING_ACTIONS.QUESTION_ANSWERED, {
        questionId,
        status: patch.status,
      });
      announce(patch.status === "answered" ? "Answered" : "Dropped the question");
      if (mapCounts(saved).open === 0 && saved.questions.length > 0 && !isExampleId(map.id)) {
        cheer(TOOL_ID, "done");
      }
    } else {
      record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["questions"] });
    }
  };

  const deleteQuestion = (map: ExampleMap, questionId: string) => {
    const index = map.questions.findIndex((q) => q.id === questionId);
    const item = map.questions[index];
    if (!item) return;
    const label = `Deleted the question “${shortText(item.text)}”`;
    undoable({
      label,
      apply: () => {
        patchMap(map.id, (m) => withoutQuestion(m, questionId, nowIso()));
        record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, { fields: ["questions"] });
      },
      revert: () => {
        patchMap(map.id, (m) => withCardRestored(m, { kind: "question", item, index }, nowIso()));
      },
    });
    announce(label);
  };

  const makeRule = (map: ExampleMap, questionId: string) => {
    const q = map.questions.find((x) => x.id === questionId);
    if (!q) return;
    addRule(map, ruleFromQuestion(q));
  };

  /* Deciding and sending */

  const setVerdict = (map: ExampleMap, verdict: ExampleMapVerdict | null) => {
    if (write(map.id, (m) => withVerdict(m, verdict, nowIso()))) {
      if (verdict) record(map.id, EXAMPLE_MAPPING_ACTIONS.VERDICT_SET, { verdict });
      announce(verdict ? `Verdict: ${VERDICT_LABEL[verdict]}` : "No verdict");
    }
  };

  const sendBlocked = (map: ExampleMap) => (isExampleId(map.id) ? EXAMPLE_BLOCKED : null);

  /** The map's rules and examples into its story's criteria and scenarios, with one Undo. */
  const sendToStory = (map: ExampleMap) => {
    if (sendBlocked(map)) return;
    const target = findStory(map.storyId);
    if (!target) return say("Its story is no longer in the backlog.");
    const plan = storyWritePlan(target, map);
    if (!plan.ok) return say(plan.problem);
    // The map records when it was sent: checked first, so a refusal sends nothing.
    if (rowTooBig(touched(map, { sentAt: nowIso() }, nowIso()), map)) return say(MAP_TOO_BIG);
    if (plan.unchanged) {
      return say(
        `“${shortText(target.title)}” already has these rules and examples${plan.notSent.length > 0 ? `; ${plural(plan.notSent.length, "example", "examples")} didn't fit its 20 scenarios` : ""}.`
      );
    }
    const before = {
      criteria: target.acceptanceCriteria,
      gwt: target.gwt,
      refined: target.refinedAt,
    };
    const sentBefore = map.sentAt;
    let stamp: string | undefined;
    const lines = plan.rules + plan.examples;
    const label = `Sent ${plural(plan.rules, "rule", "rules")} and ${plural(plan.examples, "example", "examples")} to “${shortText(target.title, 40)}”`;
    undoable({
      label,
      kind: "success",
      apply: () => {
        const store = useWorkspaceStore.getState();
        store.upsertStory(plan.next);
        stamp = findStory(target.id)?.refinedAt;
        patchMap(map.id, (m) => touched(m, { sentAt: nowIso() }, nowIso()));
        record(map.id, EXAMPLE_MAPPING_ACTIONS.SENT_TO_STORY, { storyId: target.id, lines });
      },
      revert: () => {
        const cur = findStory(target.id);
        if (cur) {
          const restored: Story = { ...cur };
          if (before.criteria === undefined) delete restored.acceptanceCriteria;
          else restored.acceptanceCriteria = before.criteria;
          if (before.gwt === undefined) delete restored.gwt;
          else restored.gwt = before.gwt;
          useWorkspaceStore
            .getState()
            .upsertStory(withRefinedPutBack(restored, stamp, before.refined));
        }
        patchMap(map.id, (m) => {
          const next = touched(m, {}, nowIso());
          if (sentBefore) next.sentAt = sentBefore;
          else delete next.sentAt;
          return next;
        });
      },
    });
    say(
      `${label}.${plan.notSent.length > 0 ? ` ${plural(plan.notSent.length, "example wasn't", "examples weren't")} sent: already there, or past the story's 20 scenarios.` : ""}`
    );
    cheer(TOOL_ID, "done");
  };

  /** The map's own link store: a new backlog story becomes the story it maps. */
  const mapLinks = (id: string): HandoffLinkStore => ({
    getLinks: () => findMap(id)?.sentTo,
    setLinks: (update) => {
      patchMap(id, (m) => {
        const old = findLink(m.sentTo, "backlog-story");
        const links = update(m.sentTo);
        const link = findLink(links, "backlog-story");
        const next = touched(m, {}, nowIso());
        if (links.length > 0) next.sentTo = links;
        else delete next.sentTo;
        if (link) next.storyId = link.targetId;
        else if (old && m.storyId === old.targetId) delete next.storyId;
        return next;
      });
    },
  });

  const addToBacklog = (map: ExampleMap) => {
    if (sendBlocked(map)) return;
    const link = sendHandoff(
      "backlog-story",
      { title: map.title, sourceRef: { tool: TOOL_ID, id: map.id, doc: map.id } },
      mapLinks(map.id)
    );
    if (!link) return say(`“${shortText(map.title)}” is already in the backlog.`);
    record(map.id, EXAMPLE_MAPPING_ACTIONS.MAP_UPDATED, {
      fields: ["storyId"],
      storyId: link.targetId,
    });
    say(`Added “${shortText(map.title)}” to the backlog. Its rules and examples can go to it now.`);
  };

  const ruleLinks = (mapId: string, ruleId: string): HandoffLinkStore => ({
    getLinks: () => findMap(mapId)?.rules.find((r) => r.id === ruleId)?.sentTo,
    setLinks: (update) => {
      patchMap(mapId, (m) => {
        const r = ruleOf(m, ruleId);
        return r ? withRuleLinks(m, ruleId, update(r.sentTo), nowIso()) : null;
      });
    },
  });

  const splitRules = (map: ExampleMap, ruleIds: string[]): number => {
    if (sendBlocked(map)) return 0;
    const picked = map.rules.filter(
      (r) => ruleIds.includes(r.id) && !liveLink(r.sentTo, "backlog-story")
    );
    if (picked.length === 0) return 0;
    const before = new Map(
      picked.map((r) => [r.id, findLink(r.sentTo, "backlog-story")?.targetId])
    );
    sendHandoffBatch(
      "backlog-story",
      picked.map((r) => ({
        src: {
          title: splitTitle(map.title, r.text),
          description: splitDescription(map, r.id),
          sourceRef: { tool: TOOL_ID, id: r.id, doc: map.id },
        },
        links: ruleLinks(map.id, r.id),
      })),
      picked.length === 1
        ? `Split “${shortText(picked[0].text, 40)}” into a story`
        : `Split ${picked.length} rules into stories`
    );
    let made = 0;
    const saved = findMap(map.id);
    for (const r of picked) {
      const link = findLink(saved?.rules.find((x) => x.id === r.id)?.sentTo, "backlog-story");
      if (!link || link.targetId === before.get(r.id)) continue;
      made += 1;
      record(map.id, EXAMPLE_MAPPING_ACTIONS.SPLIT_BY_RULE, {
        ruleId: r.id,
        storyId: link.targetId,
      });
    }
    if (made > 0) say(`Made ${plural(made, "story", "stories")}, one a rule, in the backlog.`);
    return made;
  };

  /* Example */

  const loadExample = () => {
    const map = buildExample(new Date());
    saveMap(map);
    openMap(map.id);
  };
  const clearExample = () => {
    let removed: ExampleMap[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentMaps()
          .filter((m) => isExampleId(m.id))
          .map((m) => removeMap(m.id))
          .filter((m): m is ExampleMap => m !== null);
      },
      revert: () => removed.forEach(saveMap),
    });
    setCurrentId(null);
  };

  /* ── Rendering ─────────────────────────────────────────────────────── */

  const wrapper = (children: ReactNode) => (
    <ToolPageWrapper
      toolId="example-mapping"
      title="Example Mapping"
      description="Map a story's rules, examples and open questions in a timebox, then send them to the story."
      category="Spec Quality"
    >
      {children}
    </ToolPageWrapper>
  );

  if (!hydrated) return wrapper(<WorkspaceLoading>Loading the example maps…</WorkspaceLoading>);

  const newForm = (
    <SectionCard title="Map a story" icon={StickyNote}>
      <NewMapForm
        stories={pickable(stories)}
        onCreate={createMap}
        onCancel={maps.length > 0 ? () => setCreating(false) : undefined}
      />
    </SectionCard>
  );

  return wrapper(
    <div className="space-y-4">
      <OnSearchParams onChange={onQuery} />
      {hasExample && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 text-xs text-sub">
            Example: a story mapped in one session. It is never sent to the backlog.
          </p>
        </div>
      )}

      {maps.length === 0 ? (
        <>
          {newForm}
          <EmptyState icon={StickyNote} action={<LoadExampleButton onLoad={loadExample} />}>
            No maps yet. Pick a story above, or type one, then write its rules, an example for each,
            and the questions nobody can answer yet. 25 minutes is usually enough.
          </EmptyState>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {maps.length > 1 && (
              <Field label="Map" className="min-w-0 flex-1 sm:max-w-sm">
                {(props) => (
                  <select
                    {...props}
                    className={SELECT_CLASS}
                    value={current?.id ?? ""}
                    onChange={(e) => openMap(e.target.value)}
                  >
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                        {isExampleId(m.id) ? " (example)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2 self-end">
              {!creating && (
                <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" />
                  New map
                </Button>
              )}
              {current && <AiPromptGenerator config={promptConfig} />}
              {current && (
                <ExportButton
                  filename="example-map"
                  markdown={markdown}
                  clipboardText={markdown}
                  jsonData={current}
                />
              )}
            </div>
          </div>
          {creating && newForm}
          {current && (
            <MapBoard
              key={current.id}
              map={current}
              story={story}
              status={status}
              ruleInput={ruleInput}
              actions={{
                renameMap,
                setTimebox,
                deleteMap,
                addRule,
                editRule,
                deleteRule,
                addExample,
                editExample,
                deleteExample,
                addQuestion,
                patchQuestion,
                deleteQuestion,
                makeRule,
                setVerdict,
                sendToStory,
                addToBacklog,
                splitRules,
              }}
              sendBlocked={sendBlocked(current)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Starting a map ──────────────────────────────────────────────────── */

function NewMapForm({
  stories,
  onCreate,
  onCancel,
}: {
  stories: readonly Story[];
  onCreate: (v: { title: string; storyId?: string }) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<MapDraft, { title: string; storyId?: string }, "title">({
    initial: { title: "", storyId: "" },
    validate: validateMapDraft,
    onSave: onCreate,
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel="Start the map" onCancel={onCancel}>
      {stories.length > 0 && (
        <Field label="A story from the backlog">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.storyId}
              onChange={(e) => update({ storyId: e.target.value })}
            >
              <option value="">Type one instead</option>
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {!draft.storyId && (
        <Field
          label={stories.length > 0 ? "Or type the story" : "The story"}
          error={errors.title}
          hint="Not in the backlog yet? It can be added from the map."
        >
          {(props) => (
            <Input
              {...props}
              value={draft.title}
              maxLength={CARD_TEXT_MAX}
              enterKeyHint="done"
              autoComplete="off"
              placeholder="e.g. Pay with a saved card"
              onChange={(e) => update({ title: e.target.value })}
            />
          )}
        </Field>
      )}
    </ItemForm>
  );
}

/* ── The board ───────────────────────────────────────────────────────── */

interface BoardActions {
  renameMap: (map: ExampleMap, title: string) => void;
  setTimebox: (map: ExampleMap, minutes: number) => void;
  deleteMap: (map: ExampleMap) => void;
  addRule: (map: ExampleMap, text: string) => string | null;
  editRule: (map: ExampleMap, ruleId: string, text: string) => void;
  deleteRule: (map: ExampleMap, rule: ExampleMapRule) => void;
  addExample: (
    map: ExampleMap,
    ruleId: string,
    input: { text: string; given?: string; when?: string; then?: string }
  ) => string | null;
  editExample: (
    map: ExampleMap,
    exampleId: string,
    edit: Parameters<typeof withExampleEdit>[2]
  ) => void;
  deleteExample: (map: ExampleMap, exampleId: string) => void;
  addQuestion: (
    map: ExampleMap,
    v: { text: string; owner?: string; ruleId?: string }
  ) => string | null;
  patchQuestion: (
    map: ExampleMap,
    questionId: string,
    patch: Parameters<typeof withQuestionPatch>[2]
  ) => void;
  deleteQuestion: (map: ExampleMap, questionId: string) => void;
  makeRule: (map: ExampleMap, questionId: string) => void;
  setVerdict: (map: ExampleMap, verdict: ExampleMapVerdict | null) => void;
  sendToStory: (map: ExampleMap) => void;
  addToBacklog: (map: ExampleMap) => void;
  splitRules: (map: ExampleMap, ruleIds: string[]) => number;
}

/** Undo for an accepted suggestion: take back the card it added, if it is still there. */
function acceptWithUndo(label: string, add: () => string | null, remove: (id: string) => void) {
  let id: string | null = null;
  undoable({
    label,
    kind: "success",
    apply: () => {
      id = add();
    },
    revert: () => {
      if (id) remove(id);
    },
  });
}

function MapBoard({
  map,
  story,
  status,
  ruleInput,
  actions: a,
  sendBlocked,
}: {
  map: ExampleMap;
  story: Story | undefined;
  status: string | null;
  ruleInput: RefObject<HTMLInputElement>;
  actions: BoardActions;
  sendBlocked: string | null;
}) {
  const announce = useAnnounce();
  const title = useInlineEdit<HTMLButtonElement>();
  const [ruleIdeas, setRuleIdeas] = useState<{ items: RuleSuggestion[]; source: AiSource } | null>(
    null
  );
  const [exampleIdeas, setExampleIdeas] = useState<{
    ruleId: string;
    items: SuggestedExample[];
    source: AiSource;
  } | null>(null);
  const [questionIdeas, setQuestionIdeas] = useState<{
    items: { text: string; ruleId?: string }[];
    source: AiSource;
  } | null>(null);

  const signals = mapSignals(map);
  const counts = mapCounts(map);
  const minutes = map.timeboxMinutes ?? TIMEBOX_DEFAULT;
  const offerAddToRoster = !isExampleId(map.id);
  const ruleFull = ruleRoomProblem(map);
  const questionFull = questionRoomProblem(map);
  const removeCard = (id: string) => {
    const m = findMap(map.id);
    if (!m) return;
    if (m.rules.some((r) => r.id === id)) patchMap(map.id, (x) => withoutRule(x, id, nowIso()));
    else if (m.examples.some((e) => e.id === id))
      patchMap(map.id, (x) => withoutExample(x, id, nowIso()));
    else patchMap(map.id, (x) => withoutQuestion(x, id, nowIso()));
  };

  const rulesInput = (): RulesInput => ({
    title: cap(map.title, EXAMPLE_MAPPING_AI.text),
    notes: cap(story?.notes, EXAMPLE_MAPPING_AI.notes),
    criteria: cap(story?.acceptanceCriteria, EXAMPLE_MAPPING_AI.notes),
    rules: map.rules.map((r) => cap(r.text, EXAMPLE_MAPPING_AI.text)),
  });
  const examplesInput = (rule: ExampleMapRule): ExamplesInput => ({
    title: cap(map.title, EXAMPLE_MAPPING_AI.text),
    rule: cap(rule.text, EXAMPLE_MAPPING_AI.text),
    examples: examplesOf(map, rule.id)
      .slice(0, EXAMPLE_MAPPING_AI.examples)
      .map((e) => cap(e.text, EXAMPLE_MAPPING_AI.text)),
  });
  const questionsInput = (): QuestionsInput => ({
    title: cap(map.title, EXAMPLE_MAPPING_AI.text),
    rules: map.rules.map((r) => ({
      id: r.id,
      text: cap(r.text, EXAMPLE_MAPPING_AI.text),
      examples: examplesOf(map, r.id)
        .slice(0, EXAMPLE_MAPPING_AI.examplesPerRule)
        .map((e) => cap(e.text, EXAMPLE_MAPPING_AI.text)),
    })),
    questions: map.questions
      .slice(0, EXAMPLE_MAPPING_AI.questions)
      .map((q) => cap(q.text, EXAMPLE_MAPPING_AI.text)),
  });

  const acceptIdea = (idea: RuleSuggestion) =>
    acceptWithUndo(
      idea.kind === "rule"
        ? `Added the rule “${shortText(idea.text, 40)}”`
        : `Added the question “${shortText(idea.text, 40)}”`,
      () =>
        idea.kind === "rule" ? a.addRule(map, idea.text) : a.addQuestion(map, { text: idea.text }),
      removeCard
    );

  const splitHref = (rule: ExampleMapRule) => {
    const link = storyLink(rule.sentTo, storyExists);
    return link ? getHandoffRoute("backlog-story").targetHref(link.targetId) : null;
  };

  return (
    <div className="space-y-4">
      {/* The story card */}
      <section
        aria-labelledby="map-story"
        className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-semibold text-warning">The story</p>
            {title.editing ? (
              <InlineItemEditor
                label="Rename the story"
                title={map.title}
                titleLabel="Story"
                titleMaxLength={CARD_TEXT_MAX}
                onDone={(next, { refocus }) => {
                  if (next) a.renameMap(map, next.title);
                  title.stop({ refocus });
                }}
              />
            ) : (
              <h2 id="map-story" className="text-lg font-semibold text-text">
                <button
                  ref={title.triggerRef}
                  type="button"
                  onClick={title.start}
                  className="min-touch-coarse rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`${map.title}. Rename the story`}
                >
                  {map.title}
                </button>
              </h2>
            )}
            <p className="text-xs text-sub">
              {story
                ? `In the backlog${story.points ? ` · ${story.points} points` : ""}`
                : "Not in the backlog yet"}
              {" · "}
              {plural(counts.rules, "rule", "rules")},{" "}
              {plural(counts.examples, "example", "examples")},{" "}
              {plural(counts.open, "open question", "open questions")}
              {map.verdict ? ` · ${VERDICT_LABEL[map.verdict]}` : ""}
            </p>
          </div>
          <IconButton
            label={`Delete the map of “${map.title}”`}
            icon={<Trash2 aria-hidden="true" />}
            variant="ghost"
            size="icon"
            onClick={() => a.deleteMap(map)}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DockTimebox
            label={`Example Mapping · ${shortText(map.title, 40)}`}
            href={EXAMPLE_MAPPING_PATH}
            minutes={minutes}
            what="this map"
          />
          <Field label="Timebox" className="w-36">
            {(props) => (
              <select
                {...props}
                className={SELECT_CLASS}
                value={minutes}
                onChange={(e) => a.setTimebox(map, Number(e.target.value))}
              >
                {Array.from(new Set([...TIMEBOX_CHOICES, minutes]))
                  .sort((x, y) => x - y)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </div>
      </section>

      {status && (
        <p
          role="status"
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-text"
        >
          {status}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Rules and their examples */}
        <SectionCard
          title={`Rules (${counts.rules})`}
          icon={ListChecks}
          contentClassName="space-y-3"
        >
          <CaptureLine
            ref={ruleInput}
            what="rule"
            label="A rule the story must follow"
            placeholder="e.g. An expired card is refused"
            onAdd={(text) => {
              if (a.addRule(map, text)) ruleInput.current?.focus();
            }}
            fullReason={ruleFull}
          />
          <AiButton
            task={mapRulesTask}
            input={rulesInput}
            label="Ask Amr for rules"
            fallbackLabel="Suggest rules without AI"
            onResult={(data, meta) => {
              const items: RuleSuggestion[] = [
                ...data.rules.map((r) => ({ kind: "rule" as const, text: r.text })),
                ...data.questions.map((q) => ({ kind: "question" as const, text: q.text })),
              ];
              setRuleIdeas({ items, source: meta.source });
              announce(
                items.length === 0
                  ? "No new rules to suggest."
                  : `${plural(items.length, "suggestion", "suggestions")} below. Add the ones that fit.`
              );
            }}
          />
          {ruleIdeas && (
            <AiSuggestions
              items={ruleIdeas.items}
              source={ruleIdeas.source}
              title="Possible rules and questions"
              render={(i) => ({ title: i.text, detail: i.kind === "rule" ? "Rule" : "Question" })}
              onAccept={acceptIdea}
              onDismiss={() => setRuleIdeas(null)}
            />
          )}
          {map.rules.length === 0 ? (
            <p className="text-sm text-sub">
              No rules yet. A rule is something the story must always do, or never do.
            </p>
          ) : (
            <ol
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
              aria-label="Rules, each with its examples"
            >
              {map.rules.map((rule, i) => {
                const examples = examplesOf(map, rule.id);
                const href = splitHref(rule);
                return (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    index={i}
                    split={href ? { href } : null}
                    onEdit={(text) => a.editRule(map, rule.id, text)}
                    onDelete={() => a.deleteRule(map, rule)}
                    actions={
                      <div className="space-y-2">
                        <AiButton
                          task={mapExamplesTask}
                          input={() => examplesInput(rule)}
                          label="Ask Amr for examples"
                          fallbackLabel="Suggest examples without AI"
                          variant="outline"
                          onResult={(data, meta) => {
                            setExampleIdeas({
                              ruleId: rule.id,
                              items: data.examples,
                              source: meta.source,
                            });
                            announce(
                              data.examples.length === 0
                                ? "No new examples to suggest."
                                : `${plural(data.examples.length, "example", "examples")} below.`
                            );
                          }}
                        />
                        {exampleIdeas?.ruleId === rule.id && (
                          <AiSuggestions
                            items={exampleIdeas.items}
                            source={exampleIdeas.source}
                            title="Possible examples"
                            render={(e) => ({
                              title: e.text,
                              detail:
                                e.given && e.when && e.then
                                  ? `Given ${e.given}, when ${e.when}, then ${e.then}`
                                  : undefined,
                            })}
                            onAccept={(e) =>
                              acceptWithUndo(
                                `Added the example “${shortText(e.text, 40)}”`,
                                () =>
                                  a.addExample(map, rule.id, {
                                    text: e.text,
                                    ...(e.given && e.when && e.then
                                      ? { given: e.given, when: e.when, then: e.then }
                                      : {}),
                                  }),
                                removeCard
                              )
                            }
                            onDismiss={() => setExampleIdeas(null)}
                          />
                        )}
                      </div>
                    }
                  >
                    {examples.length > 0 && (
                      <ul className="space-y-2" aria-label={`Examples of “${rule.text}”`}>
                        {examples.map((e) => (
                          <ExampleCard
                            key={e.id}
                            example={e}
                            onEdit={(text) => a.editExample(map, e.id, { text })}
                            onGwt={(gwt) => a.editExample(map, e.id, { gwt })}
                            onDelete={() => a.deleteExample(map, e.id)}
                          />
                        ))}
                      </ul>
                    )}
                    <CaptureLine
                      what="example"
                      label={`An example of “${shortText(rule.text, 40)}”`}
                      hideLabel
                      placeholder="An example, with real names and numbers"
                      submitLabel="Add example"
                      onAdd={(text) => a.addExample(map, rule.id, { text })}
                      fullReason={exampleRoomProblem(map, rule.id)}
                    />
                  </RuleCard>
                );
              })}
            </ol>
          )}
        </SectionCard>

        {/* Questions */}
        <SectionCard
          title={`Questions (${counts.open} open)`}
          icon={CircleHelp}
          contentClassName="space-y-3"
        >
          <QuestionForm
            rules={map.rules}
            fullReason={questionFull}
            offerAddToRoster={offerAddToRoster}
            onAdd={(v: QuestionValues) =>
              a.addQuestion(map, {
                text: v.text,
                ...(v.owner.trim() ? { owner: v.owner } : {}),
                ...(v.ruleId ? { ruleId: v.ruleId } : {}),
              })
            }
          />
          <AiButton
            task={mapQuestionsTask}
            input={questionsInput}
            label="Ask Amr for questions"
            fallbackLabel="Suggest questions without AI"
            variant="outline"
            onResult={(data, meta) => {
              const known = keepKnownRules(data, questionsInput());
              setQuestionIdeas({ items: known.questions, source: meta.source });
              announce(
                known.questions.length === 0
                  ? "No new questions to suggest."
                  : `${plural(known.questions.length, "question", "questions")} below.`
              );
            }}
          />
          {questionIdeas && (
            <AiSuggestions
              items={questionIdeas.items}
              source={questionIdeas.source}
              title="Possible questions"
              render={(q) => ({
                title: q.text,
                detail: q.ruleId ? `About “${ruleOf(map, q.ruleId)?.text ?? ""}”` : undefined,
              })}
              onAccept={(q) =>
                acceptWithUndo(
                  `Added the question “${shortText(q.text, 40)}”`,
                  () => a.addQuestion(map, q),
                  removeCard
                )
              }
              onDismiss={() => setQuestionIdeas(null)}
            />
          )}
          {map.questions.length > 0 ? (
            <ul className="space-y-2" aria-label="Questions">
              {map.questions.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  ruleText={q.ruleId ? ruleOf(map, q.ruleId)?.text : undefined}
                  onEdit={(text) => a.patchQuestion(map, q.id, { text })}
                  onAnswer={(answer) => a.patchQuestion(map, q.id, { answer, status: "answered" })}
                  onStatus={(s) => a.patchQuestion(map, q.id, { status: s })}
                  onMakeRule={() => a.makeRule(map, q.id)}
                  makeRuleBlocked={ruleFull}
                  onDelete={() => a.deleteQuestion(map, q.id)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-sub">
              No questions. Put each thing nobody can answer on its own card.
            </p>
          )}
        </SectionCard>
      </div>

      <SectionCard title="What the map says" icon={StickyNote} contentClassName="space-y-3">
        <ul className="space-y-1.5" aria-label="What the map says">
          {signals.map((s) => (
            <li
              key={s.id}
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                s.tone === "ready"
                  ? "border-success/40 bg-success/10 text-text"
                  : s.tone === "warn"
                    ? "border-warning/40 bg-warning/10 text-text"
                    : "border-border bg-card text-text"
              )}
            >
              {s.text}
            </li>
          ))}
        </ul>
        <DecidePanel
          map={map}
          story={story}
          sendBlocked={sendBlocked}
          splitHref={splitHref}
          onVerdict={(v) => a.setVerdict(map, v)}
          onSend={() => a.sendToStory(map)}
          onAddToBacklog={() => a.addToBacklog(map)}
          onSplit={(ids) => a.splitRules(map, ids)}
        />
      </SectionCard>
    </div>
  );
}
