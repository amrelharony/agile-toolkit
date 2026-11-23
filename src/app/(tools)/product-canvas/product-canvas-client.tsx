"use client";

/**
 * Product Canvas: a product idea on one page, in the format that fits it: a
 * Vision Board with its pitch, a Value Proposition, a Lean UX canvas or a
 * PR/FAQ. Each box is a section of the sectioned kit; lines are marked a
 * fact or a guess, and a guess (or a Lean UX hypothesis) goes to the
 * Hypothesis Tracker to be tested.
 *
 * Canvases live in the workspace (productCanvases), so Amr and the
 * hand-offs read the same records; this browser keeps only the list's
 * format filter. `?canvas=<id>` opens one canvas, `?format=<id>` the list
 * of one format.
 *
 * Store writes stamp nothing: every change goes through the canvas model,
 * which stamps `updatedAt` and refuses what doesn't fit. Deletes have Undo,
 * and so does every AI suggestion accepted. Example canvases carry example
 * ids: Clear example removes them, they are never sent, and changes to
 * them aren't logged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  formatOf,
  itemsOf,
  newCanvas,
  newCanvasId,
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
import { canvasToMarkdown, emptyMarkdown } from "./markdown";
import { FormatPicker, NewCanvasForm, type NewCanvasValues } from "./new-canvas-form";
import { readLastFormat, setLastFormat, useProductCanvasPrefs } from "./store";

const TOOL_ID = "product-canvas";
const NONE: readonly unknown[] = [];
const NO_HYPOTHESES: readonly Hypothesis[] = [];

const ws = () => useWorkspaceStore.getState();
const freshRow = (id: string) => (ws().productCanvases ?? []).find((c) => c.id === id);
const fresh = (id: string) => readCanvas(freshRow(id));
const nowIso = () => new Date().toISOString();
const short = (s: string, max = 40) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
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
      // A canvas opened by link shows whatever the filter: it may be in another format.
      const c = fresh(id);
      if (c && readLastFormat(useProductCanvasPrefs.getState().lastFormat) !== c.format) {
        setLastFormat("");
      }
      dropSearchParam("canvas");
    }
  }, []);

  const shown = filter ? canvases.filter((c) => c.format === filter) : canvases;
  const selected = shown.find((c) => c.id === selectedId) ?? shown[0] ?? null;
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
    }),
    [hypotheses, logFor]
  );

  const create = (values: NewCanvasValues) => {
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
  const gapContext = useMemo(
    () => ({ goal: goal ?? null, hypotheses, today: todayIso() }),
    [goal, hypotheses]
  );

  const markdown = selected ? canvasToMarkdown(selected, { goal, hypotheses }) : emptyMarkdown();
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

          {canvases.length === 0 ? (
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
                  <div ref={startRef}>
                    <NewCanvasForm
                      key={creating}
                      format={creating}
                      onCreate={create}
                      onCancel={() => setCreating(null)}
                    />
                  </div>
                </SectionCard>
              ) : (
                <FormatPicker
                  onPick={(f) => {
                    focusShown.current = true;
                    setCreating(f);
                  }}
                />
              )}
            </>
          ) : (
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
                    All <span className="font-mono text-xs opacity-80">{canvases.length}</span>
                  </Button>
                  {BUILT_FORMATS.filter((id) => counts.get(id)).map((id) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={filter === id ? "toolkit" : "outline"}
                      aria-pressed={filter === id}
                      onClick={() => setLastFormat(id)}
                    >
                      {PRODUCT_FORMATS[id]?.name}{" "}
                      <span className="font-mono text-xs opacity-80">{counts.get(id)}</span>
                    </Button>
                  ))}
                </div>
                {shown.length === 0 ? (
                  <p className="text-sm text-sub">No {productFormat(filter)?.name} yet.</p>
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
                    <NewCanvasForm
                      format={creating}
                      onCreate={create}
                      onCancel={() => setCreating(null)}
                    />
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
              </nav>
              {selected && (
                <CanvasView
                  key={selected.id}
                  ref={creating === null ? headingRef : undefined}
                  handle={handleFor(selected)}
                  goal={goal}
                  draftContext={draftContext}
                  gapContext={gapContext}
                  onRemove={() => remove(selected)}
                />
              )}
            </div>
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
