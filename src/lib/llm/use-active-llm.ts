"use client";

import { useShallow } from "zustand/react/shallow";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import type { ProviderId } from "./types";
import { PROVIDER_META } from "./pricing";

export interface ActiveLlm {
  isReady: boolean;
  provider: ProviderId | null;
  providerName: string | null;
  model: string | null;
  openSettings: () => void;
}

/**
 * Single subscription that the run panel + status chip both use. Keeping it
 * shallow-selector-based means consumers don't re-render on changes to
 * other providers' keys or to UI-only flags.
 */
export function useActiveLlm(): ActiveLlm {
  const { activeProvider, providers } = useLlmStore(
    useShallow((s) => ({
      activeProvider: s.activeProvider,
      providers: s.providers,
    }))
  );
  const openSettings = useLlmUiStore((s) => s.openSettings);

  if (!activeProvider) {
    return {
      isReady: false,
      provider: null,
      providerName: null,
      model: null,
      openSettings,
    };
  }
  const cfg = providers[activeProvider];
  const hasKey = !!cfg && cfg.apiKey.length > 0;
  return {
    isReady: hasKey,
    provider: activeProvider,
    providerName: PROVIDER_META[activeProvider].name,
    model: cfg?.model ?? null,
    openSettings,
  };
}
