"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePersisted } from "@/lib/utils/use-persisted";
import { categories, getToolsByCategory, type ToolCategory } from "@/lib/constants/tools";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronLeft, History, Activity, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useSwipeToClose } from "@/hooks/use-swipe-to-close";
import { emit as sonify } from "@/lib/sonification/emit";

/**
 * Compact display label for each category header in the sidebar. The full
 * name lives in the registry (used by breadcrumbs, search, AI prompts);
 * the sidebar gets a shorter Title-Case version so 18 categories sit in
 * a calm visual rhythm without screaming UPPERCASE at the user.
 *
 * Any category missing from this map falls back to the registry name.
 */
const SHORT_CATEGORY: Partial<Record<ToolCategory, string>> = {
  "Sprint Planning & Estimation": "Sprint Planning",
  "Metrics & Dashboards": "Metrics",
  "Team Health & Maturity": "Team Health",
  "Portfolio & Scaling": "Portfolio",
  "Product Discovery": "Discovery",
  "Risk & Governance": "Risk",
  "Flow & Delivery": "Flow",
  "Outcomes & Pulse": "Outcomes",
  "Engineering Excellence": "Engineering",
  "Incidents & Reliability": "Incidents",
  "Security & Compliance": "Security",
  "Quality Engineering": "Quality",
  "Workshops & Facilitation": "Workshops",
  "AI / LLM Product Management": "AI / LLM",
  "Prioritization Frameworks": "Prioritization",
  "Decision Frameworks": "Decisions",
  "Visual Collaboration": "Whiteboard",
};

function categoryLabel(category: ToolCategory): string {
  return SHORT_CATEGORY[category] ?? category;
}

interface SidebarProps {
  /** Mobile drawer open state (parent-controlled). */
  mobileOpen?: boolean;
  /** Invoked when user triggers a close action. */
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  // Persisted layout prefs.
  //
  // Auto-hide rail (collapsed default) — see the original design notes; v2
  // storage keys ensure existing users adopt the new defaults on first
  // load. The visual rewrite below doesn't change persistence semantics.
  const [collapsed, setCollapsed] = usePersisted<boolean>(
    "agile-toolkit:sidebar:collapsed:v2",
    true
  );
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const expanded = !collapsed || hoverExpanded;
  const [openCategories, setOpenCategories] = usePersisted<Record<string, boolean>>(
    "agile-toolkit:sidebar:openCategories:v2",
    {}
  );
  const asideRef = useRef<HTMLElement>(null);

  const handleClose = useCallback(() => onClose?.(), [onClose]);

  useSwipeToClose(asideRef, {
    direction: "left",
    enabled: mobileOpen,
    onClose: handleClose,
  });

