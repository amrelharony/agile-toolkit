"use client";

/**
 * A view's fills for the panel header's slots (panel-chrome's PanelFill), by
 * name. Here, not in panel-chrome, because only the views render them: the
 * owner's panel, the visitor's steps and chat, all lazy chunks. panel-chrome
 * ships in the mascot chunk on every page, and webpack keeps there any export
 * a lazy chunk uses, so these wrappers would ship on every page with it.
 */

import type { ReactNode } from "react";
import { PanelFill } from "./panel-chrome";

type FillProps = { children?: ReactNode };

/** The one-line context under the name plate: a thread title, "Your chats", a step. */
export function PanelSubtitle({ children }: FillProps) {
  return <PanelFill slot="subtitle">{children}</PanelFill>;
}

/** A back control, drawn before the name plate. */
export function PanelBack({ children }: FillProps) {
  return <PanelFill slot="back">{children}</PanelFill>;
}

/** The view's own header icons, drawn before the shell's Enlarge and Close. */
export function PanelActions({ children }: FillProps) {
  return <PanelFill slot="actions">{children}</PanelFill>;
}
