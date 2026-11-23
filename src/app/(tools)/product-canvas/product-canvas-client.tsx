"use client";

/**
 * Product Canvas: a product idea on one page, in the format that fits it: a
 * Vision Board with its pitch, a Value Proposition, an idea in the inbox, a
 * Lean UX canvas, a PR/FAQ, a lean business case or a Shape Up pitch. Each
 * box is a section of the sectioned kit; lines are marked a fact or a
 * guess, and a guess (or a Lean UX hypothesis) goes to the Hypothesis
 * Tracker to be tested.
 *
 * Two formats get a view of their own beside the list:
 *   - the idea inbox (the format filter "Idea intake"): quick capture, the
 *     ideas by status and demand, look-alikes to merge, a straw poll; ideas
 *     stay out of "All", which lists every other canvas;
 *   - the betting table (the filter "Shape Up pitch"): every pitch by where
 *     it stands, and the cycles they're bet on.
 *
 * Canvases live in the workspace (productCanvases), so Amr and the
 * hand-offs read the same records; this browser keeps only how the page is
 * viewed (the format filter, the inbox filter, "Include who asked").
 * `?canvas=<id>` opens one canvas, `?format=<id>` the list of one format.
 *
 * Store writes stamp nothing: every change goes through the canvas model,
 * which stamps `updatedAt` and refuses what doesn't fit. Deletes have Undo,
 * and so does every AI suggestion accepted, a merge and a cycle's new
 * dates. Example canvases carry example ids: Clear example removes them,
 * they are never sent, never mixed with the team's (look-alikes, merges,
 * cycles), and changes to them aren't logged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { LayoutTemplate, Plus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { useActiveProductGoal } from "@/components/product-goal/product-goal-line";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { generateProductCanvasPrompts } from "@/lib/ai-prompts/product-canvas";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { BUILT_FORMATS, PRODUCT_FORMATS, productFormat } from "@/lib/product-canvas/formats";
import { ideasOf, inboxView } from "@/lib/product-canvas/intake";
import { pitchesOf } from "@/lib/product-canvas/bets";
import {
  formatOf,
  itemsOf,
  newCanvas,
  newCanvasId,
  newIdea,
  readCanvas,
  readCanvases,
  type CanvasWrite,
} from "@/lib/product-canvas/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hypothesis, ProductCanvas, ProductCanvasFormat } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayIso } from "@/lib/sprints/series";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import type { CanvasHandle } from "./boxes";
import { CanvasView } from "./canvas-view";
import { EXAMPLE_STORY_TITLES, EXAMPLE_VISION, buildExample, exampleGoal } from "./example";
import {
  bettingTableToMarkdown,
  canvasToMarkdown,
  emptyMarkdown,
  inboxToMarkdown,
} from "./markdown";
import { FormatPicker, NewCanvasForm, type NewCanvasValues } from "./new-canvas-form";
import type { BetWriter } from "./panels/bet-controls";
import type { InboxWriter } from "./panels/inbox-panel";
import {
  readInboxFilter,
  readLastFormat,
  setInboxFilter,
  setLastFormat,
  setWithRequesters,
  useProductCanvasPrefs,
} from "./store";

const InboxPanel = dynamic(() => import("./panels/inbox-panel").then((m) => m.InboxPanel), {
  ssr: false,
});
const BettingTable = dynamic(() => import("./panels/betting-table").then((m) => m.BettingTable), {
  ssr: false,
});

const TOOL_ID = "product-canvas";
const NONE: readonly unknown[] = [];
const NO_HYPOTHESES: readonly Hypothesis[] = [];

const ws = () => useWorkspaceStore.getState();
const freshRow = (id: string) => (ws().productCanvases ?? []).find((c) => c.id === id);
const fresh = (id: string) => readCanvas(freshRow(id));
const freshAll = () => readCanvases(ws().productCanvases);
/** The canvases read beside `c`: the example's with the example, the team's with theirs. */
const worldOf = (c: Pick<ProductCanvas, "id">, all: readonly ProductCanvas[]) =>
  all.filter((x) => isExampleId(x.id) === isExampleId(c.id));
