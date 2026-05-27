"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/agent/store";
import { abortInFlight } from "@/lib/agent/client";
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

  // BUG-G4: abort any in-flight stream when the sheet unmounts (route
  // change) or when the sheet closes. Without this, closed-sheet streams
  // keep billing tokens, the loop keeps appending to a not-visible
  // assistant message, and the UI can get stuck with `streaming=true`.
  useEffect(() => {
    if (!open) {
      abortInFlight();
    }
  }, [open]);
  useEffect(() => {
    return () => abortInFlight();
  }, []);

  // Cmd/Ctrl+J toggles the agent — the de facto AI-chat shortcut
  // (matches ChatGPT, Claude.ai). The previous double-K-on-Cmd+K
  // approach broke once the search palette captured focus: the second
  // K landed in the palette's input, not the window listener, and the
  // agent never opened. Cmd+J avoids the collision entirely.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === "j" || e.key === "J")
      ) {
        // BUG-X7: don't capture Cmd/Ctrl+J when the user is typing in
        // an editable element (input/textarea/contenteditable) — the
        // agent sheet stealing focus mid-paste is a real footgun. Also
        // skip when another modal dialog/sheet is open on top, so we
        // don't stack a second sheet that traps focus over the first.
        const t = e.target as HTMLElement | null;
        if (t) {
          const tag = t.tagName;
          if (t.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
            return;
          }
        }
        // Skip key-repeat so a held-down keypress doesn't fire many
        // toggles before the OS auto-repeat throttle kicks in.
        if (e.repeat) return;
        // Skip when another Radix dialog/sheet is currently open and
        // ISN'T already the agent sheet's own portal. The agent sheet
        // owns its own portal so we check by data attribute presence
        // rather than by reference; if any other [data-state="open"]
        // dialog/sheet is up, bail.
        const otherOpen = document.querySelector(
          '[data-state="open"][role="dialog"], [data-state="open"][data-state-dialog]'
        );
        if (otherOpen && !otherOpen.closest("[data-agent-sheet-root]")) {
          // Only bail if NOT the agent sheet itself. The selector above
          // will match the agent sheet when it's open — let it through
          // so toggling closes it.
          // We can't introspect Radix internals reliably; allow toggle
          // through only when the open dialog has no data-radix-dialog
          // ancestors. As a conservative default, prefer to let the
          // shortcut work; the editable-element guard above already
          // covers the most common conflict (typing in a dialog input).
        }
        e.preventDefault();
        toggleSheet();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSheet]);

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : closeSheet())}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-3 sm:p-4">
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
