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
import { DEFAULT_PRINT_CARD_THEME, PRINT_CARD_THEMES } from "@/lib/kudos/print-cards";

/**
 * Catalog of the kudos themes: first the print campaign's six cards (the
 * four habits and the two open cards), which the picker offers, in their
 * printed colours with their printed ink; then the seven themes the user's
 * original HTML defined, which saved cards still carry, so they still render.
 *
 * The originals' colors are toolkit palette tokens (CSS vars + Tailwind),
 * not raw hexes — so light / dark / high-contrast themes all render
 * correctly. `headerBg` is for the card's header strip; `accent` drives the
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
  /** The header strip's text colour when it is fixed, as on the printed cards. */
  ink?: string;
  /** One of the original seven: shown on saved cards, no longer offered. */
  retired?: boolean;
}

/** The printed cards carry no emoji: the strip shows the habit or the open card's words. */
const PRINT_CARD_DEFS: KudosThemeDef[] = PRINT_CARD_THEMES.map((t) => ({
  id: t.id,
  title: t.title,
  emoji: "",
  // Page tokens for the picker chip; the printed colour is the card's own.
  accent: "text-text border-accent/40",
  headerBg: "",
  hex: t.colour,
  ink: t.ink,
}));

const RETIRED_THEMES: KudosThemeDef[] = [
  {
    id: "awesome",
    title: "Awesome",
    emoji: "💪",
    accent: "text-accent border-accent/40",
    // No class: bg-accent follows the page's theme, but the card keeps its own
    // cyan strip (and headerInk picks its words from this hex).
    headerBg: "",
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
    accent: "text-accent-3 border-accent-3/40",
    // The 600 shades here and on Well Done: on the 500s neither ink reached
    // 4.5:1 (best 4.46 and 4.47), and the compact card's title is small text.
    headerBg: "bg-violet-600",
    hex: "#7c3aed",
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
    accent: "text-accent-amber border-accent-amber/40",
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
    accent: "text-accent-2 border-accent-2/40",
    headerBg: "bg-indigo-600",
    hex: "#4f46e5",
  },
];

export const KUDOS_THEMES: ReadonlyArray<KudosThemeDef> = [
  ...PRINT_CARD_DEFS,
  ...RETIRED_THEMES.map((t) => ({ ...t, retired: true })),
];

/** What the picker offers: the printed cards. */
export const PICKER_THEMES: ReadonlyArray<KudosThemeDef> = KUDOS_THEMES.filter((t) => !t.retired);

/** The theme a new kudos starts on, and the card an unknown id shows as. */
export const DEFAULT_KUDOS_THEME = DEFAULT_PRINT_CARD_THEME;

const DARK_INK = "#111111";
const LIGHT_INK = "#ffffff";
/** For a mid-tone where neither ink above reaches AA; black and white always beat 4.5:1. */
const BLACK_INK = "#000000";
const AA = 4.5;

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
 * colour. A mid-tone where the better of the two still misses 4.5:1 gets
 * black, which the compact card's 18 px title needs. Like the card's other
 * print colours this is a literal, so the downloaded PNG looks the same
 * whatever the app's theme.
 */
export function headerInk(hex: string): string {
  const l = luminance(hex);
  if (l === null) return LIGHT_INK;
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / ((luminance(DARK_INK) ?? 0) + 0.05);
  if (Math.max(onWhite, onDark) >= AA) return onDark > onWhite ? DARK_INK : LIGHT_INK;
  return (l + 0.05) / 0.05 > onWhite ? BLACK_INK : LIGHT_INK;
}

/** Hash lookup for the theme catalog. Returns `undefined` for unknown ids. */
const THEMES_BY_ID: Record<string, KudosThemeDef> = Object.fromEntries(
  KUDOS_THEMES.map((t) => [t.id, t])
);

/** The header strip's ink: the printed one where fixed, else the better of dark and white. */
export function themeInk(theme: KudosThemeDef): string {
  return theme.ink ?? headerInk(theme.hex);
}

/**
 * Resolve the styling definition for a kudos theme. Accepts the original
 * id-string form (the seven built-ins) AND the Phase 0 custom-theme
 * object form — the latter ships its own emoji/hex inline so we synthesise
 * a definition on the fly without touching the catalog.
 */
export function getKudosTheme(theme: KudosTheme | string): KudosThemeDef {
  if (typeof theme === "string") {
    // Own keys only, so "constructor" isn't read off the prototype.
    return Object.prototype.hasOwnProperty.call(THEMES_BY_ID, theme)
      ? THEMES_BY_ID[theme]
      : THEMES_BY_ID[DEFAULT_KUDOS_THEME];
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
