"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { getToolByPath } from "@/lib/constants/tools";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Search, Moon, Sun, Menu, Contrast, MessageSquare } from "lucide-react";
import { SonificationToggle } from "@/components/shared/sonification-toggle";
import { LlmStatusChip } from "@/components/ai/llm-status-chip";
import { useAgentStore } from "@/lib/agent/store";
import { XpBar } from "@/components/gamification/xp-bar";
import { WeatherWidget } from "@/lib/weather/widget";
import { UserMenu } from "@/components/auth/user-menu";
import { KudosHeaderBeacon } from "@/lib/kudos/beacon/header-beacon";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onOpenSearch: () => void;
  onOpenSidebar?: () => void;
  onOpenTrophyCase?: () => void;
}

export function Header({ onOpenSearch, onOpenSidebar, onOpenTrophyCase }: HeaderProps) {
  const pathname = usePathname();
  const tool = getToolByPath(pathname);
  const openAgent = useAgentStore((s) => s.openSheet);
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Theme cycle: dark → light → hc (high-contrast) → dark.
  // High-contrast mode (Phase 33) — WCAG AAA palette with maximised
  // text/bg contrast, solid borders, and visible focus rings for
  // keyboard-only users.
  type Theme = "dark" | "light" | "hc";
  const [theme, setTheme] = useState<Theme>("dark");
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // getItem can throw SecurityError in Safari Private Browsing /
    // some corporate-managed Chromes. The inline boot script in
    // layout.tsx already swallows the same error, so mirror that here.
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("ae-theme");
    } catch {
      saved = null;
    }
    const valid: Theme = saved === "light" || saved === "hc" || saved === "dark" ? saved : "dark";
    setTheme(valid);
    setIsMac(
      navigator.platform.toUpperCase().includes("MAC") || navigator.userAgent.includes("Mac")
    );
    setMounted(true);
  }, []);

  useEffect(() => {
    // Skip the entire effect on its very first (mount) run. At that point
    // `theme` still holds the "dark" default — the localStorage-reading
    // effect above runs in the same effect phase, so its setTheme hasn't
    // re-rendered yet. Applying classes here clobbered the boot script's
    // .light/.hc classes with .dark for a frame (wrong-theme flash) and
    // fired every documentElement MutationObserver (sonner Toaster,
    // ParticleBackground) twice on every load. The boot script + SSR
    // markup already have the correct classes before React runs, so the
    // mount pass has nothing to do; this effect only needs to act on
    // user-initiated theme changes (and the post-hydration re-run, which
    // is idempotent).
    if (!mounted) return;
    // Class-based selectors (.light / .hc) and data-theme attribute
    // are both honoured by globals.css — set both for compatibility
    // with any inline test snippets that check classList.
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("hc", theme === "hc");
    document.documentElement.setAttribute("data-theme", theme);
    // Wrap setItem — Safari Private Browsing throws SecurityError on every
    // localStorage write, and a full workspace store can push the origin
    // over quota. Either case would crash the theme effect (which renders
    // on every page load) without the guard.
    try {
      localStorage.setItem("ae-theme", theme);
    } catch {
      /* quota or private mode — preference stays per-session only */
    }
  }, [theme, mounted]);

  const cycleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : t === "light" ? "hc" : "dark"));
  };

  useEffect(() => {
    // Throttle via rAF — `scroll` can fire at native 60Hz+, and our only
    // need is the boolean transition. Calling setState 60 times per second
    // when no consumer of `scrolled` cares about sub-frame precision is a
    // pointless render storm.
    let raf = 0;
    let queued = false;
    const compute = () => {
      queued = false;
      setScrolled(window.scrollY > 8);
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(compute);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header
      className={cn(
        // Mobile-first: tight 8 px gap on the smallest phones, growing as the
        // viewport widens. Padding scales 12 → 16 → 24 px to match the
        // .container-tool padding rhythm.
        "flex items-center gap-1 xs:gap-2 px-3 sm:px-4 md:px-6 h-14",
        "sticky top-0 z-header pt-safe pr-safe",
        "transition-all duration-default ease-spring",
        scrolled
          ? "glass-elevated border-b border-border"
          : "bg-transparent border-b border-transparent"
      )}
    >
      {/* Mobile hamburger — hidden on md+. Touch-target compliant (44×44). */}
      <button
        type="button"
        onClick={onOpenSidebar}
        data-no-sound="true"
        className="md:hidden min-touch shrink-0 rounded-lg flex items-center justify-center text-sub hover:text-accent hover:bg-accent/5 transition active-press"
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* Weather — only when there's room (md+). The 320 px viewport
          can't fit anything secondary alongside the breadcrumb. */}
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <WeatherWidget />
      </div>

      {/* Breadcrumb. `overflow-hidden` on the wrapper clips any internal
          overflow defensively — without it, when the search pill +
          XpBar + right cluster squeeze the breadcrumb below its content
          size at md viewports, the inner flex-nowrap items spill out and
          collide with the search pill. `min-w-0` on the list lets the
          inner flex chain shrink so the tool-name truncate can engage. */}
      <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap min-w-0">
            {/* "Home" + separator only at lg+. On sm–md the tool name
                stands alone — Home is reachable via the sidebar / logo
                anyway, and at md the search pill takes 280 px which left
                no room for the full chain. */}
            <BreadcrumbItem className="hidden lg:list-item">
              <BreadcrumbLink href="/" className="text-sub hover:text-text">
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
            {tool && (
              <>
                <BreadcrumbSeparator className="text-sub hidden lg:block" />
                <BreadcrumbItem className="hidden lg:list-item">
                  <span className="text-sub text-sm truncate max-w-[14rem]">{tool.category}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="text-sub hidden lg:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="text-text font-medium truncate max-w-[50vw] sm:max-w-[16rem] lg:max-w-[20rem]">
                    {tool.name}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
            {!tool && (
              <BreadcrumbItem className="lg:hidden">
                <BreadcrumbPage className="text-text font-medium">Home</BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Search. Icon-only on mobile, full pill on md+. */}
      <button
        type="button"
        onClick={onOpenSearch}
        data-no-sound="true"
        className={cn(
          "flex items-center gap-2 shrink-0",
          // Mobile: 36×36 icon button (acceptable inside a touch-padded header)
          "w-9 h-9 justify-center rounded-lg text-sub hover:text-text hover:bg-accent/5",
          // Desktop: full pill search
          "md:w-full md:max-w-[280px] md:h-auto md:px-4 md:py-1.5 md:justify-between md:rounded-xl md:glass md:border md:border-border md:text-sm md:hover:border-accent/15"
        )}
        aria-label="Open search"
      >
        <span className="flex items-center gap-2">
          <Search className="w-4 h-4 md:w-3.5 md:h-3.5" aria-hidden="true" />
          <span className="hidden md:inline">Search tools...</span>
        </span>
        <kbd className="hidden md:inline font-mono text-nano text-sub bg-[var(--card)] border border-border rounded px-1.5 py-0.5">
          {mounted && isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {/* Right — Actions.
          - <640 px: only icon buttons + user menu survive.
          - sm+:     XpBar (level + progress + xp/needed) + sonification +
                     LLM chip appear.
          - md+:     achievements count surfaces inside the XpBar.
          Hidden buttons remain reachable from the user menu. The XpBar
          was previously gated at `xs` (375px) but the ~110px pill plus
          search + agent + theme + menu pushed the right edge off-screen
          on iPhone-mini-class viewports; bumping to `sm` keeps it
          legible while keeping the trophy case reachable via user menu. */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        <div className="hidden sm:flex items-center gap-0.5 sm:gap-1">
          <XpBar onOpenTrophyCase={onOpenTrophyCase} />
        </div>
        <div className="hidden sm:flex items-center">
          <SonificationToggle />
        </div>
        {/* BYOK LLM status chip — sits next to sonification on the same
            sm+ breakpoint. Hidden on phones to preserve the right-edge
            real estate; reachable via the UserMenu entry on mobile. */}
        <div className="hidden sm:flex items-center">
          <LlmStatusChip />
        </div>
        {/* Phase 4 kudos beacon — global pulse + count for incoming kudos.
            Visible for guests too (they receive kudos as well). The
            FlyingCard portal uses this element's rect as a fallback when
            sender / recipient identity ids aren't resolvable, so it must
            mount on every authenticated and guest page. */}
        <KudosHeaderBeacon />
        {/* Agent chat button. Visible from xs+ — keyboard users can also
            hit Cmd/Ctrl+J to toggle (matches ChatGPT / Claude.ai). */}
        <button
          onClick={openAgent}
          data-no-sound="true"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
          aria-label="Open agent chat"
          title="Open agent (Cmd/Ctrl+J)"
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={cycleTheme}
          data-no-sound="true"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
          // R9: WCAG 3.2.4 — tell the user what mode they'd switch TO.
          // The previous label only said the current mode, leaving SR
          // and cognitively-impaired users guessing what the click does.
          aria-label={`Switch to ${theme === "dark" ? "light" : theme === "light" ? "high contrast" : "dark"} theme (currently ${theme === "dark" ? "dark" : theme === "light" ? "light" : "high contrast"})`}
          title={`Theme: ${theme === "dark" ? "Dark" : theme === "light" ? "Light" : "High contrast"} — click to switch to ${theme === "dark" ? "Light" : theme === "light" ? "High contrast" : "Dark"}`}
        >
          {!mounted ? (
            <div className="w-4 h-4" aria-hidden="true" />
          ) : theme === "dark" ? (
            <Moon className="w-4 h-4" aria-hidden="true" />
          ) : theme === "light" ? (
            <Sun className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Contrast className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
