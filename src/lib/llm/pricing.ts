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
    // Listed newest → oldest so the dropdown surfaces current models first.
    // Aliased ids (without the date suffix) are used because Anthropic
    // resolves them server-side to the latest snapshot of each tier.
    // Pricing per https://www.anthropic.com/pricing — re-verify if drift.
    {
      id: "claude-opus-4-7",
      label: "Claude Opus 4.7",
      contextWindow: 200_000,
      inputPer1k: 0.015,
      outputPer1k: 0.075,
    },
    {
      id: "claude-sonnet-4-7",
      label: "Claude Sonnet 4.7",
      contextWindow: 1_000_000,
      inputPer1k: 0.003,
      outputPer1k: 0.015,
    },
    {
      id: "claude-haiku-4-7",
      label: "Claude Haiku 4.7",
      contextWindow: 200_000,
      inputPer1k: 0.0008,
      outputPer1k: 0.004,
    },
    {
      id: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      contextWindow: 200_000,
      inputPer1k: 0.015,
      outputPer1k: 0.075,
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      contextWindow: 200_000,
      inputPer1k: 0.003,
      outputPer1k: 0.015,
    },
    {
      id: "claude-haiku-4-6",
      label: "Claude Haiku 4.6",
      contextWindow: 200_000,
      inputPer1k: 0.0008,
      outputPer1k: 0.004,
    },
    {
      id: "claude-opus-4-5",
      label: "Claude Opus 4.5",
      contextWindow: 200_000,
      inputPer1k: 0.015,
      outputPer1k: 0.075,
    },
    {
      id: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      contextWindow: 200_000,
      inputPer1k: 0.003,
      outputPer1k: 0.015,
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      contextWindow: 200_000,
      inputPer1k: 0.0008,
      outputPer1k: 0.004,
    },
    {
      id: "claude-3-7-sonnet-latest",
      label: "Claude 3.7 Sonnet",
      contextWindow: 200_000,
      inputPer1k: 0.003,
      outputPer1k: 0.015,
    },
  ],
  openai: [
    // Listed newest → oldest. Pricing per https://openai.com/api/pricing —
    // re-verify if drift. Reasoning models (o-series) are charged the same
    // per token but typically consume more output tokens for the same task.
    {
      id: "gpt-5",
      label: "GPT-5",
      contextWindow: 400_000,
      inputPer1k: 0.00125,
      outputPer1k: 0.01,
    },
    {
      id: "gpt-5-mini",
      label: "GPT-5 mini",
      contextWindow: 400_000,
      inputPer1k: 0.00025,
      outputPer1k: 0.002,
    },
    {
      id: "gpt-5-nano",
      label: "GPT-5 nano",
      contextWindow: 400_000,
      inputPer1k: 0.00005,
      outputPer1k: 0.0004,
    },
    {
      id: "gpt-4.1",
      label: "GPT-4.1",
      contextWindow: 1_000_000,
      inputPer1k: 0.002,
      outputPer1k: 0.008,
    },
    {
      id: "gpt-4.1-mini",
      label: "GPT-4.1 mini",
      contextWindow: 1_000_000,
      inputPer1k: 0.0004,
      outputPer1k: 0.0016,
    },
    {
      id: "gpt-4.1-nano",
      label: "GPT-4.1 nano",
      contextWindow: 1_000_000,
      inputPer1k: 0.0001,
      outputPer1k: 0.0004,
    },
    {
      id: "o4-mini",
      label: "o4 mini (reasoning)",
      contextWindow: 200_000,
      inputPer1k: 0.0011,
      outputPer1k: 0.0044,
    },
    {
      id: "o3",
      label: "o3 (reasoning)",
      contextWindow: 200_000,
      inputPer1k: 0.002,
      outputPer1k: 0.008,
    },
    {
      id: "o3-mini",
      label: "o3 mini (reasoning)",
      contextWindow: 200_000,
      inputPer1k: 0.0011,
      outputPer1k: 0.0044,
    },
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
  ],
  gemini: [
    // Listed newest → oldest. Pricing per https://ai.google.dev/pricing —
    // re-verify if drift. Note: Gemini 2.5 Pro uses tiered pricing based on
    // prompt length; the figures below reflect the ≤200K-token tier.
    {
      id: "gemini-3-pro",
      label: "Gemini 3 Pro",
      contextWindow: 2_000_000,
      inputPer1k: 0.00125,
      outputPer1k: 0.01,
    },
    {
      id: "gemini-3-flash",
      label: "Gemini 3 Flash",
      contextWindow: 1_000_000,
      inputPer1k: 0.0003,
      outputPer1k: 0.0025,
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      contextWindow: 2_000_000,
      inputPer1k: 0.00125,
      outputPer1k: 0.01,
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      contextWindow: 1_000_000,
      inputPer1k: 0.0003,
      outputPer1k: 0.0025,
    },
    {
      id: "gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash-Lite",
      contextWindow: 1_000_000,
      inputPer1k: 0.0001,
      outputPer1k: 0.0004,
    },
    {
      id: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      contextWindow: 1_000_000,
      inputPer1k: 0.0001,
      outputPer1k: 0.0004,
    },
    {
      id: "gemini-2.0-flash-lite",
      label: "Gemini 2.0 Flash-Lite",
      contextWindow: 1_000_000,
      inputPer1k: 0.000075,
      outputPer1k: 0.0003,
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
    // Listed newest-first so the dropdown surfaces current models at the top.
    // Pricing is approximate USD conversion from Zhipu's CNY pricing page —
    // update against https://open.bigmodel.cn/pricing if numbers drift.
    // GLM-5.3 / GLM-5.3-Flash: Z.AI's USD list prices per
    // https://docs.z.ai/guides/overview/pricing (checked 2026-11-08):
    // $1.40 / $4.40 and $0.15 / $0.50 per 1M input / output tokens. The
    // context window isn't published there; 200K matches GLM-5.1.
    {
      id: "glm-5.3",
      label: "GLM-5.3",
      contextWindow: 200_000,
      inputPer1k: 0.0014,
      outputPer1k: 0.0044,
    },
    {
      id: "glm-5.3-flash",
      label: "GLM-5.3 Flash",
      contextWindow: 200_000,
      inputPer1k: 0.00015,
      outputPer1k: 0.0005,
    },
    {
      id: "glm-5.1",
      label: "GLM-5.1",
      contextWindow: 200_000,
      inputPer1k: 0.001,
      outputPer1k: 0.004,
    },
    {
      id: "glm-5",
      label: "GLM-5",
      contextWindow: 200_000,
      inputPer1k: 0.001,
      outputPer1k: 0.004,
    },
    {
      id: "glm-4.7",
      label: "GLM-4.7",
      contextWindow: 200_000,
      inputPer1k: 0.0008,
      outputPer1k: 0.003,
    },
    {
      id: "glm-4.6",
      label: "GLM-4.6",
      contextWindow: 200_000,
      inputPer1k: 0.0006,
      outputPer1k: 0.0022,
    },
    {
      id: "glm-4.5",
      label: "GLM-4.5",
      contextWindow: 128_000,
      inputPer1k: 0.0005,
      outputPer1k: 0.002,
    },
    {
      id: "glm-4.5-air",
      label: "GLM-4.5 Air",
      contextWindow: 128_000,
      inputPer1k: 0.0001,
      outputPer1k: 0.0004,
    },
    {
      id: "glm-4.5-flash",
      label: "GLM-4.5 Flash",
      contextWindow: 128_000,
      inputPer1k: 0,
      outputPer1k: 0,
    },
    {
      id: "glm-4-plus",
      label: "GLM-4 Plus",
      contextWindow: 128_000,
      inputPer1k: 0.007,
      outputPer1k: 0.007,
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
  // Defaults bias toward the cheap, fast, current-gen model in each family
  // so a first-time user's first Run doesn't surprise them with a flagship
  // bill. Power users can switch to a bigger model in two clicks.
  anthropic: "claude-haiku-4-7",
  openai: "gpt-5-mini",
  gemini: "gemini-2.5-flash",
  glm: "glm-5.1",
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
