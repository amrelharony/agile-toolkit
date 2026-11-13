"use client";

/**
 * The frame on screen in a show room, drawn by the renderer registered for
 * its tool and kind (`lib/realtime/show-room/renderers/registry`). Before
 * the host shows anything, it says so; a frame this page can't draw (a kind
 * it doesn't know, from a newer build, or a payload its parser refused) gets
 * a "reload" line instead of anything from the wire.
 *
 * Only this tool's renderers load, when the view mounts (the built-in text
 * frame needs none): a frame that arrives first waits a moment for them.
 *
 * A new frame is announced politely, once, by number and time, so the
 * same spin twice is two announcements.
 */

import { useEffect, useRef, useState } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  loadShowRenderers,
  loadedShowRenderers,
  showRendererFor,
} from "@/lib/realtime/show-room/renderers/registry";
import type { ShowRoomTool } from "@/lib/realtime/show-room/protocol";
import type { ShowFrame } from "@/lib/realtime/show-room/use-show-room";
import { cn } from "@/lib/utils";

export interface ShowFrameViewProps {
  tool: ShowRoomTool;
  frame: ShowFrame | null;
  /** "phone": a participant's screen (large). "host": the host's preview. */
  surface?: "phone" | "host";
  /** Shown while nothing is on screen. */
  emptyText?: string;
  /** Say a new frame arrived (phones only). Off for the host's big screen, which shows its own. */
  announceNew?: boolean;
  className?: string;
}

/** Whether `tool`'s own renderers are in: "loading", "ready" or "failed" (draw what we can). */
function useToolRenderers(tool: ShowRoomTool): "loading" | "ready" | "failed" {
  const [state, setState] = useState<{ tool: ShowRoomTool; failed: boolean } | null>(null);
  const ready = loadedShowRenderers(tool) !== null;
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadShowRenderers(tool).then(
      () => {
        if (live) setState({ tool, failed: false });
      },
      () => {
        if (live) setState({ tool, failed: true });
      }
    );
    return () => {
      live = false;
    };
  }, [tool, ready]);
  if (ready) return "ready";
  return state?.tool === tool && state.failed ? "failed" : "loading";
}

export function ShowFrameView({
  tool,
  frame,
  surface = "phone",
  emptyText = "Waiting for the host to show something…",
  announceNew = true,
  className,
}: ShowFrameViewProps) {
  const announce = useAnnounce();
  const lastKey = useRef<string | null>(null);
  const renderers = useToolRenderers(tool);
  // A frame's number and the host's time for it: a new frame always differs.
  const frameKey = frame ? `${frame.n}-${frame.at}` : null;
  useEffect(() => {
    if (surface !== "phone" || !announceNew || frameKey === null) return;
    if (lastKey.current === frameKey) return;
    const first = lastKey.current === null;
    lastKey.current = frameKey;
    if (!first) announce("The host showed something new.");
  }, [frameKey, surface, announceNew, announce]);

  const Renderer = frame?.supported ? showRendererFor(tool, frame.kind) : null;
  // The tool's renderers are still on their way: nothing to say yet.
  const waiting = Boolean(frame?.supported) && !Renderer && renderers === "loading";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        surface === "phone" ? "min-h-48 p-4 sm:p-6" : "p-3",
        className
      )}
    >
      {!frame ? (
        <p role="status" className="text-sm text-sub">
          {emptyText}
        </p>
      ) : Renderer ? (
        <Renderer
          // A new frame mounts afresh, so a renderer's own reveal plays again.
          key={frameKey}
          payload={frame.payload}
          frame={{ n: frame.n, kind: frame.kind, at: frame.at }}
          surface={surface}
        />
      ) : waiting ? (
        <p className="text-sm text-sub">Loading what the host is showing…</p>
      ) : (
        <p className="text-sm text-sub">
          The host is showing something this page can&apos;t display. Reload the page to update it.
        </p>
      )}
    </div>
  );
}
