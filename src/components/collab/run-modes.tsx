"use client";

/**
 * The two ways to run a session wherever a live room can be started (the
 * Planning Poker lobby, the Retro board, a tool's vote-round panel), under
 * the same two names everywhere:
 *
 *   - "One screen": the facilitator's screen, shared in the meeting, with
 *     votes or cards entered there or counted by hand;
 *   - "Everyone on their own device": a visitor live room, joined by link
 *     or QR code.
 *
 * Beside the second choice go our own limits, from the constants, and
 * nobody else's.
 *
 *   <RunModeChoice
 *     oneScreen={{ description: "…", action: <Button>Start Session</Button> }}
 *     ownDevice={{ description: "…", action: <Button>Start a live room</Button> }}
 *   />
 */

import { useId, type ReactNode } from "react";
import { Monitor, Smartphone, type LucideIcon } from "lucide-react";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { cn } from "@/lib/utils";

/** The two names, the same wherever they show. */
export const RUN_MODES = {
  oneScreen: "One screen",
  ownDevice: "Everyone on their own device",
} as const;

const HOUR_MS = 60 * 60 * 1000;

/**
 * A live room's limits, as one short sentence each: no account for host or
 * guests, the most people, the longest it stays open, and that we keep
 * nothing. The numbers come from `VISITOR_LIMITS`.
 */
export function liveRoomLimits(): string[] {
  const hours = Math.round(VISITOR_LIMITS.hardTtlMs / HOUR_MS);
  return [
    "No account needed, for you or your guests.",
    `Up to ${VISITOR_LIMITS.maxMembers} people, for up to ${hours} hours.`,
    "We store nothing.",
  ];
}

/** The limits line that sits beside the live choice. */
export function LiveRoomLimits({ id, className }: { id?: string; className?: string }) {
  return (
    <p id={id} className={cn("text-xs text-sub", className)}>
      {liveRoomLimits().join(" ")}
    </p>
  );
}

export interface RunModeOption {
  /** How this way works, in a sentence or two. */
  description: ReactNode;
  /** What starts it: a button, or a status while it opens. */
  action: ReactNode;
}

/**
 * The two ways side by side, "One screen" first, as labelled groups; they
 * stack when the space is narrower than two comfortable columns.
 */
export function RunModeChoice({
  oneScreen,
  ownDevice,
  className,
}: {
  oneScreen: RunModeOption;
  ownDevice: RunModeOption;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className={cn("flex flex-col gap-2", className)}
    >
      <p id={`${id}-title`} className="text-sm font-medium text-text">
        How will you run it?
      </p>
      <div className="flex flex-wrap gap-3">
        <RunModeCard id={`${id}-one`} icon={Monitor} name={RUN_MODES.oneScreen} {...oneScreen} />
        <RunModeCard
          id={`${id}-own`}
          icon={Smartphone}
          name={RUN_MODES.ownDevice}
          {...ownDevice}
          limits
        />
      </div>
    </div>
  );
}

function RunModeCard({
  id,
  icon: Icon,
  name,
  description,
  action,
  limits = false,
}: RunModeOption & { id: string; icon: LucideIcon; name: string; limits?: boolean }) {
  return (
    <div
      role="group"
      aria-labelledby={`${id}-name`}
      className="flex min-w-0 flex-1 basis-60 flex-col gap-2 rounded-lg border border-border bg-surface-deep p-3"
    >
      <p id={`${id}-name`} className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        {name}
      </p>
      <div className="text-sm text-sub">{description}</div>
      {limits && <LiveRoomLimits />}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">{action}</div>
    </div>
  );
}
