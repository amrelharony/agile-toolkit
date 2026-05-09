"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import type { ToolPromptConfig } from "@/lib/ai-prompts/types";

/**
 * The drawer body (`PromptCard`s, copy logic, toast util) is lazy-loaded —
 * most users never open this drawer in a session, so deferring its bundle
 * shrinks first-paint JS for every tool that imports `AiPromptGenerator`.
 *
 * `ssr: false` is correct: the trigger button is rendered SSR; the body is
 * only meaningful inside an open `<Sheet>` (a client-side dialog).
 */
const AiPromptDrawerContent = dynamic(
  () => import("./ai-prompt-drawer-content"),
  { ssr: false }
);

interface AiPromptGeneratorProps {
  config: ToolPromptConfig;
}

export function AiPromptGenerator({ config }: AiPromptGeneratorProps) {
  // Track open state so the body chunk only loads after the user has shown
  // intent. The chunk fetch starts the moment the trigger is clicked;
  // under HTTP/2 it usually arrives before the open animation completes.
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border hover:border-accent/40 hover:bg-accent/5 text-sub hover:text-accent"
        >
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          AI Prompts
        </Button>
      </SheetTrigger>
      {open && <AiPromptDrawerContent config={config} />}
    </Sheet>
  );
}
