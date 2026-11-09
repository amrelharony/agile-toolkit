"use client";

import { Sparkles, SparklesIcon } from "lucide-react";
import { useMounted } from "@/hooks/use-mounted";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { useAgentBackend } from "@/lib/agent/use-agent-backend";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { cn } from "@/lib/utils";

/** How the header names the server agent's backend (the route's GET `provider`). */
const SERVER_PROVIDER_NAME: Record<string, string> = {
  openclaw: "OpenClaw · GLM-5.3",
  glm: "GLM",
  zai: "Z.AI",
};

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
  const byok = useActiveLlm();
  // The server agent is owner-only; visitors see their own BYOK state.
  const backend = useAgentBackend({ enabled: useIsOwner() });

  // The agent is "on" when either a BYOK key is configured OR the server has a
  // backend (OpenClaw/GLM). BYOK takes precedence in the label since it's the
  // user's explicit override.
  const serverActive = backend?.mode === "server";
  const isReady = byok.isReady || serverActive;
  const providerName = byok.isReady
    ? byok.providerName
    : serverActive
      ? (SERVER_PROVIDER_NAME[backend?.provider ?? ""] ?? "Server")
      : null;
  const model = byok.isReady ? byok.model : serverActive ? backend?.model : null;
  const openSettings = byok.openSettings;

  const tooltip = !mounted
    ? undefined
    : isReady
      ? `AI: ${providerName}${model ? ` (${model})` : ""}${
          !byok.isReady && serverActive ? " (server-side)" : ""
        } — click to manage`
      : "AI: Off — click to configure your own API key";

  return (
    <button
      type="button"
      onClick={openSettings}
      data-no-sound="true"
      title={tooltip}
      // The tooltip depends on client-only state; keep the button named
      // in the server render too.
      aria-label={tooltip ?? "AI settings"}
      aria-haspopup="dialog"
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
