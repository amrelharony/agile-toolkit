"use client";

/**
 * Slots in the header of Amr's chat panel that the view below it fills.
 *
 * The header belongs to the shell, but what it says depends on the view: the
 * owner's thread title and New chat, "Your chats" in History, the visitor's
 * step and a way back. A view renders <PanelFill slot> (or panel-fills.tsx's
 * named wrappers) for
 *
 *   subtitle  the one-line context under the name plate
 *   back      a back control before the plate
 *   actions   the view's own icons, before the shell's Enlarge and Close
 *
 * anywhere in its tree, and each one draws into the element the header exposes
 * for that slot (a portal), so the view keeps its own state and handlers. Until
 * a view fills the subtitle the header shows the shell's default for the step.
 *
 * <PanelChrome> wraps the header and the view. A slot draws nothing when no
 * header is mounted (no provider, or the header isn't there yet) or on the
 * server, and an empty fill (null, false or "") leaves the default in place.
 * One view fills a slot at a time; two fills of one slot both show.
 *
 * Small on purpose: it ships in the mascot chunk on every page.
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PanelSlot = "subtitle" | "back" | "actions";

type HostRef = (el: HTMLElement | null) => void;

interface PanelChromeValue {
  hosts: Partial<Record<PanelSlot, HTMLElement>>;
  /** How many mounted views fill each slot with something to show. */
  fills: Partial<Record<PanelSlot, number>>;
  hostRef: Record<PanelSlot, HostRef>;
  claim(slot: PanelSlot): () => void;
}

const PanelChromeContext = createContext<PanelChromeValue | null>(null);
PanelChromeContext.displayName = "PanelChrome";

// Fills and hosts settle before paint, so the default subtitle never flashes
// beside a view's own; on the server there is nothing to settle.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Holds the header's slot hosts for the views inside it. */
export function PanelChrome({ children }: { children: ReactNode }) {
  const [hosts, setHosts] = useState<PanelChromeValue["hosts"]>({});
  const [fills, setFills] = useState<PanelChromeValue["fills"]>({});
  // Stable per slot: a new ref function each render would detach and attach
  // the host every time.
  const hostRef = useMemo(() => {
    const host =
      (slot: PanelSlot): HostRef =>
      (el) =>
        setHosts((h) => (h[slot] === (el ?? undefined) ? h : { ...h, [slot]: el ?? undefined }));
    return { subtitle: host("subtitle"), back: host("back"), actions: host("actions") };
  }, []);
  const claim = useCallback((slot: PanelSlot) => {
    const add = (n: number) => setFills((f) => ({ ...f, [slot]: (f[slot] ?? 0) + n }));
    add(1);
    return () => add(-1);
  }, []);
  const value = useMemo(() => ({ hosts, fills, hostRef, claim }), [hosts, fills, hostRef, claim]);
  return <PanelChromeContext.Provider value={value}>{children}</PanelChromeContext.Provider>;
}

/**
 * For the header: `ref(slot)` makes an element that slot's host (undefined
 * outside a PanelChrome), and `filled(slot)` says whether a view fills it.
 */
export function usePanelHosts() {
  const chrome = useContext(PanelChromeContext);
  return {
    ref: (slot: PanelSlot): HostRef | undefined => chrome?.hostRef[slot],
    filled: (slot: PanelSlot) => (chrome?.fills[slot] ?? 0) > 0,
  };
}

/**
 * Fills one header slot from a view. Only the views (lazy chunks) render it,
 * through panel-fills.tsx's wrappers, so no wrapper ships on every page.
 */
export function PanelFill({ slot, children }: { slot: PanelSlot; children?: ReactNode }) {
  const chrome = useContext(PanelChromeContext);
  const claim = chrome?.claim;
  const given = children != null && children !== false && children !== "";
  useIsomorphicLayoutEffect(() => (given && claim ? claim(slot) : undefined), [given, claim, slot]);
  const host = chrome?.hosts[slot];
  return given && host ? createPortal(children, host) : null;
}

/**
 * The subtitle at each step, in one place: the shell shows its default for
 * the step it knows (the owner's chat, or the tool finder), and a view fills
 * its own as it moves on (History, the visitor's consent card and chat). The
 * owner's open thread shows its own title instead of "New chat".
 */
export const PANEL_SUBTITLE = {
  owner: "New chat",
  history: "Your chats",
  guide: "Find the right tool",
  consent: "Before you chat",
  chat: "Chat · not saved",
} as const;

/**
 * A header icon's size: 36 px with a mouse and 44 px on a touch screen, at any
 * width (Button `sm`'s pointer-coarse:min-h-11 recipe; a landscape phone is wide
 * but still touch). A pressed toggle turns accent.
 */
export const PANEL_ICON =
  "h-9 w-9 min-h-0 min-w-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-sub aria-pressed:text-accent";

export interface PanelIconButtonProps extends Omit<ButtonProps, "aria-label" | "variant" | "size"> {
  /** What it does: its accessible name and, unless `title` says otherwise, its tooltip. */
  label: string;
}

/** A ghost icon button for the panel header (the shell's and the views' alike). */
export const PanelIconButton = forwardRef<HTMLButtonElement, PanelIconButtonProps>(
  ({ label, title, className, ...rest }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={title ?? label}
      className={cn(PANEL_ICON, className)}
      {...rest}
    />
  )
);
PanelIconButton.displayName = "PanelIconButton";
