"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, LogOut, Radio, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { toast } from "@/lib/utils/toast";
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
  className?: string;
}

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
  className,
}: VisitorRoomChipProps) {
  const announce = useAnnounce();
  const [copied, setCopied] = useState(false);
  const prevCount = useRef<number | null>(null);
  const max = VISITOR_LIMITS.maxMembers;

  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = memberCount;
    if (prev === null || prev === memberCount) return;
    const what = memberCount > prev ? "Someone joined" : "Someone left";
    announce(`${what}. ${memberCount} of ${max} people in the room.`);
  }, [memberCount, max, announce]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const path = joinUrl(tool, code);
  if (!visitorRoomsEnabled() || !path) return null;

  const copyLink = async () => {
    const url = `${window.location.origin}${path}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied. Share it only with your team.");
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
