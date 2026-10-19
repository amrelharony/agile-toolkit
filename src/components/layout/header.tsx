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
import Link from "next/link";
import {
  Search,
  Moon,
  Sun,
  Menu,
  Contrast,
  MessageSquare,
  CloudOff,
  X,
  CircleHelp,
} from "lucide-react";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { SonificationToggle } from "@/components/shared/sonification-toggle";
import { LlmStatusChip } from "@/components/ai/llm-status-chip";
import { useAgentStore } from "@/lib/agent/store";
import { XpBar } from "@/components/gamification/xp-bar";
import { WeatherWidget } from "@/lib/weather/widget";
import { UserMenu } from "@/components/auth/user-menu";
import { VisitorDataMergeDialog } from "@/components/auth/visitor-data-merge-dialog";
import { useAuth } from "@/lib/auth/auth-provider";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";
import {
  setVisitorDataPromptOpen,
  useOwnerSeen,
  useOwnerSyncGateStore,
  useVisitorDataPending,
} from "@/lib/sync/owner-sync-gate";
import { installLocalDataChannelListener } from "@/lib/utils/clear-local-data";
import { KudosHeaderBeacon } from "@/lib/kudos/beacon/header-beacon";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";
import { cn } from "@/lib/utils";
import { setThemePreference, useAppliedTheme } from "@/lib/theme/theme";

interface HeaderProps {
  onOpenSearch: () => void;
  onOpenSidebar?: () => void;
  onOpenTrophyCase?: () => void;
}

export function Header({ onOpenSearch, onOpenSidebar, onOpenTrophyCase }: HeaderProps) {
  const pathname = usePathname();
  const tool = getToolByPath(pathname);
  const openAgent = useAgentStore((s) => s.openSheet);
  // The agent and the Cairo weather are the owner's; visitors get the
  // mascot's help panel behind the same button instead.
  const isOwner = useIsOwner();
  // Kudos settings → "Header beacon". The store defers its localStorage
  // read (skipHydration), so SSR and the first client render both see
  // the `true` default and the gate can't cause a hydration mismatch.
  const beaconHeader = useKudosSettingsStore((s) => s.beaconHeader);
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Theme quick-switch: dark → light → hc (high-contrast) → dark. The full
  // choice, including "System", is in Settings → Appearance (lib/theme).
  const theme = useAppliedTheme();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(
      navigator.platform.toUpperCase().includes("MAC") || navigator.userAgent.includes("Mac")
    );
    setMounted(true);
  }, []);

  const cycleTheme = () => {
    setThemePreference(theme === "dark" ? "light" : theme === "light" ? "hc" : "dark");
  };

  // Another tab cleared this browser's toolkit data (visitor "Clear data",
  // owner sign-out, or discarding signed-out work): clear this tab too (its
  // in-memory stores and its own sessionStorage, which the other tab can't
  // reach) and reload, or the cleared data would be written straight back.
  useEffect(() => installLocalDataChannelListener(), []);

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

  const bar = (
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
      {isOwner && (
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <WeatherWidget />
        </div>
      )}

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
        <kbd className="hidden md:inline font-mono text-xs text-sub bg-[var(--card)] border border-border rounded px-1.5 py-0.5">
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
            sender / recipient identity ids aren't resolvable, so it
            mounts on every authenticated and guest page — unless the
            owner switched "Header beacon" off in kudos settings, which
            until now was an inert toggle (the FlyingCard simply falls
            back to its other anchors when the beacon is hidden). */}
        {beaconHeader && <KudosHeaderBeacon />}
        {/* Agent chat button. Visible from xs+ — keyboard users can also
            hit Cmd/Ctrl+J to toggle (matches ChatGPT / Claude.ai). */}
        <button
          onClick={openAgent}
          data-no-sound="true"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
          aria-label={isOwner ? "Open agent chat" : "Open help"}
          title={isOwner ? "Open agent (Cmd/Ctrl+J)" : "Find a tool or get help (Cmd/Ctrl+J)"}
        >
          {isOwner ? (
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
          ) : (
            <CircleHelp className="w-4 h-4" aria-hidden="true" />
          )}
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

  return (
    <>
      {bar}
      <SharedBrowserNotice />
      <VisitorDataMergeDialog />
    </>
  );
}

const NOTICE_DISMISSED_KEY = "agile-toolkit:signed-out-notice-dismissed";

/**
 * Slim notice under the header for the two shared-browser states that
 * otherwise fail silently:
 *  - the owner has used this browser but is now signed out (e.g. the
 *    session lapsed): changes stay local until they sign back in;
 *  - the owner closed the "work created while signed out" dialog without
 *    answering: cloud sync stays paused until they do.
 */
function SharedBrowserNotice() {
  const { status, error } = useAuth();
  const pathname = usePathname();
  const ownerSeen = useOwnerSeen();
  const syncPending = useVisitorDataPending();
  const promptOpen = useOwnerSyncGateStore((s) => s.promptOpen);
  // Hidden until sessionStorage is read, so a dismissed notice never flashes.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(NOTICE_DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(NOTICE_DISMISSED_KEY, "1");
    } catch {
      /* storage blocked — dismissed for this page view only */
    }
  };

  // Tokens, not `border-accent/30`-style modifiers: opacity modifiers on the
  // var() palette colours emit no CSS in this Tailwind config.
  const noticeClass =
    "mx-3 sm:mx-4 md:mx-6 mt-2 flex items-center gap-2 rounded-lg border border-[var(--glowS)] bg-[var(--glow)] px-3 py-1.5 text-xs text-sub";

  if (syncPending && !promptOpen) {
    return (
      <div role="status" className={noticeClass}>
        <CloudOff className="w-3.5 h-3.5 shrink-0 text-accent" aria-hidden="true" />
        <span className="flex-1 min-w-0">
          Cloud sync is paused until you choose what to do with work created while signed out.
        </span>
        <button
          type="button"
          onClick={() => setVisitorDataPromptOpen(true)}
          className="shrink-0 font-medium text-accent hover:underline underline-offset-4"
        >
          Review
        </button>
      </div>
    );
  }

  // A visitor on a browser the owner has used. Not while an owner check is
  // merely unanswered (OWNER_UNVERIFIED): that session is still signed in
  // and AuthProvider is retrying.
  const signedOut = status === "anonymous" || (status === "error" && error !== OWNER_UNVERIFIED);
  if (!signedOut || !ownerSeen || dismissed) return null;

  return (
    <div role="status" className={noticeClass}>
      <CloudOff className="w-3.5 h-3.5 shrink-0 text-accent" aria-hidden="true" />
      <span className="flex-1 min-w-0">Signed out — changes stay on this device.</span>
      <Link
        href={`/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`}
        className="shrink-0 font-medium text-accent hover:underline underline-offset-4"
      >
        Sign in to sync
      </Link>
      <button
        type="button"
        onClick={dismiss}
        className="min-touch-coarse shrink-0 -mr-1 p-1 rounded text-sub hover:text-text"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
