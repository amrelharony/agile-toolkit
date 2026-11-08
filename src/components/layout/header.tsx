"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { getToolByPath } from "@/lib/constants/tools";
import { isVipOnly } from "@/lib/tools/catalog";
import { VIP_TITLE } from "@/lib/vip/constants";
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
  Crown,
  Ellipsis,
} from "lucide-react";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { useMounted } from "@/hooks/use-mounted";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SonificationToggle } from "@/components/shared/sonification-toggle";
import { LlmStatusChip } from "@/components/ai/llm-status-chip";
import { useAgentStore } from "@/lib/agent/store";
import { XpBar } from "@/components/gamification/xp-bar";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { computeLevel } from "@/lib/gamification/xp-curve";
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
import { setThemePreference, useAppliedTheme, type AppliedTheme } from "@/lib/theme/theme";

/** What each theme is called, here and in Settings → Appearance. */
const THEME_LABEL: Record<AppliedTheme, string> = {
  light: "Comic",
  dark: "Night",
  hc: "High contrast",
};

/**
 * What the bar calls a page that isn't a tool (tools name themselves). On a
 * phone this is the only title in the sticky bar, so it must not say "Home"
 * anywhere but home (mobile audit 2026-11-08). Matches each page's own heading.
 */
const PAGE_TITLES = new Map<string, string>([
  ["/", "Home"],
  ["/history", "History"],
  ["/insights", "Your activity"],
  ["/team", "Team"],
  ["/more-tools", "More tools"],
  ["/vip", VIP_TITLE],
  ["/s", "Shared snapshot"],
]);

/** The title for a non-tool address, or undefined when it has none. */
function pageTitleFor(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "Settings";
  return PAGE_TITLES.get(pathname);
}

interface HeaderProps {
  onOpenSearch: () => void;
  onOpenSidebar?: () => void;
  onOpenTrophyCase?: () => void;
}

