/**
 * Kudos tool — theme catalog + tool-scoped re-exports.
 *
 * Lives in a dedicated file because both the owner-side client and the
 * guest-side client import it. The runtime shape guard used by the wire,
 * the store, and JSON import lives in `src/lib/kudos/parse.ts` — this
 * file re-exports it so historic call sites keep compiling.
 */

import type { Kudos, KudosBuiltInTheme, KudosTheme } from "@/lib/stores/workspace-types";
import { isValidKudos as canonicalIsValidKudos, parseKudos } from "@/lib/kudos/parse";

/**
 * Catalog of the seven kudos themes the user's original HTML defined.
 *
 * Colors are toolkit palette tokens (CSS vars + Tailwind), not raw
 * hexes — so light / dark / high-contrast themes all render correctly.
 * The `gradient` is for the card's header strip; `accent` drives the
 * surrounding border + emoji-chip badge.
 */
export interface KudosThemeDef {
  /**
   * Built-in theme id. The catalog only carries the seven shipped
   * themes; custom themes synthesised by Phase 3's LLM (or the Phase 5
   * settings UI) ride alongside as `KudosCustomTheme` objects on the
   * Kudos row itself and resolve their styling inline at render time.
   */
  id: KudosBuiltInTheme;
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
    accent: "text-success border-success/40",
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
    accent: "text-warning border-warning/40",
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
    accent: "text-danger border-danger/40",
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

const DARK_INK = "#111111";
const LIGHT_INK = "#ffffff";

/** WCAG relative luminance of a `#rgb` / `#rrggbb` colour, or null when it isn't one. */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The header strip's text colour: near-black or white, whichever has the
 * higher contrast on the theme's colour. White on Awesome's cyan or
 * Congratulations' amber read at under 2.2:1, and a custom theme can be any
 * colour. Like the card's other print colours this is a literal, so the
 * downloaded PNG looks the same whatever the app's theme.
 */
export function headerInk(hex: string): string {
  const l = luminance(hex);
  if (l === null) return LIGHT_INK;
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / ((luminance(DARK_INK) ?? 0) + 0.05);
  return onDark > onWhite ? DARK_INK : LIGHT_INK;
}

/** Hash lookup for the theme catalog. Returns `undefined` for unknown ids. */
const THEMES_BY_ID: Record<string, KudosThemeDef> = Object.fromEntries(
  KUDOS_THEMES.map((t) => [t.id, t])
);

/**
 * Resolve the styling definition for a kudos theme. Accepts the original
 * id-string form (the seven built-ins) AND the Phase 0 custom-theme
 * object form — the latter ships its own emoji/hex inline so we synthesise
 * a definition on the fly without touching the catalog.
 */
export function getKudosTheme(theme: KudosTheme | string): KudosThemeDef {
  if (typeof theme === "string") {
    return THEMES_BY_ID[theme] ?? KUDOS_THEMES[0];
  }
  return {
    id: theme.id as KudosBuiltInTheme,
    title: theme.title,
    emoji: theme.emoji,
    // Custom themes don't ship Tailwind classes — the render path uses
    // inline styles for the header strip + accent ring when a hex is the
    // only signal we have.
    accent: "border-border",
    headerBg: "",
    hex: theme.hex,
  };
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

/**
 * Count words in a string. Whitespace-collapsed split; empty input → 0.
 * Matches the original HTML's behavior so word-count UX is identical.
 */
export function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Defensive shape guard for incoming `kudos:created` / `kudos:snapshot`
 * realtime broadcasts. Delegates to the canonical `parseKudos` in
 * `src/lib/kudos/parse.ts` so the wire, the store, and any future cloud-
 * hydrate path share one shape contract. The boolean-guard form lives
 * here for historic call sites that don't need the error code.
 */
export const isValidKudos: (raw: unknown) => raw is Kudos = canonicalIsValidKudos;

export { parseKudos };
export type { KudosParseResult } from "@/lib/kudos/parse";

/** Workspace-wide channel: one kudos wall per workspace. */
export const KUDOS_ENTITY_ID = "workspace" as const;
export const KUDOS_TOOL_ID = "kudos" as const;
