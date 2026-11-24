"use client";

/**
 * The "Send to…" menu's items: one per route, or "Sent · Open" (a link to
 * the target) for a route the item was already sent on while that target
 * still exists. Sending is undoable: Undo removes the new item and the link.
 *
 * This module brings the hand-off registry, every target and the sender, so
 * pages never import it: `SendToMenu` and `SendToMenuItems` in
 * ./send-to-menu load it when a menu first shows its items.
 */

import Link from "next/link";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
  /** Whether the item can hold one more link (asked before anything is made); defaults to yes. */
  canLink?: () => boolean;
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
  canLink,
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
                canLink,
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
