"use client";

import Link from "next/link";
import { HeartHandshake, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SectionCard } from "@/components/shared/section-card";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { RECENT_DAYS, type RosterName } from "@/lib/kudos/recognition";
import type { Sprint } from "@/lib/stores/workspace-types";

/** Which kudos the Not thanked yet panel reads. */
export type WindowMode = "sprint" | "recent" | "all";

/** "Sam", from "Sam Lee": the button names a person by their first name. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export interface NotThankedSectionProps {
  /** Teammates nobody has thanked in the window, in roster order. */
  members: readonly RosterName[];
  /** The team's size: with nobody on it, the panel asks for the team instead. */
  rosterSize: number;
  /** "in Sprint 12", "in the last 30 days", "so far". */
  windowLabel: string;
  mode: WindowMode;
  onMode: (mode: WindowMode) => void;
  /** Sprints with real dates, newest first. */
  sprints: Sprint[];
  selectedSprintId: string | undefined;
  onSelectSprint: (id: string) => void;
  /** Shown when the Sprint window has no dated sprint to read. */
  sprintNote?: string;
  /** "Send to …" for a teammate on the list; absent while the example is shown. */
  onSendTo?: (memberId: string) => void;
  /** Can the form pick this member (they're in its recipient list)? */
  canSendTo?: (memberId: string) => boolean;
}

/**
 * Not thanked yet: the teammates no kudos has reached in a window, each with
 * Send to <name>. It names people and never counts: kudos are thanks, not a
 * scoreboard, so there is no tally, ranking or share here.
 */
export function NotThankedSection({
  members,
  rosterSize,
  windowLabel,
  mode,
  onMode,
  sprints,
  selectedSprintId,
  onSelectSprint,
  sprintNote,
  onSendTo,
  canSendTo,
}: NotThankedSectionProps) {
  return (
    <SectionCard title="Not thanked yet" icon={HeartHandshake} contentClassName="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          {/* The group names itself ("Window"); this is the visible caption. */}
          <span className="text-xs font-medium text-sub" aria-hidden="true">
            Window
          </span>
          <ToggleGroup<WindowMode>
            label="Window"
            size="sm"
            value={mode}
            onValueChange={onMode}
            options={[
              { value: "sprint", label: "Sprint", disabled: sprints.length === 0 },
              { value: "recent", label: `Last ${RECENT_DAYS} days` },
              { value: "all", label: "All time" },
            ]}
          />
        </div>
        {mode === "sprint" && sprints.length > 0 && (
          <SprintPicker
            sprints={sprints}
            selectedId={selectedSprintId}
            onSelect={onSelectSprint}
            allowCreate={false}
          />
        )}
      </div>
      {sprintNote && <p className="text-xs text-sub">{sprintNote}</p>}

      {rosterSize === 0 ? (
        <p className="text-sm text-text">
          Add your teammates on the{" "}
          <Link href="/team" className="font-medium text-accent underline underline-offset-2">
            Team page
          </Link>{" "}
          to see who hasn&apos;t been thanked yet.
        </p>
      ) : members.length > 0 ? (
        <>
          <p className="text-sm text-text">No kudos have reached these teammates {windowLabel}.</p>
          <ul aria-label="Not thanked yet" className="divide-y divide-border">
            {members.map((m) => {
              const sendable = onSendTo && (canSendTo?.(m.memberId) ?? true);
              return (
                <li
                  key={m.memberId}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
                >
                  <span className="min-w-0 break-words font-medium text-text">{m.name}</span>
                  {sendable && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => onSendTo(m.memberId)}
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      Send to {firstName(m.name)}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-sm text-text">Everyone on your team has been thanked {windowLabel}.</p>
      )}
    </SectionCard>
  );
}
