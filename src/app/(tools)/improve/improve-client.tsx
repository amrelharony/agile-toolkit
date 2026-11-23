"use client";

/**
 * Improve: one thing improved at a time, as an A3 (a problem on one page,
 * from why it matters to whether the change worked) or an Improvement Kata
 * (a target reached in small experiments, with a short coaching talk after
 * each one).
 *
 * Improvements live in the workspace (improvements), so Amr's verbs, the
 * next-step rule and Root Cause read the same records. `?item=<id>` opens
 * one; `?from=<analysis id>` (Root Cause's "Plan and check it in Improve")
 * opens the improvement already made from that analysis, or the start
 * form filled from it (its problem, root cause and countermeasure, with
 * the action it already sent), and nothing is saved until Start.
 *
 * Store writes stamp nothing: every change here stamps updatedAt. Deletes
 * come with Undo, and so does every AI suggestion the person accepts.
 * Example improvements carry example ids: Clear example removes them, they
 * are never sent, editing them isn't logged and they show no AI buttons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Footprints, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { OnSearchParams, dropSearchParams } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { IMPROVE_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  BLANK_TITLE,
  IMPROVEMENT_ID_PREFIX,
  IMPROVE_TOOL,
  METHOD_LABEL,
  STATUS_LABEL,
  blankImprovement,
  improveVerdict,
  itemVerdict,
  newestFirst,
  readImprovements,
  stepDoneIn,
  type NewImprovement,
  type StepDone,
  type VerdictContext,
} from "@/lib/improve/model";
import {
  countermeasureSource,
  liveOnBoards,
  readAnalyses,
  sentLink,
  newestFirst as newestAnalysesFirst,
} from "@/lib/root-cause/model";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  TOOL_TEXT_MAX,
  type Improvement,
  type ImprovementStep,
  type RootCauseAnalysis,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { A3View } from "./a3-view";
import { buildExample } from "./example";
import { PersonField, RequiredBlurInput } from "./fields";
import { KataView } from "./kata-view";
import { improveToMarkdown } from "./markdown";
import { NewItemForm, type NewItemValues } from "./new-item-form";
import { short, useItemActions, type Log } from "./use-item-actions";

const NONE: Improvement[] = [];
const ws = () => useWorkspaceStore.getState();
const nowIso = () => new Date().toISOString();

/** A new improvement id, as the workspace CRUD makes them. */
export const newImprovementId = (): string => `${IMPROVEMENT_ID_PREFIX}${nanoid(8)}`;

/** What the start form opens with, from a Root Cause analysis. */
interface StartFrom {
  initial: { title: string; method: "a3" };
  label: string;
  seed: Omit<NewImprovement, "title" | "method">;
  analysisId: string;
}

/**
 * The start form's seed from an analysis: its problem as why it matters,
 * its root cause as why it happens, and its countermeasure's first line as
 * the first countermeasure (its "Check:" line as what is expected). When
 * the countermeasure was already sent to Retro Actions, that link comes
 * along, so the action isn't sent twice and the row reads done when it is.
 */
export function startFromAnalysis(
  a: RootCauseAnalysis,
  boards: Parameters<typeof liveOnBoards>[0],
  stepId: string
): StartFrom {
  const steps: ImprovementStep[] = [];
  if (a.countermeasure?.trim()) {
    const { title } = countermeasureSource(a);
    const check = a.countermeasure
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^check:/i.test(l));
    const sent = sentLink(a, liveOnBoards(boards));
    steps.push({
      id: stepId,
      text: title.slice(0, TOOL_TEXT_MAX.text),
      ...(check && check.replace(/^check:\s*/i, "")
        ? { expect: check.replace(/^check:\s*/i, "").slice(0, TOOL_TEXT_MAX.text) }
        : {}),
      status: "planned",
      ...(sent ? { sentTo: [sent] } : {}),
    });
  }
  const brings = [
    "its problem",
    a.rootCause?.trim() ? "root cause" : "",
    steps.length > 0 ? "countermeasure" : "",
  ].filter(Boolean);
  const list =
    brings.length <= 1
      ? brings[0]
      : `${brings.slice(0, -1).join(", ")} and ${brings[brings.length - 1]}`;
  return {
    initial: { title: a.title.slice(0, TOOL_TEXT_MAX.short), method: "a3" },
    label: `From the Root Cause analysis “${short(a.title, 60)}”: ${list} come along.`,
    seed: {
      background: a.problem,
      ...(a.rootCause?.trim() ? { analysis: a.rootCause } : {}),
      rootCauseId: a.id,
      steps,
    },
    analysisId: a.id,
  };
}

