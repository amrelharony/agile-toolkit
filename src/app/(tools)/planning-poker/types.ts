/**
 * Shared types for Planning Poker.
 *
 * Lives in its own module because both the owner-side client and the
 * guest-side client import them, plus the runtime validator that gates
 * incoming realtime state-sync payloads.
 */

export type ScaleType = "fibonacci" | "tshirt" | "custom";

export const SCALES: Record<ScaleType, string[]> = {
  fibonacci: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
  tshirt: ["XS", "S", "M", "L", "XL", "XXL", "?"],
  custom: [],
};

export const SCALE_LABELS: Record<ScaleType, string> = {
  fibonacci: "Fibonacci",
  tshirt: "T-Shirt",
  custom: "Custom",
};

export interface Participant {
  id: string;
  name: string;
  vote: string | null;
}

export interface Story {
  id: string;
  title: string;
  description?: string;
  finalEstimate: string | null;
  /** The revealed votes of each finished round, oldest first and sorted
   *  low to high, so a re-voted story keeps the first round's spread. */
  rounds?: string[][];
}

/** Rounds kept per story; older ones drop off. */
export const MAX_ROUNDS = 10;

export interface Session {
  roomCode: string;
  sessionName: string;
  scale: string[];
  scaleType: ScaleType;
  /** Display name of the host (the person who started the session). */
  host: string;
  /** Participant id of the host — the canonical "who can mutate
   *  host-only fields" check. The display-name `host` field stays
   *  around for label rendering, but authorization uses the id so two
   *  guests with the same display name can't impersonate the host. */
  hostId: string;
  participants: Participant[];
  stories: Story[];
  currentStoryIdx: number;
  revealed: boolean;
}

/**
 * Defensive shape validator for incoming realtime state-sync payloads.
 *
 * A peer can in principle send anything on the channel — a buggy build,
 * a browser extension, or an outright hostile client. We refuse anything
 * that doesn't match the Session shape rather than letting it crash the
 * receiver mid-render. Caps on every string length are intentional: a
 * 50 MB title would otherwise survive broadcast and freeze every
 * receiver's React reconciliation.
 */
export function isValidSession(raw: unknown): raw is Session {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.roomCode !== "string" || r.roomCode.length < 4 || r.roomCode.length > 32)
    return false;
  if (typeof r.sessionName !== "string" || r.sessionName.length > 200) return false;
  if (typeof r.scaleType !== "string" || !["fibonacci", "tshirt", "custom"].includes(r.scaleType))
    return false;
  if (typeof r.host !== "string" || r.host.length < 1 || r.host.length > 80) return false;
  if (typeof r.hostId !== "string" || r.hostId.length < 1 || r.hostId.length > 64) return false;
  if (
    typeof r.currentStoryIdx !== "number" ||
    !Number.isInteger(r.currentStoryIdx) ||
    r.currentStoryIdx < 0 ||
    r.currentStoryIdx > 500
  )
    return false;
  if (typeof r.revealed !== "boolean") return false;
  if (!Array.isArray(r.scale) || r.scale.length === 0 || r.scale.length > 32) return false;
  for (const s of r.scale) {
    if (typeof s !== "string" || s.length === 0 || s.length > 32) return false;
  }
  if (!Array.isArray(r.participants) || r.participants.length > 100) return false;
  for (const p of r.participants) {
    if (!p || typeof p !== "object") return false;
    const pr = p as Record<string, unknown>;
    if (typeof pr.id !== "string" || pr.id.length === 0 || pr.id.length > 64) return false;
    if (typeof pr.name !== "string" || pr.name.length === 0 || pr.name.length > 80) return false;
    if (pr.vote !== null && (typeof pr.vote !== "string" || pr.vote.length > 32)) return false;
  }
  if (!Array.isArray(r.stories) || r.stories.length > 500) return false;
  for (const s of r.stories) {
    if (!s || typeof s !== "object") return false;
    const st = s as Record<string, unknown>;
    if (typeof st.id !== "string" || st.id.length === 0 || st.id.length > 64) return false;
    if (typeof st.title !== "string" || st.title.length === 0 || st.title.length > 500)
      return false;
    if (
      st.description !== undefined &&
      (typeof st.description !== "string" || st.description.length > 5000)
    )
      return false;
    if (
      st.finalEstimate !== null &&
      (typeof st.finalEstimate !== "string" || st.finalEstimate.length > 32)
    )
      return false;
    if (st.rounds !== undefined) {
      if (!Array.isArray(st.rounds) || st.rounds.length > MAX_ROUNDS) return false;
      for (const round of st.rounds) {
        if (!Array.isArray(round) || round.length > 100) return false;
        for (const v of round) {
          if (typeof v !== "string" || v.length === 0 || v.length > 32) return false;
        }
      }
    }
  }
  return true;
}
