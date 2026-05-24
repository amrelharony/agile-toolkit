"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePersisted } from "@/lib/utils/use-persisted";
import { categories, getToolsByCategory, type ToolCategory } from "@/lib/constants/tools";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, History, Activity } from "lucide-react";
import { useSwipeToClose } from "@/hooks/use-swipe-to-close";
import { emit as sonify } from "@/lib/sonification/emit";

/**
 * Compact display label for each category header in the sidebar. The full
 * name lives in the registry (used by breadcrumbs, search, AI prompts);
 * the sidebar gets a shorter version so 18 categories all fit in the
 * column without truncation or wrap.
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
  // Persist sidebar prefs so a user who collapses the rail or closes a
  // category section keeps that layout across page loads. Without this,
  // every refresh resets the sidebar back to fully-expanded, which is
  // disruptive for power users who work with the sidebar collapsed.
  // Auto-hide: the sidebar lives in a thin icon rail by default and
  // temporarily expands on pointer hover. The collapsed state itself is
  // persisted so the user can pin it open by clicking the chevron at the
  // bottom — but on first visit (and after this storage-key change) the
  // sidebar starts in rail mode and reveals on hover.
  //
  // Storage key bumped to ":v2" so existing users who had `collapsed: false`
  // (pinned-open) inherit the new auto-hide default. They can re-pin via
  // the chevron in one click.
  const [collapsed, setCollapsed] = usePersisted<boolean>(
    "agile-toolkit:sidebar:collapsed:v2",
    true
  );
  // Transient hover-expand. Layered on top of `collapsed`: when the rail is
  // collapsed and the pointer enters the aside, we render the full-width
  // tree as an overlay; leaving collapses back to the rail without changing
  // the persisted state.
  const [hoverExpanded, setHoverExpanded] = useState(false);
  // The visual "expanded?" state — pinned-open OR hovering-over-collapsed.
  const expanded = !collapsed || hoverExpanded;
  // Default to ALL categories collapsed. The sidebar is the user's primary
  // navigation surface; with 18 visible categories every one open at once
  // forces a long scroll just to find Burndown or Retro. Categories the
  // user opens are persisted, so opening Sprint Planning once keeps it
  // open across reloads.
  //
  // Storage key bumped to ":v2" so the previously-persisted "all open"
  // state is ignored — this is the one-shot reset that gives the
  // collapsed-by-default UX to existing users without each having to
  // manually close 17 categories.
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
    // Use dedicated sidebar palette entries — `category-open` /
    // `category-close` are piano tones (step 3 P5 → step 0 root) instead
    // of the generic `toggle-on/off` so the sidebar plays as a small
    // musical phrase. The default `click-generic` from the global
    // event-router is suppressed via `data-no-sound="true"` on the
    // trigger so we don't double-emit.
    const next = !openCategories[category];
    sonify("ui", next ? "category-open" : "category-close");
    setOpenCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  // Single handler shared by every Link in the sidebar (brand, meta
  // links, tool links). Emits the piano `sidebar-nav` tone — step 2
  // (maj3) of the pentatonic, sitting harmonically between the
  // category-open (P5) and category-close (root) tones. Combined,
  // clicking around the sidebar plays a small musical sequence rather
  // than the generic synth clicks. Pairs with `data-no-sound="true"`
  // on the Link to suppress the global click router's contribution.
  const handleNavClick = useCallback(() => {
    sonify("ui", "sidebar-nav");
    onClose?.();
  }, [onClose]);

  // Close the mobile drawer on route change.
  useEffect(() => {
    if (mobileOpen) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // BUG-C2: counter-based body-scroll lock. The prior pattern
  // snapshotted `document.body.style.overflow` on open and restored
  // it on close — but Radix dialogs/sheets ALSO mutate body.overflow
  // for their own scroll-lock. A sidebar→dialog→close-sidebar sequence
  // would have the sidebar's cleanup restore the pre-sidebar "", then
  // the dialog's later restore writes the wrong cached value. Use a
  // shared counter on window so every scroll-lock owner adds/removes
  // a refcount, and the live lock state is `count > 0`.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!mobileOpen) return;
    type W = Window & {
      __scrollLockCount?: number;
      __scrollLockPrev?: string;
    };
    const w = window as W;
    if ((w.__scrollLockCount ?? 0) === 0) {
      w.__scrollLockPrev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    w.__scrollLockCount = (w.__scrollLockCount ?? 0) + 1;
    return () => {
      w.__scrollLockCount = Math.max(0, (w.__scrollLockCount ?? 1) - 1);
      if (w.__scrollLockCount === 0) {
        document.body.style.overflow = w.__scrollLockPrev ?? "";
        delete w.__scrollLockPrev;
      }
    };
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

  // BUG-C3: mobile drawer focus management. On open, capture the
  // trigger (whatever was focused before — the hamburger button) and
  // move focus into the drawer. While the drawer is open, trap Tab
  // inside it. On close, restore focus to the original trigger.
  // Without this, keyboard / SR users tab past the drawer into the
  // backdrop DOM, and closing leaves focus on `<body>` (WCAG 2.4.3
  // failure).
  useEffect(() => {
    if (!mobileOpen) return;
    if (typeof document === "undefined") return;
    const aside = asideRef.current;
    if (!aside) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer one frame so the drawer is painted before we move focus,
    // matching the focus-trap hook's convention.
    const raf = requestAnimationFrame(() => {
      const focusable = aside.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      if (first) first.focus();
      else {
        aside.setAttribute("tabindex", "-1");
        aside.focus();
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        aside.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) {
        e.preventDefault();
        aside.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !aside.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !aside.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      if (
        previouslyFocused &&
        document.contains(previouslyFocused) &&
        typeof previouslyFocused.focus === "function"
      ) {
        previouslyFocused.focus();
      }
    };
  }, [mobileOpen]);

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
        // Auto-hide reveal: when the persisted state is collapsed (rail
        // mode), hovering the rail temporarily expands the tree as an
        // overlay. Leaving the area collapses back to the rail. We don't
        // change `collapsed` itself so the user's pinned preference is
        // preserved. Touch users get no hover effect — they can pin via
        // the chevron at the bottom, or use the mobile drawer flow.
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse" && collapsed) setHoverExpanded(true);
        }}
        onPointerLeave={() => setHoverExpanded(false)}
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
          // Desktop: inline, sticky, reveal. Width swaps between rail
          // (64 px) and full (256 px) — the `transition-all` on the
          // shared layout above smooths the swap. Hover-expand uses the
          // same width change so the page content stays in step.
          "md:static md:translate-x-0 md:top-0 md:h-screen md:sticky md:pl-0",
          expanded ? "md:w-64" : "md:w-16"
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-4 md:py-5 border-b border-border pt-safe md:pt-4">
          <Link
            href="/"
            onClick={handleNavClick}
            data-no-sound="true"
            className="flex items-center gap-3 min-w-0"
          >
            <div
              data-sidebar-logo="true"
              className="flex-shrink-0 w-8 h-8 rounded-xl overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/AT.svg"
                alt="Agile Toolkit"
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            </div>
            {expanded && (
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
                  onClick={handleNavClick}
                  data-no-sound="true"
                  className={cn(
                    "group flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-default ease-spring relative overflow-hidden min-h-[40px]",
                    isActive
                      ? "bg-accent/10 text-accent shadow-[0_0_10px_var(--glow)_inset]"
                      : "text-sub hover:text-text hover:bg-accent/5",
                    !expanded && "md:justify-center"
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
                  {expanded && <span className="truncate font-medium">{label}</span>}
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
            // Skip categories with no tools — the registry lists 37 categories
            // for future Phase 23+ tool batches, but rendering an empty
            // Collapsible looks broken (chevron toggles open → reveals nothing,
            // so users think the category isn't collapsible at all).
            if (categoryTools.length === 0) return null;
            const label = categoryLabel(category);
            // Rail mode forces every category open so the user sees tool
            // icons in the collapsed sidebar. The trigger (with its
            // category label) is hidden in rail mode below — only the
            // tool icons render in the narrow rail. The persisted
            // open/closed preference is only consulted in expanded
            // mode, where the trigger is visible.
            const isOpen = !expanded || !!openCategories[category];

            return (
              <Collapsible
                key={category}
                open={isOpen}
                onOpenChange={() => toggleCategory(category)}
                // CRITICAL: the global event-router has a MutationObserver
                // on [data-state] attribute changes that emits `state-open`
                // / `state-close` (a chord at default velocity 1.0). Radix
                // flips data-state on BOTH the trigger AND the
                // CollapsibleContent, and `data-no-sound` on the trigger
                // alone doesn't suppress the Content's mutation (Content
                // is a sibling of the trigger, so isSuppressed's parent
                // walk never reaches it). Putting the attribute on the
                // Root catches both — Radix forwards arbitrary data-*
                // props to the rendered div, so the isSuppressed walk
                // from either child finds it.
                data-no-sound="true"
              >
                {/* Trigger only renders in expanded mode. In rail mode the
                    Collapsible is force-open (isOpen=true above) and the
                    category structure is implicit — only tool icons show.
                    The previous 3-letter railTag ("POR", "TEA", "AI ")
                    was crowding the rail without adding navigation value;
                    the tool icons themselves are the actionable affordance. */}
                {expanded && (
                  <CollapsibleTrigger
                    // Suppress the loud `click-generic` sound that the
                    // global event-router would otherwise emit. The
                    // toggleCategory handler emits the piano category-open
                    // / category-close tones instead.
                    data-no-sound="true"
                    className="flex items-center w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sub hover:text-text transition-colors rounded-lg"
                  >
                    <span className="truncate">{label}</span>
                    <ChevronDown
                      className={cn(
                        // Rotate the chevron 180° when the category is open
                        // so users get a visual confirmation that clicking
                        // toggled the state.
                        "ml-auto w-3 h-3 transition-transform duration-default",
                        isOpen ? "rotate-180" : "rotate-0"
                      )}
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>
                )}
                <CollapsibleContent className="space-y-0.5">
                  {categoryTools.map((tool) => {
                    const isActive = pathname === tool.path;
                    const Icon = tool.icon;

                    return (
                      <Link
                        key={tool.id}
                        href={tool.path}
                        onClick={handleNavClick}
                        data-no-sound="true"
                        // Rail mode centres the icon in the 64px-wide rail
                        // (no label or badge renders since `expanded` is
                        // false). A title attribute carries the tool name
                        // for hover tooltips so the user knows what the
                        // icon represents without expanding the sidebar.
                        title={!expanded ? tool.name : undefined}
                        className={cn(
                          "group flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-default ease-spring relative overflow-hidden min-h-[40px]",
                          !expanded && "md:justify-center md:px-0 md:gap-0",
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
                        {expanded && (
                          <>
                            <span className="truncate relative z-[1] font-medium">{tool.name}</span>
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
        {expanded && (
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
