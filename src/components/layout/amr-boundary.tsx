"use client";

/**
 * Amr's last resort, around him in the app shell. His own boundaries catch
 * what is expected to go wrong: his figure (the launcher plate takes its
 * place and he is tried again) and his panel's body (a narration caption in
 * the panel). This one catches the rest, a crash in Amr himself or his code
 * not loading at all, so the page carries on instead of turning into the
 * app's error screen.
 *
 * It is never empty, because Amr stays visible: his lettered "Ask Amr" plate
 * stands in his usual corner, never a likeness of him. A tap tries him again
 * and opens his panel, as a tap on him would. While the plate stands in, his
 * panel can't be open, so a panel left open by the crash is closed (that
 * also denies a card that was waiting, as any close does).
 *
 * Small on purpose: the app shell ships it on every page. amr-geometry has
 * no imports, and the agent store is there already (the header's opener).
 */

import { useEffect, type ReactNode } from "react";
import { BUTTON_INSET, BUTTON_SIDE, LAUNCHER_PLATE } from "@/components/agent/mascot/amr-geometry";
import { useAgentStore } from "@/lib/agent/store";
import { ErrorBoundary } from "./error-boundary";

/** The plate's words and its name, as on Amr's own launcher. */
const ASK_AMR = "Ask Amr";

export function AmrBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary name="Amr" fallback={(_error, tryAgain) => <AmrStandIn tryAgain={tryAgain} />}>
      {children}
    </ErrorBoundary>
  );
}

/** His plate in his usual corner (bottom right), clear of the home indicator and a notch. */
function AmrStandIn({ tryAgain }: { tryAgain: () => void }) {
  useEffect(() => {
    const agent = useAgentStore.getState();
    if (agent.open) agent.closeSheet();
  }, []);
  return (
    <button
      type="button"
      data-launcher=""
      data-amr-stand-in=""
      aria-label={ASK_AMR}
      className="comic-name-plate fixed z-50 cursor-pointer select-none"
      style={{
        bottom: `calc(${BUTTON_INSET}px + env(safe-area-inset-bottom, 0px))`,
        right: `calc(${BUTTON_SIDE}px + env(safe-area-inset-right, 0px))`,
        minWidth: LAUNCHER_PLATE.w,
        minHeight: LAUNCHER_PLATE.h,
      }}
      onClick={(e) => {
        // A keyboard press clicks with detail 0, which his panel's focus owner
        // treats apart from a pointer's.
        useAgentStore.getState().openSheet({ via: e.detail === 0 ? "keyboard" : "pointer" });
        tryAgain();
      }}
    >
      {ASK_AMR}
    </button>
  );
}
