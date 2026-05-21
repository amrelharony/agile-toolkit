/**
 * Lazy adapter registry. Each adapter module is dynamic-imported so it only
 * lands in the bundle when the user actually opens the settings dialog OR
 * runs a prompt — non-AI users pay zero.
 *
 * The static `ADAPTER_META` block (provider id → name/website) is safe to
 * load eagerly: it's tiny and lets the status chip render the provider name
 * without forcing the full adapter into the eager bundle.
 */

import type { LlmAdapter, ProviderId } from "./types";

export { PROVIDER_META, MODELS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER } from "./pricing";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "glm",
] as const;

/**
 * Return the adapter implementation for a provider, dynamic-importing the
 * underlying module on first use. Subsequent calls reuse the same Promise
 * (Webpack/Turbopack caches ESM modules, so this is effectively memoised
 * after the first resolution).
 */
export async function getAdapter(id: ProviderId): Promise<LlmAdapter> {
  switch (id) {
    case "anthropic": {
      const mod = await import("./adapters/anthropic");
      return mod.anthropicAdapter;
    }
    case "openai": {
      const mod = await import("./adapters/openai-compatible");
      return mod.openaiAdapter;
    }
    case "glm": {
      const mod = await import("./adapters/openai-compatible");
      return mod.glmAdapter;
    }
    case "gemini": {
      const mod = await import("./adapters/gemini");
      return mod.geminiAdapter;
    }
  }
}
