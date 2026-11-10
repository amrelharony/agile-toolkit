"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Type only: the value is the string "auto", so none of the router's internals ship.
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getToolById, type ToolDefinition } from "@/lib/constants/tools";
import { isShelved, isVipHidden } from "@/lib/tools/catalog";
import { useVipHint } from "@/lib/vip/use-vip-hint";
import { useToolVisibility } from "@/lib/tools/use-visible-tools";
import { searchTools } from "@/lib/search/tool-search";
import { useToolPrefs } from "@/lib/tools/tool-prefs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isDynamicPath, pushWithTransition } from "@/lib/motion/page-transition";

/**
 * The highlighted tool starts loading after it has stayed highlighted this
 * long, so arrowing through the list does not fetch every row.
 */
const PREFETCH_DELAY_MS = 150;

/**
 * Next 14.2's router.prefetch defaults to "full", which would replace the
 * "auto" copy a link already loaded with a new fetch. "auto" reuses it.
 */
const AUTO = "auto" as PrefetchKind.AUTO;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Ctrl/Cmd+K tool finder.
 *
 * Typing ranks tools with the synonym-aware matcher (lib/search/tool-search),
 * so "daily scrum", "definition of ready" or "prioritise my backlog" find the
 * right tools even when those words aren't in a tool's name. Hits from the
 * "More tools" shelf sit in their own group unless "Show all tools" is on.
 * With an empty query it shows favourites and recent tools first, then every
 * visible category.
 *
 * Picking a tool cross-fades to it like a link (lib/motion/page-transition),
 * so the highlighted tool starts loading while it is looked at. The prefetch
 * is optional-chained: some tests hand in a router that has only push.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // The highlighted item's value (cmdk only reports it when controlled).
  const [active, setActive] = useState("");
  const prefetched = useRef(new Set<string>());
  const { favorites, recent } = useToolPrefs();
  const { showAll, categories, toolsIn } = useToolVisibility();
  const vip = useVipHint();

  // Ctrl/Cmd+K is the shell's (use-command-palette-shortcut): this file loads
  // only once the palette is first opened.

  // Start fresh each time the palette opens. The query and highlight reset
  // while rendering, not in an effect: cmdk highlights the first row only
  // when its value is empty as the rows mount, and this component stays
  // mounted between opens, so a highlight kept from last time would win.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActive("");
    }
  }
  useEffect(() => {
    if (open) prefetched.current = new Set();
  }, [open]);

  // Load the highlighted tool ahead, once per path while the palette is open.
  // Force-dynamic pages are left out: their prefetch carries no page, and
  // the change to them is instant anyway.
  useEffect(() => {
    if (!open) return;
    const path = getToolById(active.replace(/^pinned-/, ""))?.path;
    if (!path || prefetched.current.has(path) || isDynamicPath(path)) return;
    const timer = setTimeout(() => {
      prefetched.current.add(path);
      router.prefetch?.(path, { kind: AUTO });
    }, PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active, open, router]);

  const trimmed = query.trim();
  const matches = useMemo(() => (trimmed ? searchTools(trimmed, 12) : []), [trimmed]);
  const bestMatches = showAll ? matches : matches.filter((t) => !isShelved(t));
  const shelvedMatches = showAll ? [] : matches.filter(isShelved);

  const pinned = useMemo(() => {
    const ids = [...favorites, ...recent.map((r) => r.id)];
    const seen = new Set<string>();
    const out: ToolDefinition[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const tool = getToolById(id);
      if (tool && !isVipHidden(tool, vip)) out.push(tool);
    }
    return out.slice(0, 6);
  }, [favorites, recent, vip]);

  const go = (tool: ToolDefinition) => {
    // Cross-fades when it may; otherwise the router pushes plainly, as before.
    pushWithTransition(tool.path, { plain: router });
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search tools"
      commandProps={{ shouldFilter: false, loop: true, value: active, onValueChange: setActive }}
    >
      <CommandInput
        aria-label="Search tools"
        placeholder="What do you need to do? e.g. run a retro, prioritise a backlog"
        className="font-body"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {trimmed ? (
          <>
            <CommandEmpty>
              No tools match “{trimmed}”. Try a method name (WSJF, OKR) or a task (estimate, retro).
            </CommandEmpty>
            {bestMatches.length > 0 && (
              <CommandGroup heading="Best matches">
                {bestMatches.map((tool) => (
                  <ToolItem key={tool.id} tool={tool} onSelect={() => go(tool)} />
                ))}
              </CommandGroup>
            )}
            {shelvedMatches.length > 0 && (
              <CommandGroup heading="More tools (off the main navigation)">
                {shelvedMatches.map((tool) => (
                  <ToolItem key={tool.id} tool={tool} onSelect={() => go(tool)} />
                ))}
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            {pinned.length > 0 && (
              <CommandGroup heading="Favourites & recent">
                {pinned.map((tool) => (
                  <ToolItem
                    key={`pinned-${tool.id}`}
                    value={`pinned-${tool.id}`}
                    tool={tool}
                    onSelect={() => go(tool)}
                  />
                ))}
              </CommandGroup>
            )}
            {categories.map((category) => (
              <CommandGroup key={category} heading={category}>
                {toolsIn(category).map((tool) => (
                  <ToolItem key={tool.id} tool={tool} onSelect={() => go(tool)} />
                ))}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function ToolItem({
  tool,
  value,
  onSelect,
}: {
  tool: ToolDefinition;
  value?: string;
  onSelect: () => void;
}) {
  const Icon = tool.icon;
  return (
    <CommandItem
      value={value ?? tool.id}
      onSelect={onSelect}
      className="flex items-center gap-2 sm:gap-3 cursor-pointer"
    >
      <Icon className="w-4 h-4 text-accent flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{tool.name}</span>
        <p className="text-xs text-sub truncate">{tool.description}</p>
      </div>
      {tool.badge && (
        <Badge
          variant="outline"
          className={cn(
            "text-xs px-1 py-0",
            tool.badge === "new"
              ? "border-accent-green text-accent-green"
              : "border-accent-amber text-accent-amber"
          )}
        >
          {tool.badge}
        </Badge>
      )}
    </CommandItem>
  );
}
