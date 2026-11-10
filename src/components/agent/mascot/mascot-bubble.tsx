"use client";

/**
 * What Amr says beside himself (lib/agent/mascot/bubble.ts): one short line,
 * sometimes with one or two answers. It stands where the moment chip stands,
 * beside him wherever he's parked, and waits its turn: a moment chip or his open
 * panel comes first. It fades on its own (a line after about 4 s, a question
 * after about 10), stays while the pointer or focus is on it, and has no
 * animation under reduced motion. Mounted once, by the mascot assistant.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { momentChipPosition } from "@/components/notify/moment-chip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { bubbleMs, useBubbleStore, type MascotBubble as Bubble } from "@/lib/agent/mascot/bubble";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useAgentStore } from "@/lib/agent/store";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { useMomentStore } from "@/lib/notify/moment-scheduler";
import { cn } from "@/lib/utils";

export function MascotBubble() {
  const bubble = useBubbleStore((s) => s.current);
  const dismiss = useBubbleStore((s) => s.dismiss);
  const corner = useMascotStore((s) => s.corner);
  const momentUp = useMomentStore((s) => s.current !== null);
  const panelOpen = useAgentStore((s) => s.open);
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);
  const [held, setHeld] = useState(false);
  // A moment chip or the open panel has the spot: the bubble waits, its clock too.
  const showing = bubble && !momentUp && !panelOpen ? bubble : null;

  useEffect(() => {
    if (!showing || held) return;
    const id = setTimeout(() => dismiss(showing.id), bubbleMs(showing));
    return () => clearTimeout(id);
  }, [showing, held, dismiss]);

  // A new bubble starts un-held.
  useEffect(() => {
    setHeld(false);
  }, [showing?.id]);

  // The live region is always mounted (empty between bubbles), so a screen
  // reader announces a line when it appears.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-amr-bubble-region
      data-vt-hold="amr-bubble"
      style={{ position: "fixed", ...momentChipPosition(corner, phone) }}
      className="pointer-events-none z-[55] max-w-[min(18rem,calc(100vw-32px))]"
    >
      {showing ? <BubbleBody bubble={showing} setHeld={setHeld} /> : null}
    </div>
  );
}

function BubbleBody({ bubble, setHeld }: { bubble: Bubble; setHeld: (held: boolean) => void }) {
  const dismiss = useBubbleStore((s) => s.dismiss);
  const hold = {
    onPointerEnter: () => setHeld(true),
    onPointerLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };
  const actions = bubble.actions ?? [];
  const text = <span className="leading-snug">{bubble.text}</span>;

  return (
    <div
      data-amr-bubble={bubble.id}
      className={cn(
        "pointer-events-auto flex max-w-full flex-col gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text shadow-lg",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-reduce:animate-none"
      )}
      {...hold}
    >
      {bubble.onTap && actions.length === 0 ? (
        <button
          type="button"
          onClick={() => {
            dismiss(bubble.id, true);
            bubble.onTap?.();
          }}
          className="flex min-h-[44px] items-center rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {text}
        </button>
      ) : (
        <p className="py-1">{text}</p>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.slice(0, 2).map((action, i) => (
            <Button
              key={action.label}
              type="button"
              size="sm"
              variant={i === 0 ? "toolkit" : "ghost"}
              onClick={() => {
                // The answer first, from the tap itself: it may ask the browser
                // for a permission, which only a tap may do.
                action.run();
                dismiss(bubble.id, true);
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
