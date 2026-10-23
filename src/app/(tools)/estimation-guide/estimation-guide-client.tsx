"use client";

import { useEffect, useId, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Share2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ResetButton } from "@/components/shared/reset-button";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateEstimationGuidePrompts } from "@/lib/ai-prompts/estimation-guide";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story, Workspace } from "@/lib/stores/workspace-types";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ESTIMATION_GUIDE_ACTIONS } from "@/lib/history/event-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { scales, type EstimationScale } from "@/lib/constants/scales";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import {
  defaultDescription,
  entriesForScale,
  entryKey,
  migrateDescriptions,
  migrateExamples,
  readEntry,
  sameEntries,
} from "./entries";
import { hasExample, isExampleNote, withExample, withoutExample } from "./example";
import { toMarkdown } from "./markdown";
import {
  MAX_REFERENCE_STORIES,
  hasSuggestions,
  pinResolver,
  pinnedIds,
  pointsOf,
  resolveReferenceStories,
  suggestReferenceStories,
  withPin,
  withoutPin,
  type GuideEntries,
  type ReferenceStory,
} from "./references";
import { ReferenceStoriesField } from "./reference-stories";
import { isScaleAtDefaults, restoreScale, withScaleReset, type ScaleMaps } from "./scale-reset";
import { useEstimationGuideStore } from "./store";
import { guideCoverage, guideVerdict } from "./verdict";

/**
 * Encode arbitrary JSON state as a URL-safe, UTF-8-correct base64 string.
 * Plain `btoa(JSON.stringify(x))` throws on any non-Latin1 character
 * (emoji, Arabic, accented chars in descriptions). Round-trip via
 * encodeURIComponent so all UTF-8 bytes are representable.
 */
function encodeSharedState(payload: unknown): string {
  const json = JSON.stringify(payload);
  const utf8 = encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  return btoa(utf8);
}

