"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { categories, getToolsByCategory } from "@/lib/constants/tools";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, Sparkles } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    Object.fromEntries(categories.map((c) => [c, true]))
  );

  const toggleCategory = (category: string) => {
    setOpenCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <aside
      className={cn(
        "flex flex-col glass-elevated border-r border-border h-screen sticky top-8 transition-all duration-slow ease-spring",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <Link href="/" className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-bg" />
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <span className="text-sm font-semibold text-text">
                Agile Toolkit
              </span>
              <div className="font-mono text-micro text-sub tracking-wider uppercase">
                by amrelharony
              </div>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {categories.map((category) => {
          const categoryTools = getToolsByCategory(category);
          const shortName = category.split(" ")[0];

          return (
            <Collapsible
              key={category}
              open={!collapsed && openCategories[category]}
              onOpenChange={() => toggleCategory(category)}
            >
              <CollapsibleTrigger
                className={cn(
                  "flex items-center w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sub hover:text-text transition-colors rounded-lg",
                  collapsed && "justify-center"
                )}
              >
                {collapsed ? (
                  <span className="text-[10px]">{shortName.slice(0, 3)}</span>
                ) : (
                  <>
                    <span className="truncate">{category}</span>
                    <ChevronDown className="ml-auto w-3 h-3 transition-transform duration-default" />
                  </>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-0.5">
                {categoryTools.map((tool) => {
                  const isActive = pathname === tool.path;
                  const Icon = tool.icon;

                  return (
                    <Link
                      key={tool.id}
                      href={tool.path}
                      className={cn(
                        "group flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-default ease-spring relative overflow-hidden",
                        isActive
                          ? "bg-accent/10 text-accent shadow-[0_0_10px_var(--glow)_inset]"
                          : "text-sub hover:text-text hover:bg-accent/5"
                      )}
                    >
                      {/* Shimmer overlay on hover */}
                      {!isActive && (
                        <div
                          className="
                            absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100
                            bg-gradient-to-r from-transparent via-glow to-transparent
                            -translate-x-full group-hover:animate-shimmer
                          "
                        />
                      )}
                      <Icon
                        className={cn(
                          "w-4 h-4 flex-shrink-0 relative z-[1] transition-transform duration-default ease-spring",
                          isActive
                            ? "text-accent"
                            : "text-sub group-hover:text-text group-hover:scale-110"
                        )}
                      />
                      {!collapsed && (
                        <>
                          <span className="truncate relative z-[1] font-medium">
                            {tool.name}
                          </span>
                          {tool.badge && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "ml-auto text-[10px] px-1 py-0 relative z-[1]",
                                tool.badge === "new"
                                  ? "border-accent-green text-accent-green"
                                  : "border-accent-amber text-accent-amber"
                              )}
                            >
                              {tool.badge}
                            </Badge>
                          )}
                        </>
                      )}
                      {/* Active indicator bar */}
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent shadow-[0_0_8px_var(--glow)]" />
                      )}
                    </Link>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="
          flex items-center justify-center
          w-full py-3 border-t border-border
          text-sub hover:text-accent
          transition-all duration-default ease-spring
        "
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronLeft
          className={cn(
            "w-4 h-4 transition-transform duration-medium ease-spring",
            collapsed && "rotate-180"
          )}
        />
      </button>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 pb-3">
          <p className="text-[10px] text-sub text-center">
            Built by{" "}
            <a
              href="https://amrelharony.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Amr El Harony
            </a>
          </p>
        </div>
      )}
    </aside>
  );
}
