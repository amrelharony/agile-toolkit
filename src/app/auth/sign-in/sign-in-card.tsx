"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { LogIn, Users } from "lucide-react";

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (raw.length > 2048) return "/";
  if (CONTROL_CHARS.test(raw)) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.startsWith("/auth/")) return "/";
  if (raw === "/not-authorized") return "/";
  return raw;
}

const ERROR_MESSAGES: Record<string, string> = {
  expired: "That sign-in link expired. Try again.",
  invalid: "That sign-in attempt was invalid. Try again.",
  network: "Network trouble reaching the auth provider. Try again.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  oauth_failed: "Sign-in didn't complete. Try again.",
  missing_code: "Sign-in didn't complete. Try again.",
  not_authorized: "That Google account isn't on the allowlist.",
  auth_disabled: "Auth isn't configured on this deployment.",
};

export function SignInCard() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = safeNext(params.get("next"));
  const errCode = params.get("auth_error");
  const initialError = errCode ? (ERROR_MESSAGES[errCode] ?? "Sign-in failed.") : null;
  const displayError = error ?? initialError;

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    const supabase = getAuthBrowserClient();
    if (!supabase) {
      setError("Auth isn't configured.");
      setBusy(false);
      return;
    }
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success the browser navigates to Google; no need to clear `busy`.
  };

  return (
    <div className="max-w-sm w-full space-y-4 text-center">
      <p className="text-sub text-sm">
        Sign in with the Google account on the workspace allowlist.
      </p>

      <Button
        onClick={() => void handleSignIn()}
        disabled={busy}
        size="lg"
        className="w-full gap-2"
      >
        <LogIn className="w-4 h-4" aria-hidden="true" />
        {busy ? "Redirecting to Google…" : "Continue with Google"}
      </Button>

      {displayError && (
        <p className="text-sm text-destructive" role="alert">
          {displayError}
        </p>
      )}

      {/* Guest-join path. Distinct from the owner sign-in above —
          squad members don't need (and shouldn't have) a workspace
          account. Visually subordinate so the primary path stays
          obvious for the workspace owner. Middleware bypasses
          /guest/*, so this link works for any unauthenticated
          visitor. We intentionally don't forward `?next=` here: the
          sign-in `next` targets owner routes which a guest can't
          reach anyway; the guest-side pages stamp their own `?next=`
          when they redirect to /guest/join. */}
      <div
        className="flex items-center gap-3 pt-2 text-[11px] uppercase tracking-wider text-sub/60"
        aria-hidden="true"
      >
        <div className="flex-1 h-px bg-border" />
        <span>or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Link
        href="/guest/join"
        className="inline-flex items-center justify-center w-full gap-2 rounded-md border border-border bg-transparent px-4 py-2 text-sm text-sub hover:text-accent hover:border-accent/30 transition-colors"
      >
        <Users className="w-4 h-4 opacity-60" aria-hidden="true" />
        Join with a squad invite code
      </Link>
      <p className="text-[11px] text-sub/60">No account needed — your squad lead shares a code.</p>
    </div>
  );
}
