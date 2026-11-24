"use client";

/**
 * "Send to…" for a kickoff's line: the shared hand-off menu's items, one
 * route at a time, so each route gets what fits it (a worry its ratings and
 * cover for the Risk Register; a problem statement its evidence for an
 * opportunity, and the problem itself for a root-cause analysis). A route
 * already taken shows "Sent · Open" while its target is there; every send
 * comes with Undo (lib/handoffs/send).
 *
 * The menu is off, with the reason beside it, for an example kickoff and for
 * a line still holding a [placeholder].
 */

import { Check, Send } from "lucide-react";
import { SendToMenuItems, preloadSendToMenuItems } from "@/components/handoff/send-to-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HandoffLink, HandoffRouteId, HandoffSource } from "@/lib/handoffs/types";

/** Every route a kickoff sends on: worries, assumptions, scope, rules, the statement and the trade-offs. */
export const KICKOFF_SEND_ROUTES = [
  "risk",
  "hypothesis",
  "backlog-story",
  "agreement-rule",
  "opportunity",
  "root-cause",
  "decision",
] as const satisfies readonly HandoffRouteId[];

/** What each route is called in a kickoff's menu. */
export const KICKOFF_ROUTE_LABEL: Partial<Record<HandoffRouteId, string>> = {
  risk: "Risk Register",
  hypothesis: "Hypothesis to test",
  "backlog-story": "Backlog story",
  "agreement-rule": "Working Agreement rule",
  opportunity: "Opportunity Tree",
  "root-cause": "Root-cause analysis",
  decision: "Decision Log",
};

export interface KickoffSendEntry {
  route: HandoffRouteId;
  item: HandoffSource;
}

export function KickoffSendMenu({
  entries,
  sentTo,
  getLinks,
  onLinksChange,
  disabled,
}: {
  entries: readonly KickoffSendEntry[];
  sentTo: readonly HandoffLink[] | undefined;
  getLinks: () => readonly HandoffLink[] | undefined;
  onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  disabled?: boolean;
}) {
  if (entries.length === 0) return null;
  const title = entries[0].item.title.trim();
  const sent = entries.some((e) => (sentTo ?? []).some((l) => l.route === e.route));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !title}
          // Rows repeat this button, so its name says which line.
          aria-label={`Send to… ${title}${sent ? " (sent)" : ""}`.trim()}
          className="min-touch-coarse h-7 gap-1.5 px-2 text-xs text-sub hover:text-accent"
          // The items (and the hand-off registry) load as a pointer or focus gets here.
          onPointerEnter={preloadSendToMenuItems}
          onFocus={preloadSendToMenuItems}
        >
          {sent ? (
            <Check className="text-success" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          Send to…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-medium text-sub">Send to</DropdownMenuLabel>
        {entries.map((e) => (
          <SendToMenuItems
            key={e.route}
            routes={[e.route]}
            item={e.item}
            sentTo={sentTo}
            getLinks={getLinks}
            onLinksChange={onLinksChange}
            itemLabels={{ [e.route]: KICKOFF_ROUTE_LABEL[e.route] }}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