function decodeSharedState(encoded: string): unknown {
  const utf8 = atob(encoded);
  const json = decodeURIComponent(
    utf8
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(json, (k, v) => {
    // Strip prototype-pollution-capable keys from the parsed object so a
    // shared URL can't poison Object.prototype.
    if (k === "__proto__" || k === "constructor" || k === "prototype") return undefined;
    return v;
  });
}

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const NO_STORIES: Story[] = [];

/** The current per-value maps, read fresh (an Undo can run long after its render). */
function currentMaps(): ScaleMaps {
  const s = useEstimationGuideStore.getState();
  return {
    descriptions: s.descriptions ?? {},
    examples: s.examples ?? {},
    referenceStoryIds: s.referenceStoryIds ?? {},
  };
}

/**
 * Reset and its Undo for one scale. Both come from the same render, so the
 * Undo restores the snapshot its own reset took (and the scale it reset),
 * even after another scale was reset or picked since.
 */
function scaleResetPair(scale: EstimationScale) {
  let before: ScaleMaps | null = null;
  return {
    onReset: () => {
      before = currentMaps();
      useEstimationGuideStore.setState(withScaleReset(before, scale));
    },
    onUndo: () => {
      if (before) useEstimationGuideStore.setState(restoreScale(currentMaps(), before, scale));
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EstimationGuideClient() {
  const store = useEstimationGuideStore();
  const stories = useWorkspaceStore((s) => s.stories ?? NO_STORIES);
  const queued = useWorkspaceStore(
    (s) => (s.pokerEstimationLogs ?? []).find((d) => d.id === POKER_LOG_ID)?.queue?.length ?? 0
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const { log } = useHistoryLogger("estimation-guide");

  // Hydrate persisted store on mount, then apply any URL-shared state so the
  // URL payload wins over the locally-persisted state. Running these in
  // parallel raced (whichever resolved last would clobber the other).
  useEffect(() => {
    const rehydrate = useEstimationGuideStore.persist.rehydrate();
    Promise.resolve(rehydrate).then(() => {
      // Saved entries from before per-scale keys used the bare value ("8")
      // for every scale. Copy them onto each scale that has the value.
      const saved = useEstimationGuideStore.getState();
      const descriptions = migrateDescriptions(saved.descriptions);
      const examples = migrateExamples(saved.examples);
      if (
        !sameEntries(saved.descriptions ?? {}, descriptions) ||
        !sameEntries(saved.examples ?? {}, examples)
      ) {
        useEstimationGuideStore.setState({ descriptions, examples });
      }
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const shared = params.get("state");
      if (!shared) return;
      // Bound the inbound payload — a 1MB base64 blob in the URL is hostile
      // input, not a legitimate share. The decoded JSON is then bounded
      // implicitly because base64 is ~33% larger than raw.
      if (shared.length > 100_000) return;
      try {
        const decoded = decodeSharedState(shared);
        if (!decoded || typeof decoded !== "object") return;
        const d = decoded as Record<string, unknown>;
        // Validate every field's type before adopting — a crafted payload
        // could otherwise set `selectedScale` to a function or array.
        // Pinned reference stories are never shared: they are ids in the
        // sender's workspace, which mean nothing in anyone else's.
        const patch: Partial<{
          selectedScale: string;
          descriptions: Record<string, string>;
          examples: Record<string, string>;
        }> = {};
        if (typeof d.selectedScale === "string") patch.selectedScale = d.selectedScale;
        if (
          d.descriptions &&
          typeof d.descriptions === "object" &&
          !Array.isArray(d.descriptions)
        ) {
          // Links made before per-scale keys carry bare values ("8").
          patch.descriptions = migrateDescriptions(d.descriptions);
        }
        if (d.examples && typeof d.examples === "object" && !Array.isArray(d.examples)) {
          patch.examples = migrateExamples(d.examples);
        } else {
          patch.examples = {};
        }
        // BUG-T3-estimation-guide-1: apply the patch if ANY field is
        // present, not only when selectedScale is set. Sharing just
        // descriptions/examples (a perfectly valid use case — "calibrate
        // my Fibonacci notes") previously silently dropped on load.
        if (patch.selectedScale || patch.descriptions || patch.examples) {
          useEstimationGuideStore.setState(patch);
        }
        // Clean up URL without reload
        window.history.replaceState({}, "", window.location.pathname);
        toast.success("Loaded shared estimation guide");
      } catch {
        // Invalid shared state - ignore
      }
    });
  }, []);

  const activeScale = useMemo(
    () => scales.find((s) => s.name === store.selectedScale) ?? scales[0],
    [store.selectedScale]
  );

  const maps: GuideEntries = useMemo(
    () => ({
      descriptions: store.descriptions ?? {},
      examples: store.examples ?? {},
      referenceStoryIds: store.referenceStoryIds ?? {},
    }),
    [store.descriptions, store.examples, store.referenceStoryIds]
  );

  const handleScaleChange = useCallback(
    (value: string) => {
      useEstimationGuideStore.setState({ selectedScale: value });
      log(ESTIMATION_GUIDE_ACTIONS.SCALE_CHANGED, { scale: value });
    },
    [log]
  );

  // Entries are keyed per scale, so editing 8 on Fibonacci leaves 8 on
  // Powers of 2 and Linear alone.
  const handleDescriptionChange = useCallback((key: string, value: string) => {
    useEstimationGuideStore.setState((state) => ({
      descriptions: { ...state.descriptions, [key]: value },
    }));
  }, []);

  const handleExampleChange = useCallback((key: string, value: string) => {
    useEstimationGuideStore.setState((state) => ({
      examples: { ...state.examples, [key]: value },
    }));
  }, []);

  const descriptionOf = useCallback(
    (val: string | number) =>
      readEntry(store.descriptions, activeScale.name, val, defaultDescription(val)),
    [store.descriptions, activeScale.name]
  );
  const exampleOf = useCallback(
    (val: string | number) => readEntry(store.examples, activeScale.name, val),
    [store.examples, activeScale.name]
  );
  const isExampleNoteOf = useCallback(
    (val: string | number) => isExampleNote(entryKey(activeScale.name, val), exampleOf(val)),
    [activeScale.name, exampleOf]
  );
  const pinnedOf = useCallback(
    (val: string | number) =>
      resolveReferenceStories(pinnedIds(maps.referenceStoryIds, activeScale.name, val), stories),
    [maps.referenceStoryIds, activeScale.name, stories]
  );

  // ─── Reference stories ───
  // A pin whose story was deleted shows nowhere, so it mustn't hold a slot:
  // only pins that still resolve count toward the cap, and pinning a new
  // story drops the ones that don't (./references withPin).
  const resolves = useMemo(() => pinResolver(stories), [stories]);
  const pin = (val: string | number, story: Story) => {
    useEstimationGuideStore.setState((state) => ({
      referenceStoryIds: withPin(
        state.referenceStoryIds ?? {},
        activeScale.name,
        val,
        story.id,
        undefined,
        resolves
      ),
    }));
    log(ESTIMATION_GUIDE_ACTIONS.EXAMPLE_ADDED, {
      scale: activeScale.name,
      value: String(val),
      storyId: story.id,
    });
  };

  // Undo puts the story back where it was in the card's list.
  const unpin = (val: string | number, story: ReferenceStory) => {
    const scale = activeScale.name;
    const index = pinnedIds(maps.referenceStoryIds, scale, val).indexOf(story.id);
    undoable({
      label: `Unpinned “${shortName(story.title)}”`,
      apply: () => {
        useEstimationGuideStore.setState((state) => ({
          referenceStoryIds: withoutPin(state.referenceStoryIds ?? {}, scale, val, story.id),
        }));
        log(ESTIMATION_GUIDE_ACTIONS.EXAMPLE_REMOVED, {
          scale,
          value: String(val),
          storyId: story.id,
        });
      },
      revert: () =>
        useEstimationGuideStore.setState((state) => ({
          referenceStoryIds: withPin(state.referenceStoryIds ?? {}, scale, val, story.id, index),
        })),
    });
  };

  // ─── Example ───
  // Fills the empty cards of the scale on screen; "Clear example" removes
  // only what still reads exactly as the example wrote it. The notice
  // speaks for the scale on screen: another scale's example doesn't make
  // this one example data.
  const exampleShown = hasExample(maps, activeScale);
  const loadExample = () => {
    useEstimationGuideStore.setState((state) =>
      withExample(
        { examples: state.examples ?? {}, referenceStoryIds: state.referenceStoryIds ?? {} },
        activeScale
      )
    );
  };
  const clearExample = () => {
    useEstimationGuideStore.setState((state) =>
      withoutExample({
        examples: state.examples ?? {},
        referenceStoryIds: state.referenceStoryIds ?? {},
      })
    );
  };

  const reset = scaleResetPair(activeScale);
  const atDefaults = isScaleAtDefaults(maps, activeScale);
  const coverage = useMemo(
    () => guideCoverage(maps, activeScale, stories),
    [maps, activeScale, stories]
  );
  const numericScale = activeScale.values.some((v) => pointsOf(v) !== null);
  const canSuggest = useMemo(
    () => numericScale && hasSuggestions(stories, activeScale.values),
    [numericScale, stories, activeScale.values]
  );

  // The next step: stories waiting to be estimated. The queue goes straight
  // to Poker; unsized backlog stories are queued from Sprint Planning.
  const unsized = useMemo(
    () =>
      stories.filter((s) => s.status !== "done" && s.points === undefined && !isExampleId(s.id))
        .length,
    [stories]
  );

  const handleShare = useCallback(() => {
    const payload = {
      selectedScale: store.selectedScale,
      descriptions: store.descriptions,
      examples: store.examples,
    };
    try {
      const encoded = encodeSharedState(payload);
      const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`;
      navigator.clipboard.writeText(url).then(
        () => toast.success("Share link copied to clipboard"),
        () => toast.error("Failed to copy share link")
      );
    } catch {
      // Encoding can only fail if the payload is gigantic (it can't here),
      // but be defensive — a stray Unicode-only-in-some-locale char in the
      // user's descriptions used to throw in the old btoa() implementation.
      toast.error("Failed to build share link");
    }
  }, [store.selectedScale, store.descriptions, store.examples]);

  // Build export data
  const clipboardText = useMemo(() => {
    if (!activeScale) return "";
    const lines = [`Estimation Reference Guide - ${activeScale.name} Scale`, ""];
    for (const val of activeScale.values) {
      lines.push(`[${val}]`);
      lines.push(`Description: ${descriptionOf(val)}`);
      const example = exampleOf(val);
      if (example) {
        lines.push(`Example: ${example}${isExampleNoteOf(val) ? " (example)" : ""}`);
      }
      const refs = pinnedOf(val);
      if (refs.length > 0) {
        lines.push(
          `Reference stories: ${refs.map((r) => `${r.title}${r.example ? " (example)" : ""}`).join("; ")}`
        );
      }
      lines.push("");
    }
    return lines.join("\n");
  }, [activeScale, descriptionOf, exampleOf, isExampleNoteOf, pinnedOf]);

  // Example data carries a flag, so an export made while it's loaded never
  // passes it off as the team's.
  const jsonData = useMemo(() => {
    if (!activeScale) return { scale: "", values: [] };
    return {
      scale: activeScale.name,
      values: activeScale.values.map((val) => ({
        value: val,
        description: descriptionOf(val),
        example: exampleOf(val),
        exampleIsExample: isExampleNoteOf(val),
        referenceStories: pinnedOf(val).map((r) => ({
          title: r.title,
          points: r.points,
          example: r.example,
        })),
      })),
    };
  }, [activeScale, descriptionOf, exampleOf, isExampleNoteOf, pinnedOf]);

  const markdown = useMemo(
    () => toMarkdown(maps, activeScale, stories),
    [maps, activeScale, stories]
  );

  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "Estimation Guide",
      // The prompts read entries by bare value: hand them the active scale's.
      prompts: generateEstimationGuidePrompts(
        {
          selectedScale: store.selectedScale,
          descriptions: entriesForScale(store.descriptions, activeScale, true),
          examples: entriesForScale(store.examples, activeScale, false),
        },
        workspace
      ),
    }),
    [store.selectedScale, store.descriptions, store.examples, activeScale, workspace]
  );

  // Guard against scales[] being empty so render-time access to
  // `activeScale.values` is safe.
  if (!activeScale) return null;

  return (
    <ToolPageWrapper
      toolId="estimation-guide"
      title="Estimation Reference Guide"
      description="Interactive story point reference chart with team-specific calibration. Edit descriptions and add examples to build a shared estimation language."
      category="Sprint Planning & Estimation"
    >
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3 mb-6">
        <Select value={store.selectedScale} onValueChange={handleScaleChange}>
          <SelectTrigger
            ref={scaleRef}
            aria-label="Estimation scale"
            className="w-[200px] border-border bg-card text-text hover:border-accent-cyan/30"
          >
            <SelectValue placeholder="Select scale" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            {scales.map((scale) => (
              <SelectItem key={scale.name} value={scale.name}>
                {scale.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            className="gap-2 border-border bg-card hover:bg-cardH hover:border-accent-cyan/30 text-sub hover:text-text"
          >
            <Share2 className="w-4 h-4" />
            Share
          </Button>

          <ResetButton
            label="Reset this scale"
            title={`Reset the ${activeScale.name} scale?`}
            description="Its card meanings go back to the built-in ones, and its team examples and reference stories are cleared. Other scales stay as they are."
            confirmLabel="Reset scale"
            doneLabel={`Reset the ${activeScale.name} scale`}
            onReset={() => {
              reset.onReset();
              log(ESTIMATION_GUIDE_ACTIONS.GUIDE_RESET, { scale: activeScale.name });
              // The dialog has no trigger to hand focus back to, and the
              // Reset button is disabled now the scale is at its defaults:
              // land on the scale picker beside it, not the page. After
              // this tick, once the dialog has started closing.
              setTimeout(() => scaleRef.current?.focus(), 0);
            }}
            onUndo={reset.onUndo}
            disabled={atDefaults}
            variant="outline"
            className="gap-2 border-border bg-card text-sub hover:text-text"
          />

          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="estimation-guide"
            clipboardText={clipboardText}
            jsonData={jsonData}
            markdown={markdown}
            targetRef={gridRef}
          />
        </div>
      </div>

      {exampleShown && <ExampleNotice onClear={clearExample} />}

      <p className="mb-4 text-sm font-medium text-text">{guideVerdict(coverage)}</p>

      {coverage.calibrated === 0 && (
        <EmptyState
          icon={BookOpen}
          padding="md"
          className="mb-4"
          action={<LoadExampleButton onLoad={loadExample} />}
        >
          No team examples on the {activeScale.name} scale yet. Under each card, write a story your
          team knows{numericScale ? " or pin one it finished" : ""}, or load an example to see how a
          calibrated guide reads.
        </EmptyState>
      )}

      {numericScale && !canSuggest && coverage.calibrated > 0 && (
        <p className="mb-4 text-xs text-sub">
          Done stories with points show up under their card, ready to pin as references.
        </p>
      )}
      {!numericScale && (
        <p className="mb-4 text-xs text-sub">
          Stories carry points, not T-shirt sizes, so this scale has no done stories to suggest.
        </p>
      )}

      {/* Cards Grid */}
      <div
        ref={gridRef}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      >
        {activeScale.values.map((val) => {
          const key = String(val);
          const pinned = pinnedOf(val);
          const pinnedIdsHere = pinnedIds(maps.referenceStoryIds, activeScale.name, val);
          const suggestions = suggestReferenceStories(stories, val, pinnedIdsHere);
          return (
            <Card
              key={key}
              className="bg-card border-border hover:border-accent-cyan/30 transition-colors duration-200"
            >
              <CardContent className="p-5 space-y-3">
                {/* Value */}
                <div className="text-center">
                  <span className="text-4xl font-display font-bold text-accent text-glow-cyan">
                    {val}
                  </span>
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-${key}-description`}
                    className="text-xs font-medium text-sub uppercase tracking-wider"
                  >
                    Description
                  </label>
                  <Textarea
                    id={`${uid}-${key}-description`}
                    value={descriptionOf(val)}
                    onChange={(e) =>
                      handleDescriptionChange(entryKey(activeScale.name, val), e.target.value)
                    }
                    placeholder="Describe what this estimate means..."
                    rows={3}
                    className="resize-none border-border bg-bg text-text placeholder:text-sub text-sm focus-visible:ring-accent-cyan/50"
                  />
                </div>

                {/* Example */}
                <div className="space-y-1">
                  <label
                    htmlFor={`${uid}-${key}-example`}
                    className="text-xs font-medium text-sub uppercase tracking-wider"
                  >
                    Example
                  </label>
                  <Textarea
                    id={`${uid}-${key}-example`}
                    value={exampleOf(val)}
                    onChange={(e) =>
                      handleExampleChange(entryKey(activeScale.name, val), e.target.value)
                    }
                    placeholder="Add a team-specific example..."
                    rows={2}
                    className="resize-none border-border bg-bg text-text placeholder:text-sub text-sm focus-visible:ring-accent-cyan/50"
                  />
                </div>

                {(numericScale || pinned.length > 0) && (
                  <ReferenceStoriesField
                    value={key}
                    pinned={pinned}
                    suggestions={suggestions}
                    full={pinned.length >= MAX_REFERENCE_STORIES}
                    onPin={(story) => pin(val, story)}
                    onUnpin={(story) => unpin(val, story)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {(queued > 0 || unsized > 0) && (
        <aside
          aria-labelledby={`${uid}-next`}
          className="mt-6 flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">Next step</p>
            <h2 id={`${uid}-next`} className="mt-0.5 text-sm font-semibold text-text">
              {queued > 0 ? "Estimate the queue in Planning Poker" : "Size the unsized stories"}
            </h2>
            <p className="mt-0.5 text-sm text-sub">
              {queued > 0
                ? `${plural(queued, "story", "stories")} ${queued === 1 ? "is" : "are"} waiting in the Planning Poker queue. This guide shows under the deck for the card being discussed.`
                : `${plural(unsized, "story", "stories")} ${unsized === 1 ? "has" : "have"} no points yet. Queue ${unsized === 1 ? "it" : "them"} for Planning Poker from Sprint Planning.`}
            </p>
          </div>
          <Link
            href={queued > 0 ? "/planning-poker" : "/sprint-planning"}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-md border border-accent/40 bg-card px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:self-center"
          >
            {queued > 0 ? "Open Planning Poker" : "Open Sprint Planning"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </aside>
      )}
    </ToolPageWrapper>
  );
}
