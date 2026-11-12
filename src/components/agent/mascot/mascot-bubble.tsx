"use client";

/**
 * What Amr says beside himself (lib/agent/mascot/bubble.ts), and what the
 * narrator says there while his chat panel is shut and a turn still runs in it
 * (lib/agent/mascot/outside-narration.ts).
 *
 * - His line or question: a speech balloon with the chat's capped corners
 *   (`.balloon[data-tail]`, DNA-SPEC §6 "Chat strip") whose tail points at him
 *   (amr-geometry's bubbleTail). While he is carried the tail hides, as his
 *   panel's does: it would point at the spot he left. A line fades on its own after about 4 s, and
 *   stays while the pointer or focus is on it. A question waits for its
 *   answer: it goes when it is answered, when his panel opens (the panel holds
 *   the same choice) or when a new line replaces it.
 * - Narration: a caption box with no tail, in the third person ("Amr is working
 *   in Retro Board…"). "Amr is waiting for your OK" has Open, which brings the
 *   panel back to the card. It comes first: his own line waits behind it.
 *
 * Both stand where the moment chip does (momentChipPosition), beside where he
 * is drawn (the mascot store's `placed`, the other side when he has stepped
 * aside) and as far off his edge as he has stepped (`lift`). A moment chip or
 * his open panel has the spot first: the bubble waits, a line's clock too.
 *
 * For screen readers the outer region is not live (it is held still during a
 * page change). Inside it a status line holding only the words is always
 * mounted, empty between bubbles, so words are read when they appear; the
 * answers, the tap and Open sit beside it, out of the live line. It appears as
 * drawn, with no entrance animation. Mounted once, by the mascot assistant.
 */

import { useEffect, useId, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { momentChipPosition } from "@/components/notify/moment-chip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { bubbleMs, useBubbleStore } from "@/lib/agent/mascot/bubble";
import {
  outsideNarration,
  outsidePhase,
  ownerTurnRuns,
  AMR_WAITING_FOR_OK,
} from "@/lib/agent/mascot/outside-narration";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useAgentStore } from "@/lib/agent/store";
import type { ToolLabel } from "@/lib/agent/tool-label";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { useMomentStore } from "@/lib/notify/moment-scheduler";
import { cn } from "@/lib/utils";
import { bubbleTail, cornerAt } from "./amr-geometry";

type LabelOf = (wireName: string) => ToolLabel;

/** tool-label once it has loaded in this page, so a later bubble has it at once. */
let loadedLabelOf: LabelOf | null = null;
/** If tool-label can't load (offline), a call goes unnamed: "Amr is working…". */
const UNNAMED: LabelOf = () => ({ tool: "Tool", verb: "" });

/**
 * tool-label, which names the tool in "Amr is working in Retro Board…". It is
 * fetched only once an owner's turn runs (`need`), so a visitor's page never
 * loads it; an owner's chat chunk already holds it, so it is there at once.
 */
function useToolLabel(need: boolean): LabelOf | null {
  const [labelOf, setLabelOf] = useState<LabelOf | null>(() => loadedLabelOf);
  useEffect(() => {
    if (!need || labelOf) return;
    let live = true;
    import("@/lib/agent/tool-label").then(
      (m) => {
        loadedLabelOf = m.toolLabel;
        if (live) setLabelOf(() => m.toolLabel);
      },
      () => {
        if (live) setLabelOf(() => UNNAMED);
      }
    );
    return () => {
      live = false;
    };
  }, [need, labelOf]);
  return labelOf;
}

