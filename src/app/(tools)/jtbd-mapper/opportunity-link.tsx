"use client";

import { useId } from "react";
import Link from "next/link";
import { Link2Off, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OPPORTUNITY_TREE_HREF } from "./opportunities";
import type { OpportunityGroup, OpportunityLink } from "./opportunities";

/**
 * "Link to opportunity": a menu of the tree's opportunities, grouped under
 * the outcome each serves. With no opportunities yet it says so and points
 * to the Opportunity Tree, instead of opening an empty menu.
 */
export function LinkOpportunityMenu({
  groups,
  when,
  focusKey,
  disabled,
  describedBy,
  onLink,
}: {
  groups: readonly OpportunityGroup[];
  /** "when …", naming the job for screen readers. */
  when: string;
  focusKey: string;
  disabled?: boolean;
  describedBy?: string;
  onLink: (opportunityId: string) => void;
}) {
  const uid = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-focus-key={focusKey}
          aria-label={`Link to opportunity: ${when}`}
          aria-describedby={describedBy}
          className="min-touch-coarse h-7 gap-1.5 px-2 text-xs text-sub hover:text-accent"
        >
          <Target aria-hidden="true" />
          Link to opportunity
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {groups.length === 0 ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-sub">
              No opportunities in the Opportunity Tree yet. Map the outcome and its opportunities
              there, then link this job.
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={OPPORTUNITY_TREE_HREF}>
                <Target aria-hidden="true" />
                Open the Opportunity Tree
              </Link>
            </DropdownMenuItem>
          </>
        ) : (
          groups.map((g, i) => (
            <DropdownMenuGroup key={g.outcomeId ?? "none"} aria-labelledby={`${uid}-${i}`}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel id={`${uid}-${i}`} className="text-xs font-normal text-sub">
                {g.outcomeId ? `Outcome: ${g.outcome}` : g.outcome}
              </DropdownMenuLabel>
              {g.options.map((o) => (
                <DropdownMenuItem key={o.id} onSelect={() => onLink(o.id)}>
                  <span className="min-w-0 break-words">{o.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A linked job's opportunity: a chip that opens the Opportunity Tree, or
 * "Opportunity removed" once the node is gone from it, with Unlink either
 * way.
 */
export function OpportunityChip({
  link,
  when,
  focusKey,
  onUnlink,
}: {
  link: Exclude<OpportunityLink, { state: "none" }>;
  when: string;
  focusKey: string;
  onUnlink: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      {link.state === "linked" ? (
        <Link
          href={OPPORTUNITY_TREE_HREF}
          data-focus-key={focusKey}
          // The visible title truncates on a phone; the name and tooltip keep it whole.
          aria-label={`Opportunity: ${link.title} (open in the Opportunity Tree)`}
          title={link.outcome ? `${link.title} (outcome: ${link.outcome})` : link.title}
          className="min-touch-coarse inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-card px-2 text-accent-3 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Target className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Opportunity: {link.title}</span>
        </Link>
      ) : (
        <span className="inline-flex h-7 items-center gap-1 text-warning">
          <Target className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Opportunity removed
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onUnlink}
        aria-label={`Unlink the opportunity: ${when}`}
        className="min-touch-coarse h-7 gap-1 px-2 text-xs text-sub hover:text-danger"
      >
        <Link2Off aria-hidden="true" />
        Unlink
      </Button>
    </div>
  );
}
