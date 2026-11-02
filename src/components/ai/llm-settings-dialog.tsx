"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { DEFAULT_MODEL_BY_PROVIDER, MODELS_BY_PROVIDER, PROVIDER_META } from "@/lib/llm/pricing";
import { getAdapter, PROVIDER_IDS } from "@/lib/llm/registry";
import type { ProviderId } from "@/lib/llm/types";
import { isLlmError } from "@/lib/llm/types";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils";

/**
 * BYOK settings dialog. Tabs across the top for each supported provider;
 * within each tab the user pastes a key, picks a model, optionally tests
 * the key, and saves.
 *
 * Mounted once at the AppShell level. Open/close state lives in
 * `llm-ui-store` so both the header chip and UserMenu entry can flip it
 * without prop-drilling.
 */
export function LlmSettingsDialog() {
  const settingsOpen = useLlmUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useLlmUiStore((s) => s.setSettingsOpen);
  const {
    storageMode,
    providers,
    activeProvider,
    maxOutputTokens,
    setStorageMode,
    setProvider,
    removeProvider,
    setActiveProvider,
    setMaxOutputTokens,
  } = useLlmStore();

  // Drive the visible tab from the active provider when the dialog opens,
  // falling back to anthropic. Local state so flipping tabs doesn't write
  // anything to the store until the user saves.
  const [tab, setTab] = useState<ProviderId>(activeProvider ?? "anthropic");
  useEffect(() => {
    if (settingsOpen) setTab(activeProvider ?? "anthropic");
  }, [settingsOpen, activeProvider]);

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-2xl bg-bg border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text">
            <Sparkles className="w-5 h-5 text-accent" />
            Bring your own AI key
          </DialogTitle>
          <DialogDescription className="text-sub">
            Paste a key from any supported provider to run the toolkit&apos;s prompts directly.
            Copy-paste keeps working with or without a key.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ProviderId)}>
          {/*
           * `grid-cols-4` previously forced four equal columns regardless
           * of viewport — at 320 px each tab clamped to ~70 px and the
           * provider names "Anthropic" / "Mistral" truncated. The shared
           * TabsList now supplies overflow-x-auto + shrink-0 triggers, so
           * the natural-width labels swipe horizontally on narrow screens
           * and sit comfortably side-by-side on wider ones.
           */}
          <TabsList className="w-full bg-surface border border-border justify-start gap-1">
            {PROVIDER_IDS.map((id) => {
              const configured = !!providers[id]?.apiKey;
              return (
                <TabsTrigger key={id} value={id} className="relative flex-1 sm:flex-initial">
                  {PROVIDER_META[id].name}
                  {configured && (
                    // aria-label on a bare span is ignored by screen readers;
                    // the dot is decorative and the state is spoken via sr-only text.
                    <>
                      <span
                        className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                      <span className="sr-only"> (configured)</span>
                    </>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {PROVIDER_IDS.map((id) => (
            <TabsContent key={id} value={id} className="mt-4">
              <ProviderPanel
                providerId={id}
                isActive={activeProvider === id}
                existing={providers[id]}
                onSave={(apiKey, model) => {
                  setProvider(id, apiKey, model);
                  setActiveProvider(id);
                  toast.success(`${PROVIDER_META[id].name} configured`);
                }}
                onClear={() => {
                  removeProvider(id);
                  toast.success(`${PROVIDER_META[id].name} key cleared`);
                }}
                onMakeActive={() => {
                  setActiveProvider(id);
                  toast.success(`${PROVIDER_META[id].name} now active`);
                }}
              />
            </TabsContent>
          ))}
        </Tabs>

        <div className="rounded-lg border border-border bg-surface p-4 space-y-3 text-xs text-sub">
          <div>
            {/* Not a <Label>: there's no single control to label — it names the
                group of storage choices below. Same look as the Label primitive. */}
            <span id="llm-key-storage-label" className="text-xs font-medium leading-none text-text">
              Key storage
            </span>
            <div
              role="group"
              aria-labelledby="llm-key-storage-label"
              className="mt-2 flex flex-col sm:flex-row gap-2"
            >
              <button
                type="button"
                onClick={() => setStorageMode("session")}
                aria-pressed={storageMode === "session"}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-left text-xs transition",
                  storageMode === "session"
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border bg-surface-deep hover:border-accent/30"
                )}
              >
                <div className="font-semibold">Session only</div>
                <div className="text-xs mt-0.5 opacity-80">
                  Cleared when you close this tab. Safest default.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setStorageMode("device")}
                aria-pressed={storageMode === "device"}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-left text-xs transition",
                  storageMode === "device"
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border bg-surface-deep hover:border-accent/30"
                )}
              >
                <div className="font-semibold">This device</div>
                <div className="text-xs mt-0.5 opacity-80">
                  Survives reload. Any extension or XSS in this app can read it.
                </div>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="llm-max-tokens" className="text-xs text-text shrink-0">
              Max output tokens per call
            </Label>
            {/* BUG-X2: hold a local string draft, commit on blur. The
                prior per-keystroke `setMaxOutputTokens(Number(...))`
                triggered the store's clamp(64, 8192) on every key, so
                typing "100" → store snapped to 64 → field re-renders
                to "64" → the user can never reach a 3-digit value
                below 640 without backspacing through the clamp. */}
            <MaxTokensField
              id="llm-max-tokens"
              value={maxOutputTokens}
              onCommit={setMaxOutputTokens}
            />
            <span className="text-xs text-sub">caps cost per request</span>
          </div>

          <p className="text-xs leading-relaxed">
            Your key is stored only in this browser. Requests go directly from your browser to the
            provider — they never touch the toolkit&apos;s servers. Any browser extension or XSS in
            this app could read your key. Use session mode for the strongest default.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProviderPanelProps {
  providerId: ProviderId;
  isActive: boolean;
  existing?: { apiKey: string; model: string };
  onSave: (apiKey: string, model: string) => void;
  onClear: () => void;
  onMakeActive: () => void;
}

const CUSTOM_MODEL_VALUE = "__custom__";

/**
 * BUG-X2: Max-output-tokens input that holds a local string draft and
 * only commits to the (clamping) store on blur / Enter. Without this,
 * the store's `setMaxOutputTokens` clamp(64, 8192) fires on every
 * keystroke and snaps a partial value like "1" → 64, so the user can
 * never type a 3-digit value below 640.
 */
function MaxTokensField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  // Re-sync if parent value changes (reset, external update).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(8192, Math.max(64, Math.round(n)));
    onCommit(clamped);
    setDraft(String(clamped));
  };
  return (
    <Input
      id={id}
      type="number"
      min={64}
      max={8192}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="bg-surface-deep border-border w-28 text-text font-data"
    />
  );
}

