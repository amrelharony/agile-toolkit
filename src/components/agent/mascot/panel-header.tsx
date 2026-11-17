"use client";

/**
 * The top row of Amr's chat panel (DNA-SPEC §6 "Chat strip").
 *
 *   back slot   a view's way back (panel-chrome's <PanelBack>)
 *   name plate  "Amr", lettered: the dialog's title, an h2 that can take focus
 *               (tabIndex -1) when a keyboard opens a view with no field to
 *               start in. Always his name, never a role or "assistant".
 *   subtitle    one truncated line of context: the shell's default for the step
 *               until the view fills it (<PanelSubtitle>)
 *   actions     the view's own icons (<PanelActions>), then the shell's controls
 *               (Amr's scenes)
 *   More        a menu of Amr's own settings, when it has one to offer: Move
 *               Amr (a radio group of his four corners, named in words, so he
 *               moves without dragging), the tilt switch (a phone that can send
 *               its tilt) and, at its foot on fine pointers only, the
 *               open/close shortcut. Without a menu the shortcut follows the
 *               subtitle instead, also hidden on touch screens.
 *   Enlarge     md and up only, when the shell offers it; a toggle (aria-pressed)
 *               whose name stays "Enlarge chat" whatever its state, as a toggle's
 *               name should; the mouse tooltip says what a press does
 *   Close
 *
 * At least 52 px tall. Icons are ghost Buttons, 44 px on touch screens. The
 * slots fill only inside a <PanelChrome> (panel-chrome.tsx); without one the
 * header shows its defaults. Small on purpose: it ships in the mascot chunk.
 * The menu is the site's dropdown (ui/dropdown-menu), which the page header's
 * account menu already loads on every page.
 */

import { useId, type ReactNode } from "react";
import { Ellipsis, Maximize2, Minimize2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AMR_CORNERS, cornerName, type AmrCorner } from "./amr-geometry";
import { PanelIconButton, usePanelHosts } from "./panel-chrome";
import { platformShortcut } from "./panel-ids";

/** The plate's id unless the shell gives one: the dialog's aria-labelledby. */
export const AMR_PANEL_TITLE_ID = "amr-panel-title";

/**
 * Apple keyboards say ⌘ where others say Ctrl. The same test as the site
 * header's isMac, and the same spelling (panel-ids' platformShortcut) as its
 * ⌘K keycap and its Amr opener's tooltip, so every hint on the screen agrees.
 * Read while rendering: Amr's chunk never renders on the server (app-shell
 * loads it with ssr: false).
 */
function onApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toUpperCase().includes("MAC") || navigator.userAgent.includes("Mac");
}

/** A Ctrl/⌘ shortcut as this platform writes it: "⌘J" on Apple, "Ctrl J" elsewhere. */
export function shortcutLabel(key: string, apple: boolean = onApple()): string {
  return platformShortcut(key, apple);
}

/** Whether Amr feels the phone's tilt, and the switch's toggle. */
export interface PanelTilt {
  on: boolean;
  onToggle: () => void;
}

/** Moving Amr without dragging him: the corner he stands in, and the move to another. */
export interface PanelMove {
  /** Where he is drawn now: the checked corner. */
  corner: AmrCorner;
  onMove: (corner: AmrCorner) => void;
}

export interface PanelHeaderProps {
  /** The name plate's id, for the dialog's aria-labelledby. */
  plateId?: string;
  /** What the panel shows at this step, until the view fills the subtitle. */
  subtitle?: ReactNode;
  /** The open/close shortcut as this platform writes it (shortcutLabel("J")). */
  shortcut?: string;
  /** The shell's own controls (Amr's scenes), after the view's actions and before More. */
  controls?: ReactNode;
  /** The tilt switch, on a phone that can send its tilt. Without it there is none. */
  tilt?: PanelTilt;
  /** Move Amr, the More menu's first group. Without it there is none. */
  move?: PanelMove;
  /** Whether the panel is enlarged (Enlarge's pressed state). */
  enlarged?: boolean;
  /** Toggles the enlarged size. Without it there is no Enlarge button. */
  onToggleEnlarge?: () => void;
  onClose: () => void;
}

