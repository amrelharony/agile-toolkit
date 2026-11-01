"use client";

/**
 * Controls every visitor room's host strip shares: the member list with
 * Remove, and the "keep the room open?" prompt after 30 idle minutes.
 *
 * Names come from presence (or a host's snapshot), already checked for
 * control and bidi characters, and render as React text only.
 */

import { useId } from "react";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface RoomMemberListProps {
  members: readonly { id: string; name: string }[];
  selfId: string;
  hostId: string | null;
  removedIds?: ReadonlySet<string>;
  /** Host only: offer Remove next to everyone else. */
  onRemove?: (id: string, name: string) => void;
  className?: string;
}

export function RoomMemberList({
  members,
  selfId,
  hostId,
  removedIds,
  onRemove,
  className,
}: RoomMemberListProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("space-y-1", className)}>
      <h2 id={headingId} className="text-xs font-semibold text-sub">
        In the room
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const removed = removedIds?.has(m.id) ?? false;
          const tags = [
            m.id === selfId ? "you" : null,
            m.id === hostId ? "host" : null,
            removed ? "removed" : null,
          ].filter(Boolean);
          return (
            <li
              key={m.id}
              className={cn(
                "flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-text",
                removed && "opacity-60"
              )}
            >
              <span className="max-w-[12rem] truncate">{m.name}</span>
              {tags.length > 0 && <span className="text-sub">({tags.join(", ")})</span>}
              {onRemove && m.id !== selfId && !removed && (
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  className="h-6 min-h-0 px-1"
                  aria-label={`Remove ${m.name} from the room`}
                  onClick={() => onRemove(m.id, m.name)}
                >
                  <UserMinus className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface IdlePromptDialogProps {
  open: boolean;
  onKeepOpen: () => void;
  onEnd: () => void;
  /** One more sentence on what ending keeps or loses, e.g. "Your board stays here either way." */
  note?: string;
}

export function IdlePromptDialog({ open, onKeepOpen, onEnd, note }: IdlePromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeepOpen()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keep the live room open?</DialogTitle>
          <DialogDescription>
            Nothing has happened in the room for 30 minutes. It ends in 2 minutes unless you keep it
            open.{note ? ` ${note}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onEnd}>
            End room
          </Button>
          <Button type="button" variant="toolkit" onClick={onKeepOpen} autoFocus>
            Keep it open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