  const toggleCategory = (category: string) => {
    // Dedicated sidebar palette: `category-open` / `category-close` are
    // softer than the global click sound (velocity ≤ 0.22, muffled blip,
    // pitch jitter) so navigation chrome doesn't sound like a primary CTA.
    const next = !openCategories[category];
    sonify("ui", next ? "category-open" : "category-close");
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
      {/* Mobile backdrop — same behaviour as before, slightly more muted. */}
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
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse" && collapsed) setHoverExpanded(true);
        }}
        onPointerLeave={() => setHoverExpanded(false)}
        className={cn(
          // Container — keep the glass-elevated treatment so the sidebar
          // still reads as a separate surface, but lean on a single
          // hairline border instead of any internal divider noise.
          "flex flex-col bg-bg/80 backdrop-blur-xl border-r border-border/70",
          "transition-[width] duration-slow ease-spring overflow-hidden overscroll-contain-strict",
          // Mobile: fixed off-canvas drawer.
          "fixed top-0 left-0 bottom-0 z-[91] w-[80vw] max-w-[18rem] pl-safe",
          "[@media(max-width:767px)_and_(orientation:landscape)]:w-[55vw]",
          "[@media(max-width:767px)_and_(orientation:landscape)]:max-w-[14rem]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: inline sticky rail / panel.
          "md:static md:translate-x-0 md:top-0 md:h-screen md:sticky md:pl-0",
          expanded ? "md:w-60" : "md:w-14"
        )}
      >
        {/* Brand — compact, restrained. The logo carries identity; the
            wordmark only appears in the expanded width so the rail mode
            stays icon-only. */}
        <Link
          href="/"
          onClick={onClose}
          className={cn(
            "flex items-center gap-2.5 px-3 h-14 shrink-0",
            "pt-safe md:pt-0",
            "border-b border-border/60",
            !expanded && "md:justify-center md:px-0 md:gap-0"
          )}
        >
          <div
            data-sidebar-logo="true"
            className="w-7 h-7 rounded-lg overflow-hidden shrink-0"
          >
            <Image
              src="/AT.svg"
              alt="Agile Toolkit"
              width={28}
              height={28}
              className="w-full h-full object-cover"
              priority
            />
          </div>
          {expanded && (
            <span className="text-[13px] font-semibold tracking-tight text-text whitespace-nowrap">
              Agile Toolkit
            </span>
          )}
          {/* Mobile-only close button stays anchored to the brand row so
              the user can dismiss from the top-right edge by thumb. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            data-no-sound="true"
            className="md:hidden ml-auto w-9 h-9 rounded-md flex items-center justify-center text-sub hover:text-text hover:bg-text/[0.04]"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
        </Link>

        {/* Navigation — single scroll surface, generous padding so items
            breathe instead of stacking. */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 overscroll-contain">
          {/* Meta links — sit visually as plain items, no boxed-out
              "section" treatment. A single subtle margin separates them
              from the first category cluster. */}
          <div className="mb-2">
            {[
              { href: "/history", label: "History", icon: History },
              { href: "/insights", label: "Insights", icon: Activity },
            ].map(({ href, label, icon: Icon }) => (
              <SidebarItem
                key={href}
                href={href}
                label={label}
                Icon={Icon}
                isActive={pathname === href}
                expanded={expanded}
                onClose={onClose}
              />
            ))}
          </div>

          {(() => {
            // Track the first NON-EMPTY category index so the rail-mode
            // hairline separator above each category skips the top one.
            // (Plain `.map` index would point at categories with zero
            // tools too, which we skip — so the visual "first" doesn't
            // line up with index 0.)
            let firstRenderedSeen = false;
            return categories.map((category) => {
            const categoryTools = getToolsByCategory(category);
            if (categoryTools.length === 0) return null;
            const isFirstRendered = !firstRenderedSeen;
            firstRenderedSeen = true;
            const label = categoryLabel(category);
            // In rail mode every category is forced open — the rail is a
            // single flat scroll of tool icons, grouped by hairline
            // separators (rendered in place of the trigger below). The
            // user's persisted open/closed preference is honoured only
            // in the expanded width, which is the only place the
            // category headers are visible to toggle.
            const isOpen = !expanded || !!openCategories[category];
            // Rail mode: skip the category header entirely. The icons
            // below already imply grouping via insertion order; rendering
            // truncated 3-letter tags (the old "Spr"/"Met" approach) felt
            // unfinished and added visual debt.
            //
            // Tool count belongs in the expanded header as a quiet hint
            // — users can gauge category density without expanding.
            const toolCount = categoryTools.length;

            return (
              <Collapsible
                key={category}
                open={isOpen}
                onOpenChange={() => toggleCategory(category)}
              >
                {expanded ? (
                  <CollapsibleTrigger
                    data-no-sound="true"
                    className={cn(
                      // Title Case (not UPPERCASE) + tighter tracking +
                      // text-sub gives a quieter header that still scans
                      // as a section divider. Margin-top spaces clusters
                      // apart so the eye can chunk them.
                      "flex items-center w-full pl-3 pr-2 h-7 mt-3 first:mt-1",
                      "text-[11px] font-medium tracking-tight text-sub/80",
                      "hover:text-text transition-colors rounded-md",
                      "group"
                    )}
                  >
                    <span className="truncate">{label}</span>
                    <span
                      className={cn(
                        "ml-1.5 text-[10px] font-normal tabular-nums",
                        "text-sub/50 group-hover:text-sub transition-colors"
                      )}
                    >
                      {toolCount}
                    </span>
                    <ChevronDown
                      className={cn(
                        "ml-auto w-3 h-3 text-sub/60 transition-transform duration-default",
                        isOpen ? "rotate-0" : "-rotate-90"
                      )}
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>
                ) : !isFirstRendered ? (
                  // Rail mode: a hairline separator between categories.
                  // Skipped above the very first rendered category so the
                  // rail doesn't open with a line under the meta links.
                  // Aria-hidden so screen readers don't enumerate empty
                  // group markers; the section structure is reconstructed
                  // when the user expands.
                  <div
                    aria-hidden="true"
                    className="hidden md:block h-px mx-2 my-2 bg-border/40"
                  />
                ) : null}
                <CollapsibleContent className="space-y-px">
                  {categoryTools.map((tool) => (
                    <SidebarItem
                      key={tool.id}
                      href={tool.path}
                      label={tool.name}
                      Icon={tool.icon}
                      badge={tool.badge}
                      isActive={pathname === tool.path}
                      expanded={expanded}
                      onClose={onClose}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          });
          })()}
        </nav>

        {/* Footer cluster — credit line on top, collapse toggle anchored
            at the bottom edge. Border-top separates the cluster from the
            scrollable nav above without competing with it. Credit hides
            in rail mode since 56px can't accommodate the full line. */}
        <div className="border-t border-border/60 pb-safe md:pb-0">
          {expanded && (
            <p className="px-3 pt-2.5 text-[10px] text-sub/70 text-center leading-none">
              Developed by{" "}
              <a
                href="https://amrelharony.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent/90 hover:text-accent hover:underline underline-offset-2 font-medium"
              >
                Amr El Harony
              </a>
            </p>
          )}
          {/* Collapse toggle — small affordance anchored to the bottom edge.
              Hidden on mobile where the drawer pattern handles open/close. */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            data-no-sound="true"
            className={cn(
              "hidden md:flex items-center justify-center",
              "h-7 mx-2 my-2 rounded-md",
              "text-sub/70 hover:text-text hover:bg-text/[0.04]",
              "transition-colors duration-default",
              expanded ? "ml-auto w-7" : "w-7 mx-auto"
            )}
            aria-label={collapsed ? "Pin sidebar open" : "Collapse sidebar"}
            title={collapsed ? "Pin sidebar open" : "Collapse sidebar"}
          >
            <ChevronLeft
              className={cn(
                "w-3.5 h-3.5 transition-transform duration-medium ease-spring",
                collapsed && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * Single navigation row — used for both meta links (History / Insights)
 * and individual tool links inside each category. Extracted because the
 * shared visual treatment (hover bg, active pill, icon sizing, rail-mode
 * collapse) is non-trivial and was previously duplicated.
 *
 * Visual contract:
 *   - Hover: bg-text/[0.04], no scale/shimmer animation
 *   - Active: bg-accent/[0.08] + text-accent + thin accent left-edge
 *     line (replaces the previous floating 3px bar + glow combo)
 *   - Rail: centred icon-only, same hover/active rules, fixed 36 × 36
 */
function SidebarItem({
  href,
  label,
  Icon,
  isActive,
  expanded,
  onClose,
  badge,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  isActive: boolean;
  expanded: boolean;
  onClose?: () => void;
  badge?: "new" | "beta";
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      aria-current={isActive ? "page" : undefined}
      title={!expanded ? label : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md",
        "text-[13px] transition-colors duration-default",
        // Rail mode collapses to a 36x36 icon-only block centred in the
        // rail's 56px width. The icon size stays the same so the visual
        // weight matches the expanded mode.
        expanded ? "px-2.5 py-1.5 min-h-[34px]" : "h-9 w-9 mx-auto justify-center px-0",
        // States. The accent left-edge line replaces the old free-floating
        // bar + glow inset — it's anchored to the row, doesn't compete
        // with text, and stays visible in rail mode too.
        isActive
          ? "bg-accent/[0.08] text-accent"
          : "text-sub hover:text-text hover:bg-text/[0.04]"
      )}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-full bg-accent",
            expanded ? "h-4" : "h-5"
          )}
        />
      )}
      <Icon
        className={cn(
          "shrink-0 transition-colors duration-default",
          "w-4 h-4",
          isActive ? "text-accent" : "text-sub group-hover:text-text"
        )}
        aria-hidden={true}
      />
      {expanded && (
        <>
          <span className="truncate font-medium leading-none">{label}</span>
          {badge && (
            <span
              className={cn(
                "ml-auto text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded",
                badge === "new"
                  ? "text-accent-green bg-accent-green/10"
                  : "text-accent-amber bg-accent-amber/10"
              )}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}
