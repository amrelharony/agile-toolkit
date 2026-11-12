"use client";

/**
 * The frame on screen in a show room, drawn by the renderer registered for
 * its tool and kind (`lib/realtime/show-room/renderers`). Before the host
 * shows anything, it says so; a frame this page can't draw (a kind it
 * doesn't know, from a newer build, or a payload its parser refused) gets
 * a "reload" line instead of anything from the wire.
 *
 * A new frame is announced politely, once, by number and time, so the
 * same spin twice is two announcements.
 */

import { useEffect, useRef } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { showRendererFor } from "@/lib/realtime/show-room/renderers";
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
  className?: string;
}

export function ShowFrameView({
  tool,
  frame,
  surface = "phone",
  emptyText = "Waiting for the host to show something…",
  className,
}: ShowFrameViewProps) {
  const announce = useAnnounce();
  const lastKey = useRef<string | null>(null);
  // A frame's number and the host's time for it: a new frame always differs.
  const frameKey = frame ? `${frame.n}-${frame.at}` : null;
  useEffect(() => {
    if (surface !== "phone" || frameKey === null) return;
    if (lastKey.current === frameKey) return;
    const first = lastKey.current === null;
    lastKey.current = frameKey;
    if (!first) announce("The host showed something new.");
  }, [frameKey, surface, announce]);

  const Renderer = frame?.supported ? showRendererFor(tool, frame.kind) : null;

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
      ) : (
        <p className="text-sm text-sub">
          The host is showing something this page can&apos;t display. Reload the page to update it.
        </p>
      )}
    </div>
  );
}