export function MascotBubble() {
  const bubble = useBubbleStore((s) => s.current);
  const dismiss = useBubbleStore((s) => s.dismiss);
  const placed = useMascotStore((s) => s.placed);
  const lift = useMascotStore((s) => s.lift);
  const carried = useMascotStore((s) => s.drag !== null);
  const momentUp = useMomentStore((s) => s.current !== null);
  const panelOpen = useAgentStore((s) => s.open);
  const phase = useAgentStore(outsidePhase);
  const labelOf = useToolLabel(useAgentStore(ownerTurnRuns));
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);
  const [held, setHeld] = useState(false);
  const statusId = useId();

  // The narrator first (behind a moment chip, which has the spot). His own
  // line waits behind both, and behind his open panel: while a turn runs with
  // the panel shut it waits even before the narration has its words.
  const narration = momentUp ? null : outsideNarration(phase, labelOf);
  const line = bubble && !momentUp && !panelOpen && phase === null ? bubble : null;

  // A line fades on its own unless held; a question has no clock.
  useEffect(() => {
    if (!line || held) return;
    const ms = bubbleMs(line);
    if (ms === null) return;
    const id = setTimeout(() => dismiss(line.id), ms);
    return () => clearTimeout(id);
  }, [line, held, dismiss]);

  // His panel opening ends a question unanswered: the panel holds the same choice.
  useEffect(() => {
    if (panelOpen && bubble?.actions?.length) dismiss(bubble.id);
  }, [panelOpen, bubble, dismiss]);

  // A new line starts un-held.
  useEffect(() => {
    setHeld(false);
  }, [line?.id]);

  const corner = cornerAt(placed);
  const tail = bubbleTail(corner, phone);
  const shown = narration !== null || line !== null;
  const actions = line?.actions?.slice(0, 2) ?? [];
  const tap = line?.onTap && actions.length === 0 ? line : null;
  const hold = {
    onPointerEnter: () => setHeld(true),
    onPointerLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };

  const openPanel = (e: MouseEvent<HTMLButtonElement>) => {
    // A key press clicks with no detail: the panel's focus owner takes it in.
    useAgentStore.getState().openSheet({ via: e.detail === 0 ? "keyboard" : "pointer" });
  };

  return (
    <div
      data-amr-bubble-region
      data-vt-hold="amr-bubble"
      style={{ position: "fixed", ...momentChipPosition(corner, phone, lift) }}
      className="pointer-events-none z-[55] max-w-[min(18rem,calc(100vw-32px))]"
    >
      {/* One element for every state, so the status line inside it is never
          remounted: a live region that arrives with its words isn't read. */}
      <div
        data-amr-bubble={narration !== null ? "narration" : line?.id}
        data-voice={narration !== null ? "narration" : undefined}
        data-tail={line ? (carried ? "none" : tail.tail) : undefined}
        data-tail-from={line && !carried ? tail.from : undefined}
        className={
          shown
            ? cn(
                "pointer-events-auto flex max-w-full px-3 py-2 font-sans text-sm text-text",
                line
                  ? "balloon flex-col justify-center gap-2"
                  : "comic-caption flex-wrap items-center gap-x-3 gap-y-2",
                tap && "min-h-11"
              )
            : undefined
        }
        {...(line ? hold : {})}
      >
        <p
          id={statusId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={
            shown ? cn("min-w-0 leading-snug", narration !== null && "flex-1 basis-40") : undefined
          }
        >
          {narration ?? line?.text ?? ""}
        </p>
        {tap && (
          // The whole balloon is the tap; its name is the line.
          <button
            type="button"
            aria-labelledby={statusId}
            onClick={() => {
              dismiss(tap.id, true);
              tap.onTap?.();
            }}
            className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        {line && actions.length > 0 && (
          <div className="flex flex-wrap gap-2" data-bubble-actions="">
            {actions.map((action, i) => (
              <Button
                key={action.label}
                type="button"
                size="sm"
                variant={i === 0 ? "toolkit" : "ghost"}
                onClick={() => {
                  // The answer first, from the tap itself: it may ask the browser
                  // for a permission, which only a tap may do.
                  action.run();
                  dismiss(line.id, true);
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
        {narration === AMR_WAITING_FOR_OK && (
          <div className="flex flex-wrap gap-2" data-bubble-actions="">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-describedby={statusId}
              onClick={openPanel}
            >
              Open
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
