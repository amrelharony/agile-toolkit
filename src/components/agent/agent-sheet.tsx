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
 * or Cmd/Ctrl+K K.
 */
export function AgentSheet() {
  const open = useAgentStore((s) => s.open);
  const closeSheet = useAgentStore((s) => s.closeSheet);
  const toggleSheet = useAgentStore((s) => s.toggleSheet);

  // Cmd/Ctrl+K K toggles the agent. The double-K differentiates from the
  // existing Cmd/Ctrl+K search palette — pressing K twice opens the agent.
  useEffect(() => {
    let lastKDown = 0;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        const now = Date.now();
        if (now - lastKDown < 600) {
          // Second K within 600ms — toggle the agent. Let the first K
          // open the search palette as usual (we don't preventDefault on it).
          e.preventDefault();
          toggleSheet();
          lastKDown = 0;
        } else {
          lastKDown = now;
        }
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
            Drive every tool through Claude. Cmd/Ctrl+K twice to toggle.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0">
          <AgentConversation />
        </div>
      </SheetContent>
    </Sheet>
  );
}
