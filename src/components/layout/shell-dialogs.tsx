"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { DeferredDialog } from "./deferred-dialog";
import { useCommandPaletteShortcut } from "./use-command-palette-shortcut";

// Off every page's first download and hydration: the Ctrl/Cmd+K tool finder
// (cmdk and the search synonyms), the trophy case and the BYOK settings
// dialog (its tabs, model lists and provider import). Each loads the first
// time it opens.
const loadCommandPalette = () => import("./command-palette").then((m) => m.CommandPalette);
const loadTrophyCase = () =>
  import("@/components/gamification/trophy-case").then((m) => m.TrophyCase);
const loadLlmSettings = () =>
  import("@/components/ai/llm-settings-dialog").then((m) => m.LlmSettingsDialog);

/**
 * True once the page has gone idle on a device with a fine pointer: a mouse
 * and keyboard reach for Ctrl/Cmd+K straight away, so there the dialogs mount
 * closed ahead of time and their first open is as instant as it always was.
 * A phone loads each one only when someone opens it.
 */
function useWarmOnFinePointer(): boolean {
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    const go = () => setWarm(true);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(go, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(go, 3000);
    return () => window.clearTimeout(timer);
  }, []);
  return warm;
}

interface ShellDialogsProps {
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  trophyOpen: boolean;
  /** The trophy case lives in the Activity UI store, so a plain setter. */
  setTrophyOpen: (open: boolean) => void;
}

/**
 * The app shell's dialogs that load on demand. The header's search button and
 * XP bar open the first two through the shell's state; the BYOK dialog's
 * open state lives in llm-ui-store, so the header chip and the UserMenu entry
 * share this one mount. Ctrl/Cmd+K is handled here, so it works before the
 * palette's code exists.
 */
export function ShellDialogs({
  searchOpen,
  setSearchOpen,
  trophyOpen,
  setTrophyOpen,
}: ShellDialogsProps) {
  const settingsOpen = useLlmUiStore((s) => s.settingsOpen);
  const closeSettings = useLlmUiStore((s) => s.closeSettings);
  const warm = useWarmOnFinePointer();
  useCommandPaletteShortcut(useCallback(() => setSearchOpen((open) => !open), [setSearchOpen]));

  return (
    <>
      <DeferredDialog
        load={loadCommandPalette}
        open={searchOpen}
        warm={warm}
        label="search"
        onClose={() => setSearchOpen(false)}
        props={{ open: searchOpen, onOpenChange: setSearchOpen }}
      />
      <DeferredDialog
        load={loadTrophyCase}
        open={trophyOpen}
        warm={warm}
        label="the trophy case"
        onClose={() => setTrophyOpen(false)}
        props={{ open: trophyOpen, onOpenChange: setTrophyOpen }}
      />
      <DeferredDialog
        load={loadLlmSettings}
        open={settingsOpen}
        warm={warm}
        label="AI settings"
        onClose={closeSettings}
        props={{}}
      />
    </>
  );
}
