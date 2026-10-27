"use client";

/**
 * "Send to…": hand an item to another tool (a retro action to the Kanban
 * backlog, a premortem cause to the Risk Register, …).
 *
 * `SendToMenu` is the trigger plus menu. `SendToMenuItems` renders just the
 * items, for a tool that already has a menu on the item (Story Mapper).
 * A route the item was already sent on shows "Sent · Open", a link to the
 * target, while that target still exists. Sending is undoable: Undo removes
 * the new item and the link.
 */

import Link from "next/link";
import { Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink, HandoffRouteId, HandoffSource } from "@/lib/handoffs/types";

export interface SendToProps {
  /** Routes this item may take, in menu order. */
  routes: readonly HandoffRouteId[];
  /** The item to send. */
  item: HandoffSource;
  /** Where the item was already sent. */
  sentTo: readonly HandoffLink[] | undefined;
  /** Record a change to the item's links (the send, or its Undo). */
  onLinksChange: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => void;
  /** Read the item's freshest links; defaults to `sentTo`. */
  getLinks?: () => readonly HandoffLink[] | undefined;
  /** Menu item text per route; defaults to the route's name. */
  itemLabels?: Partial<Record<HandoffRouteId, string>>;
}

/** The menu items alone, for an existing DropdownMenuContent. */
export function SendToMenuItems({
  routes,
  item,
  sentTo,
  onLinksChange,
  getLinks,
  itemLabels,
}: SendToProps) {
  const blank = !item.title.trim();
  return (
    <>
      {routes.map((id) => {
        const route = getHandoffRoute(id);
        const label = itemLabels?.[id] ?? route.label;
        const link = liveLink(sentTo, id);
        if (link) {
          return (
            <DropdownMenuItem key={id} asChild>
              <Link href={route.targetHref(link.targetId)}>
                <span className="flex-1">{label}</span>
                <span className="text-xs text-success">Sent · Open</span>
              </Link>
            </DropdownMenuItem>
          );
        }
        return (
          <DropdownMenuItem
            key={id}
            // A source the route can't take yet (an unrated risk) would send nothing.
            disabled={blank || Boolean(route.problem?.(item))}
            onSelect={() =>
              sendHandoff(id, item, {
                getLinks: getLinks ?? (() => sentTo),
                setLinks: onLinksChange,
              })
            }
          >
            {label}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

export function SendToMenu({
  className,
  disabled,
  ...props
}: SendToProps & {
  className?: string;
  disabled?: boolean;
}) {
  const title = props.item.title.trim();
  const sent = (props.sentTo ?? []).length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !title}
          // Rows repeat this button, so its name says which item (and starts
          // with the visible text).
          aria-label={`Send to… ${title}${sent ? " (sent)" : ""}`.trim()}
          className={cn(
            "min-touch-coarse h-7 gap-1.5 px-2 text-xs text-sub hover:text-accent",
            className
          )}
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
        <SendToMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