function ItemView({
  item,
  analyses,
  done,
  log,
  onRemove,
}: {
  item: Improvement;
  analyses: readonly RootCauseAnalysis[];
  done: StepDone;
  log: Log;
  onRemove: () => void;
}) {
  const actions = useItemActions(item.id, log);
  const id = item.id;
  const [titleError, setTitleError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 basis-full space-y-1 sm:basis-0 sm:flex-1">
            <label htmlFor={`improve-title-${id}`} className="block text-xs font-medium text-sub">
              What you’re improving
            </label>
            <RequiredBlurInput
              id={`improve-title-${id}`}
              value={item.title}
              maxLength={TOOL_TEXT_MAX.short}
              className="font-semibold"
              aria-describedby={titleError ? `improve-title-${id}-error` : undefined}
              onBlank={() => setTitleError(BLANK_TITLE)}
              onCommit={(text) => {
                setTitleError(null);
                actions.setTitle(text);
              }}
            />
            {titleError && (
              <p id={`improve-title-${id}-error`} role="alert" className="text-xs text-danger">
                {titleError}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="gap-1.5 text-sub hover:text-danger sm:mt-5"
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </div>
        <p className="text-xs text-sub">
          {METHOD_LABEL[item.method]} · {STATUS_LABEL[item.status]}
        </p>
        <PersonField
          label="Who leads it"
          value={item.owner ?? ""}
          onCommit={(name) => actions.setPerson("owner", name)}
          className="max-w-sm"
        />
        {actions.rowError && (
          <p role="alert" className="text-sm text-danger">
            {actions.rowError}
          </p>
        )}
      </div>
      {item.method === "a3" ? (
        <A3View item={item} analyses={analyses} done={done} actions={actions} />
      ) : (
        <KataView item={item} done={done} actions={actions} />
      )}
    </div>
  );
}

export function ImproveClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.improvements) ?? NONE;
  const items = useMemo(() => newestFirst(readImprovements(stored)), [stored]);
  const rawAnalyses = useWorkspaceStore((s) => s.rootCauseAnalyses);
  const allAnalyses = useMemo(() => readAnalyses(rawAnalyses), [rawAnalyses]);
  // The picker offers the team's own analyses, newest first: never the example's.
  const analyses = useMemo(
    () => newestAnalysesFirst(allAnalyses).filter((a) => !isExampleId(a.id)),
    [allAnalyses]
  );
  const boards = useWorkspaceStore((s) => s.retroBoards);
  const stories = useWorkspaceStore((s) => s.stories);
  const done = useMemo(() => stepDoneIn({ boards, stories }), [boards, stories]);
  const { log } = useHistoryLogger(IMPROVE_TOOL);
  const announce = useAnnounce();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<StartFrom | "blank" | null>(null);
  const [pending, setPending] = useState<{ item: string | null; from: string | null } | null>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  // Each request to show the selected improvement (or the start form) takes
  // focus there once: a count, so a request always renders and is used up
  // at once, even when the selection doesn't change.
  const [focusAsk, setFocusAsk] = useState(0);
  const askFocus = () => setFocusAsk((n) => n + 1);
  const select = (itemId: string | null) => {
    askFocus();
    setSelectedId(itemId);
  };

  const today = todayIso();
  const ctx: VerdictContext = { today, done, analyses: allAnalyses };
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const example = hasExampleItems(items);
  const real = items.filter((i) => !isExampleId(i.id));
  const verdict = improveVerdict(real.length > 0 ? real : items, ctx);

  useEffect(() => {
    if (focusAsk === 0) return;
    const target =
      headingRef.current ??
      startRef.current?.querySelector<HTMLElement>("input, textarea, button") ??
      null;
    target?.focus();
  }, [focusAsk]);

  /** Open `?from=`: the improvement already made from that analysis, or the form filled from it. */
  const openFrom = useCallback(
    (rcaId: string) => {
      if (isExampleId(rcaId)) return;
      const analysis = readAnalyses(ws().rootCauseAnalyses).find((a) => a.id === rcaId);
      if (!analysis) return;
      const existing = newestFirst(readImprovements(ws().improvements)).find(
        (i) => i.rootCauseId === rcaId
      );
      if (existing) {
        select(existing.id);
        return;
      }
      setCreating(startFromAnalysis(analysis, ws().retroBoards, nanoid(8)));
      askFocus();
      setSelectedId(null);
    },
    // `select` and `askFocus` only set state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Links are read once the workspace has loaded: before, nothing is there to open.
  useEffect(() => {
    if (!hydrated || !pending) return;
    setPending(null);
    if (pending.from) openFrom(pending.from);
    else if (pending.item) select(pending.item);
    dropSearchParams(["item", "from"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, pending, openFrom]);

  /** Log a change unless it's to the example. */
  const logFor = useCallback(
    (itemId: string): Log =>
      (action, payload) => {
        if (!isExampleId(itemId)) log(action, payload);
      },
    [log]
  );

  const create = (values: NewItemValues) => {
    const from = creating && creating !== "blank" ? creating : null;
    const item = blankImprovement(
      { title: values.title, method: values.method, ...(from?.seed ?? {}) },
      newImprovementId(),
      nowIso()
    );
    ws().upsertImprovement(item);
    log(IMPROVE_ACTIONS.ITEM_CREATED, {
      itemId: item.id,
      method: item.method,
      ...(from ? { analysisId: from.analysisId } : {}),
    });
    setCreating(null);
    select(item.id);
    announce(
      `Started “${short(item.title)}”. ${
        item.method === "a3"
          ? "Say why it matters and where things stand."
          : "Set the challenge and the next target."
      }`
    );
  };

  const remove = (item: Improvement) => {
    const at = items.findIndex((x) => x.id === item.id);
    const neighbour = items[at + 1] ?? items[at - 1];
    const saved = ws().improvements?.find((x) => x.id === item.id) ?? item;
    undoable({
      label: `Deleted “${short(item.title)}”`,
      apply: () => {
        ws().removeImprovement(item.id);
        if (!isExampleId(item.id)) {
          log(IMPROVE_ACTIONS.ITEM_REMOVED, { itemId: item.id, method: item.method });
        }
      },
      revert: () => {
        if (!ws().improvements?.some((x) => x.id === item.id)) ws().upsertImprovement(saved);
        setSelectedId(item.id);
      },
    });
    select(neighbour?.id ?? null);
  };

  const loadExample = () => {
    for (const item of buildExample()) ws().upsertImprovement(item);
    setSelectedId(null);
  };
  const clearExample = () => {
    for (const item of ws().improvements ?? []) {
      if (isExampleId(item.id)) ws().removeImprovement(item.id);
    }
    setSelectedId(null);
  };

  const analysisTitle = (id: string) => allAnalyses.find((a) => a.id === id)?.title;
  const markdown = improveToMarkdown(items, { verdict, analysisTitle, done });
  const startForm = (
    <NewItemForm
      key={creating && creating !== "blank" ? creating.analysisId : "blank"}
      initial={creating && creating !== "blank" ? creating.initial : undefined}
      fromLabel={creating && creating !== "blank" ? creating.label : undefined}
      onCreate={create}
      onCancel={items.length > 0 || creating !== null ? () => setCreating(null) : undefined}
    />
  );

  return (
    <ToolPageWrapper
      toolId="improve"
      title="Improve"
      description="An A3 or an Improvement Kata: a target, its obstacles and small experiments."
    >
      <OnSearchParams
        onChange={(search) => {
          const item = search.get("item");
          const from = search.get("from");
          if (item || from) setPending({ item, from });
        }}
      />
      {!hydrated ? (
        <WorkspaceLoading>Loading improvements…</WorkspaceLoading>
      ) : (
        <div className="space-y-5">
          {example && <ExampleNotice onClear={clearExample} />}

          {items.length === 0 ? (
            <>
              <EmptyState
                icon={Footprints}
                action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
              >
                Nothing being improved yet. Start one below as an A3 or an Improvement Kata, or load
                an example to see both.
              </EmptyState>
              <SectionCard title="Start an improvement" icon={Plus}>
                <div ref={startRef}>{startForm}</div>
              </SectionCard>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-text">{verdict}</p>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                <nav aria-label="Improvements" className="space-y-2">
                  <ul className="space-y-1.5">
                    {items.map((i) => {
                      const current = !creating && selected?.id === i.id;
                      return (
                        <li key={i.id}>
                          <button
                            type="button"
                            aria-current={current ? "true" : undefined}
                            onClick={() => {
                              setCreating(null);
                              select(i.id);
                            }}
                            className={cn(
                              "w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                              current
                                ? "border-accent bg-accent/10"
                                : "border-border bg-card hover:border-accent/40"
                            )}
                          >
                            <span className="block break-words text-sm font-medium text-text">
                              {i.title}
                            </span>
                            <span className="block text-xs text-sub">
                              {METHOD_LABEL[i.method]} · {STATUS_LABEL[i.status]}
                            </span>
                            <span className="block text-xs text-sub">{itemVerdict(i, ctx)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {!creating && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() => {
                        askFocus();
                        setCreating("blank");
                      }}
                    >
                      <Plus aria-hidden="true" />
                      New improvement
                    </Button>
                  )}
                </nav>
                {creating ? (
                  <SectionCard title="Start an improvement" icon={Plus}>
                    <div ref={startRef}>{startForm}</div>
                  </SectionCard>
                ) : (
                  selected && (
                    <section
                      aria-labelledby={`improve-heading-${selected.id}`}
                      className="min-w-0 space-y-3"
                    >
                      <h2
                        id={`improve-heading-${selected.id}`}
                        className="font-display text-lg text-text"
                      >
                        <span
                          ref={headingRef}
                          tabIndex={-1}
                          className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {selected.title}
                        </span>
                      </h2>
                      <ItemView
                        key={selected.id}
                        item={selected}
                        analyses={analyses}
                        done={done}
                        log={logFor(selected.id)}
                        onRemove={() => remove(selected)}
                      />
                    </section>
                  )
                )}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <ExportButton filename="improve" markdown={markdown} clipboardText={markdown} />
          </div>
        </div>
      )}
    </ToolPageWrapper>
  );
}
