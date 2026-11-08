"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMounted } from "@/hooks/use-mounted";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-provider";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";
import { isOwnerOnlyPage } from "@/lib/auth/owner-routes";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { useHistoryStore } from "@/lib/history/history-store";
import { syncEngine } from "@/lib/sync/engine";
import { useOwnerSeen, useVisitorDataPending } from "@/lib/sync/owner-sync-gate";
import { clearLocalWorkspaceData } from "@/lib/utils/clear-local-data";
import { toast } from "@/lib/utils/toast";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { SCRUM_ROLE_LABEL, type SignOutResult } from "@/lib/auth/types";
import { ActivityDot, useVisibleUnreadCount } from "@/components/notify/activity-dot";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { areCelebrationsPaused } from "@/lib/notify/prefs";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { computeLevel } from "@/lib/gamification/xp-curve";
import {
  BookImage,
  LogOut,
  History,
  UserCircle,
  LogIn,
  Sparkles,
  KeyRound,
  Palette,
  BarChart3,
  Eraser,
  HardDrive,
  Bell,
  BellOff,
  Trophy,
  SlidersHorizontal,
} from "lucide-react";

// Loaded on first open: backup/restore isn't needed until someone asks.
const YourDataDialog = dynamic(
  () => import("@/components/data/your-data-dialog").then((m) => m.YourDataDialog),
  { ssr: false }
);

function getInitials(name: string | null | undefined, email: string): string {
  const source = (name ?? email).trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

/** Upper bound on the pre-sign-out cloud flush, so a dead network can't
 *  leave the sign-out dialog spinning. */
const FLUSH_TIMEOUT_MS = 4_000;

function flushCloudSync(): Promise<void> {
  return Promise.race([
    syncEngine.flushAllNow().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
  ]);
}

/**
 * Set (after the data sweep) when a sign-out removed the session from this
 * browser but the server never confirmed it; read once by the next page.
 */
const UNREVOKED_SIGN_OUT_KEY = "agile-toolkit:sign-out-unrevoked";

const UNREVOKED_SIGN_OUT_MESSAGE =
  "Signed out on this browser. The server couldn't be reached to end your session everywhere, so your other devices may still be signed in.";

function useUnrevokedSignOutNotice() {
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(UNREVOKED_SIGN_OUT_KEY) === null) return;
      window.sessionStorage.removeItem(UNREVOKED_SIGN_OUT_KEY);
    } catch {
      return;
    }
    toast.warning(UNREVOKED_SIGN_OUT_MESSAGE);
  }, []);
}

export function UserMenu() {
  const { status, user, error } = useAuth();
  const mounted = useMounted();
  useUnrevokedSignOutNotice();

  if (!mounted) {
    return <div className="w-9 h-9" aria-hidden="true" />;
  }

  if (status === "loading") {
    return (
      <div
        className="w-9 h-9 rounded-full bg-[var(--card)] border border-border animate-pulse"
        aria-label="Loading account"
      />
    );
  }

  // "authenticated" is only ever the server-verified owner (AuthProvider).
  // Everyone else — signed out, a non-owner Google account, or a
  // deployment without auth — is a visitor whose work stays in this
  // browser. A session whose owner check couldn't complete yet is NOT
  // shown as a visitor: it is still signed in (AuthProvider is retrying),
  // so the menu says so and offers to sign it out of this browser.
  if (status === "authenticated" && user) return <OwnerMenu />;
  return (
    <VisitorMenu
      authAvailable={status !== "disabled"}
      sessionUnverified={status === "error" && error === OWNER_UNVERIFIED}
    />
  );
}

