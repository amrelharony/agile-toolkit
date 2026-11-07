/**
 * Kudos tool — word limits + tool-scoped re-exports.
 *
 * Lives in a dedicated file because both the owner-side client and the
 * guest-side client import it. The runtime shape guard used by the wire,
 * the store, and JSON import lives in `src/lib/kudos/parse.ts` — this
 * file re-exports it so historic call sites keep compiling. The cards
 * themselves (which printed card a kudos is drawn as, its colours and
 * words) live in `src/lib/kudos/card-designs.ts`.
 */

import type { Kudos } from "@/lib/stores/workspace-types";
import { isValidKudos as canonicalIsValidKudos, parseKudos } from "@/lib/kudos/parse";

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