const nowIso = () => new Date().toISOString();
const short = (s: string, max = 40) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const putRows = (rows: readonly ProductCanvas[]) => {
  for (const r of rows) ws().upsertProductCanvas(r);
};

const refusedGone: CanvasWrite = {
  ok: false,
  reason: "not_found",
  message: "This canvas isn't here any more.",
};

/** Rehydrate a persisted store once, quietly: blocked storage leaves its defaults. */
function useRehydrate(store: {
  persist: { hasHydrated: () => boolean; rehydrate: () => unknown };
}) {
  useEffect(() => {
    const { persist } = store;
    void Promise.resolve(persist.hasHydrated() ? undefined : persist.rehydrate()).catch(() => {
      /* storage blocked: the defaults stand */
    });
  }, [store]);
}

export function ProductCanvasClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore((s) => s.productCanvases) ?? NONE;
  const canvases = useMemo(() => readCanvases(stored), [stored]);
  const activeGoal = useActiveProductGoal();
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers);
  const hypotheses = useMemo(
    () => trackers?.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? NO_HYPOTHESES,
    [trackers]
  );
  const stories = useWorkspaceStore((s) => s.stories);
  const storyTitles = useMemo(
    () =>
      (stories ?? [])
        .filter((s) => !isExampleId(s.id) && s.title?.trim())
        .map((s) => s.title)
        .slice(0, 20),
    [stories]
  );
  const vision = useProductGoalPrefs((s) => s.vision);
  const filter = readLastFormat(useProductCanvasPrefs((s) => s.lastFormat));
  const inboxFilter = readInboxFilter(useProductCanvasPrefs((s) => s.inboxFilter));
  const withRequesters = useProductCanvasPrefs((s) => s.withRequesters) === true;
  useRehydrate(useProductGoalPrefs);
  useRehydrate(useProductCanvasPrefs);

  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The new-canvas form: open with this format chosen ("" for none yet), or closed (null). */
  const [creating, setCreating] = useState<ProductCanvasFormat | "" | null>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const focusShown = useRef(false);
  const select = (id: string | null) => {
    focusShown.current = true;
    setSelectedId(id);
  };

  const openFromUrl = useCallback((params: URLSearchParams) => {
    const id = params.get("canvas");
    const format = params.get("format");
    if (format !== null) {
      const known = readLastFormat(format);
      if (known) setLastFormat(known);
      dropSearchParam("format");
    }
    if (id) {
      setSelectedId(id);
      // A canvas opened by link shows whatever the filter: it may be in
      // another format. An idea shows in the inbox, the rest under All.
      const c = fresh(id);
      if (c && readLastFormat(useProductCanvasPrefs.getState().lastFormat) !== c.format) {
        setLastFormat(c.format === "idea" ? "idea" : "");
      }
      dropSearchParam("canvas");
    }
  }, []);

  const inbox = filter === "idea";
  // The canvases the filter takes in: one format's, or (All) every one but the ideas.
  const pool = filter
    ? canvases.filter((c) => c.format === filter)
    : canvases.filter((c) => c.format !== "idea");
  // What the list shows: the inbox's ideas by its filter, or the pool.
  const shown = inbox ? inboxView(pool, inboxFilter) : pool;
  const selected = pool.find((c) => c.id === selectedId) ?? shown[0] ?? null;
  const example = hasExampleItems(canvases);

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
    (canvasId: string) => (action: string, payload?: Record<string, unknown>) => {
      if (!isExampleId(canvasId)) log(action, payload);
    },
    [log]
  );

  /** Show a canvas, switching the filter when it is somewhere else. */
  const openCanvas = useCallback((id: string) => {
    const c = fresh(id);
    if (c) {
      const lastFormat = readLastFormat(useProductCanvasPrefs.getState().lastFormat);
      if (c.format === "idea" && lastFormat !== "idea") setLastFormat("idea");
      else if (c.format !== "idea" && lastFormat && lastFormat !== c.format) setLastFormat("");
    }
    focusShown.current = true;
    setSelectedId(id);
  }, []);

  const handleFor = useCallback(
    (canvas: ProductCanvas): CanvasHandle => ({
      canvas,
      hypotheses,
      read: () => fresh(canvas.id),
      write: (fn) => {
        const cur = fresh(canvas.id);
        if (!cur) return refusedGone;
        const result = fn(cur, nowIso());
        if (result.ok && result.canvas !== cur) ws().upsertProductCanvas(result.canvas);
        return result;
      },
      log: logFor(canvas.id),
      world: () => worldOf(canvas, freshAll()),
      put: putRows,
      open: openCanvas,
    }),
    [hypotheses, logFor, openCanvas]
  );

  const writerLog = useCallback(
    (canvasId: string, action: string, payload?: Record<string, unknown>) =>
      logFor(canvasId)(action, payload),
    [logFor]
  );

  const create = (values: NewCanvasValues, opts: { quick?: boolean } = {}) => {
    if (values.format === "idea") {
      const w = newIdea({
        id: newCanvasId(),
        now: nowIso(),
        title: values.title,
        ...(values.requester ? { requester: values.requester } : {}),
        ...(values.source ? { source: values.source } : {}),
        ...(activeGoal ? { productGoalId: activeGoal.id } : {}),
      });
      if (!w.ok) {
        announce(w.message);
        return;
      }
      ws().upsertProductCanvas(w.canvas);
      log(PRODUCT_CANVAS_ACTIONS.IDEA_LOGGED, {
        canvasId: w.canvas.id,
        source: w.canvas.intake?.source ?? "other",
      });
      setLastFormat("idea");
      setCreating(null);
      // The inbox's quick capture keeps the cursor in it, ready for the next idea.
      if (opts.quick) setSelectedId(w.canvas.id);
      else select(w.canvas.id);
      announce(`Logged “${short(w.canvas.title)}” in the idea inbox.`);
      return;
    }
    const c = newCanvas({
      id: newCanvasId(),
      format: values.format,
      title: values.title,
      now: nowIso(),
      ...(activeGoal ? { productGoalId: activeGoal.id } : {}),
    });
    ws().upsertProductCanvas(c);
    log(PRODUCT_CANVAS_ACTIONS.CANVAS_CREATED, { canvasId: c.id, format: c.format });
    if (filter && filter !== c.format) setLastFormat("");
    setCreating(null);
    select(c.id);
    announce(`Started “${short(c.title)}”, a ${formatOf(c).name}.`);
  };

  const remove = (c: ProductCanvas) => {
    const at = shown.findIndex((x) => x.id === c.id);
    const neighbour = shown[at + 1] ?? shown[at - 1];
    const saved = freshRow(c.id) ?? c;
    undoable({
      label: `Deleted “${short(c.title)}”`,
      apply: () => {
        ws().removeProductCanvas(c.id);
        if (!isExampleId(c.id)) {
          log(PRODUCT_CANVAS_ACTIONS.CANVAS_REMOVED, { canvasId: c.id, format: c.format });
        }
      },
      revert: () => {
        if (!freshRow(c.id)) ws().upsertProductCanvas(saved);
        setSelectedId(c.id);
      },
    });
    select(neighbour?.id ?? null);
  };

  const loadExample = () => {
    for (const c of buildExample()) ws().upsertProductCanvas(c);
    setLastFormat("");
    setSelectedId(null);
  };
  const clearExample = () => {
    for (const c of ws().productCanvases ?? []) {
      if (isExampleId(c.id)) ws().removeProductCanvas(c.id);
    }
    setSelectedId(null);
  };

  // An example canvas reads the example's goal, vision and backlog, never the team's.
  const selectedExample = selected ? isExampleId(selected.id) : false;
  const theExampleGoal = useMemo(() => exampleGoal(), []);
  const goal = selectedExample ? theExampleGoal : activeGoal;
  const draftContext = useMemo(
    () =>
      selectedExample
        ? { goal: theExampleGoal, vision: EXAMPLE_VISION, stories: EXAMPLE_STORY_TITLES }
        : { goal: activeGoal ?? null, vision, stories: storyTitles },
    [selectedExample, theExampleGoal, activeGoal, vision, storyTitles]
  );
  const selectedWorld = useMemo(
    () => canvases.filter((c) => isExampleId(c.id) === selectedExample),
    [canvases, selectedExample]
  );
  const gapContext = useMemo(
    () => ({
      goal: goal ?? null,
      hypotheses,
      today: todayIso(),
      ideas: ideasOf(selectedWorld),
    }),
    [goal, hypotheses, selectedWorld]
  );

  // The betting table shows one world: the open pitch's, else the team's, else the example's.
  const tableWorld = useMemo(() => {
    if (filter !== "shape-up") return [];
    if (selected?.format === "shape-up") return selectedWorld;
    const team = canvases.filter((c) => !isExampleId(c.id));
    return pitchesOf(team).length > 0 ? team : canvases.filter((c) => isExampleId(c.id));
  }, [filter, selected, selectedWorld, canvases]);
  const tableExample = tableWorld.length > 0 && isExampleId(tableWorld[0].id);
  const betWriter: BetWriter = useMemo(
    () => ({
      world: () => freshAll().filter((c) => isExampleId(c.id) === tableExample),
      put: putRows,
      log: writerLog,
    }),
    [tableExample, writerLog]
  );
  const inboxWriter: InboxWriter = useMemo(
    () => ({ all: freshAll, put: putRows, log: writerLog }),
    [writerLog]
  );

  const canvasMarkdown = selected
    ? canvasToMarkdown(selected, {
        goal,
        hypotheses,
        withRequesters,
        canvases: selectedWorld,
      })
    : "";
  // The export is the view: the inbox or the betting table, then the canvas open beside it.
  const markdown = inbox
    ? [inboxToMarkdown(pool, { withRequesters }), canvasMarkdown]
        .filter(Boolean)
        .join("\n\n---\n\n")
    : filter === "shape-up"
      ? [bettingTableToMarkdown(tableWorld), canvasMarkdown].filter(Boolean).join("\n\n---\n\n")
      : canvasMarkdown || emptyMarkdown();
  const promptConfig = useMemo(() => {
    const prompts = selected
      ? generateProductCanvasPrompts(selected.format, {
          title: selected.title,
          goal: goal?.statement ?? "",
          boxes: Object.fromEntries(
            formatOf(selected).sections.map((d) => [
              d.id,
              itemsOf(selected, d.id).map((i) => i.text),
            ])
          ),
        })
      : [];
    return { toolName: "Product Canvas", prompts };
  }, [selected, goal]);

  const counts = useMemo(() => {
    const out = new Map<ProductCanvasFormat, number>();
    for (const c of canvases) out.set(c.format, (out.get(c.format) ?? 0) + 1);
    return out;
  }, [canvases]);
  const allCount = canvases.length - (counts.get("idea") ?? 0);

  const pickFormat = (f: ProductCanvasFormat) => {
    focusShown.current = true;
    // An idea is logged in the inbox's quick capture.
    if (f === "idea") {
      setLastFormat("idea");
      setCreating(null);
      return;
    }
    setCreating(f);
  };

  const newCanvasForm = (
    <NewCanvasForm
      key={creating ?? ""}
      format={creating ?? ""}
      onCreate={(v) => create(v)}
      onCancel={() => setCreating(null)}
      ideas={ideasOf(canvases.filter((c) => !isExampleId(c.id)))}
      onOpenIdea={openCanvas}
    />
  );

  return (
    <ToolPageWrapper
      toolId="product-canvas"
      title="Product Canvas"
      description="A product idea on one page, in the format that fits it."
    >
      <OnSearchParams onChange={openFromUrl} />
      {!hydrated ? (
        <WorkspaceLoading>Loading canvases…</WorkspaceLoading>
      ) : (
        <div className="space-y-5">
          {example && <ExampleNotice onClear={clearExample} />}

          {canvases.length === 0 && !inbox ? (
            <>
              <EmptyState
                icon={LayoutTemplate}
                action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
              >
                No canvas yet. Pick a format below to put a product idea on one page, or load an
                example to see one of each.
              </EmptyState>
              {creating !== null ? (
                <SectionCard title="Start a canvas" icon={Plus}>
                  <div ref={startRef}>{newCanvasForm}</div>
                </SectionCard>
              ) : (
                <FormatPicker onPick={pickFormat} />
              )}
            </>
          ) : (
            <>
              {filter === "shape-up" && (
                <BettingTable
                  pitches={tableWorld}
                  writer={betWriter}
                  onOpen={openCanvas}
                  example={tableExample}
                />
              )}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                <nav aria-label="Canvases" className="space-y-3">
                  <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={filter === "" ? "toolkit" : "outline"}
                      aria-pressed={filter === ""}
                      onClick={() => setLastFormat("")}
                    >
                      All <span className="font-mono text-xs opacity-80">{allCount}</span>
                    </Button>
                    {BUILT_FORMATS.filter((id) => counts.get(id) || id === filter).map((id) => (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={filter === id ? "toolkit" : "outline"}
                        aria-pressed={filter === id}
                        onClick={() => setLastFormat(id)}
                      >
                        {PRODUCT_FORMATS[id]?.name}{" "}
                        <span className="font-mono text-xs opacity-80">{counts.get(id) ?? 0}</span>
                      </Button>
                    ))}
                  </div>
                  {inbox ? (
                    <div ref={startRef}>
                      <InboxPanel
                        canvases={pool}
                        selectedId={selected?.id ?? null}
                        filter={inboxFilter}
                        withRequesters={withRequesters}
                        onSelect={openCanvas}
                        onFilter={setInboxFilter}
                        onWithRequesters={setWithRequesters}
                        onLog={(v) => create(v, { quick: true })}
                        writer={inboxWriter}
                      />
                    </div>
                  ) : (
                    <>
                      {shown.length === 0 ? (
                        <p className="text-sm text-sub">
                          {filter ? `No ${productFormat(filter)?.name} yet.` : "No canvas yet."}
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {shown.map((c) => {
                            const current = selected?.id === c.id;
                            return (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  aria-current={current ? "true" : undefined}
                                  onClick={() => select(c.id)}
                                  className={cn(
                                    "w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    current
                                      ? "border-accent bg-accent/10"
                                      : "border-border bg-card hover:border-accent/40"
                                  )}
                                >
                                  <span className="block break-words text-sm font-medium text-text">
                                    {c.title}
                                  </span>
                                  <span className="block text-xs text-sub">{formatOf(c).name}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {creating !== null ? (
                        <div ref={startRef} className="rounded-lg border border-border bg-card p-3">
                          {newCanvasForm}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full gap-1.5"
                          onClick={() => {
                            focusShown.current = true;
                            setCreating(filter || "");
                          }}
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          New canvas
                        </Button>
                      )}
                    </>
                  )}
                </nav>
                {selected ? (
                  <CanvasView
                    key={selected.id}
                    ref={creating === null ? headingRef : undefined}
                    handle={handleFor(selected)}
                    goal={goal}
                    draftContext={draftContext}
                    gapContext={gapContext}
                    onRemove={() => remove(selected)}
                    onOpenTable={
                      selected.format === "shape-up" && filter !== "shape-up"
                        ? () => setLastFormat("shape-up")
                        : undefined
                    }
                  />
                ) : inbox ? (
                  <p className="text-sm text-sub">
                    Pick an idea to check it, or log one: it lands here.
                  </p>
                ) : null}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton filename="product-canvas" markdown={markdown} clipboardText={markdown} />
          </div>
        </div>
      )}
    </ToolPageWrapper>
  );
}