function VisitorMenu({
  authAvailable,
  sessionUnverified,
}: {
  authAvailable: boolean;
  sessionUnverified: boolean;
}) {
  const openAiSettings = useLlmUiStore((s) => s.openSettings);
  const pathname = usePathname();
  const ownerSeen = useOwnerSeen();
  const [clearOpen, setClearOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const unread = useVisibleUnreadCount();

  const signInHref = `/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`;
  const title = sessionUnverified
    ? "Signed in — checking owner access"
    : ownerSeen
      ? "Signed out — sign in to sync"
      : "Visitor";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative min-touch-coarse w-9 h-9 rounded-full flex items-center justify-center text-sub ring-1 ring-border hover:text-accent hover:ring-accent/40 transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={withUnread(sessionUnverified ? "Account menu" : "Visitor menu", unread)}
            title={title}
          >
            <UserCircle className="w-5 h-5" aria-hidden="true" />
            {/* The owner has used this browser before: hint that signing
                back in resumes cloud sync (their session may have lapsed). */}
            {(ownerSeen || sessionUnverified) && (
              <span
                className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-accent ring-2 ring-[var(--bg)]"
                aria-hidden="true"
              />
            )}
            {/* Something new in Activity. Bottom corner, so it never sits on
                the sign-in hint above. */}
            <ActivityDot className="top-auto bottom-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {sessionUnverified ? (
            <div className="px-2 py-2 text-xs text-sub">
              <span className="text-sm font-medium text-text">Signed in</span> · Checking owner
              access… Cloud sync resumes once it&apos;s confirmed.
            </div>
          ) : (
            <div className="px-2 py-2 text-xs text-sub">
              <span className="text-sm font-medium text-text">Visitor</span> · Your work stays in
              this browser
            </div>
          )}
          <DropdownMenuSeparator />
          <ProgressMenuSection />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              openAiSettings();
            }}
            className="cursor-pointer"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            <span>AI settings (bring your own key)</span>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/appearance" className="cursor-pointer">
              <Palette className="w-4 h-4" aria-hidden="true" />
              <span>Appearance</span>
            </Link>
          </DropdownMenuItem>
          <SoundMenuItem />
          <DropdownMenuItem onSelect={() => setDataOpen(true)} className="cursor-pointer">
            <HardDrive className="w-4 h-4" aria-hidden="true" />
            <span>Your data (back up & restore)</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/history" className="cursor-pointer">
              <History className="w-4 h-4" aria-hidden="true" />
              <span>My history</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/insights" className="cursor-pointer">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
              <span>My insights</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setClearOpen(true)}
            className="text-destructive focus:text-destructive cursor-pointer"
          >
            <Eraser className="w-4 h-4" aria-hidden="true" />
            <span>Clear data on this browser…</span>
          </DropdownMenuItem>
          {sessionUnverified ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setSignOutOpen(true)}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>Sign out…</span>
              </DropdownMenuItem>
            </>
          ) : (
            authAvailable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={signInHref} className="cursor-pointer">
                    <LogIn className="w-4 h-4" aria-hidden="true" />
                    <span>{ownerSeen ? "Sign in to sync" : "Owner sign in"}</span>
                  </Link>
                </DropdownMenuItem>
              </>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ClearDataDialog open={clearOpen} onOpenChange={setClearOpen} />
      {dataOpen && <YourDataDialog open={dataOpen} onOpenChange={setDataOpen} />}
      {sessionUnverified && <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />}
    </>
  );
}

function ClearDataDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  const onConfirm = () => {
    setBusy(true);
    clearLocalWorkspaceData({ broadcast: true });
    // In-memory stores still hold the data; a reload drops them.
    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clear data on this browser?</DialogTitle>
          <DialogDescription>
            This removes every tool&apos;s data, your history and any AI keys saved in this browser,
            in all open tabs. It can&apos;t be undone — export anything you want to keep first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Clearing…" : "Clear data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnerMenu() {
  const { user, profile } = useAuth();
  const openAiSettings = useLlmUiStore((s) => s.openSettings);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const unread = useVisibleUnreadCount();

  const displayName = profile?.display_name || user?.email || "Account";
  const initials = getInitials(profile?.display_name, user?.email ?? "");
  const role = profile?.scrum_role ? SCRUM_ROLE_LABEL[profile.scrum_role] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative min-touch-coarse w-9 h-9 rounded-full ring-1 ring-border hover:ring-accent/40 transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={withUnread(`Account menu for ${displayName}`, unread)}
          >
            <Avatar className="w-9 h-9">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={displayName} />}
              <AvatarFallback className="text-xs font-medium bg-accent/15 text-accent">
                {initials}
              </AvatarFallback>
            </Avatar>
            <ActivityDot />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-2 py-2">
            <div className="text-sm font-medium text-text truncate">{displayName}</div>
            <div className="text-xs text-sub truncate">{user?.email}</div>
            {role && (
              <Badge variant="secondary" className="mt-1.5 text-xs">
                {role}
              </Badge>
            )}
          </div>
          <DropdownMenuSeparator />
          <ProgressMenuSection />
          <DropdownMenuLabel className="text-xs uppercase tracking-wide text-sub">
            Your work
          </DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/history" className="cursor-pointer">
              <History className="w-4 h-4" aria-hidden="true" />
              <span>My history</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/insights" className="cursor-pointer">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
              <span>My insights</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* BYOK AI settings — paste your own API key to run prompts inline
              instead of copy-pasting them into another tab. */}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              openAiSettings();
            }}
            className="cursor-pointer"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            <span>AI settings (BYOK)</span>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/comics" className="cursor-pointer">
              <BookImage className="w-4 h-4" aria-hidden="true" />
              <span>Comics portal</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/access-tokens" className="cursor-pointer">
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span>Access tokens</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/appearance" className="cursor-pointer">
              <Palette className="w-4 h-4" aria-hidden="true" />
              <span>Appearance</span>
            </Link>
          </DropdownMenuItem>
          <SoundMenuItem />
          <DropdownMenuItem onSelect={() => setDataOpen(true)} className="cursor-pointer">
            <HardDrive className="w-4 h-4" aria-hidden="true" />
            <span>Your data (back up & restore)</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setSignOutOpen(true)}
            className="text-destructive focus:text-destructive cursor-pointer"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Sign out…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
      {dataOpen && <YourDataDialog open={dataOpen} onOpenChange={setDataOpen} />}
    </>
  );
}

