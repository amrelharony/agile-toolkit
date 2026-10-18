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
import { CommandPalette } from "./command-palette";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import { dismissUndoToasts } from "@/lib/utils/undoable";
import { installSignalBridge } from "@/lib/signals/signal-bridge";
import { bootstrapPredictions } from "@/lib/predictions/bootstrap";
import { installKudosReceiveBridge } from "@/lib/kudos/receive-bridge";
import { KudosOwnerBridge } from "@/lib/kudos/owner-bridge";
// The tool action registry is populated by the owner's agent panel
// (components/agent/mascot/owner-agent-panel) when it loads — only the
// agent reads it client-side, so visitors never download it.

// Settings dialog is dynamic-imported so its body (tabs, model lists, the
// tested provider import) never lands in the eager bundle — only loads
// when the user actually clicks the header chip or UserMenu entry.
const LlmSettingsDialog = dynamic(
  () => import("@/components/ai/llm-settings-dialog").then((m) => m.LlmSettingsDialog),
  { ssr: false }
);

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
import { HolidayEngine } from "@/lib/holiday/engine";
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
import { TrophyCase } from "@/components/gamification/trophy-case";
import { RecentToolTracker } from "@/lib/tools/tool-prefs";

// Routes that bypass the full app chrome (sidebar/header/providers).
// Every page is reachable signed-out now, so that is no longer what sets
// these apart: they are the auth flow itself (sign-in, sign-out, callback,
// not-authorized) and the guest tree, which has its own layout. They must
// render without depending on auth state, workspace store rehydration, etc.
const BARE_ROUTE_PREFIXES = [
  "/auth/sign-in",
  "/auth/sign-out",
  "/auth/callback",
  "/not-authorized",
  "/guest",
];

function isBareRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return BARE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = isBareRoute(pathname);

  // Bare routes (sign-in, not-authorized) render with just the atmosphere
  // background already in the root layout. No sidebar, no header, no
  // providers — those would either depend on auth or pull in heavy bundles
  // for what is otherwise a single-screen landing page.
  if (bare) {
    return <>{children}</>;
  }

  return <FullAppShell>{children}</FullAppShell>;
}

function FullAppShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [trophyOpen, setTrophyOpen] = useState(false);
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
                                  onOpenTrophyCase={() => setTrophyOpen(true)}
                                />
                                <main
                                  id="main-content"
                                  className="flex-1 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-28 pl-safe pr-safe md:pl-0 md:pr-0"
                                >
                                  {children}
                                </main>
                              </div>
                              <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
                            </div>
                            <TrophyCase open={trophyOpen} onOpenChange={setTrophyOpen} />
                            <Suspense fallback={null}>
                              <HolidayEngine />
                            </Suspense>
                            {/* BYOK settings dialog — open/close state lives in llm-ui-store,
            so this single mount serves both header-chip and UserMenu
            entry points. Dynamic-imported so non-AI users never load it. */}
                            <LlmSettingsDialog />
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
