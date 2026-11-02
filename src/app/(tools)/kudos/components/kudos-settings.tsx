"use client";

/**
 * Owner-only Kudos settings modal (Phase 5).
 *
 * Three sections rendered inline (no tabs — the whole thing fits in
 * one comfortable column):
 *   - AI features:           sentiment / dedup / fairness toggles.
 *   - Beacon visibility:     ambient HUD / header beacon toggles.
 *   - Custom themes:         create / edit / delete custom themes
 *                            using the Phase 0 open theme registry.
 *
 * State persists to localStorage via `useKudosSettingsStore`. These
 * are device-local preferences — the AI/beacon sliders are user
 * comfort, not shared workspace state, and the custom-theme catalog
 * is the owner's personal palette (themes attached to outgoing kudos
 * still ride the realtime wire as inline objects, which makes them
 * shareable to peers downstream).
 *
 * Custom-theme validation: rather than reimplement the codepoint /
 * regex checks that Phase 0's `parseKudos` already enforces, we
 * synthesise a throwaway Kudos with the candidate theme and parse it.
 * The parser's error code (e.g. "invalid_theme") drives the inline
 * "Couldn't add: …" hint so we never drift from the wire's truth.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";
import { parseKudos } from "@/lib/kudos/parse";
import type { KudosCustomTheme } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";

/**
 * Where the colour picker starts. A custom theme carries its own colour as
 * data (the card paints it inline and the PNG export needs a literal), so
 * this is the one hex here: the brand accent, as a starting point to change.
 */
const DEFAULT_THEME_HEX = "#00f0ff";

/** How long the dialog's own Undo row stays, as long as the toast's. */
const INLINE_UNDO_MS = 8000;

/**
 * Delete a custom theme, with Undo that puts it back in its place. The
 * Undo is offered twice: in the toast, and in the dialog (the toast sits
 * outside the dialog's focus trap, so a keyboard user couldn't reach it).
 * Returns the restore both share, which puts the theme back once.
 */