export function Header({ onOpenSearch, onOpenSidebar, onOpenTrophyCase }: HeaderProps) {
  const pathname = usePathname();
  const pathTool = getToolByPath(pathname);
  // A VIP tool's address may be showing a lock panel, and this bar can't know: the
  // hint can be forged and the real cookie is out of its reach. So it stays generic
  // for everyone, and the page itself names the tool once it has checked access.
  const onVipTool = Boolean(pathTool && isVipOnly(pathTool));
  const tool = onVipTool ? undefined : pathTool;
  const pageTitle = pageTitleFor(pathname);
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
  // Theme quick-switch: comic → night → high contrast → comic. The full
  // choice, including "System", is in Settings → Appearance (lib/theme).
  const theme = useAppliedTheme();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(
      navigator.platform.toUpperCase().includes("MAC") || navigator.userAgent.includes("Mac")
    );
    setMounted(true);
  }, []);

  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "hc" : "light";
  const cycleTheme = () => {
    setThemePreference(nextTheme);
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
      data-chrome="header"
      className={cn(
        // Mobile-first: tight 8 px gap on the smallest phones, growing as the
        // viewport widens.
        "flex items-center gap-1 xs:gap-2",
        // Side gutters scale 12 → 16 → 24 px to match the .container-tool
        // rhythm, and never drop below the notch or rounded corner's safe
        // area. A bare `pr-safe` beat `px-3` (0 on most phones), so the
        // account button sat flush against the screen edge; from md the
        // right one stayed 24 px under a landscape iPhone's notch. From md
        // the left edge is the rail's, which keeps its own inset (sidebar).
        "pl-[max(0.75rem,env(safe-area-inset-left))] sm:pl-[max(1rem,env(safe-area-inset-left))] md:pl-6",
        "pr-[max(0.75rem,env(safe-area-inset-right))] sm:pr-[max(1rem,env(safe-area-inset-right))] md:pr-[max(1.5rem,env(safe-area-inset-right))]",
        // A 56 px row below the status bar's safe area. --header-h
        // (globals.css) is that row plus the inset, and is what Amr's top
        // corner hangs from. A fixed h-14 with pt-safe (border-box) took the
        // inset out of the row, so with a top inset the buttons spilled over
        // the status bar and the page.
        "min-h-[var(--header-h)] pt-safe",
        "sticky top-0 z-header",
        "transition-all duration-default ease-spring",
        scrolled ? "bg-card border-b border-border" : "bg-transparent border-b border-transparent"
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

      {/* Weather — only from xl, where the bar has room for it. Between
          md and xl it lives in the "More" popover in the right cluster
          (a landscape phone or tablet at 768–1040 px pushed the page
          wider than the screen with it inline), and phones skip it. */}
      {isOwner && (
        <div className="hidden xl:flex items-center gap-2 shrink-0">
          <WeatherWidget />
        </div>
      )}

      {/* Breadcrumb. `overflow-hidden` on the wrapper clips any internal
          overflow defensively — without it, when the search pill +
          XpBar + right cluster squeeze the breadcrumb below its content
          size, the inner flex-nowrap items spill out and collide with
          the search pill. `min-w-0` on the list lets the inner flex
          chain shrink so the tool-name truncate can engage. */}
      <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
        <Breadcrumb>
          <BreadcrumbList className="flex-nowrap min-w-0">
            {/* "Home" + separator only at lg+. Below that the tool name
                stands alone — Home is reachable via the sidebar / logo
                anyway, and the narrower bars have no room for the full
                chain. */}
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
            {onVipTool && (
              <>
                <BreadcrumbSeparator className="text-sub hidden lg:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="text-text font-medium truncate">
                    {VIP_TITLE}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
            {/* Any other page: its own title below lg, where it's the only
                one in the bar (from lg the Home link above stands alone, as
                before). An address with no entry gets nothing rather than a
                wrong "Home". */}
            {!tool && !onVipTool && pageTitle && (
              <BreadcrumbItem className="lg:hidden min-w-0">
                <BreadcrumbPage className="text-text font-medium truncate">
                  {pageTitle}
                </BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Search. Icon-only below lg (phones, landscape phones, tablets),
          the full pill from lg. Never shrink-0 — scripts/check-ui-classes.mjs
          enforces it: a rigid 280 px pill is what pushed the md bar wider
          than the screen. */}
      <button
        type="button"
        onClick={onOpenSearch}
        data-no-sound="true"
        data-header-search=""
        className={cn(
          "flex items-center gap-2",
          // Below lg: a 36×36 icon button for a mouse, 44×44 on touch. The
          // min-width keeps the row from squeezing it. (From lg the pill's
          // own min-width wins: breakpoint rules come after pointer ones.)
          "w-9 min-w-9 h-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11 justify-center rounded-lg text-sub hover:text-text hover:bg-accent/5",
          // lg+: the full pill — 280 px when there's room. A fixed width
          // (not w-full + max-w, which the flex algorithm clamps straight
          // back to 280) so it can give width back, and before the right
          // cluster does (shrink 100 to the cluster's 1), down to 10rem.
          "lg:w-[280px] lg:min-w-[10rem] lg:shrink-[100] lg:overflow-hidden lg:h-auto lg:px-4 lg:py-1.5 lg:justify-between lg:rounded-lg lg:bg-card lg:border lg:border-border lg:text-sm lg:hover:border-accent"
        )}
        aria-label="Open search"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Search className="w-4 h-4 shrink-0 lg:w-3.5 lg:h-3.5" aria-hidden="true" />
          <span className="hidden lg:inline truncate">Search tools...</span>
        </span>
        <kbd className="hidden lg:inline shrink-0 font-mono text-xs text-sub bg-[var(--card)] border border-border rounded px-1.5 py-0.5">
          {mounted && isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {/* Right — Actions.
          - <640 px: only icon buttons + user menu survive.
          - sm–md:   XpBar (level + progress + xp/needed) + sonification +
                     LLM chip appear.
          - md–xl:   a compact level chip instead of the XpBar, and the
                     sonification toggle, LLM chip and (owner) weather
                     move into the "More" popover. With the 64 px rail, a
                     landscape phone or tablet (768–1040 px) had no room
                     for them: the bar grew wider than the screen and
                     pushed help, theme, the account menu and Amr off it.
          - xl+:     the full XpBar (with the achievements count) and the
                     extras inline.
          Hidden buttons remain reachable from the user menu. The XpBar
          was previously gated at `xs` (375px) but the ~110px pill plus
          search + agent + theme + menu pushed the right edge off-screen
          on iPhone-mini-class viewports; bumping to `sm` keeps it
          legible while keeping the trophy case reachable via user menu.
          `min-w-0` + `justify-end` (not shrink-0): should the bar still
          run short, the cluster gives way leftwards once the search pill
          has, so help, theme and the account menu never leave the screen
          — no overflow clipping, which would hide them (and Amr). */}
      <div
        data-header-actions=""
        className="flex items-center justify-end gap-0.5 sm:gap-1 min-w-0"
      >
        <div className="hidden sm:flex items-center gap-0.5 sm:gap-1">
          <div className="flex md:hidden xl:flex items-center">
            <XpBar onOpenTrophyCase={onOpenTrophyCase} />
          </div>
          <div className="hidden md:flex xl:hidden items-center">
            <XpLevelChip onOpen={onOpenTrophyCase} />
          </div>
        </div>
        <div className="hidden sm:flex md:hidden xl:flex items-center">
          <SonificationToggle />
        </div>
        {/* BYOK LLM status chip — sits next to sonification on the same
            breakpoints. Hidden on phones to preserve the right-edge
            real estate; reachable via the UserMenu entry on mobile. */}
        <div className="hidden sm:flex md:hidden xl:flex items-center">
          <LlmStatusChip />
        </div>
        <HeaderMoreMenu isOwner={isOwner} />
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
            hit Cmd/Ctrl+J to toggle (matches ChatGPT / Claude.ai). It and
            the theme button are 36×36 for a mouse, 44×44 on touch. */}
        <button
          onClick={openAgent}
          data-no-sound="true"
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 w-9 h-9 rounded-lg flex items-center justify-center text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
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
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 w-9 h-9 rounded-lg flex items-center justify-center text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
          // R9: WCAG 3.2.4 — tell the user what mode they'd switch TO.
          // The previous label only said the current mode, leaving SR
          // and cognitively-impaired users guessing what the click does.
          aria-label={`Switch to ${THEME_LABEL[nextTheme]} theme (currently ${THEME_LABEL[theme]})`}
          title={`Theme: ${THEME_LABEL[theme]}. Click for ${THEME_LABEL[nextTheme]}.`}
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

/**
 * The XP pill's compact form for md–xl, where the full bar (256–314 px)
 * pushed the header wider than the screen: the level and a short progress
 * line. It opens what the full bar opens and reads the same to a screen
 * reader.
 */
function XpLevelChip({ onOpen }: { onOpen?: () => void }) {
  const mounted = useMounted();
  const xp = useVDnaStore((s) => s.xp);
  const prestige = useVDnaStore((s) => s.prestige);
  const unlockedCount = useVDnaStore((s) => s.unlocked.length);

  // The XP store hydrates on the client only: hold the space until then.
  if (!mounted) return <div className="h-8 w-16" aria-hidden="true" />;
  const info = computeLevel(xp, prestige);
  const pct = Math.round(info.progress01 * 100);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-no-sound="true"
      aria-label={`Level ${info.level}, ${pct}% to next level. ${unlockedCount} achievements. Open trophy case.`}
      title="Open trophy case"
      className={cn(
        "pointer-coarse:min-h-11 pointer-coarse:min-w-11 flex items-center justify-center gap-1.5 h-8 rounded-md",
        "border border-border bg-surface px-2",
        "text-xs font-mono text-sub hover:text-text hover:border-accent",
        "transition-all duration-fast"
      )}
    >
      {prestige > 0 && (
        <span className="flex items-center gap-0.5 text-warning">
          <Crown className="w-3 h-3" aria-hidden="true" />
          <span className="font-data">{prestige}</span>
        </span>
      )}
      <span className="text-accent font-data">L{info.level}</span>
      <span
        className="relative h-1.5 w-6 rounded-full bg-bg border border-border overflow-hidden"
        aria-hidden="true"
      >
        <span
          className="absolute left-0 top-0 bottom-0 bg-accent transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </span>
    </button>
  );
}

/** Where the "More" button shows: Tailwind's md up to (not including) xl. */
const MORE_MENU_RANGE = "(min-width: 768px) and (max-width: 1279.98px)";

/**
 * md–xl only: the extras that sit inline from xl — the sound toggle, the AI
 * status chip and, for the owner, the Cairo weather — behind one button, so
 * the bar fits a landscape phone or tablet without losing any of them. The
 * real controls render inside, so right-click / Shift+Enter still opens the
 * sound settings.
 */
function HeaderMoreMenu({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);

  // Resized out of the range while open (the button hides at xl, and the
  // controls are back inline): close rather than float unanchored.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") return;
    const range = window.matchMedia(MORE_MENU_RANGE);
    const onChange = () => {
      if (!range.matches) setOpen(false);
    };
    range.addEventListener("change", onChange);
    return () => range.removeEventListener("change", onChange);
  }, [open]);

  const label = isOwner ? "More: sound, AI and weather" : "More: sound and AI";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-no-sound="true"
          className={cn(
            "hidden md:flex xl:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11 w-9 h-9 rounded-lg items-center justify-center",
            "text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
          )}
          aria-label={label}
          title={label}
        >
          <Ellipsis className="w-4 h-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={label} className="w-auto p-2">
        <div className="flex items-center gap-1">
          {isOwner && <WeatherWidget />}
          <SonificationToggle />
          <LlmStatusChip />
        </div>
      </PopoverContent>
    </Popover>
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
