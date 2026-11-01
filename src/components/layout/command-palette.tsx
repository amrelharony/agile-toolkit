"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { favorites, recent } = useToolPrefs();
  const { showAll, categories, toolsIn } = useToolVisibility();
  const vip = useVipHint();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Caps Lock makes `e.key` "K" — compare against the lowercase form so
      // the shortcut keeps working regardless of caps state. Also accept the
      // physical key code as a fallback for layouts where the K position
      // produces a different character.
      const isK = e.key.toLowerCase() === "k" || e.code === "KeyK";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  // Start fresh each time the palette opens.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

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
    router.push(tool.path);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search tools"
      commandProps={{ shouldFilter: false, loop: true }}
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
