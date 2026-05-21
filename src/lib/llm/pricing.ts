/**
 * Per-provider model catalog + cost estimation.
 *
 * Loaded only by the settings dialog and the run panel — both of which are
 * dynamic-imported — so this stays out of the eager bundle.
 *
 * Prices are USD per 1K tokens, captured from each provider's public pricing
 * page. They drift over time and serve only the upfront estimate — actual
 * billing comes from the provider's invoice.
 */

import type { ModelInfo, ProviderId } from "./types";

export const MODELS_BY_PROVIDER: Record<ProviderId, readonly ModelInfo[]> = {
  anthropic: [
    {
      id: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      contextWindow: 200_000,
      inputPer1k: 0.003,
      outputPer1k: 0.015,
    },
    {
      id: "claude-opus-4-5",
      label: "Claude Opus 4.5",
      contextWindow: 200_000,
      inputPer1k: 0.015,
      outputPer1k: 0.075,
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      contextWindow: 200_000,
      inputPer1k: 0.0008,
      outputPer1k: 0.004,
    },
  ],
  openai: [
    {
      id: "gpt-4o",
      label: "GPT-4o",
      contextWindow: 128_000,
      inputPer1k: 0.0025,
      outputPer1k: 0.01,
    },
    {
      id: "gpt-4o-mini",
      label: "GPT-4o mini",
      contextWindow: 128_000,
      inputPer1k: 0.00015,
      outputPer1k: 0.0006,
    },
    {
      id: "o3-mini",
      label: "o3 mini",
      contextWindow: 200_000,
      inputPer1k: 0.0011,
      outputPer1k: 0.0044,
    },
  ],
  gemini: [
    {
      id: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      contextWindow: 1_000_000,
      inputPer1k: 0.0001,
      outputPer1k: 0.0004,
    },
    {
      id: "gemini-1.5-pro",
      label: "Gemini 1.5 Pro",
      contextWindow: 2_000_000,
      inputPer1k: 0.00125,
      outputPer1k: 0.005,
    },
  ],
  glm: [
    {
      id: "glm-4-plus",
      label: "GLM-4 Plus",
      contextWindow: 128_000,
      inputPer1k: 0.0070, // approximate USD conversion from CNY pricing
      outputPer1k: 0.0070,
    },
    {
      id: "glm-4-air",
      label: "GLM-4 Air",
      contextWindow: 128_000,
      inputPer1k: 0.0001,
      outputPer1k: 0.0001,
    },
    {
      id: "glm-4-flash",
      label: "GLM-4 Flash",
      contextWindow: 128_000,
      inputPer1k: 0,
      outputPer1k: 0,
    },
  ],
};

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  glm: "glm-4-flash",
};

/** Static UI metadata — names, websites. Safe to load eagerly. */
export const PROVIDER_META: Record<
  ProviderId,
  { name: string; website: string; keyHelpUrl: string; keyPrefix?: string }
> = {
  anthropic: {
    name: "Claude",
    website: "https://www.anthropic.com",
    keyHelpUrl: "https://console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant-",
  },
  openai: {
    name: "OpenAI",
    website: "https://openai.com",
    keyHelpUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
  },
  gemini: {
    name: "Gemini",
    website: "https://ai.google.dev",
    keyHelpUrl: "https://aistudio.google.com/app/apikey",
  },
  glm: {
    name: "GLM (Zhipu)",
    website: "https://open.bigmodel.cn",
    keyHelpUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
};

/** Rough token estimate from raw text — `length/4` is the standard heuristic
 *  for English and slightly under-counts CJK. Good enough for a pre-send
 *  cost preview; the provider returns exact counts on response. */
export function estimateInputTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function findModel(provider: ProviderId, modelId: string): ModelInfo | undefined {
  return MODELS_BY_PROVIDER[provider].find((m) => m.id === modelId);
}

export function estimateCostUsd(
  provider: ProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const model = findModel(provider, modelId);
  if (!model) return 0;
  const inCost = (inputTokens / 1000) * model.inputPer1k;
  const outCost = (outputTokens / 1000) * model.outputPer1k;
  return inCost + outCost;
}

/** Formats a USD cost into a tight string for the UI (≤3 sig figs).
 *  Uses "<$0.001" for amounts that would otherwise show as "$0.000". */
export function formatCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
