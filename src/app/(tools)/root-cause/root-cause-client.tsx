"use client";

/**
 * Root Cause: a problem taken back to its causes with 5 Whys, a fishbone or
 * both, a Pareto chart of the fishbone's counts, then the root cause and a
 * countermeasure sent to Retro Actions so someone owns it.
 *
 * Analyses live in the workspace (rootCauseAnalyses), so Amr, the hand-off
 * routes and Post-Mortem read the same records: a post-mortem's
 * contributing factor opens here ("Analyze in Root Cause"), and an analysis
 * links to its post-mortem from here. `?analysis=<id>` opens one.
 *
 * Store writes stamp nothing: every change here stamps `updatedAt`. Deletes
 * (an analysis, a why, a cause) come with Undo, and so does every AI
 * suggestion the person accepts. Example analyses carry example ids: Clear
 * example removes them, they are never sent, and editing them isn't logged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, ListTree, Plus, Search, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { Button } from "@/components/ui/button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { generateRootCausePrompts } from "@/lib/ai-prompts/root-cause";
import { cheer } from "@/lib/celebrate/cheer";
import { sendHandoff } from "@/lib/handoffs/send";
import { sourceHref, sourceLabel } from "@/lib/handoffs/registry";
import { newRootCauseId } from "@/lib/handoffs/targets/root-cause";
import { ROOT_CAUSE_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  ROOT_CAUSE_METHOD_LABEL,
  ROOT_CAUSE_TOOL,
  STAGE_LABEL,
  analysisStage,
  blankAnalysis,
  cleanText,
  countermeasureSource,
  liveOnBoards,
  newestFirst,
  readAnalysis,
  rootCauseVerdict,
  touched,
  withCategoryRenamed,
  type LinkIsLive,
  withCause,
  withCausePatch,
  withWhy,
  withWhyText,
  type NewCause,
} from "@/lib/root-cause/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  TOOL_TEXT_MAX,
  type HandoffLink,
  type RootCauseAnalysis,
  type RootCauseCause,
  type RootCauseMethod,
  type RootCauseWhy,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { PM_ID } from "../post-mortem/constants";
import { setWhyCheck, useRootCauseChecks, useWhyChecks, type WhyCheck } from "./checks-store";
import { buildExample } from "./example";
import { FiveWhys } from "./five-whys";
import { Fishbone } from "./fishbone";
import { rootCauseToMarkdown } from "./markdown";
import { NewAnalysisForm, type NewAnalysisValues } from "./new-analysis-form";
import { Outcome, type PostMortemOption } from "./outcome";
import { Pareto } from "./pareto";

const TOOL_ID = "root-cause";
const NONE: RootCauseAnalysis[] = [];

const ws = () => useWorkspaceStore.getState();
const fresh = (id: string) => (ws().rootCauseAnalyses ?? []).find((a) => a.id === id);
const nowIso = () => new Date().toISOString();
const short = (s: string, max = 40) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The post-mortems to link to, newest incident first. */
function usePostMortems(): PostMortemOption[] {
  const logs = useWorkspaceStore((s) => s.postMortemLogs);
  return useMemo(() => {
    const doc = (logs ?? []).find((d) => d.id === PM_ID);
    return [...(doc?.postmortems ?? [])]
      .sort((a, b) => (b.incidentDate ?? "").localeCompare(a.incidentDate ?? ""))
      .map((p) => ({ id: p.id, title: p.title, incidentDate: p.incidentDate }));
  }, [logs]);
}