/**
 * Owner sign-out. The site is public, so the next person at this browser
 * is a visitor: by default sign-out also clears the toolkit's local data
 * (workspace, history, BYOK keys) — the cloud workspace keeps the owner's
 * copy. "Keep a copy on this browser" opts out, for a personal device.
 */
function SignOutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, status, error, signOut } = useAuth();
  const router = useRouter();
  const [keepCopy, setKeepCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Offline, history events whose push hasn't landed, or cloud sync paused
  // (a "work created while signed out" answer outstanding, or the owner
  // check unanswered) means clearing would lose work the cloud doesn't
  // have yet. Only computed while open.
  const offline = open && typeof navigator !== "undefined" && navigator.onLine === false;
  const unsyncedHistory = useHistoryStore(
    (s) =>
      open && s.events.some((e) => e.userId === user?.id && !e.syncedAt && e.squadProfileId == null)
  );
  const decisionPending = useVisitorDataPending();
  const unverified = status === "error" && error === OWNER_UNVERIFIED;
  const syncPaused = open && (decisionPending || unverified);
  const atRisk = offline || unsyncedHistory || syncPaused;

  const onConfirm = async () => {
    setBusy(true);
    setFailed(false);
    if (!keepCopy) {
      // Push anything still inside its debounce while the session is
      // valid: the cloud copy is what makes clearing this browser safe.
      await flushCloudSync();
    }
    // AWAIT signOut() before navigating, so the session cookies are gone
    // before the next request goes out.
    let result: SignOutResult;
    try {
      result = await signOut();
    } catch {
      result = { revoked: false, signedOutHere: false };
    }
    if (!result.signedOutHere) {
      // The session is still in this browser. Clearing and reloading now
      // would look like a clean sign-out while the next page load restores
      // the owner's session (and pulls the cloud workspace back) for
      // whoever uses this browser next. Stay, say so, let them retry.
      setBusy(false);
      setFailed(true);
      return;
    }
    const leaveOwnerPage = isOwnerOnlyPage(window.location.pathname);
    if (!keepCopy) {
      clearLocalWorkspaceData({ broadcast: true });
      // After the sweep, so it survives into the next page, which says it.
      if (!result.revoked) {
        try {
          window.sessionStorage.setItem(UNREVOKED_SIGN_OUT_KEY, "1");
        } catch {
          /* storage blocked: no notice */
        }
      }
      // A full load, not a soft refresh: in-memory stores still hold the
      // owner's data and would write it straight back.
      if (leaveOwnerPage) window.location.replace("/");
      else window.location.reload();
    } else {
      if (!result.revoked) toast.warning(UNREVOKED_SIGN_OUT_MESSAGE);
      if (leaveOwnerPage) router.replace("/");
      else router.refresh();
    }
  };

  const description = syncPaused
    ? "Cloud sync is paused, so changes made since it paused are only in this browser. Signing out also clears the toolkit data stored in this browser, so the next person using it starts fresh."
    : "Your work is saved in your cloud workspace. Signing out also clears the toolkit data stored in this browser, so the next person using it starts fresh.";
  const riskMessage = offline
    ? "You're offline — changes made since the last sync would be lost."
    : decisionPending
      ? "Cloud sync is paused until you choose what to do with work created while signed out — changes made since you signed in would be lost."
      : unverified
        ? "Your owner access hasn't been confirmed yet, so cloud sync is paused — changes made since would be lost."
        : "Some recent history hasn't synced yet and would be lost.";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sign out</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm text-text cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={keepCopy}
            onChange={(e) => setKeepCopy(e.target.checked)}
            disabled={busy}
          />
          <span>
            Keep a copy on this browser
            <span className="block text-xs text-sub">
              For a device only you use — anyone using this browser can see and change it.
            </span>
          </span>
        </label>
        {atRisk && !keepCopy && (
          <p className="text-xs text-destructive" role="status">
            {riskMessage} Keep a copy, or wait until sync catches up.
          </p>
        )}
        {failed && (
          <p className="text-xs text-destructive" role="alert">
            Couldn&apos;t sign out — you&apos;re still signed in on this browser and nothing was
            cleared. Check your connection and try again.
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={busy}>
            {busy ? "Signing out…" : "Sign out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Interface sounds on/off. Sound is opt-in, and the header's sound toggle is
 * hidden on phones, so the menu is the place every visitor can reach it.
 */
function SoundMenuItem() {
  const enabled = useSonificationStore((s) => s.enabled);
  const setEnabled = useSonificationStore((s) => s.setEnabled);
  return (
    <DropdownMenuCheckboxItem
      checked={enabled}
      onCheckedChange={(v) => setEnabled(v === true)}
      onSelect={(e) => e.preventDefault()}
      className="cursor-pointer"
    >
      Interface sounds
    </DropdownMenuCheckboxItem>
  );
}

/** The avatar's accessible name, with the unread count (its dot is decorative). */
function withUnread(label: string, unread: number): string {
  return unread > 0 ? `${label}, ${unread} new in Activity` : label;
}

const PAUSE_CELEBRATIONS_MS = 60 * 60 * 1000;

/**
 * Progress, Activity, Trophies, Notifications and "Pause celebrations" rows.
 * The header's XP bar is hidden on phones, so this is where every visitor
 * reaches them.
 */
function ProgressMenuSection() {
  const gamificationEnabled = useNotificationPrefsStore((s) => s.gamificationEnabled);
  const pausedUntil = useNotificationPrefsStore((s) => s.celebrationsPausedUntil);
  const pause = useNotificationPrefsStore((s) => s.pauseCelebrations);
  const resume = useNotificationPrefsStore((s) => s.resumeCelebrations);
  const openActivity = useActivityUiStore((s) => s.openActivity);
  const openTrophies = useActivityUiStore((s) => s.openTrophies);
  const unread = useVisibleUnreadCount();
  const xp = useVDnaStore((s) => s.xp);
  const prestigeCount = useVDnaStore((s) => s.prestige);
  const info = computeLevel(xp, prestigeCount);
  const paused = areCelebrationsPaused({ celebrationsPausedUntil: pausedUntil }, Date.now());
  const toNext = Math.max(0, info.xpNeededForLevel - info.xpIntoLevel);

  return (
    <>
      {gamificationEnabled && (
        <div className="px-2 py-1.5 text-xs text-sub" data-testid="menu-progress">
          <span className="font-medium text-text">Level {info.level}</span>
          {info.atMax ? " · Top level" : ` · ${toNext} XP to Level ${info.level + 1}`}
        </div>
      )}
      <DropdownMenuItem onSelect={() => openActivity()} className="cursor-pointer">
        <Bell className="w-4 h-4" aria-hidden="true" />
        <span className="flex-1">Activity</span>
        {unread > 0 && (
          <Badge variant="secondary" className="text-xs">
            {unread > 99 ? "99+" : unread} <span className="sr-only">unread</span>
          </Badge>
        )}
      </DropdownMenuItem>
      {gamificationEnabled && (
        <DropdownMenuItem onSelect={() => openTrophies()} className="cursor-pointer">
          <Trophy className="w-4 h-4" aria-hidden="true" />
          <span>Trophies &amp; challenges</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <Link href="/settings/notifications" className="cursor-pointer">
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          <span>Notifications</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => (paused ? resume() : pause(PAUSE_CELEBRATIONS_MS))}
        className="cursor-pointer"
      >
        <BellOff className="w-4 h-4" aria-hidden="true" />
        <span>{paused ? "Resume celebrations" : "Pause celebrations · 1 h"}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}
