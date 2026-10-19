"use client";

import { useEffect, useId, useRef, useCallback, useMemo } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateEstimationGuidePrompts } from "@/lib/ai-prompts/estimation-guide";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
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
import { scales } from "@/lib/constants/scales";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { toast } from "@/lib/utils/toast";
import { RotateCcw, Share2 } from "lucide-react";
import {
  defaultDescription,
  defaultScaleDescriptions,
  entriesForScale,
  entryKey,
  migrateDescriptions,
  migrateExamples,
  readEntry,
  sameEntries,
} from "./entries";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface EstimationGuideState {
  selectedScale: string;
  /** Keyed per scale and value, e.g. "Fibonacci:8" (see ./entries). */
  descriptions: Record<string, string>;
  /** Keyed per scale and value, e.g. "Fibonacci:8" (see ./entries). */
  examples: Record<string, string>;
}

const initialState: EstimationGuideState = {
  selectedScale: "Fibonacci",
  descriptions: defaultScaleDescriptions(),
  examples: {},
};

const useEstimationGuideStore = createPersistedStore<EstimationGuideState>(
  "estimation-guide",
  initialState
);

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EstimationGuideClient() {
  const store = useEstimationGuideStore();
  const gridRef = useRef<HTMLDivElement>(null);
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

  const handleReset = useCallback(() => {
    useEstimationGuideStore.setState({
      ...initialState,
      selectedScale: store.selectedScale,
    });
    toast.success("Reset to defaults");
    log(ESTIMATION_GUIDE_ACTIONS.GUIDE_RESET, {});
  }, [store.selectedScale, log]);

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
        lines.push(`Example: ${example}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }, [activeScale, descriptionOf, exampleOf]);

  const jsonData = useMemo(() => {
    if (!activeScale) return { scale: "", values: [] };
    return {
      scale: activeScale.name,
      values: activeScale.values.map((val) => ({
        value: val,
        description: descriptionOf(val),
        example: exampleOf(val),
      })),
    };
  }, [activeScale, descriptionOf, exampleOf]);

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

          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="gap-2 border-border bg-card hover:bg-cardH hover:border-accent-cyan/30 text-sub hover:text-text"
          >
            <RotateCcw className="w-4 h-4" />
            Reset to Defaults
          </Button>

          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="estimation-guide"
            clipboardText={clipboardText}
            jsonData={jsonData}
            targetRef={gridRef}
          />
        </div>
      </div>

      {/* Cards Grid */}
      <div
        ref={gridRef}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      >
        {activeScale.values.map((val) => {
          const key = String(val);
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ToolPageWrapper>
  );
}
