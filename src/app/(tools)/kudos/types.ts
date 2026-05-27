/**
 * Kudos tool — theme catalog + runtime validators.
 *
 * Lives in a dedicated file because both the owner-side client and the
 * guest-side client import it, plus the runtime guard used by the
 * realtime sync hook to gate incoming peer broadcasts.
 */

import type { Kudos, KudosTheme } from "@/lib/stores/workspace-types";

/**
 * Catalog of the seven kudos themes the user's original HTML defined.
 *
 * Colors are toolkit palette tokens (CSS vars + Tailwind), not raw
 * hexes — so light / dark / high-contrast themes all render correctly.
 * The `gradient` is for the card's header strip; `accent` drives the
 * surrounding border + emoji-chip badge.
 */
export interface KudosThemeDef {
  id: KudosTheme;
  title: string;
  emoji: string;
  /** Tailwind text/border color class for the accent stripe + emoji halo. */
  accent: string;
  /** Tailwind background class for the card header strip. */
  headerBg: string;
  /** Hex value used by the PNG-export path; mirrors the Tailwind class. */
  hex: string;
}

export const KUDOS_THEMES: ReadonlyArray<KudosThemeDef> = [
  {
    id: "awesome",
    title: "Awesome",
    emoji: "💪",
    accent: "text-accent border-accent/40",
    headerBg: "bg-accent",
    hex: "#00f0ff",
  },
  {
    id: "thank-you",
    title: "Thank You",
    emoji: "🙏",
    accent: "text-emerald-400 border-emerald-400/40",
    headerBg: "bg-emerald-500",
    hex: "#10b981",
  },
  {
    id: "great-job",
    title: "Great Job",
    emoji: "👏",
    accent: "text-violet-400 border-violet-400/40",
    headerBg: "bg-violet-500",
    hex: "#8b5cf6",
  },
  {
    id: "congratulations",
    title: "Congratulations",
    emoji: "🎉",
    accent: "text-amber-400 border-amber-400/40",
    headerBg: "bg-amber-500",
    hex: "#f59e0b",
  },
  {
    id: "very-happy",
    title: "Very Happy",
    emoji: "😄",
    accent: "text-orange-400 border-orange-400/40",
    headerBg: "bg-orange-500",
    hex: "#fb923c",
  },
  {
    id: "you-rock",
    title: "You Rock!",
    emoji: "🤘",
    accent: "text-red-400 border-red-400/40",
    headerBg: "bg-red-500",
    hex: "#ef4444",
  },
  {
    id: "well-done",
    title: "Well Done",
    emoji: "👍",
    accent: "text-indigo-400 border-indigo-400/40",
    headerBg: "bg-indigo-500",
    hex: "#6366f1",
  },
];

/** Hash lookup for the theme catalog. Returns `undefined` for unknown ids. */
const THEMES_BY_ID: Record<string, KudosThemeDef> = Object.fromEntries(
  KUDOS_THEMES.map((t) => [t.id, t])
);

export function getKudosTheme(id: string): KudosThemeDef {
  return THEMES_BY_ID[id] ?? KUDOS_THEMES[0];
}

/**
 * Validation limits matching the original HTML's UX. The store-level
 * validator in workspace-store.upsertKudos allows up to 2000 chars on
 * `message` as a defensive ceiling against a peer broadcasting a giant
 * payload, but the UI keeps users to the friendly 50-word / 2-word caps.
 */
export const KUDOS_WORD_LIMITS = {
  to: 4, // recipient display name — was 2 in the original; squad profile names go up to ~3 words
  from: 4, // sender display name — squad profile names
  team: 3, // optional team label
  message: 50,
} as const;

const SHORT_TEXT_MAX = 80;
const MESSAGE_CHAR_MAX = 2000;

/**
 * Count words in a string. Whitespace-collapsed split; empty input → 0.
 * Matches the original HTML's behavior so word-count UX is identical.
 */
export function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const VALID_THEMES = new Set<KudosTheme>(KUDOS_THEMES.map((t) => t.id));

/**
 * Defensive shape guard for incoming `kudos:created` / `kudos:snapshot`
 * realtime broadcasts. A peer can send anything — a buggy build, a
 * hostile client, a stale-format event from an old tab. We accept ONLY
 * the expected shape and reject everything else.
 *
 * Field caps deliberately match `workspace-store.upsertKudos` so a
 * payload that survives realtime validation also survives the store
 * write. Keep these two in sync.
 */
export function isValidKudos(raw: unknown): raw is Kudos {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 64) return false;
  if (typeof r.theme !== "string" || !VALID_THEMES.has(r.theme as KudosTheme)) return false;
  if (typeof r.toName !== "string" || r.toName.length === 0 || r.toName.length > SHORT_TEXT_MAX)
    return false;
  if (
    typeof r.fromName !== "string" ||
    r.fromName.length === 0 ||
    r.fromName.length > SHORT_TEXT_MAX
  )
    return false;
  if (
    typeof r.message !== "string" ||
    r.message.length === 0 ||
    r.message.length > MESSAGE_CHAR_MAX
  )
    return false;
  if (typeof r.sentAt !== "string" || r.sentAt.length === 0 || r.sentAt.length > 64) return false;
  // Reject sentAt strings that parse to Invalid Date (e.g. "lol",
  // "yesterday") — without this they survive the length-check, land
  // on the wall, and the card renders the literal "Invalid Date".
  // Also reject far-future timestamps (>5 min ahead, clock-skew
  // tolerance) so a peer can't backdate-bomb the wall.
  const sentAtMs = Date.parse(r.sentAt);
  if (!Number.isFinite(sentAtMs)) return false;
  if (sentAtMs > Date.now() + 5 * 60 * 1000) return false;
  // Optional fields — type-only checks; the absence is fine.
  if (
    r.toProfileId !== undefined &&
    (typeof r.toProfileId !== "string" || r.toProfileId.length > 64)
  )
    return false;
  if (
    r.fromProfileId !== undefined &&
    (typeof r.fromProfileId !== "string" || r.fromProfileId.length > 64)
  )
    return false;
  if (
    r.teamName !== undefined &&
    (typeof r.teamName !== "string" || r.teamName.length > SHORT_TEXT_MAX)
  )
    return false;
  return true;
}

/** Workspace-wide channel: one kudos wall per workspace. */
export const KUDOS_ENTITY_ID = "workspace" as const;
export const KUDOS_TOOL_ID = "kudos" as const;
