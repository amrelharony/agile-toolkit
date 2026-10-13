import type { User } from "@supabase/supabase-js";

export const SCRUM_ROLES = [
  "scrum_master",
  "product_owner",
  "developer",
  "tester",
  "stakeholder",
] as const;

export type ScrumRole = (typeof SCRUM_ROLES)[number];

export const SCRUM_ROLE_LABEL: Record<ScrumRole, string> = {
  scrum_master: "Scrum Master",
  product_owner: "Product Owner",
  developer: "Developer",
  tester: "Tester / QA",
  stakeholder: "Stakeholder",
};

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  email_verified: boolean;
  scrum_role: ScrumRole | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export type AuthStatus =
  | "disabled" // Supabase env vars missing — anonymous-only mode
  | "loading" // session check in flight
  | "anonymous" // hydrated, no session
  | "authenticated" // hydrated, session present
  | "error";

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  profile: Profile | null;
  error: string | null;
}

export interface SignOutResult {
  /** The server ended the session(s). False when the call failed or hung. */
  revoked: boolean;
  /** No session is left in this browser (removed locally if need be). */
  signedOutHere: boolean;
}

export interface AuthActions {
  signInWithGoogle: () => Promise<void>;
  /** Never throws; see SignOutResult. */
  signOut: () => Promise<SignOutResult>;
  updateProfile: (patch: Partial<Pick<Profile, "scrum_role" | "display_name">>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export type AuthContextValue = AuthState & AuthActions;
