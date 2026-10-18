"use client";

import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles, Copy, Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";
import type { ToolPromptConfig } from "@/lib/ai-prompts/types";
import { useActiveLlm } from "@/lib/llm/use-active-llm";

/**
 * Lazy-load the run panel so the (heavier) LLM machinery only lands in the
 * bundle when a user actually clicks "Run with AI". Non-AI users get only
 * the original copy-paste path with no additional code.
 */
const AiRunPanel = dynamic(() => import("./ai-run-panel"), { ssr: false });

/**
 * Heavy body of the AI prompt drawer. Split into its own file so it can be
 * `next/dynamic`-ed from the trigger component — most users open this drawer
 * fewer than once per session, so deferring the copy logic, toast util, and
 * extra icons saves a few KB of first-paint JS for every tool that uses it.
 */
function PromptCard({
  title,
  description,
  prompt,
  toolName,
}: {
  title: string;
  description: string;
  prompt: string;
  toolName: string;
}) {
  const [copied, setCopied] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isReady } = useActiveLlm();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // If the user disables their AI between opening the drawer and clicking
  // Run, fold the panel away so they aren't staring at a dead control.
  useEffect(() => {
    if (!isReady) setShowRun(false);
  }, [isReady]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(prompt);
    if (ok) {
      setCopied(true);
      toast.success("Prompt copied — paste into your AI assistant");
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Failed to copy prompt");
    }
  };

  // Every card has its own "Run with AI" / "Copy"; tie them to this
  // card's title so screen readers can tell them apart.
  const titleId = useId();
  const runPanelId = useId();

  return (
    <div className="rounded-lg border border-border bg-surface-deep p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 id={titleId} className="text-sm font-semibold text-text">
            {title}
          </h4>
          <p className="text-xs text-sub mt-0.5">{description}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {isReady && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-accent/40 bg-accent/5 text-accent hover:bg-accent/10"
              onClick={() => setShowRun((v) => !v)}
              // It shows / hides the run panel below, so it's a disclosure
              // (a pressed state with a label that flips reads as nonsense).
              aria-expanded={showRun}
              aria-controls={showRun ? runPanelId : undefined}
              aria-describedby={titleId}
            >
              <Play className="w-3.5 h-3.5" />
              {showRun ? "Hide" : "Run with AI"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-border hover:border-accent/40 hover:bg-accent/5 text-sub hover:text-accent"
            onClick={handleCopy}
            aria-describedby={titleId}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <pre className="whitespace-pre-wrap text-xs text-text/80 bg-surface rounded-md border border-border p-3 max-h-60 overflow-y-auto font-mono leading-relaxed">
        {prompt}
      </pre>
      {isReady && showRun && (
        // AiRunPanel is dynamic-imported, so it lands in the bundle only
        // when the user actually expands it for the first time.
        <div id={runPanelId}>
          <AiRunPanel prompt={prompt} toolName={toolName} />
        </div>
      )}
    </div>
  );
}

interface AiPromptDrawerContentProps {
  config: ToolPromptConfig;
}

export default function AiPromptDrawerContent({ config }: AiPromptDrawerContentProps) {
  const hasPrompts = config.prompts.length > 0;
  const { isReady, providerName, model, openSettings } = useActiveLlm();
  return (
    <SheetContent side="right" className="w-[90vw] sm:max-w-lg bg-bg border-border p-0">
      <SheetHeader className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-border">
        <SheetTitle className="flex items-center gap-2 text-text">
          <Sparkles className="w-5 h-5 text-accent" />
          AI Prompts
        </SheetTitle>
        <SheetDescription className="text-sub">
          Copy a prompt and paste it into any AI assistant for deeper insights from your{" "}
          {config.toolName} data.
        </SheetDescription>
        {/* AI status pill — clickable when off so anonymous users can
            discover the BYOK feature directly from the drawer. */}
        <div className="pt-1">
          {isReady ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border border-accent/40 bg-accent/10 text-accent">
              <Sparkles className="w-3 h-3" />
              AI: {providerName}
              {model && <span className="text-sub normal-case">· {model}</span>}
            </span>
          ) : (
            <button
              type="button"
              onClick={openSettings}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border border-border bg-surface text-sub hover:text-accent hover:border-accent/40 transition"
            >
              <Sparkles className="w-3 h-3" />
              AI: Off — bring your own key
            </button>
          )}
        </div>
      </SheetHeader>

      <ScrollArea className="h-[calc(100dvh-160px)] px-4 sm:px-6 py-4">
        {hasPrompts ? (
          <div className="space-y-4 pb-6">
            {config.prompts.map((p) => (
              <PromptCard
                key={p.id}
                title={p.title}
                description={p.description}
                prompt={p.prompt}
                toolName={config.toolName}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Sparkles className="w-10 h-10 text-sub/30 mb-4" />
            <p className="text-sm text-sub">
              Add some data to this tool first, then come back for AI&#8209;powered prompts.
            </p>
          </div>
        )}
      </ScrollArea>
    </SheetContent>
  );
}
