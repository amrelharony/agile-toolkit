"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getAuthBrowserClient, isAuthAvailable } from "./supabase-browser";
import type {
  AuthContextValue,
  AuthState,
  Profile,
  ScrumRole,
} from "./types";
import { RolePickerDialog } from "@/components/auth/role-picker-dialog";

const AuthContext = createContext<AuthContextValue | null>(null);

// Hydration-safe initial state: report "loading" on first render regardless
// of `isAuthAvailable()`. The previous initialState called `isAuthAvailable()`
// at module load — if the env var was present on the server but the client
// build was older (or vice versa), the status would differ between SSR and
// CSR, producing a hydration warning. The effect below switches to the
// correct status as soon as we're confirmed on the client.
const initialState: AuthState = {
  status: "loading",
  user: null,
  profile: null,
  error: null,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const supabase = getAuthBrowserClient();

  // Hold the latest user ref so async profile loads stay correlated.
  const userIdRef = useRef<string | null>(null);

  type ProfileLoadResult =
    | { kind: "ok"; profile: Profile }
    | { kind: "missing" } // PGRST116 — row doesn't exist; first sign-in
    | { kind: "error"; message: string }; // network / RLS / other

  const loadProfile = useCallback(
    async (user: User): Promise<ProfileLoadResult> => {
      if (!supabase) return { kind: "error", message: "auth_disabled" };
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (!error) return { kind: "ok", profile: data as Profile };
      // PGRST116 = "no rows" — the trigger may not have fired yet on first sign-in.
      // Retry with exponential backoff (300ms, 700ms, 1500ms) so a slow trigger
      // doesn't force the role picker open with a still-missing profile that
      // would race the user's first interaction.
      if (error.code === "PGRST116") {
        const delays = [300, 700, 1500];
        for (const delay of delays) {
          await new Promise((r) => setTimeout(r, delay));
          const retry = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();
          if (!retry.error) return { kind: "ok", profile: retry.data as Profile };
          if (retry.error.code !== "PGRST116") {
            return { kind: "error", message: retry.error.message };
          }
        }
        // After 3 retries totaling ~2.5s, give up and treat as missing —
        // the picker will let the user set their role, which writes a
        // fresh profile row.
        return { kind: "missing" };
      }
      return { kind: "error", message: error.message };
    },
    [supabase]
  );

  const applySession = useCallback(
    async (session: Session | null) => {
      if (!session?.user) {
        userIdRef.current = null;
        setState({
          status: "anonymous",
          user: null,
          profile: null,
          error: null,
        });
        return;
      }
      // Allowlist enforcement is server-side only (middleware on every
      // request + auth/callback after the OAuth code exchange). We
      // intentionally do NOT re-check here: AUTHORIZED_EMAILS is a
      // server-only env var with no NEXT_PUBLIC_ prefix, so in the
      // browser `isEmailAuthorized` would always fail closed and sign
      // out every signed-in user. Trust the server gates above.
      userIdRef.current = session.user.id;
      const result = await loadProfile(session.user);
      // Drop response if user changed (e.g. quick sign-in/out).
      if (userIdRef.current !== session.user.id) return;
      if (result.kind === "ok") {
        setState({
          status: "authenticated",
          user: session.user,
          profile: result.profile,
          error: null,
        });
        // Open role picker only if scrum_role is genuinely null on a profile
        // we successfully loaded — never on transient errors.
        if (!result.profile.scrum_role) setRolePickerOpen(true);
      } else if (result.kind === "missing") {
        // First sign-in race: keep status authenticated but profile null;
        // open the picker so the user sets a role on the next render.
        setState({
          status: "authenticated",
          user: session.user,
          profile: null,
          error: null,
        });
        setRolePickerOpen(true);
      } else {
        // Network / RLS error: stay authenticated, surface the message,
        // do NOT reopen the role picker so users aren't prompted on every
        // transient hiccup.
        setState((prev) => ({
          status: "authenticated",
          user: session.user,
          profile: prev.profile, // keep last-known-good profile if any
          error: result.message,
        }));
      }
    },
    [loadProfile]
  );

  // Initial session check + auth state listener
  useEffect(() => {
    // Decide auth availability HERE (post-mount), not at module load —
    // see comment on initialState. If auth is disabled, transition the
    // visible status from "loading" to "disabled" on the next render
    // without warning the user about a hydration mismatch first.
    if (!supabase || !isAuthAvailable()) {
      setState({
        status: "disabled",
        user: null,
        profile: null,
        error: null,
      });
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      void applySession(data.session ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      void applySession(session);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase, applySession]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(
            window.location.pathname + window.location.search
          )}`
        : undefined;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setState((s) => ({ ...s, error: error.message }));
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // R10: wrap in try/finally — a failing `signOut()` (network down,
    // token-revoke 500) previously left `rolePickerOpen` true forever,
    // freezing the dropdown in a "signing out" limbo. Always close the
    // picker; surface the error via setState so the UI can show it.
    try {
      await supabase.auth.signOut();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, error: msg }));
    } finally {
      setRolePickerOpen(false);
    }
  }, [supabase]);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<Profile, "scrum_role" | "display_name">>) => {
      if (!supabase || !state.user) return;
      const { data, error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", state.user.id)
        .select("*")
        .single();
      if (error) {
        setState((s) => ({ ...s, error: error.message }));
        return;
      }
      setState((s) => ({ ...s, profile: data as Profile, error: null }));
      if ((data as Profile).scrum_role) setRolePickerOpen(false);
    },
    [supabase, state.user]
  );

  const refreshProfile = useCallback(async () => {
    if (!state.user) return;
    const result = await loadProfile(state.user);
    if (result.kind === "ok") {
      setState((s) => ({ ...s, profile: result.profile, error: null }));
    } else if (result.kind === "missing") {
      setState((s) => ({ ...s, profile: null, error: null }));
    } else {
      setState((s) => ({ ...s, error: result.message }));
    }
  }, [state.user, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signInWithGoogle,
      signOut,
      updateProfile,
      refreshProfile,
    }),
    [state, signInWithGoogle, signOut, updateProfile, refreshProfile]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {state.status === "authenticated" && (
        <RolePickerDialog
          open={rolePickerOpen}
          onOpenChange={setRolePickerOpen}
          currentRole={state.profile?.scrum_role ?? null}
          onSave={async (role: ScrumRole) => {
            await updateProfile({ scrum_role: role });
          }}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
