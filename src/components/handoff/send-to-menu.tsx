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
 *
 * The items need the hand-off registry, every target and the sender, which
 * no page needs to draw the trigger. They load (./send-to-menu-items) the
 * first time a pointer or focus reaches a trigger, so they are usually in by
 * the time the menu opens; until then the menu says it is loading.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
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
import type { SendToProps } from "./send-to-menu-items";

export type { SendToProps } from "./send-to-menu-items";

type ItemsModule = typeof import("./send-to-menu-items");

let itemsModule: ItemsModule | null = null;
let itemsLoad: Promise<ItemsModule> | null = null;
const itemsListeners = new Set<() => void>();

/**
 * Loads the menu items (once), resolving when they can draw; every menu
 * waiting on them draws them then. A failed load is tried again on the next
 * call. A test that opens a menu and picks an item at once awaits this first.
 */
export function loadSendToMenuItems(): Promise<ItemsModule> {
  itemsLoad ??= import("./send-to-menu-items").then(
    (mod) => {
      itemsModule = mod;
      itemsListeners.forEach((listener) => listener());
      return mod;
    },
    (error: unknown) => {
      itemsLoad = null;
      throw error;
    }
  );
  return itemsLoad;
}

/** Starts the load early (a pointer or focus on a trigger); a failure waits for the menu's own try. */
export function preloadSendToMenuItems() {
  loadSendToMenuItems().catch(() => {});
}

const subscribeItems = (listener: () => void) => {
  itemsListeners.add(listener);
  return () => {
    itemsListeners.delete(listener);
  };
};
const loadedItems = () => itemsModule;

/** The menu items alone, for an existing DropdownMenuContent. */
export function SendToMenuItems(props: SendToProps) {
  const mod = useSyncExternalStore(subscribeItems, loadedItems, () => null);
  const [failed, setFailed] = useState(false);
  // The menu's content mounts as it opens: an earlier failed load is tried again then.
  useEffect(() => {
    if (mod) return;
    let live = true;
    loadSendToMenuItems().catch(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [mod]);
  if (mod) return <mod.SendToMenuItems {...props} />;
  return (
    <DropdownMenuItem disabled>
      {failed ? "Couldn't load where to send it. Close and try again." : "Loading…"}
    </DropdownMenuItem>
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
        <SendToMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