function AnalysisView({
  analysis,
  postMortems,
  isLive,
  onWrite,
  onRemove,
  onLog,
}: {
  analysis: RootCauseAnalysis;
  postMortems: readonly PostMortemOption[];
  /** Whether a sent link's target is still there (a deleted retro action isn't). */
  isLive: LinkIsLive;
  /** Change the analysis through the store, stamped; returns the saved one. */
  onWrite: (
    fn: (a: RootCauseAnalysis, now: string) => RootCauseAnalysis | null
  ) => RootCauseAnalysis | null;
  onRemove: () => void;
  onLog: (action: string, payload?: Record<string, unknown>) => void;
}) {
  const announce = useAnnounce();
  const [view, setView] = useState<RootCauseMethod>(analysis.method);
  const checks = useWhyChecks(analysis.id);
  const example = isExampleId(analysis.id);
  const id = analysis.id;
  const from = sourceLabel(analysis.sourceRef);
  const fromHref = sourceHref(analysis.sourceRef);

  /**
   * Name the root cause. Marking a why or a cause is finding one (logged as
   * found); typing in the field is editing it, logged as found only when
   * there was none. Amr cheers only the first one, not a typo fixed later.
   */
  const markRoot = (text: string, opts?: { typed?: boolean }) => {
    const clean = cleanText(text, TOOL_TEXT_MAX.text);
    if (!clean) return;
    const was = fresh(id)?.rootCause?.trim() ?? "";
    if (was === clean) return;
    const saved = onWrite((a, now) => touched(a, { rootCause: clean }, now));
    if (!saved) return;
    if (opts?.typed && was) {
      onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "rootCause" });
      return;
    }
    onLog(ROOT_CAUSE_ACTIONS.ROOT_CAUSE_FOUND, { analysisId: id, rootCause: clean });
    if (!example && !was) cheer(TOOL_ID, "milestone");
    announce(`Root cause: ${short(clean, 80)}. Now agree a countermeasure.`);
  };

  const addWhy = (text: string, opts?: { fromAi?: boolean }) => {
    const whyId = nanoid(8);
    const apply = () => onWrite((a, now) => withWhy(a, text, whyId, now));
    const log = (count: number) => onLog(ROOT_CAUSE_ACTIONS.WHY_ADDED, { analysisId: id, count });
    let count = 0;
    if (opts?.fromAi) {
      undoable({
        label: "Added a why",
        description: `“${short(text)}”`,
        kind: "success",
        apply: () => {
          const saved = apply();
          if (saved) log((count = saved.whys.length));
        },
        revert: () =>
          onWrite((a, now) => touched(a, { whys: a.whys.filter((w) => w.id !== whyId) }, now)),
      });
    } else {
      const saved = apply();
      if (saved) log((count = saved.whys.length));
    }
    if (count > 0) announce(`Added why ${count}.`);
  };

  const removeWhy = (why: RootCauseWhy) => {
    const before = fresh(id)?.whys ?? [];
    const at = before.findIndex((w) => w.id === why.id);
    undoable({
      label: `Deleted “${short(why.text)}”`,
      apply: () => {
        onWrite((a, now) => touched(a, { whys: a.whys.filter((w) => w.id !== why.id) }, now));
        onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "whys" });
      },
      revert: () =>
        onWrite((a, now) => {
          if (a.whys.some((w) => w.id === why.id)) return null;
          const whys = [...a.whys];
          whys.splice(Math.min(Math.max(0, at), whys.length), 0, why);
          return touched(a, { whys }, now);
        }),
    });
  };

  const addCause = (cause: NewCause) => {
    const causeId = nanoid(8);
    const saved = onWrite((a, now) => withCause(a, cause, causeId, now));
    if (saved) {
      onLog(ROOT_CAUSE_ACTIONS.CAUSE_ADDED, {
        analysisId: id,
        category: cause.category,
        count: saved.causes.length,
      });
      announce(`Added “${short(cause.text)}” under ${cause.category}.`);
    }
  };

  const removeCause = (cause: RootCauseCause) => {
    const before = fresh(id)?.causes ?? [];
    const at = before.findIndex((c) => c.id === cause.id);
    undoable({
      label: `Deleted “${short(cause.text)}”`,
      apply: () => {
        onWrite((a, now) => touched(a, { causes: a.causes.filter((c) => c.id !== cause.id) }, now));
        onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "causes" });
      },
      revert: () =>
        onWrite((a, now) => {
          if (a.causes.some((c) => c.id === cause.id)) return null;
          const causes = [...a.causes];
          causes.splice(Math.min(Math.max(0, at), causes.length), 0, cause);
          return touched(a, { causes }, now);
        }),
    });
  };

  const moveCause = (causeId: string, category: string) => {
    const cause = fresh(id)?.causes.find((c) => c.id === causeId);
    if (!cause) return;
    const was = cause.category;
    undoable({
      label: `Moved “${short(cause.text)}” to ${category}`,
      kind: "success",
      apply: () => {
        onWrite((a, now) => withCausePatch(a, causeId, { category }, now));
        onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "causes" });
      },
      revert: () => onWrite((a, now) => withCausePatch(a, causeId, { category: was }, now)),
    });
  };

  const setCountermeasure = (text: string, opts?: { fromAi?: boolean }) => {
    const clean = cleanText(text, TOOL_TEXT_MAX.text);
    const was = fresh(id)?.countermeasure;
    const apply = () => {
      onWrite((a, now) => {
        const next = touched(a, { countermeasure: clean || undefined }, now);
        if (!clean) delete next.countermeasure;
        return next;
      });
      onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "countermeasure" });
    };
    if (!opts?.fromAi) return apply();
    undoable({
      label: "Countermeasure filled in",
      description: `“${short(clean)}”`,
      kind: "success",
      apply,
      revert: () =>
        onWrite((a, now) => {
          const next = touched(a, { countermeasure: was }, now);
          if (!was) delete next.countermeasure;
          return next;
        }),
    });
  };

  const setRootCause = (text: string) => {
    const clean = cleanText(text, TOOL_TEXT_MAX.text);
    if (!clean) {
      onWrite((a, now) => {
        const next = touched(a, {}, now);
        delete next.rootCause;
        return next;
      });
      onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "rootCause" });
      return;
    }
    markRoot(clean, { typed: true });
  };

  const send = () => {
    const cur = fresh(id);
    if (!cur || isExampleId(cur.id) || !cur.countermeasure?.trim()) return;
    const { title, description } = countermeasureSource(cur);
    const link = sendHandoff(
      "retro-action",
      { title, description, sourceRef: { tool: ROOT_CAUSE_TOOL, id: cur.id } },
      {
        getLinks: () => fresh(id)?.sentTo,
        setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) =>
          onWrite((a, now) => touched(a, { sentTo: update(a.sentTo) }, now)),
      }
    );
    if (link) {
      onLog(ROOT_CAUSE_ACTIONS.COUNTERMEASURE_SENT, { analysisId: id, targetId: link.targetId });
      announce("The countermeasure is now an action in Retro Actions.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`rca-title-${id}`} className="block text-xs font-medium text-sub">
              The problem
            </label>
            <BlurInput
              id={`rca-title-${id}`}
              value={analysis.title}
              maxLength={TOOL_TEXT_MAX.short}
              className="font-semibold"
              onCommit={(text) => {
                const title = text.replace(/\s+/g, " ").trim();
                if (!title) return;
                onWrite((a, now) => touched(a, { title }, now));
                onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "title" });
              }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="mt-5 gap-1.5 text-sub hover:text-danger"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete analysis
          </Button>
        </div>
        <div>
          <label htmlFor={`rca-problem-${id}`} className="mb-1 block text-xs font-medium text-sub">
            What happened, as a fact
          </label>
          <BlurTextarea
            id={`rca-problem-${id}`}
            rows={2}
            value={analysis.problem}
            maxLength={TOOL_TEXT_MAX.text}
            placeholder="Where, when and how often. No names and no blame."
            onCommit={(text) => {
              onWrite((a, now) =>
                touched(a, { problem: cleanText(text, TOOL_TEXT_MAX.text) }, now)
              );
              onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "problem" });
            }}
          />
        </div>
        <p className="text-xs text-sub">
          {STAGE_LABEL[analysisStage(analysis, isLive)]}
          {from && fromHref && (
            <>
              {" · "}
              <a href={fromHref} className="font-medium text-accent hover:underline">
                {from}
              </a>
            </>
          )}
        </p>
      </div>

      <div role="group" aria-label="Method" className="flex flex-wrap gap-2">
        {(["five-whys", "fishbone"] as const).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={view === m ? "default" : "outline"}
            aria-pressed={view === m}
            onClick={() => setView(m)}
            className="gap-1.5"
          >
            {m === "five-whys" ? (
              <ListTree className="h-4 w-4" aria-hidden="true" />
            ) : (
              <GitBranch className="h-4 w-4" aria-hidden="true" />
            )}
            {ROOT_CAUSE_METHOD_LABEL[m]}
            <span className="font-mono text-xs opacity-80">
              {m === "five-whys" ? analysis.whys.length : analysis.causes.length}
            </span>
          </Button>
        ))}
      </div>

      {view === "five-whys" ? (
        <FiveWhys
          analysis={analysis}
          checks={checks}
          readOnlyAi={example}
          onAdd={addWhy}
          onEdit={(whyId, text) => {
            onWrite((a, now) => withWhyText(a, whyId, text, now));
            onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "whys" });
          }}
          onRemove={removeWhy}
          onMarkRoot={markRoot}
          onCheck={(whyId, answer: WhyCheck | null) => setWhyCheck(id, whyId, answer)}
        />
      ) : (
        <div className="space-y-5">
          <Fishbone
            analysis={analysis}
            readOnlyAi={example}
            onAdd={addCause}
            onPatch={(causeId, patch) => {
              onWrite((a, now) => withCausePatch(a, causeId, patch, now));
              onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "causes" });
            }}
            onRemove={removeCause}
            onRename={(fromName, to) => {
              onWrite((a, now) => withCategoryRenamed(a, fromName, to, now));
              onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "category" });
              announce(`Renamed ${fromName} to ${to}.`);
            }}
            onMarkRoot={markRoot}
            onMove={moveCause}
          />
          <Pareto causes={analysis.causes} />
        </div>
      )}

      <Outcome
        analysis={analysis}
        postMortems={postMortems}
        onRootCause={setRootCause}
        onCountermeasure={setCountermeasure}
        onSend={send}
        onLinkPostMortem={(pmId) => {
          onWrite((a, now) => {
            const next = touched(a, pmId ? { postMortemId: pmId } : {}, now);
            if (!pmId) delete next.postMortemId;
            return next;
          });
          onLog(ROOT_CAUSE_ACTIONS.ANALYSIS_UPDATED, { analysisId: id, field: "postMortemId" });
          announce(pmId ? "Linked to the post-mortem." : "No longer linked to a post-mortem.");
        }}
      />
    </div>
  );
}

