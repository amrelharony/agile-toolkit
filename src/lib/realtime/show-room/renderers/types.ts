/**
 * The shape of a show-room renderer: a component that draws one parsed
 * payload of one frame kind (`../frames.ts` parsed it). Kept apart from the
 * registry so the per-tool renderer files can import it without a cycle.
 */

import type { ComponentType } from "react";

/** Where a frame sits: its number (a new spin is a new frame), kind and when it was shown. */
export interface ShowFrameMeta {
  n: number;
  kind: string;
  /** Host clock, epoch ms. */
  at: number;
}

export interface ShowRendererProps<P = unknown> {
  /** What the tool's parser returned for this frame: safe to draw as React text. */
  payload: P;
  frame: ShowFrameMeta;
  /** "phone" on a participant's screen; "host" where the host previews what everyone sees. */
  surface: "phone" | "host";
  /**
   * False where nobody can press or type: the host's Big screen, which
   * draws the phone's large layout on a projector. A renderer then leaves
   * out its own controls (Team Mixer's "Find your name"). Absent: true.
   */
  interactive?: boolean;
}

export type ShowFrameRenderer = ComponentType<ShowRendererProps<unknown>>;

/** A tool's frame kinds and their renderers. */
export type ShowRenderers = Readonly<Record<string, ShowFrameRenderer>>;

/**
 * A renderer for payloads of type `P`, as the registry stores it. Its
 * frame kind's parser guarantees the payload's type, which is what makes
 * the widening sound.
 */
export function defineShowRenderer<P>(
  component: ComponentType<ShowRendererProps<P>>
): ShowFrameRenderer {
  return component as ShowFrameRenderer;
}
