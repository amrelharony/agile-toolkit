"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { MotionConfig } from "framer-motion";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { BackupReminder } from "@/components/data/backup-reminder";
import { DockedTimer } from "@/components/timer/docked-timer";
import { PresentationController } from "@/components/presentation/presentation-mode";
import { StorageHealthBanner } from "@/components/data/storage-health-banner";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { ShellDialogs } from "./shell-dialogs";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import { dismissUndoToasts } from "@/lib/utils/undoable";
import { installSignalBridge } from "@/lib/signals/signal-bridge";
import { bootstrapPredictions } from "@/lib/predictions/bootstrap";
import { installKudosReceiveBridge } from "@/lib/kudos/receive-bridge";
import { KudosOwnerBridge } from "@/lib/kudos/owner-bridge";
import { LegacySprintMigration } from "@/components/sprints/legacy-sprint-migration";
import { LegacyToolMigrations } from "@/components/data/legacy-tool-migrations";
// The tool action registry is populated by the owner's agent panel
// (components/agent/mascot/owner-agent-panel) when it loads — only the
// agent reads it client-side, so visitors never download it.

// The holiday engine (its Hijri and Coptic calendars) renders nothing until
// a theme applies after hydration, so it loads right after the page is up
// instead of in every page's first download. The tool finder, the trophy case
// and the BYOK settings dialog load when first opened (see ShellDialogs).
const HolidayEngine = dynamic(() => import("@/lib/holiday/engine").then((m) => m.HolidayEngine), {
  ssr: false,
});

// Floating 3D mascot + agent chat — dynamic-imported (ssr:false) so the WebGL
// mascot + agent runtime (SSE parser, tool-execution machinery) only load
// client-side. Replaces the old right-side agent sheet.
const MascotAssistant = dynamic(
  () => import("@/components/agent/mascot/mascot-assistant").then((m) => m.MascotAssistant),
  { ssr: false }
);
import { SonificationProvider } from "@/lib/sonification/provider";
import { GamificationProvider } from "@/lib/gamification/provider";
import { HapticsProvider } from "@/lib/haptics/provider";
import { EmotionProvider } from "@/lib/emotion/provider";
import { WeatherProvider } from "@/lib/weather/provider";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { OwnerPresenceProvider } from "./owner-presence-provider";
import { CloudSyncProvider } from "@/lib/sync/sync-provider";
import { HistorySyncProvider } from "@/lib/history/sync-provider";
import { TimeTravelShortcuts } from "@/components/history/time-travel-shortcuts";
import { ErrorBoundary } from "./error-boundary";
import { Suspense } from "react";

// Phase 4 — global flying-card portal. Dynamic-imported so the
// framer-motion + KudosCard subtree doesn't land in the eager bundle
// for users who never send a kudos.
const FlyingCardPortal = dynamic(
  () => import("@/lib/kudos/beacon/flying-card").then((m) => m.FlyingCardPortal),
  { ssr: false }
);
import { ActivityPanel } from "@/components/notify/activity-panel";
import { MomentChip } from "@/components/notify/moment-chip";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { RecentToolTracker } from "@/lib/tools/tool-prefs";
import { RouteSignal } from "@/components/motion/route-signal";

// Routes that bypass the full app chrome (sidebar/header/providers).
// Every page is reachable signed-out now, so that is no longer what sets
// these apart: they are the auth flow itself (sign-in, sign-out, callback,
// not-authorized), the guest tree, which has its own layout, and the
// visitor live-room join page (/join/<tool>/<code>), which must not mount
// the owner's auth, cloud sync or workspace store. They must render
// without depending on auth state, workspace store rehydration, etc.
// Page changes to or from them are instant (lib/motion/page-transition.ts).
export const BARE_ROUTE_PREFIXES = [
  "/auth/sign-in",
  "/auth/sign-out",
  "/auth/callback",
  "/not-authorized",
  "/guest",
  "/join",
];

function isBareRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return BARE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = isBareRoute(pathname);

  // Each page's arrival, for page changes, in both branches and at the same
  // place, so it stays mounted when a change crosses between them. Its own
  // Suspense: it reads the query, which on a static page renders up to the
  // nearest Suspense in the browser; this one holds nothing else.
  const signal = (
    <Suspense fallback={null}>
      <RouteSignal isBare={isBareRoute} />
    </Suspense>
  );

  // Bare routes (sign-in, not-authorized) render with just the atmosphere
  // background already in the root layout. No sidebar, no header, no
  // providers — those would either depend on auth or pull in heavy bundles
  // for what is otherwise a single-screen landing page.
  if (bare) {
    return (
      <>
        {signal}
        {children}
      </>
    );
  }

  return (
    <>
      {signal}
      <FullAppShell>{children}</FullAppShell>
    </>
  );
}

function FullAppShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  // The trophy case and the Activity panel open from the XP bar, the user
  // menu and each other, so their state lives in a small shared store.
  const trophyOpen = useActivityUiStore((s) => s.trophyOpen);
  const setTrophyOpen = useActivityUiStore((s) => s.setTrophyOpen);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // An Undo toast belongs to the page that raised it (lib/utils/undoable).
  useEffect(() => {
    dismissUndoToasts();
  }, [pathname]);

  // Workspace store uses skipHydration; rehydrate ONCE at the app shell level
  // rather than per-tool. Multiple tools mounting all at once previously each
  // re-read localStorage and triggered re-renders.
  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
    // BYOK LLM store also uses skipHydration — its custom storage adapter
    // (sessionStorage vs localStorage) only works post-mount on the client.
    void Promise.resolve(useLlmStore.persist.rehydrate()).catch(() => {
      /* corrupt persisted blob — keep defaults */
    });
  }, []);

  // Phase 15: install the cross-tool signal bridge once. Wires
  // workspace-store mutations to the signal bus so any tool can subscribe
  // to entity changes (impediment.raised, sprint.completed, etc.).
  // Also bootstraps the smart-default predictor registry.
  //
  // The kudos receive bridge is local-only, so it runs for everyone. The
  // owner-only cloud half (cloud-sync + backfill to /api/kudos) lives in
  // <KudosOwnerBridge/> below, which follows the owner's sign-in state.
  useEffect(() => {
    installSignalBridge();
    bootstrapPredictions();
    installKudosReceiveBridge();
  }, []);

  return (
    <ErrorBoundary name="AppShell">
      {/* framer-motion ignores prefers-reduced-motion unless told to. */}
      <MotionConfig reducedMotion="user">
        <LiveAnnouncerProvider>
          <SonificationProvider>
            <HapticsProvider>
              <EmotionProvider>
                <AuthProvider>
                  <OwnerWeather>
                    {/* Inside AuthProvider: the leaderboard sync is owner-only. */}
                    <GamificationProvider>
                      <OwnerPresenceProvider>
                        <CloudSyncProvider>
                          <HistorySyncProvider>
                            <TimeTravelShortcuts />
                            <KudosOwnerBridge />
                            {/* Inside AuthProvider and the sync gate: moves old per-tool
                                sprint data into shared sprints once it's safe to. */}
                            <LegacySprintMigration />
                            {/* The same for tools whose storage moved later (Impediments). */}
                            <LegacyToolMigrations />
                            <RecentToolTracker />
                            <Suspense fallback={null}>
                              <FlyingCardPortal />
                            </Suspense>
                            {/* Skip-to-content link for screen readers + keyboard users */}
                            <a
                              href="#main-content"
                              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-accent focus:text-bg focus:rounded-md"
                            >
                              Skip to content
                            </a>

                            <div className="flex min-h-screen">
                              <Sidebar
                                mobileOpen={sidebarOpen}
                                onClose={() => setSidebarOpen(false)}
                              />
                              <div className="flex-1 flex flex-col min-w-0">
                                <StorageHealthBanner />
                                <BackupReminder />
                                <PresentationController />
                                <DockedTimer />
                                <Header
                                  onOpenSearch={() => setSearchOpen(true)}
                                  onOpenSidebar={() => setSidebarOpen(true)}
                                />
                                {/* Side safe areas: the right one at every width (md
                                    covers every landscape iPhone, notch and all); the
                                    left one only below md, where no rail sits there
                                    (the rail keeps it from md: sidebar). */}
                                <main
                                  id="main-content"
                                  className="flex-1 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-28 pl-safe pr-safe md:pl-0"
                                >
                                  {children}
                                </main>
                              </div>
                            </div>
                            {/* The tool finder (and Ctrl/Cmd+K), the trophy case and the BYOK
                                settings dialog: each one's code loads when it first opens. */}
                            <ShellDialogs
                              searchOpen={searchOpen}
                              setSearchOpen={setSearchOpen}
                              trophyOpen={trophyOpen}
                              setTrophyOpen={setTrophyOpen}
                            />
                            <ActivityPanel />
                            <MomentChip />
                            {/* Cosmetic: if its code can't load, the page carries on without it. */}
                            <ErrorBoundary name="HolidayEngine" fallback={() => null}>
                              <Suspense fallback={null}>
                                <HolidayEngine />
                              </Suspense>
                            </ErrorBoundary>
                            <MascotAssistant />
                          </HistorySyncProvider>
                        </CloudSyncProvider>
                      </OwnerPresenceProvider>
                    </GamificationProvider>
                  </OwnerWeather>
                </AuthProvider>
              </EmotionProvider>
            </HapticsProvider>
          </SonificationProvider>
        </LiveAnnouncerProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}

/** Cairo weather is the owner's flavour; visitors never fetch it. */
function OwnerWeather({ children }: { children: React.ReactNode }) {
  const isOwner = useIsOwner();
  return <WeatherProvider enabled={isOwner}>{children}</WeatherProvider>;
}