export function RootCauseClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.rootCauseAnalyses) ?? NONE;
  const analyses = useMemo(
    () =>
      newestFirst(
        stored.flatMap((raw) => {
          const a = readAnalysis(raw);
          return a ? [a] : [];
        })
      ),
    [stored]
  );
  const postMortems = usePostMortems();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // A countermeasure counts as sent while its action is still in Retro Actions.
  const retroBoards = useWorkspaceStore((s) => s.retroBoards);
  const isLive = useMemo(() => liveOnBoards(retroBoards), [retroBoards]);
  // Choosing, creating or deleting an analysis moves focus to the one shown
  // (on a phone it opens below the list, out of sight), or to the start form.
  const headingRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const focusShown = useRef(false);
  const select = (analysisId: string | null) => {
    focusShown.current = true;
    setSelectedId(analysisId);
  };

  // ?analysis=<id> (a hand-off's Open, Post-Mortem's link), read after mount.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("analysis");
    if (id) setSelectedId(id);
  }, []);
  useEffect(() => {
    const { persist } = useRootCauseChecks;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: the checks start empty */
    });
  }, []);

  const selected = analyses.find((a) => a.id === selectedId) ?? analyses[0] ?? null;
  const example = hasExampleItems(analyses);
  const verdict = rootCauseVerdict(
    analyses.filter((a) => !isExampleId(a.id)),
    isLive
  );

  useEffect(() => {
    if (!focusShown.current) return;
    focusShown.current = false;
    const target =
      headingRef.current ??
      startRef.current?.querySelector<HTMLElement>("input, textarea, button") ??
      null;
    target?.focus();
  });

  /** Log a change unless it's to the example. */
  const logFor = useCallback(
    (analysisId: string) => (action: string, payload?: Record<string, unknown>) => {
      if (!isExampleId(analysisId)) log(action, payload);
    },
    [log]
  );

  const write = useCallback(
    (
      id: string,
      fn: (a: RootCauseAnalysis, now: string) => RootCauseAnalysis | null
    ): RootCauseAnalysis | null => {
      const cur = fresh(id);
      const read = cur ? readAnalysis(cur) : null;
      const next = read ? fn(read, nowIso()) : null;
      if (next) ws().upsertRootCauseAnalysis(next);
      return next;
    },
    []
  );

  const create = (values: NewAnalysisValues) => {
    const a = blankAnalysis(values, newRootCauseId(), nowIso());
    ws().upsertRootCauseAnalysis(a);
    log(ROOT_CAUSE_ACTIONS.ANALYSIS_CREATED, {
      analysisId: a.id,
      title: a.title,
      method: a.method,
    });
    select(a.id);
    setCreating(false);
    announce(
      `Started “${short(a.title)}”. ${a.method === "five-whys" ? "Ask why it happened." : "Add its causes."}`
    );
  };

  const remove = (a: RootCauseAnalysis) => {
    const at = analyses.findIndex((x) => x.id === a.id);
    const neighbour = analyses[at + 1] ?? analyses[at - 1];
    const saved = fresh(a.id) ?? a;
    undoable({
      label: `Deleted “${short(a.title)}”`,
      apply: () => {
        ws().removeRootCauseAnalysis(a.id);
        if (!isExampleId(a.id)) log(ROOT_CAUSE_ACTIONS.ANALYSIS_REMOVED, { analysisId: a.id });
      },
      revert: () => {
        if (!fresh(a.id)) ws().upsertRootCauseAnalysis(saved);
        setSelectedId(a.id);
      },
    });
    select(neighbour?.id ?? null);
  };

  const loadExample = () => {
    for (const a of buildExample()) ws().upsertRootCauseAnalysis(a);
    setSelectedId(null);
  };
  const clearExample = () => {
    for (const a of ws().rootCauseAnalyses ?? []) {
      if (isExampleId(a.id)) ws().removeRootCauseAnalysis(a.id);
    }
    setSelectedId(null);
  };

  const pmTitle = (id: string) => postMortems.find((p) => p.id === id)?.title;
  const markdown = rootCauseToMarkdown(analyses, { verdict, postMortemTitle: pmTitle });
  const promptConfig = useMemo(
    () => ({ toolName: "Root Cause", prompts: generateRootCausePrompts(selected) }),
    [selected]
  );

  return (
    <ToolPageWrapper
      toolId="root-cause"
      title="Root Cause"
      description="5 Whys and fishbone diagrams, from a problem to a countermeasure."
    >
      {!hydrated ? (
        <WorkspaceLoading>Loading analyses…</WorkspaceLoading>
      ) : (
        <div className="space-y-5">
          {example && <ExampleNotice onClear={clearExample} />}

          {analyses.length === 0 ? (
            <>
              <EmptyState
                icon={Search}
                action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
              >
                No analysis yet. Name a problem below to ask why it happened, or load an example to
                see a 5 Whys and a fishbone with its Pareto chart.
              </EmptyState>
              <SectionCard title="Start an analysis" icon={Plus}>
                <div ref={startRef}>
                  <NewAnalysisForm onCreate={create} />
                </div>
              </SectionCard>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-text">{verdict}</p>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                <nav aria-label="Analyses" className="space-y-2">
                  <ul className="space-y-1.5">
                    {analyses.map((a) => {
                      const current = selected?.id === a.id;
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            aria-current={current ? "true" : undefined}
                            onClick={() => select(a.id)}
                            className={cn(
                              "w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                              current
                                ? "border-accent bg-accent/10"
                                : "border-border bg-card hover:border-accent/40"
                            )}
                          >
                            <span className="block break-words text-sm font-medium text-text">
                              {a.title}
                            </span>
                            <span className="block text-xs text-sub">
                              {ROOT_CAUSE_METHOD_LABEL[a.method]} ·{" "}
                              {STAGE_LABEL[analysisStage(a, isLive)]}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {creating ? (
                    <div className="rounded-lg border border-border bg-card p-3">
                      <NewAnalysisForm onCreate={create} onCancel={() => setCreating(false)} />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() => setCreating(true)}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      New analysis
                    </Button>
                  )}
                </nav>
                {selected && (
                  <SectionCard
                    title={
                      <span
                        ref={headingRef}
                        tabIndex={-1}
                        className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {selected.title}
                      </span>
                    }
                    icon={Search}
                  >
                    <AnalysisView
                      key={selected.id}
                      analysis={selected}
                      postMortems={postMortems}
                      isLive={isLive}
                      onWrite={(fn) => write(selected.id, fn)}
                      onRemove={() => remove(selected)}
                      onLog={logFor(selected.id)}
                    />
                  </SectionCard>
                )}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton filename="root-cause" markdown={markdown} clipboardText={markdown} />
          </div>
        </div>
      )}
    </ToolPageWrapper>
  );
}
