"use client";

import { useState } from "react";
import { Sparkles, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "sonner";
import type { ToolPromptConfig } from "@/lib/ai-prompts/types";

interface AiPromptGeneratorProps {
  config: ToolPromptConfig;
}

function PromptCard({ title, description, prompt }: { title: string; description: string; prompt: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(prompt);
    if (ok) {
      setCopied(true);
      toast.success("Prompt copied — paste into your AI assistant");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Failed to copy prompt");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface-deep p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-text">{title}</h4>
          <p className="text-xs text-sub mt-0.5">{description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5 border-border hover:border-accent/40 hover:bg-accent/5 text-sub hover:text-accent"
          onClick={handleCopy}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap text-xs text-text/80 bg-surface rounded-md border border-border p-3 max-h-60 overflow-y-auto font-mono leading-relaxed">
        {prompt}
      </pre>
    </div>
  );
}

export function AiPromptGenerator({ config }: AiPromptGeneratorProps) {
  const hasPrompts = config.prompts.length > 0;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border hover:border-accent/40 hover:bg-accent/5 text-sub hover:text-accent"
        >
          <Sparkles className="w-4 h-4" />
          AI Prompts
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[90vw] sm:max-w-lg bg-bg border-border p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-text">
            <Sparkles className="w-5 h-5 text-accent" />
            AI Prompts
          </SheetTitle>
          <SheetDescription className="text-sub">
            Copy a prompt and paste it into any AI assistant for deeper insights from your {config.toolName} data.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-140px)] px-6 py-4">
          {hasPrompts ? (
            <div className="space-y-4 pb-6">
              {config.prompts.map((p) => (
                <PromptCard key={p.id} title={p.title} description={p.description} prompt={p.prompt} />
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
    </Sheet>
  );
}
