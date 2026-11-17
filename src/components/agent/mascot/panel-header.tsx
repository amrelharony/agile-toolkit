"use client";

/**
 * The top row of Amr's chat panel (DNA-SPEC §6 "Chat strip").
 *
 *   back slot   a view's way back (panel-chrome's <PanelBack>)
 *   name plate  "Amr", lettered: the dialog's title, an h2 that can take focus
 *               (tabIndex -1) when a keyboard opens a view with no field to
 *               start in. Always his name, never a role or "assistant".
 *   subtitle    one truncated line of context: the shell's default for the step
 *               until the view fills it (<PanelSubtitle>), then an optional
 *               keyboard shortcut that touch screens hide
 *   actions     the view's own icons (<PanelActions>), then the shell's controls
 *   Enlarge     md and up only, when the shell offers it; a toggle (aria-pressed)
 *               whose name stays "Enlarge chat" whatever its state, as a toggle's
 *               name should; the mouse tooltip says what a press does
 *   Close
 *
 * At least 52 px tall. Icons are ghost Buttons, 44 px on touch screens. The
 * slots fill only inside a <PanelChrome> (panel-chrome.tsx); without one the
 * header shows its defaults. Small on purpose: it ships in the mascot chunk.
 */

import type { ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { PanelIconButton, usePanelHosts } from "./panel-chrome";

/** The plate's id unless the shell gives one: the dialog's aria-labelledby. */
export const AMR_PANEL_TITLE_ID = "amr-panel-title";

export interface PanelHeaderProps {
  /** The name plate's id, for the dialog's aria-labelledby. */
  plateId?: string;
  /** What the panel shows at this step, until the view fills the subtitle. */
  subtitle?: ReactNode;
  /** A keyboard shortcut after the subtitle ("Cmd/Ctrl+J"), hidden on touch. */
  shortcut?: string;
  /** The shell's own controls, after the view's actions and before Enlarge. */
  controls?: ReactNode;
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
  enlarged = false,
  onToggleEnlarge,
  onClose,
}: PanelHeaderProps) {
  const slots = usePanelHosts();
  const filled = slots.filled("subtitle");
  const hasSubtitle = filled || (subtitle != null && subtitle !== false && subtitle !== "");
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
          {shortcut && (
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
