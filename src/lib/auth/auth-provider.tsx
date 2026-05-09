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

const initialState: AuthState = {
  status: isAuthAvailable() ? "loading" : "disabled",
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
      if (error.code === "PGRST116") {
        await new Promise((r) => setTimeout(r, 300));
        const retry = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        if (!retry.error) return { kind: "ok", profile: retry.data as Profile };
        if (retry.error.code === "PGRST116") return { kind: "missing" };
        return { kind: "error", message: retry.error.message };
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
    if (!supabase) {
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
    await supabase.auth.signOut();
    setRolePickerOpen(false);
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
