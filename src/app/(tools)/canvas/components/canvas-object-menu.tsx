"use client";

import { useEffect, useState, type RefObject } from "react";
import { BringToFront, Copy, CopyPlus, Lock, LockOpen, SendToBack, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CanvasObjectActions } from "../hooks/use-canvas-shortcuts";
import { isCanvasLongPress } from "../hooks/use-canvas-touch-gestures";

interface CanvasObjectMenuProps {
  /** The board viewport the long-press `contextmenu` bubbles to. */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** The board's own shortcut handlers (see useCanvasShortcuts). */
  actions: CanvasObjectActions;
  /** Read when a long-press lands: true when there's a selection to act
   * on and nothing else owns the gesture (select tool, no editor open). */
  canOpen: () => boolean;
  /** Every selected object is locked, so the lock item reads "Unlock". */
  allLocked: boolean;
  /** Runs as the menu opens (the caller ends the drag the press began). */
  onOpen?: () => void;
}

/** Touch rows reach 44 px; desktop never opens this menu. */
const ITEM = "pointer-coarse:min-h-11";

/**
 * The long-press menu for the selection on touch screens. A finger held
 * on an object selects it (the pointer machine) and, after the hold,
 * use-canvas-touch-gestures dispatches a marked `contextmenu` at the
 * touch point; this opens a menu there with the actions a keyboard user
 * reaches by shortcut. Every item calls the same handler as its key.
 *
 * A mouse right-click isn't marked, so it keeps the browser's own menu
 * and desktop behaves exactly as before.
 */
export function CanvasObjectMenu({
  viewportRef,
  actions,
  canOpen,
  allLocked,
  onOpen,
}: CanvasObjectMenuProps) {
  // Where the menu is anchored, in viewport px; null while closed.
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onContextMenu = (e: MouseEvent) => {
      if (!isCanvasLongPress(e) || !canOpen()) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setAt({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      onOpen?.();
    };
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, [viewportRef, canOpen, onOpen]);

  return (
    <DropdownMenu
      open={at !== null}
      onOpenChange={(open) => {
        if (!open) setAt(null);
      }}
      // Non-modal: the finger that opened it is still down, captured by
      // the board; a modal menu's `pointer-events: none` on <body> could
      // swallow that finger's pointerup and leave the gesture hanging.
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        {/* Anchor only: a 1 px point at the touch, never pressed itself. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          // Names the menu too (Radix labels the content by its trigger).
          aria-label="Object actions"
          data-canvas-export-ignore="true"
          className="pointer-events-none absolute h-px w-px opacity-0"
          style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        // Over the board's own layers (selection handles and the property
        // bar sit at z 9997–9999), not under them. Inline: cn() doesn't
        // know the theme's named z values, so a class would sit beside
        // the menu's z-modal and win only by stylesheet order. Radix
        // copies this onto its positioning wrapper.
        style={{ zIndex: 10000 }}
        // Above the finger, so the hand doesn't hide it; flips below near
        // the top edge.
        side="top"
        align="center"
        sideOffset={12}
        collisionPadding={8}
        // Taps after a long-press can move focus to the board; only an
        // outside press, Esc or a pick should close the menu.
        onFocusOutside={(e) => e.preventDefault()}
        // Back to the board, not the invisible anchor, so its shortcuts
        // stay live for anyone with a keyboard attached.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          viewportRef.current?.focus({ preventScroll: true });
        }}
      >
        <DropdownMenuItem className={ITEM} onSelect={actions.duplicate}>
          <CopyPlus aria-hidden="true" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={actions.copy}>
          <Copy aria-hidden="true" />
          Copy
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={actions.bringToFront}>
          <BringToFront aria-hidden="true" />
          Bring to front
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={actions.sendToBack}>
          <SendToBack aria-hidden="true" />
          Send to back
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onSelect={actions.toggleLock}>
          {allLocked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
          {allLocked ? "Unlock" : "Lock"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={`${ITEM} text-danger focus:bg-danger/10 focus:text-danger`}
          onSelect={actions.deleteSelected}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