function ProviderPanel({
  providerId,
  isActive,
  existing,
  onSave,
  onClear,
  onMakeActive,
}: ProviderPanelProps) {
  const meta = PROVIDER_META[providerId];
  const models = MODELS_BY_PROVIDER[providerId];
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");
  const [model, setModel] = useState(existing?.model ?? DEFAULT_MODEL_BY_PROVIDER[providerId]);
  // Custom-model escape hatch — when a user has saved a model id not in
  // the dropdown (e.g., a brand-new GLM release that shipped after this
  // table was last refreshed), the Select shows a "Custom…" entry and a
  // free-text input appears.
  const isExistingModelInList = (mid: string) => models.some((m) => m.id === mid);
  const [customMode, setCustomMode] = useState(
    !!existing?.model && !isExistingModelInList(existing.model)
  );
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  // Re-sync local state when the user flips to this tab and there's a
  // different stored value (e.g., after saving on another tab).
  useEffect(() => {
    const stored = existing?.model ?? DEFAULT_MODEL_BY_PROVIDER[providerId];
    setApiKey(existing?.apiKey ?? "");
    setModel(stored);
    setCustomMode(!!existing?.model && !isExistingModelInList(existing.model));
    setTestResult(null);
    // existing.apiKey + .model already cover what we need; isExistingModelInList
    // is a stable function of `models` which is per-tab and constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.apiKey, existing?.model, providerId]);

  const handleTest = async () => {
    if (!apiKey.trim()) {
      toast.error("Paste a key first");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const adapter = await getAdapter(providerId);
      await adapter.testKey({ apiKey: apiKey.trim(), model });
      setTestResult("ok");
      toast.success(`${meta.name} key works`);
    } catch (err) {
      setTestResult("fail");
      const message = describeError(err);
      toast.error(`${meta.name} test failed: ${message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast.error("Paste a key first");
      return;
    }
    onSave(apiKey.trim(), model);
  };

  const handleClear = () => {
    setApiKey("");
    setTestResult(null);
    onClear();
  };

  const keyHint =
    meta.keyPrefix && apiKey && !apiKey.startsWith(meta.keyPrefix)
      ? `Keys from ${meta.name} usually start with "${meta.keyPrefix}". Double-check you copied the right one.`
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-sub">
        <span>Get a key:</span>
        <a
          href={meta.keyHelpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          {meta.name} console
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`llm-key-${providerId}`} className="text-xs text-text">
          API key
        </Label>
        <div className="flex gap-2">
          <Input
            id={`llm-key-${providerId}`}
            type={reveal ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={meta.keyPrefix ? `${meta.keyPrefix}...` : "Paste API key"}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={keyHint ? `llm-key-hint-${providerId}` : undefined}
            className="bg-surface-deep border-border text-text font-data"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? "Hide key" : "Show key"}
            className="border-border shrink-0"
          >
            {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        </div>
        {keyHint && (
          <p id={`llm-key-hint-${providerId}`} className="text-xs text-warning">
            {keyHint}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`llm-model-${providerId}`} className="text-xs text-text">
          Model
        </Label>
        <Select
          value={customMode ? CUSTOM_MODEL_VALUE : model}
          onValueChange={(v) => {
            if (v === CUSTOM_MODEL_VALUE) {
              setCustomMode(true);
              // Seed the input with the current model so the user can edit
              // rather than re-type from scratch.
              return;
            }
            setCustomMode(false);
            setModel(v);
          }}
        >
          <SelectTrigger
            id={`llm-model-${providerId}`}
            className="bg-surface-deep border-border text-text"
          >
            <SelectValue placeholder="Pick a model" />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="font-mono">{m.label}</span>
                <span className="ml-2 text-xs text-sub">
                  ${m.inputPer1k.toFixed(4)}/${m.outputPer1k.toFixed(4)} per 1K
                </span>
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_MODEL_VALUE}>
              <span className="font-mono">Custom model id…</span>
              <span className="ml-2 text-xs text-sub">type any id the provider supports</span>
            </SelectItem>
          </SelectContent>
        </Select>
        {customMode && (
          // Escape hatch for models released after our pricing table was last
          // updated. Cost preview falls back to "$0" for unknown ids — the
          // provider's invoice is always the source of truth.
          <Input
            type="text"
            aria-label="Custom model id"
            value={model}
            onChange={(e) => setModel(e.target.value.trim())}
            placeholder="e.g. glm-5.2 / claude-opus-4-6 / o4-mini"
            autoComplete="off"
            spellCheck={false}
            className="bg-surface-deep border-border text-text font-data text-xs"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !apiKey.trim()}
          className="gap-1.5 border-border"
        >
          {testing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : testResult === "ok" ? (
            <Check className="w-3.5 h-3.5 text-accent" />
          ) : testResult === "fail" ? (
            <AlertCircle className="w-3.5 h-3.5 text-danger" />
          ) : null}
          {testing ? "Testing…" : "Test"}
        </Button>
        <Button
          onClick={handleSave}
          disabled={!apiKey.trim()}
          className="bg-accent text-bg hover:bg-accent/90 font-semibold"
        >
          Save &amp; make active
        </Button>
        {existing && !isActive && (
          <Button variant="outline" onClick={onMakeActive} className="border-border">
            Make active
          </Button>
        )}
        {existing && (
          <Button
            variant="outline"
            onClick={handleClear}
            className="gap-1.5 border-border text-danger hover:text-danger hover:border-danger/40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear key
          </Button>
        )}
      </div>
    </div>
  );
}

function describeError(err: unknown): string {
  if (isLlmError(err)) {
    switch (err.code) {
      case "auth":
        return "key rejected";
      case "rate_limit":
        return "rate limited — try again later";
      case "cors":
        return "browser blocked the request (CORS)";
      case "network":
        return err.status ? `HTTP ${err.status}` : "network error";
      case "abort":
        return "aborted";
    }
  }
  if (err instanceof Error) return err.message.slice(0, 120);
  return "unknown error";
}
