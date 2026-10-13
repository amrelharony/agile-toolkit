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
import { checkOwner, OWNER_SEEN_KEY, OWNER_UNVERIFIED } from "./owner-check";
import { signOutThisBrowser } from "./sign-out";
import type { AuthContextValue, AuthState, Profile, ScrumRole, SignOutResult } from "./types";
import { RolePickerDialog } from "@/components/auth/role-picker-dialog";
import { toast } from "@/lib/utils/toast";

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * `AuthState.error` while a session exists but `/api/auth/owner` gave no
 * answer (offline, 5xx, timeout). Status is "error" with no user, so
 * nothing owner-only runs until a retry confirms the owner. Defined in
 * owner-check.ts.
 */
export { OWNER_UNVERIFIED };

// Owner re-check schedule after an "unknown" answer, on top of retrying
// whenever the browser comes back online or the tab becomes visible.
const OWNER_RETRY_DELAYS_MS = [2_000, 10_000, 30_000] as const;

const DENIED_MESSAGE =
  "That Google account isn't the owner account — every tool still works without signing in.";

const ANONYMOUS_STATE: AuthState = {
  status: "anonymous",
  user: null,
  profile: null,
  error: null,
};

function markOwnerSeen() {
  try {
    window.localStorage.setItem(OWNER_SEEN_KEY, "1");
  } catch {
    // Storage blocked (private mode, quota): the hint is best-effort.
  }
}

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
  // Monotonic request id — increments on every applySession call. A loadProfile
  // response is only applied if its capture matches the latest seqRef value
  // (catches out-of-order replays for the SAME user). (BUG-A4)
  const seqRef = useRef(0);
  // uid the server confirmed as the owner, and the check in flight (keyed
  // by uid). supabase-js re-emits SIGNED_IN whenever the tab regains
  // focus, plus TOKEN_REFRESHED and an INITIAL_SESSION that races
  // getSession(); none of those re-check an already-verified or
  // in-flight uid. Both reset on sign-out / a null session.
  const verifiedUidRef = useRef<string | null>(null);
  const inflightRef = useRef<{ uid: string; promise: Promise<void> } | null>(null);
  // Latest session, so an owner re-check can run outside an auth event.
  const sessionRef = useRef<Session | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const mountedRef = useRef(false);

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
          const retry = await supabase.from("profiles").select("*").eq("id", user.id).single();
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

  const clearOwnerRetry = useCallback(() => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    retryAttemptRef.current = 0;
  }, []);

  // Latest applySession for retry timers / listeners scheduled from inside it.
  const applySessionRef = useRef<(session: Session | null) => Promise<void>>(async () => {});

  const applySession = useCallback(
    async (session: Session | null): Promise<void> => {
      if (!session?.user) {
        userIdRef.current = null;
        verifiedUidRef.current = null;
        inflightRef.current = null;
        sessionRef.current = null;
        seqRef.current += 1;
        clearOwnerRetry();
        setState(ANONYMOUS_STATE);
        return;
      }
      const user = session.user;
      sessionRef.current = session;
      if (verifiedUidRef.current === user.id) return;
      if (inflightRef.current?.uid === user.id) return inflightRef.current.promise;

      // Invariant: status "authenticated" <=> the SERVER confirmed this
      // session is the owner's. The site is public, so any Google account
      // can hold a Supabase session, and the allowlist (AUTHORIZED_EMAILS)
      // is a server-only env var — checked here it would always fail
      // closed. So ask /api/auth/owner, which runs the same
      // requireAuthorizedUser() gate as every owner API. Everything keyed
      // on "authenticated" (cloud/history sync, presence, collab, the role
      // picker) is therefore owner-only without a check of its own. The
      // profile loads in parallel so the owner's first paint doesn't wait
      // on two round trips; a non-owner's result is discarded.
      if (userIdRef.current !== user.id) clearOwnerRetry();
      userIdRef.current = user.id;
      const seqCapture = ++seqRef.current;
      // Drop the result if the user changed, or a newer applySession for
      // the SAME user superseded this one (out-of-order replay). (BUG-A4)
      const stale = () =>
        !mountedRef.current || userIdRef.current !== user.id || seqCapture !== seqRef.current;

      const verify = async () => {
        const profilePromise = loadProfile(user).catch(
          (err): ProfileLoadResult => ({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          })
        );
        const ownership = await checkOwner();
        if (stale()) return;

        if (ownership === "unknown") {
          // Can't tell yet: keep the session but expose no user, so
          // nothing owner-only runs, and re-check on a backoff.
          setState({ status: "error", user: null, profile: null, error: OWNER_UNVERIFIED });
          if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
          const delay = OWNER_RETRY_DELAYS_MS[retryAttemptRef.current];
          if (delay !== undefined) {
            retryAttemptRef.current += 1;
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              const latest = sessionRef.current;
              if (latest) void applySessionRef.current(latest);
            }, delay);
          }
          return;
        }

        if (ownership !== "owner") {
          // "denied" (another Google account) or "invalid" (the server
          // sees no usable session): drop the session from THIS browser
          // only — scope "local" never revokes the account's sessions
          // elsewhere — and carry on as a visitor.
          clearOwnerRetry();
          // Even scope "local" calls the server first and keeps the session
          // when that fails; signOutThisBrowser removes it regardless.
          if (supabase) await signOutThisBrowser(supabase, "local");
          // The SIGNED_OUT event has usually reset us already. Repeat it in
          // case sign-out failed, unless another account signed in meanwhile.
          if (userIdRef.current !== null && userIdRef.current !== user.id) return;
          userIdRef.current = null;
          sessionRef.current = null;
          seqRef.current += 1;
          setState(ANONYMOUS_STATE);
          if (ownership === "denied") toast.info(DENIED_MESSAGE);
          return;
        }

        const result = await profilePromise;
        if (stale()) return;
        verifiedUidRef.current = user.id;
        clearOwnerRetry();
        markOwnerSeen();
        if (result.kind === "ok") {
          setState({
            status: "authenticated",
            user,
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
            user,
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
            user,
            profile: prev.profile, // keep last-known-good profile if any
            error: result.message,
          }));
        }
      };

      const promise = verify();
      inflightRef.current = { uid: user.id, promise };
      try {
        await promise;
      } finally {
        if (inflightRef.current?.promise === promise) inflightRef.current = null;
      }
    },
    [loadProfile, supabase, clearOwnerRetry]
  );

  useEffect(() => {
    applySessionRef.current = applySession;
  }, [applySession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, []);

  // While the owner check is unanswered, also retry as soon as the
  // browser is back online or the tab is visible again.
  const ownerUnverified = state.status === "error" && state.error === OWNER_UNVERIFIED;
  useEffect(() => {
    if (!ownerUnverified) return;
    const retryNow = () => {
      if (document.visibilityState === "hidden") return;
      const latest = sessionRef.current;
      if (latest) void applySessionRef.current(latest);
    };
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", retryNow);
    return () => {
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", retryNow);
    };
  }, [ownerUnverified]);

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
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        void applySession(data.session ?? null);
      })
      .catch(() => {
        // Without this a rejected getSession() left status "loading"
        // forever. Settle as a visitor unless an auth event already
        // delivered a session.
        if (cancelled || userIdRef.current !== null) return;
        void applySession(null);
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

  const signOut = useCallback(async (): Promise<SignOutResult> => {
    if (!supabase) return { revoked: true, signedOutHere: true };
    // R10: try/finally — a failing sign-out previously left `rolePickerOpen`
    // true forever, freezing the dropdown in a "signing out" limbo.
    try {
      // supabase-js returns `{ error }` (never throws) and KEEPS the session
      // when the server call fails; signOutThisBrowser then removes it from
      // this browser anyway, and reports whether that worked.
      const result = await signOutThisBrowser(supabase);
      // After a forced local removal SIGNED_OUT may not have reached us:
      // settle as a visitor here too. If the session is somehow still in
      // this browser, keep the state truthful (still signed in) and let the
      // caller say so — never present a signed-out UI over a live session.
      if (result.signedOutHere) await applySession(null);
      return result;
    } finally {
      setRolePickerOpen(false);
    }
  }, [supabase, applySession]);

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
        // BUG-X1: throw so callers (e.g., RolePickerDialog) can show an
        // inline error instead of silently closing as if save succeeded.
        throw new Error(error.message);
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

/**
 * Same as `useAuth` but returns null instead of throwing when no
 * AuthProvider is mounted. Used by primitives that must work in
 * BOTH owner-side trees (AuthProvider present) and guest-side trees
 * (no AuthProvider — the (guest) layout renders bare).
 *
 * Callers should treat null as "auth subsystem unavailable; behave
 * as anonymous/solo".
 */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
