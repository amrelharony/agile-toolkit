"use client";

import { useEffect, useRef } from "react";
import { Check, Copy, LogOut, Radio, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { toast } from "@/lib/utils/toast";
import { useFlash } from "@/hooks/use-flash";
import { cn } from "@/lib/utils";
import {
  VISITOR_LIMITS,
  joinUrl,
  visitorRoomsEnabled,
  type VisitorTool,
} from "@/lib/realtime/visitor-rooms";

export interface VisitorRoomChipProps {
  tool: VisitorTool;
  code: string;
  /** People in the room now, this person included. */
  memberCount: number;
  /** The host gets "End room"; everyone else gets "Leave". */
  isHost: boolean;
  /** Host only: end the room for everyone. */
  onEnd?: () => void;
  /** Participant only: leave the room. */
  onLeave?: () => void;
  /**
   * Appended to the copied link, e.g. `#k=<host key>` for a vote round. A
   * fragment stays in the browser: it never reaches the server or its logs.
   * Ignored unless it is `#` plus up to 64 URL-safe characters.
   */
  linkFragment?: string;
  className?: string;
}

const LINK_FRAGMENT_RE = /^#[A-Za-z0-9=_-]{1,64}$/;

/**
 * The header chip for a visitor live room: its code, "Copy link", how full
 * it is, and End room (host) or Leave (participant). Announces joins and
 * leaves politely. Renders nothing while the feature flag is off or for a
 * malformed code.
 */
export function VisitorRoomChip({
  tool,
  code,
  memberCount,
  isHost,
  onEnd,
  onLeave,
  linkFragment,
  className,
}: VisitorRoomChipProps) {
  const announce = useAnnounce();
  const { flash, isFlashing } = useFlash();
  const copied = isFlashing();
  const prevCount = useRef<number | null>(null);
  const max = VISITOR_LIMITS.maxMembers;

  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = memberCount;
    if (prev === null || prev === memberCount) return;
    const what = memberCount > prev ? "Someone joined" : "Someone left";
    announce(`${what}. ${memberCount} of ${max} people in the room.`);
  }, [memberCount, max, announce]);

  const path = joinUrl(tool, code);
  if (!visitorRoomsEnabled() || !path) return null;

  const copyLink = async () => {
    const fragment = linkFragment && LINK_FRAGMENT_RE.test(linkFragment) ? linkFragment : "";
    const url = `${window.location.origin}${path}${fragment}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      flash("Link copied. Share it only with your team.");
    } catch {
      toast.error(`Couldn't copy. The link is ${url}`);
    }
  };

  const full = memberCount >= max;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-2.5 py-1 text-xs text-text",
        className
      )}
    >
      <span className="flex items-center gap-1.5 text-accent">
        <Radio className="w-3.5 h-3.5" aria-hidden="true" />
        Live room
      </span>
      <span className="font-data tracking-wider">
        <span className="sr-only">Room code </span>
        {code}
      </span>
      <span className={cn("flex items-center gap-1 font-data", full ? "text-warning" : "text-sub")}>
        <Users className="w-3.5 h-3.5" aria-hidden="true" />
        <span aria-hidden="true">
          {memberCount}/{max}
        </span>
        <span className="sr-only">
          {memberCount} of {max} people
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1"
        title="Share it only with your team"
        onClick={() => void copyLink()}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
        ) : (
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy link"}
      </Button>
      {isHost
        ? onEnd && (
            <Button
              type="button"
              variant="danger-ghost"
              size="sm"
              className="gap-1"
              onClick={onEnd}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              End room
            </Button>
          )
        : onLeave && (
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onLeave}>
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Leave
            </Button>
          )}
    </div>
  );
}
