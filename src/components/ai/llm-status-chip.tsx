"use client";

import { Sparkles, SparklesIcon } from "lucide-react";
import { useMounted } from "@/hooks/use-mounted";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { cn } from "@/lib/utils";

/**
 * Header status chip mirroring `SonificationToggle` ergonomics — same
 * 8×8 footprint, same hover affordance, same `hidden sm:flex` wrapper
 * point (mounted by header.tsx).
 *
 * Click opens the settings dialog via `llm-ui-store`. Returns null until
 * mounted so the SSR pass and the first client render produce identical
 * markup — the chip's label switches between "AI: Off" and "AI: Claude"
 * based on the LLM store, which is `skipHydration: true` and therefore
 * not safe to read on the server pass.
 */
export function LlmStatusChip() {
  const mounted = useMounted();
  const { isReady, providerName, model, openSettings } = useActiveLlm();

  const tooltip = !mounted
    ? undefined
    : isReady
      ? `AI: ${providerName}${model ? ` (${model})` : ""} — click to manage`
      : "AI: Off — click to configure your own API key";

  return (
    <button
      type="button"
      onClick={openSettings}
      data-no-sound="true"
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        "min-touch-coarse w-8 h-8 rounded-lg flex items-center justify-center",
        "text-sub hover:text-accent hover:bg-accent/5",
        "transition-all duration-fast",
        mounted && isReady && "text-accent"
      )}
    >
      {!mounted ? (
        // Placeholder so layout doesn't shift when chip mounts and the
        // active-state icon swaps in.
        <div className="w-4 h-4" aria-hidden="true" />
      ) : isReady ? (
        <SparklesIcon className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Sparkles className="w-4 h-4 opacity-60" aria-hidden="true" />
      )}
    </button>
  );
}
