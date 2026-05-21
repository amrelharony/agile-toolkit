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
import { Search, Moon, Sun, Menu } from "lucide-react";
import { SonificationToggle } from "@/components/shared/sonification-toggle";
import { LlmStatusChip } from "@/components/ai/llm-status-chip";
import { TrophyButton } from "@/components/gamification/trophy-button";
import { StatusBadge, WeatherWidget } from "@/lib/weather/widget";
import { UserMenu } from "@/components/auth/user-menu";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onOpenSearch: () => void;
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSearch, onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const tool = getToolByPath(pathname);
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem("ae-theme") as "dark" | "light") || "dark";
    setTheme(saved);
    setIsMac(
      navigator.platform.toUpperCase().includes("MAC") ||
        navigator.userAgent.includes("Mac")
    );
    setMounted(true);
  }, []);

  useEffect(() => {
    // Skip the redundant write on the very first effect run — the inline
    // boot script in layout.tsx already set the class AND localStorage to
    // this same value before React hydrated. Without this guard we issue
    // a localStorage.setItem on every cold load even when nothing changed.
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (!mounted) return;
    try {
      localStorage.setItem("ae-theme", theme);
    } catch {
      /* quota / unavailable — boot script will still re-apply on next load */
    }
  }, [theme, mounted]);

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

      {/* Status + weather — only when there's room (md+). The 320 px viewport
          can't fit anything secondary alongside the breadcrumb. */}
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <StatusBadge />
        <WeatherWidget />
      </div>

      {/* Breadcrumb. On the smallest screens we cap at 50 vw so the action
          cluster on the right always has room. */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="hidden sm:list-item">
              <BreadcrumbLink href="/" className="text-sub hover:text-text">
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
            {tool && (
              <>
                <BreadcrumbSeparator className="text-sub hidden sm:block" />
                <BreadcrumbItem className="hidden lg:list-item">
                  <span className="text-sub text-sm truncate max-w-[14rem]">
                    {tool.category}
                  </span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="text-sub hidden lg:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-text font-medium truncate max-w-[50vw] sm:max-w-[20rem]">
                    {tool.name}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
            {!tool && (
              <BreadcrumbItem className="sm:hidden">
                <BreadcrumbPage className="text-text font-medium">
                  Home
                </BreadcrumbPage>
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
          - <320 px: only the user menu + theme toggle survive.
          - 320–375 px (xs): trophy hidden, sonification hidden, theme + user.
          - sm+ : everything visible.
          The hidden buttons are still reachable from the user menu. */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        <div className="hidden xs:flex items-center gap-0.5 sm:gap-1">
          <TrophyButton />
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
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          data-no-sound="true"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
          aria-label="Toggle theme"
          aria-pressed={theme === "light"}
        >
          {!mounted ? (
            <div className="w-4 h-4" aria-hidden="true" />
          ) : theme === "dark" ? (
            <Moon className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Sun className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
