"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";
import { LogIn } from "lucide-react";

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
  const initialError = errCode ? ERROR_MESSAGES[errCode] ?? "Sign-in failed." : null;
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
    <div className="max-w-md w-full space-y-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">Welcome back</h1>
        <p className="text-sub text-sm">Sign in with the Google account on the workspace allowlist.</p>
      </div>

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
    </div>
  );
}
