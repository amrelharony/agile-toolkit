"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/agent/store";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AgentConversation } from "./agent-conversation";

/**
 * Right-side chat sheet for the in-app agent. Open via the header button
 * or Cmd/Ctrl+J.
 */
export function AgentSheet() {
  const open = useAgentStore((s) => s.open);
  const closeSheet = useAgentStore((s) => s.closeSheet);
  const toggleSheet = useAgentStore((s) => s.toggleSheet);

  // Cmd/Ctrl+J toggles the agent — the de facto AI-chat shortcut
  // (matches ChatGPT, Claude.ai). The previous double-K-on-Cmd+K
  // approach broke once the search palette captured focus: the second
  // K landed in the palette's input, not the window listener, and the
  // agent never opened. Cmd+J avoids the collision entirely.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        toggleSheet();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSheet]);

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : closeSheet())}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-4">
        <SheetHeader className="space-y-1 pb-2 border-b border-border">
          <SheetTitle className="text-base">Agent</SheetTitle>
          <SheetDescription className="text-xs">
            Drive every tool through AI. Cmd/Ctrl+J to toggle.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0">
          <AgentConversation />
        </div>
      </SheetContent>
    </Sheet>
  );
}
