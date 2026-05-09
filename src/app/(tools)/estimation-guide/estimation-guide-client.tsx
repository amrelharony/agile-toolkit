"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateEstimationGuidePrompts } from "@/lib/ai-prompts/estimation-guide";
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
import { scales, defaultDescriptions } from "@/lib/constants/scales";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { toast } from "@/lib/utils/toast";
import { RotateCcw, Share2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface EstimationGuideState {
  selectedScale: string;
  descriptions: Record<string, string>;
  examples: Record<string, string>;
}

const initialState: EstimationGuideState = {
  selectedScale: "Fibonacci",
  descriptions: { ...defaultDescriptions },
  examples: {},
};

const useEstimationGuideStore = createPersistedStore<EstimationGuideState>(
  "estimation-guide",
  initialState
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EstimationGuideClient() {
  const store = useEstimationGuideStore();
  const gridRef = useRef<HTMLDivElement>(null);
  const { log } = useHistoryLogger("estimation-guide");

  // Hydrate persisted store on mount, then apply any URL-shared state so the
  // URL payload wins over the locally-persisted state. Running these in
  // parallel raced (whichever resolved last would clobber the other).
  useEffect(() => {
    const rehydrate = useEstimationGuideStore.persist.rehydrate();
    Promise.resolve(rehydrate).then(() => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const shared = params.get("state");
      if (!shared) return;
      try {
        const decoded = JSON.parse(atob(shared));
        if (decoded.selectedScale) {
          useEstimationGuideStore.setState({
            selectedScale: decoded.selectedScale,
            descriptions: { ...defaultDescriptions, ...decoded.descriptions },
            examples: decoded.examples ?? {},
          });
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

  const handleDescriptionChange = useCallback(
    (key: string, value: string) => {
      useEstimationGuideStore.setState((state) => ({
        descriptions: { ...state.descriptions, [key]: value },
      }));
    },
    []
  );

  const handleExampleChange = useCallback(
    (key: string, value: string) => {
      useEstimationGuideStore.setState((state) => ({
        examples: { ...state.examples, [key]: value },
      }));
    },
    []
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
    const encoded = btoa(JSON.stringify(payload));
    const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Share link copied to clipboard"),
      () => toast.error("Failed to copy share link")
    );
  }, [store.selectedScale, store.descriptions, store.examples]);

  // Build export data
  const clipboardText = useMemo(() => {
    if (!activeScale) return "";
    const lines = [`Estimation Reference Guide - ${activeScale.name} Scale`, ""];
    for (const val of activeScale.values) {
      const key = String(val);
      lines.push(`[${key}]`);
      lines.push(`Description: ${store.descriptions[key] ?? ""}`);
      if (store.examples[key]) {
        lines.push(`Example: ${store.examples[key]}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }, [activeScale, store.descriptions, store.examples]);

  const jsonData = useMemo(() => {
    if (!activeScale) return { scale: "", values: [] };
    return {
      scale: activeScale.name,
      values: activeScale.values.map((val) => {
        const key = String(val);
        return {
          value: val,
          description: store.descriptions[key] ?? "",
          example: store.examples[key] ?? "",
        };
      }),
    };
  }, [activeScale, store.descriptions, store.examples]);

  const promptConfig = useMemo(() => ({
    toolName: "Estimation Guide",
    prompts: generateEstimationGuidePrompts({
      selectedScale: store.selectedScale,
      descriptions: store.descriptions,
      examples: store.examples,
    }),
  }), [store.selectedScale, store.descriptions, store.examples]);

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
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        <Select value={store.selectedScale} onValueChange={handleScaleChange}>
          <SelectTrigger className="w-[200px] border-border bg-card text-text hover:border-accent-cyan/30">
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

        <div className="flex items-center gap-2 sm:ml-auto">
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
                  <label className="text-xs font-medium text-sub uppercase tracking-wider">
                    Description
                  </label>
                  <Textarea
                    value={store.descriptions[key] ?? ""}
                    onChange={(e) =>
                      handleDescriptionChange(key, e.target.value)
                    }
                    placeholder="Describe what this estimate means..."
                    rows={3}
                    className="resize-none border-border bg-bg text-text placeholder:text-sub text-sm focus-visible:ring-accent-cyan/50"
                  />
                </div>

                {/* Example */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-sub uppercase tracking-wider">
                    Example
                  </label>
                  <Textarea
                    value={store.examples[key] ?? ""}
                    onChange={(e) => handleExampleChange(key, e.target.value)}
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
