"use client";

import { useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePersisted } from "@/lib/utils/use-persisted";
import { categories, getToolsByCategory } from "@/lib/constants/tools";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, History, Activity } from "lucide-react";
import Image from "next/image";
import { useSwipeToClose } from "@/hooks/use-swipe-to-close";

interface SidebarProps {
  /** Mobile drawer open state (parent-controlled). */
  mobileOpen?: boolean;
  /** Invoked when user triggers a close action. */
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  // Persist sidebar prefs so a user who collapses the rail or closes a
  // category section keeps that layout across page loads. Without this,
  // every refresh resets the sidebar back to fully-expanded, which is
  // disruptive for power users who work with the sidebar collapsed.
  const [collapsed, setCollapsed] = usePersisted<boolean>(
    "agile-toolkit:sidebar:collapsed",
    false
  );
  const [openCategories, setOpenCategories] = usePersisted<Record<string, boolean>>(
    "agile-toolkit:sidebar:openCategories",
    Object.fromEntries(categories.map((c) => [c, true]))
  );
  const asideRef = useRef<HTMLElement>(null);

  const handleClose = useCallback(() => onClose?.(), [onClose]);

  useSwipeToClose(asideRef, {
    direction: "left",
    enabled: mobileOpen,
    onClose: handleClose,
  });

  const toggleCategory = (category: string) => {
    setOpenCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  // Close the mobile drawer on route change.
  useEffect(() => {
    if (mobileOpen) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  // Escape key closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, onClose]);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "md:hidden fixed inset-0 z-[90] bg-bg/70 backdrop-blur-sm transition-opacity duration-medium",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden={!mobileOpen}
      />

      <aside
        ref={asideRef}
        aria-label="Primary navigation"
        className={cn(
          // Shared layout
          "flex flex-col glass-elevated border-r border-border transition-all duration-slow ease-spring overflow-hidden overscroll-contain-strict",
          // Mobile portrait: off-canvas fixed drawer; 80 vw with a 18 rem
          // (288 px) cap so the user can still see the underlying page
          // edge and tap to dismiss.
          "fixed top-0 left-0 bottom-0 z-[91] w-[80vw] max-w-[18rem] pl-safe",
          // Mobile landscape: shrink to 60 vw / 14 rem so a 568 × 320 px
          // device still leaves usable content area when the drawer is
          // open. Without this, the user could only see ~64 px of content.
          "[@media(max-width:767px)_and_(orientation:landscape)]:w-[55vw]",
          "[@media(max-width:767px)_and_(orientation:landscape)]:max-w-[14rem]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: inline, sticky, reveal
          "md:static md:translate-x-0 md:top-0 md:h-screen md:sticky md:pl-0",
          collapsed ? "md:w-16" : "md:w-64"
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-4 md:py-5 border-b border-border pt-safe md:pt-4">
          <Link
            href="/"
            onClick={onClose}
            className="flex items-center gap-3 min-w-0"
          >
            <div
              data-sidebar-logo="true"
              className="flex-shrink-0 w-8 h-8 rounded-xl overflow-hidden"
            >
              <Image
                src="/AT.svg"
                alt="Agile Toolkit"
                width={32}
                height={32}
                className="w-full h-full object-cover"
                priority
              />
            </div>
            {!collapsed && (
              <span className="text-base md:text-lg font-bold text-text whitespace-nowrap animate-fade-in">
                Agile Toolkit
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            data-no-sound="true"
            className="md:hidden ml-auto w-11 h-11 md:w-9 md:h-9 rounded-lg flex items-center justify-center text-sub hover:text-text hover:bg-accent/5"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 overscroll-contain">
          {/* Activity meta links — always visible, above categories */}
          <div className="space-y-0.5 mb-3 pb-3 border-b border-border">
            {[
              { href: "/history", label: "History", icon: History },
              { href: "/insights", label: "Insights", icon: Activity },
            ].map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  className={cn(
                    "group flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-default ease-spring relative overflow-hidden min-h-[40px]",
                    isActive
                      ? "bg-accent/10 text-accent shadow-[0_0_10px_var(--glow)_inset]"
                      : "text-sub hover:text-text hover:bg-accent/5",
                    collapsed && "md:justify-center"
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4 flex-shrink-0",
                      isActive ? "text-accent" : "text-sub group-hover:text-text"
                    )}
                    aria-hidden="true"
                  />
                  {!collapsed && (
                    <span className="truncate font-medium">{label}</span>
                  )}
                  {isActive && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent shadow-[0_0_8px_var(--glow)]"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              );
            })}
          </div>
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
                    collapsed && "md:justify-center"
                  )}
                >
                  {collapsed ? (
                    <span className="text-[10px] hidden md:inline">
                      {shortName.slice(0, 3)}
                    </span>
                  ) : (
                    <>
                      <span className="truncate">{category}</span>
                      <ChevronDown
                        className="ml-auto w-3 h-3 transition-transform duration-default"
                        aria-hidden="true"
                      />
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
                        onClick={onClose}
                        className={cn(
                          "group flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-default ease-spring relative overflow-hidden min-h-[40px]",
                          isActive
                            ? "bg-accent/10 text-accent shadow-[0_0_10px_var(--glow)_inset]"
                            : "text-sub hover:text-text hover:bg-accent/5"
                        )}
                        aria-current={isActive ? "page" : undefined}
                      >
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
                          aria-hidden="true"
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
                        {isActive && (
                          <div
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent shadow-[0_0_8px_var(--glow)]"
                            aria-hidden="true"
                          />
                        )}
                      </Link>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </nav>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          data-no-sound="true"
          className="
            hidden md:flex items-center justify-center
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
            aria-hidden="true"
          />
        </button>

        {/* Footer */}
        {!collapsed && (
          <div className="px-4 pb-3 pt-2 pb-safe border-t border-border md:border-t-0 md:pb-3">
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
    </>
  );
}