function deleteCustomTheme(theme: KudosCustomTheme): () => void {
  const update = (fn: (list: readonly KudosCustomTheme[]) => KudosCustomTheme[]) =>
    useKudosSettingsStore.setState((s) => ({ customThemes: fn(s.customThemes) }));
  let index = -1;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    update((list) => {
      if (list.some((t) => t.id === theme.id)) return [...list];
      const next = [...list];
      next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, theme);
      return next;
    });
  };
  undoable({
    label: `Deleted the “${theme.title}” theme`,
    durationMs: INLINE_UNDO_MS,
    apply: () =>
      update((list) => {
        index = list.findIndex((t) => t.id === theme.id);
        return list.filter((t) => t.id !== theme.id);
      }),
    revert: restore,
  });
  return restore;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KudosSettings({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-surface border-border max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-text">Kudos settings</DialogTitle>
          <DialogDescription className="text-sub">
            Device-local preferences for AI suggestions, beacon visibility, and your custom theme
            catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <AiFeaturesSection />
          <BeaconSection />
          <CustomThemesSection />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {hint && <p className="text-xs text-sub">{hint}</p>}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}
function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-deep/40 px-3 py-2.5 cursor-pointer">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-text">{label}</span>
        {hint && <span className="text-xs text-sub">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function AiFeaturesSection() {
  const aiSentiment = useKudosSettingsStore((s) => s.aiSentiment);
  const aiDedup = useKudosSettingsStore((s) => s.aiDedup);
  const aiFairness = useKudosSettingsStore((s) => s.aiFairness);
  const setAiSentiment = useKudosSettingsStore((s) => s.setAiSentiment);
  const setAiDedup = useKudosSettingsStore((s) => s.setAiDedup);
  const setAiFairness = useKudosSettingsStore((s) => s.setAiFairness);

  return (
    <section className="flex flex-col gap-2">
      <SectionHeading
        title="AI features"
        hint="Uses your BYOK key. Turn off any feature you don't want sent to the LLM."
      />
      <ToggleRow
        label="Sentiment analysis"
        hint="Surfaces an inline 'sounds sarcastic?' warning while you type."
        checked={aiSentiment}
        onChange={setAiSentiment}
      />
      <ToggleRow
        label="Duplicate detection"
        hint="Folds near-duplicate kudos on the wall into one card."
        checked={aiDedup}
        onChange={setAiDedup}
      />
      <ToggleRow
        label="Fairness suggestions"
        hint="Highlights teammates who haven't been recognized recently."
        checked={aiFairness}
        onChange={setAiFairness}
      />
    </section>
  );
}

function BeaconSection() {
  const beaconAmbient = useKudosSettingsStore((s) => s.beaconAmbient);
  const beaconHeader = useKudosSettingsStore((s) => s.beaconHeader);
  const setBeaconAmbient = useKudosSettingsStore((s) => s.setBeaconAmbient);
  const setBeaconHeader = useKudosSettingsStore((s) => s.setBeaconHeader);

  return (
    <section className="flex flex-col gap-2">
      <SectionHeading
        title="Beacon visibility"
        hint="The kudos beacon nudges you when teammates are under-recognized."
      />
      <ToggleRow
        label="Ambient beacon"
        hint="A floating pill on the kudos page surfacing live fairness hints."
        checked={beaconAmbient}
        onChange={setBeaconAmbient}
      />
      <ToggleRow
        label="Header beacon"
        hint="A pulsing dot in the toolkit header when you receive new kudos."
        checked={beaconHeader}
        onChange={setBeaconHeader}
      />
    </section>
  );
}

function CustomThemesSection() {
  const customThemes = useKudosSettingsStore((s) => s.customThemes);
  const upsertCustomTheme = useKudosSettingsStore((s) => s.upsertCustomTheme);
  // The last delete's Undo, inside the dialog; focus moves to it, since the
  // Delete button that had focus is gone.
  const [deleted, setDeleted] = useState<{ title: string; restore: () => void } | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!deleted) return;
    undoRef.current?.focus();
    const timer = setTimeout(() => setDeleted(null), INLINE_UNDO_MS);
    return () => clearTimeout(timer);
  }, [deleted]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Custom themes"
        hint="Define your own card styles. Each must have a stable id, title, emoji, and hex color."
      />
      <ul className="flex flex-col gap-2" aria-label="Custom themes">
        {customThemes.length === 0 && (
          <li className="text-xs text-sub italic">No custom themes yet.</li>
        )}
        {customThemes.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-deep/40 px-3 py-2"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-base"
                style={{ background: t.hex }}
              >
                {t.emoji}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-sm text-text truncate">{t.title}</span>
                <span className="text-xs text-sub font-mono">{t.id}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleted({ title: t.title, restore: deleteCustomTheme(t) })}
              className="text-sub hover:text-danger"
              aria-label={`Delete theme ${t.title}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {deleted && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-deep/40 px-3 py-2 text-xs text-sub"
        >
          <span className="min-w-0 break-words">Deleted the “{deleted.title}” theme.</span>
          <Button
            ref={undoRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              deleted.restore();
              setDeleted(null);
            }}
            aria-label={`Undo deleting the ${deleted.title} theme`}
          >
            Undo
          </Button>
        </p>
      )}
      <CustomThemeCreator onAdd={upsertCustomTheme} />
    </section>
  );
}

interface CreatorProps {
  onAdd: (t: KudosCustomTheme) => void;
}

/**
 * Inline creator with all four required fields. Validation rides on the
 * Phase 0 `parseKudos` — we synthesise a tiny throwaway Kudos with the
 * candidate theme and let the parser reject it if any field is wrong.
 * The parser's error code surfaces inline so the user sees the same
 * verdict the wire would render.
 */
function CustomThemeCreator({ onAdd }: CreatorProps) {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("");
  const [hex, setHex] = useState(DEFAULT_THEME_HEX);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setId("");
    setTitle("");
    setEmoji("");
    setHex(DEFAULT_THEME_HEX);
    setError(null);
  };

  const handleAdd = () => {
    setError(null);
    const candidate: KudosCustomTheme = {
      id: id.trim(),
      title: title.trim(),
      emoji: emoji.trim(),
      hex: hex.trim(),
    };
    // Validate via the wire parser. We construct a minimal valid Kudos
    // with the candidate theme attached; if anything in the theme is
    // malformed, `parseKudos` returns `{ok: false, error}` and we
    // render the error code inline. The synthetic Kudos's other fields
    // are deliberately well-formed so the only failure mode the parser
    // can surface is "invalid_theme" (or, if we leaked a wrong field
    // ourselves, a different code that's still informative).
    const synthetic = {
      id: "kud_probe000000000",
      theme: candidate,
      toName: "x",
      fromName: "y",
      message: "z",
      sentAt: new Date().toISOString(),
    };
    const result = parseKudos(synthetic);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Final guard: the parser allows ANY string theme matching the
    // built-in catalog. Make sure we got the custom-object shape back.
    if (typeof result.kudos.theme === "string") {
      setError("invalid_theme");
      return;
    }
    onAdd(candidate);
    reset();
  };

  const canSubmit = id.length > 0 && title.length > 0 && emoji.length > 0 && hex.length > 0;

  return (
    <div className="rounded-md border border-dashed border-border bg-surface-deep/40 px-3 py-3 flex flex-col gap-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-sub" htmlFor="kudos-theme-id">
            Id (lowercase, hyphens)
          </Label>
          <Input
            id="kudos-theme-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="ship-day"
            maxLength={32}
            className="bg-surface border-border text-text"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-sub" htmlFor="kudos-theme-title">
            Title
          </Label>
          <Input
            id="kudos-theme-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ship Day"
            maxLength={64}
            className="bg-surface border-border text-text"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-sub" htmlFor="kudos-theme-emoji">
            Emoji
          </Label>
          <Input
            id="kudos-theme-emoji"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🚢"
            maxLength={8}
            className="bg-surface border-border text-text"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-sub" htmlFor="kudos-theme-hex">
            Color
          </Label>
          <div className="flex items-center gap-2">
            <input
              id="kudos-theme-hex"
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-surface"
              aria-label="Theme color"
            />
            <Input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              maxLength={9}
              className="bg-surface border-border text-text font-mono text-xs flex-1"
              aria-label="Theme color hex"
            />
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          Couldn&apos;t add: {error}
        </p>
      )}
      <Button
        type="button"
        onClick={handleAdd}
        disabled={!canSubmit}
        size="sm"
        className="self-start bg-accent text-bg hover:bg-accent/80 gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add theme
      </Button>
    </div>
  );
}
