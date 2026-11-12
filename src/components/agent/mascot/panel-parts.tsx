"use client";

/**
 * What Amr's panel and his corner show while a part of him isn't there
 * (design §1.2 "Amr himself"):
 *
 *   PanelLoading   the panel's body while its code or the sign-in check is on
 *                  its way: a pen scribbling, and "Loading Amr's chat" for
 *                  screen readers. It fills the body's place, so the panel
 *                  keeps its size and nothing jumps when the body arrives.
 *   PanelFailed    the panel's body after it crashed, or after its code
 *                  couldn't load: a narration caption saying so in the third
 *                  person, with Reload page and, for the owner, Start a new
 *                  chat (a saved reply that crashes each time it is drawn
 *                  would otherwise crash the chat again on every open). The
 *                  header stays, so Close and Move Amr still work.
 *   FigureFailed   his figure crashed, or its code couldn't load: it tells the
 *                  shell, which turns his button into the "Ask Amr" launcher
 *                  plate in his spot. The same button, so he is still dragged,
 *                  moved by Move Amr and the arrow keys, and tapped open; the
 *                  shell tries his figure again from there.
 *
 * Never AmrStill and never a new likeness of him: where his figure can't be,
 * the plate says his name in lettering (decision 3), and the panel's own lines
 * are the narrator's, never his (decision 6).
 *
 * Small on purpose: it ships in Amr's chunk, which every page loads.
 */

import { useEffect, useRef } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Narration } from "@/components/agent/comic/comic-parts";
import { InkScribble } from "@/components/ink/ink-scribble";
import { Button } from "@/components/ui/button";
import { AMR_PANEL_TITLE_ID } from "./panel-header";

/** What the launcher plate says, and its button's name: the same words, so the name is what's seen. */
export const LAUNCHER_LABEL = "Ask Amr";

/** Read by screen readers in the panel body's place while it loads. */
export const PANEL_LOADING = "Loading Amr's chat";

/** The panel's body, on its way: a pen scribbling in its place. */
export function PanelLoading() {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-4"
      aria-busy="true"
      data-panel-loading=""
    >
      {/* Decorative (InkArt is aria-hidden); drawn still under reduced motion. */}
      <InkScribble />
      <span className="sr-only">{PANEL_LOADING}</span>
    </div>
  );
}

/** Narration over a crashed panel body: what happened, in the third person. */
export const PANEL_FAILED_NOTE = "Amr's chat ran into a problem. Reload the page to try again.";

/** The owner's: a new chat leaves a thread behind that breaks every time it is drawn. */
export const PANEL_FAILED_OWNER_NOTE =
  "Amr's chat ran into a problem. Reload the page to try again, or start a new chat if this one keeps failing.";

export interface PanelFailedProps {
  /** The owner's way out: empties the chat and draws it again. Leave it out for visitors. */
  onNewChat?: () => void;
  /** Reloads the page. Tests pass their own (jsdom can't reload). */
  onReload?: () => void;
}

const reloadPage = () => window.location.reload();

/**
 * The panel's body crashed. A narration caption takes its place, inside the
 * panel. It takes focus when the crash took focus with it (the composer went
 * with the body), so a screen reader reads it; with focus kept elsewhere (the
 * header, the page), it is announced instead, once and assertively, as an
 * error. Not a live region itself.
 */
export function PanelFailed({ onNewChat, onReload = reloadPage }: PanelFailedProps) {
  const noteRef = useRef<HTMLDivElement>(null);
  const announce = useAnnounce();
  const note = onNewChat ? PANEL_FAILED_OWNER_NOTE : PANEL_FAILED_NOTE;

  // Once, as it appears.
  useEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body) noteRef.current?.focus({ preventScroll: true });
    else announce(note, "assertive");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-panel-failed="">
      {/* Takes focus from code only (tabIndex -1), so it never joins the tab order. */}
      <div ref={noteRef} tabIndex={-1} className="focus:outline-none">
        <Narration
          tone="error"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="pointer-coarse:min-h-11"
                onClick={onReload}
              >
                Reload page
              </Button>
              {onNewChat && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="pointer-coarse:min-h-11"
                  onClick={(e) => {
                    // The caption is about to go: hand focus to Amr's name plate
                    // (tabIndex -1) first, so it never drops to the page.
                    if (document.activeElement === e.currentTarget) {
                      document.getElementById(AMR_PANEL_TITLE_ID)?.focus({ preventScroll: true });
                    }
                    onNewChat();
                  }}
                >
                  Start a new chat
                </Button>
              )}
            </>
          }
        >
          {note}
        </Narration>
      </div>
    </div>
  );
}

/**
 * His figure's boundary fallback. It draws nothing itself: it tells the shell
 * once it has rendered (the shell's state changes then, never while
 * rendering), and the shell turns his button into the launcher plate.
 */
export function FigureFailed({ onFailed }: { onFailed: () => void }) {
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    told.current = true;
    onFailed();
  }, [onFailed]);
  return null;
}
