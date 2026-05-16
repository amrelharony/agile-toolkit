"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { categories, getToolsByCategory } from "@/lib/constants/tools";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Skip auto-repeat keydowns — without this, holding Cmd+K toggles
      // the palette dozens of times per second and traps the user in a
      // strobing open/close loop.
      if (e.repeat) return;
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search tools..." className="font-body" />
      <CommandList>
        <CommandEmpty>No tools found.</CommandEmpty>
        {categories.map((category) => {
          const categoryTools = getToolsByCategory(category);
          return (
            <CommandGroup key={category} heading={category}>
              {categoryTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <CommandItem
                    key={tool.id}
                    value={`${tool.name} ${tool.description}`}
                    onSelect={() => {
                      router.push(tool.path);
                      onOpenChange(false);
                    }}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <Icon className="w-4 h-4 text-accent flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{tool.name}</span>
                      <p className="text-xs text-sub truncate">
                        {tool.description}
                      </p>
                    </div>
                    {tool.badge && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1 py-0",
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
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