export function PanelHeader({
  plateId = AMR_PANEL_TITLE_ID,
  subtitle,
  shortcut,
  controls,
  tilt,
  move,
  enlarged = false,
  onToggleEnlarge,
  onClose,
}: PanelHeaderProps) {
  const slots = usePanelHosts();
  const filled = slots.filled("subtitle");
  const hasSubtitle = filled || (subtitle != null && subtitle !== false && subtitle !== "");
  // A menu needs a choice in it: a role=menu with only a line of text has no
  // item to land on. Amr's panel always offers Move Amr, so everyone has one.
  const hasMenu = tilt != null || move != null;
  return (
    <div
      data-panel-header=""
      className="flex min-h-[52px] shrink-0 items-center gap-1 border-b border-border px-3 py-1"
    >
      <span
        ref={slots.ref("back")}
        data-panel-slot="back"
        className="flex shrink-0 items-center empty:hidden"
      />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <h2 id={plateId} className="comic-name-plate" tabIndex={-1}>
          Amr
        </h2>
        <p className="w-full truncate text-xs text-sub">
          {!filled && subtitle}
          {/* dir=auto: a thread title in Arabic keeps its own direction. */}
          <span ref={slots.ref("subtitle")} data-panel-slot="subtitle" dir="auto" />
          {shortcut && !hasMenu && (
            <span className="pointer-coarse:hidden">
              {hasSubtitle ? " · " : ""}
              {shortcut}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <span
          ref={slots.ref("actions")}
          data-panel-slot="actions"
          className="flex items-center gap-0.5 empty:hidden"
        />
        {controls}
        {hasMenu && <PanelMore shortcut={shortcut} tilt={tilt} move={move} />}
        {onToggleEnlarge && (
          <PanelIconButton
            label="Enlarge chat"
            title={enlarged ? "Make chat smaller" : "Enlarge chat"}
            aria-pressed={enlarged}
            onClick={onToggleEnlarge}
            className="hidden md:inline-flex"
          >
            {enlarged ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </PanelIconButton>
        )}
        <PanelIconButton label="Close assistant" onClick={onClose}>
          <X aria-hidden="true" />
        </PanelIconButton>
      </div>
    </div>
  );
}

/**
 * The More menu: Amr's own settings, apart from the chat's controls.
 *
 * Radix gives the button aria-haspopup and aria-expanded, opens it from Enter,
 * Space or the down arrow, moves through it with the arrows, and closes it on
 * Escape with preventDefault, so the panel's Escape (which skips a prevented
 * one) leaves the panel open and focus returns to the button.
 *
 * Move Amr comes first: his four corners as radio items (aria-checked on the
 * one he stands in), a group named by its label. A choice closes the menu,
 * as a radio choice in a menu does, and focus goes back to More while the
 * panel goes with him to the new corner.
 */
function PanelMore({
  shortcut,
  tilt,
  move,
}: {
  shortcut?: string;
  tilt?: PanelTilt;
  move?: PanelMove;
}) {
  const moveLabelId = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PanelIconButton label="More">
          <Ellipsis aria-hidden="true" />
        </PanelIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {move && (
          <>
            <DropdownMenuLabel id={moveLabelId} className="text-xs text-sub">
              Move Amr
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-labelledby={moveLabelId}
              value={move.corner}
              onValueChange={(c) => move.onMove(c as AmrCorner)}
            >
              {AMR_CORNERS.map((c) => (
                <DropdownMenuRadioItem key={c} value={c}>
                  {cornerName(c)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {tilt && <DropdownMenuSeparator />}
          </>
        )}
        {tilt && (
          // A switch in a menu is a checkbox item: aria-checked is its state.
          // It stays open after a press, so the new state shows.
          <DropdownMenuCheckboxItem
            checked={tilt.on}
            onCheckedChange={tilt.onToggle}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="min-w-0 flex-1">Let Amr feel your phone&apos;s tilt</span>
            {/* aria-checked says it to a screen reader; this says it to the eye. */}
            <span aria-hidden="true" className="ml-3 shrink-0 text-xs text-sub">
              {tilt.on ? "On" : "Off"}
            </span>
          </DropdownMenuCheckboxItem>
        )}
        {shortcut && (
          <>
            {/* No Ctrl/⌘ key on a touch screen: hidden there, like the subtitle's hint. */}
            <DropdownMenuSeparator className="pointer-coarse:hidden" />
            <DropdownMenuLabel className="text-xs font-normal text-sub pointer-coarse:hidden">
              <kbd className="font-data">{shortcut}</kbd> opens and closes Amr
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
