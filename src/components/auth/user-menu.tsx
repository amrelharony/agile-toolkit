"use client";

import Link from "next/link";
import { useMounted } from "@/hooks/use-mounted";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-provider";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { SCRUM_ROLE_LABEL } from "@/lib/auth/types";
import { LogOut, History, ShieldCheck, UserCircle, LogIn, Sparkles, KeyRound } from "lucide-react";

function getInitials(name: string | null | undefined, email: string): string {
  const source = (name ?? email).trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { status, user, profile, signOut } = useAuth();
  const openAiSettings = useLlmUiStore((s) => s.openSettings);
  const mounted = useMounted();

  // Hide entirely when auth is disabled (no Supabase env), or until hydrated.
  if (!mounted || status === "disabled") {
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

  if (status === "anonymous" || status === "error") {
    // Middleware redirects unauthenticated users to /auth/sign-in before
    // reaching any tool page. Reaching this branch means the menu is
    // rendering during a brief in-between state (e.g. just signed out).
    // Link to the sign-in page rather than triggering OAuth inline, so
    // the page-level UI handles the redirect-to-Google flow consistently.
    return (
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" asChild className="gap-1.5">
          <Link href="/auth/sign-in" aria-label="Sign in">
            <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Sign in</span>
          </Link>
        </Button>
      </div>
    );
  }

  // authenticated
  const displayName = profile?.display_name || user?.email || "Account";
  const initials = getInitials(profile?.display_name, user?.email ?? "");
  const role = profile?.scrum_role ? SCRUM_ROLE_LABEL[profile.scrum_role] : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-9 h-9 rounded-full ring-1 ring-border hover:ring-accent/40 transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent overflow-hidden"
          aria-label={`Account menu for ${displayName}`}
        >
          <Avatar className="w-9 h-9">
            {profile?.avatar_url && (
              <AvatarImage src={profile.avatar_url} alt={displayName} />
            )}
            <AvatarFallback className="text-xs font-medium bg-accent/15 text-accent">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-2">
          <div className="text-sm font-medium text-text truncate">
            {displayName}
          </div>
          <div className="text-xs text-sub truncate">{user?.email}</div>
          {role && (
            <Badge variant="secondary" className="mt-1.5 text-[10px]">
              {role}
            </Badge>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-sub">
          Activity
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/history" className="cursor-pointer">
            <History className="w-4 h-4" aria-hidden="true" />
            <span>My history</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/insights" className="cursor-pointer">
            <UserCircle className="w-4 h-4" aria-hidden="true" />
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
          <Link href="/settings/access-tokens" className="cursor-pointer">
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            <span>Access tokens</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/privacy" className="cursor-pointer">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>Privacy &amp; data</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void signOut();
          }}
          className="text-destructive focus:text-destructive cursor-pointer"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
