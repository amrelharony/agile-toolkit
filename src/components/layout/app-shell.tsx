"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette } from "./command-palette";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import { installSignalBridge } from "@/lib/signals/signal-bridge";
import { bootstrapPredictions } from "@/lib/predictions/bootstrap";
import { installKudosCloudSync } from "@/lib/kudos/cloud-sync";
import { runKudosBackfillIfNeeded } from "@/lib/kudos/backfill";
import { installKudosReceiveBridge } from "@/lib/kudos/receive-bridge";
// Populate the tool action registry at app load — must happen before
// any component that consumes the agent / MCP surface mounts.
import "@/lib/actions/register-all";

// Settings dialog is dynamic-imported so its body (tabs, model lists, the
// tested provider import) never lands in the eager bundle — only loads
// when the user actually clicks the header chip or UserMenu entry.
const LlmSettingsDialog = dynamic(
  () => import("@/components/ai/llm-settings-dialog").then((m) => m.LlmSettingsDialog),
  { ssr: false }
);

// Agent chat sheet — dynamic-imported so the agent runtime (SSE parser,
// tool-execution machinery) only lands when the user actually opens it.
const AgentSheet = dynamic(
  () => import("@/components/agent/agent-sheet").then((m) => m.AgentSheet),
  { ssr: false }
);
import { SonificationProvider } from "@/lib/sonification/provider";
import { GamificationProvider } from "@/lib/gamification/provider";
import { HapticsProvider } from "@/lib/haptics/provider";
import { HolidayEngine } from "@/lib/holiday/engine";
import { EmotionProvider } from "@/lib/emotion/provider";
import { WeatherProvider } from "@/lib/weather/provider";
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
// Middleware allows them through unauthenticated, so they must render
// without depending on auth state, workspace store rehydration, etc.
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
  // Kudos redesign Phase 1: cloud-sync subscribes to `kudos.sent` on the
  // same bus, so installing it after `installSignalBridge` guarantees the
  // first emit lands on a registered listener. Backfill runs after
  // workspace rehydration completes — kicked off in a microtask so the
  // initial render isn't blocked by the (typically small) round-trip.
  useEffect(() => {
    installSignalBridge();
    bootstrapPredictions();
    installKudosCloudSync();
    installKudosReceiveBridge();
    void Promise.resolve().then(() => runKudosBackfillIfNeeded());
  }, []);

  return (
    <ErrorBoundary name="AppShell">
      <SonificationProvider>
        <HapticsProvider>
          <EmotionProvider>
            <WeatherProvider>
              <GamificationProvider>
                <AuthProvider>
                  <OwnerPresenceProvider>
                    <CloudSyncProvider>
                      <HistorySyncProvider>
                        <TimeTravelShortcuts />
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
                          <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                          <div className="flex-1 flex flex-col min-w-0">
                            <Header
                              onOpenSearch={() => setSearchOpen(true)}
                              onOpenSidebar={() => setSidebarOpen(true)}
                              onOpenTrophyCase={() => setTrophyOpen(true)}
                            />
                            <main
                              id="main-content"
                              className="flex-1 pb-[calc(2rem+env(safe-area-inset-bottom))] md:pb-8 pl-safe pr-safe md:pl-0 md:pr-0"
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
                        <AgentSheet />
                      </HistorySyncProvider>
                    </CloudSyncProvider>
                  </OwnerPresenceProvider>
                </AuthProvider>
              </GamificationProvider>
            </WeatherProvider>
          </EmotionProvider>
        </HapticsProvider>
      </SonificationProvider>
    </ErrorBoundary>
  );
}
