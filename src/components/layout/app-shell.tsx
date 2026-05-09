"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { CommandPalette } from "./command-palette";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { SonificationProvider } from "@/lib/sonification/provider";
import { GamificationProvider } from "@/lib/gamification/provider";
import { HapticsProvider } from "@/lib/haptics/provider";
import { HolidayEngine } from "@/lib/holiday/engine";
import { EmotionProvider } from "@/lib/emotion/provider";
import { WeatherProvider } from "@/lib/weather/provider";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { HistorySyncProvider } from "@/lib/history/sync-provider";
import { TimeTravelShortcuts } from "@/components/history/time-travel-shortcuts";
import { ErrorBoundary } from "./error-boundary";
import { Suspense } from "react";
import { XpBar } from "@/components/gamification/xp-bar";
import { TrophyCase } from "@/components/gamification/trophy-case";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [trophyOpen, setTrophyOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Workspace store uses skipHydration; rehydrate ONCE at the app shell level
  // rather than per-tool. Multiple tools mounting all at once previously each
  // re-read localStorage and triggered re-renders.
  useEffect(() => {
    useWorkspaceStore.persist.rehydrate();
  }, []);

  return (
    <ErrorBoundary name="AppShell">
    <SonificationProvider>
      <HapticsProvider>
      <EmotionProvider>
      <WeatherProvider>
      <GamificationProvider>
      <AuthProvider>
      <HistorySyncProvider>
        <TimeTravelShortcuts />
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
            <Header
              onOpenSearch={() => setSearchOpen(true)}
              onOpenSidebar={() => setSidebarOpen(true)}
            />
            <main
              id="main-content"
              className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-16 pl-safe pr-safe md:pl-0 md:pr-0"
            >
              {children}
            </main>
          </div>
          <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
        </div>
        <XpBar onOpenTrophyCase={() => setTrophyOpen(true)} />
        <TrophyCase open={trophyOpen} onOpenChange={setTrophyOpen} />
        <Suspense fallback={null}>
          <HolidayEngine />
        </Suspense>
      </HistorySyncProvider>
      </AuthProvider>
      </GamificationProvider>
      </WeatherProvider>
      </EmotionProvider>
      </HapticsProvider>
    </SonificationProvider>
    </ErrorBoundary>
  );
}
