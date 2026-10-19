"use client";

/**
 * Compose form for sending a kudos.
 *
 * Renders identically for the owner and a guest editor — the only
 * differences are wired by the parent:
 *   * Recipient picker source (`recipients` prop) — owner sees workspace
 *     team members + squad profiles; guest sees only squad profiles
 *   * `defaultFromName` — owner's auth profile name; guest's squad
 *     display name. The form does not let the user edit it (their
 *     identity is fixed by their auth/guest context) but renders it as
 *     read-only so they can sanity-check it. A signed-out visitor has
 *     no such identity, so the parent passes `onFromNameChange` and the
 *     field becomes an editable "Your name" input instead.
 *
 * Validation mirrors the original HTML's UX (50-word message cap,
 * short word caps on names) with live counters. The Send button is
 * disabled until the form is valid.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Download, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/shared/section-card";
import type { Kudos, KudosSentiment, KudosTheme } from "@/lib/stores/workspace-types";
import { KUDOS_THEMES, KUDOS_WORD_LIMITS, countWords } from "../types";
import { KudosCard } from "./kudos-card";
import { analyseSentiment } from "@/lib/kudos/llm/sentiment";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";

export interface RecipientOption {
  /** Stable id — squad profile id or workspace team-member id, or
   *  `"free:<typed>"` for ad-hoc entries. */
  id: string;
  /** Display name shown in the dropdown and stamped on the Kudos. */
  displayName: string;
  /** When set, stamps `toProfileId` on the saved Kudos so the recipient's
   *  tab can highlight kudos addressed to them. */
  profileId?: string;
  /** Visual hint for the dropdown — "squad" / "team" / "free". */
  source: "squad" | "team" | "free";
}

interface Props {
  /** Sender display name (read-only unless `onFromNameChange` is set). */
  defaultFromName: string;
  /** Placeholder for the editable sender field. */
  fromPlaceholder?: string;
  /** When set, the sender field is editable and reports each change
   *  here; the parent owns the value via `defaultFromName`. */
  onFromNameChange?: (name: string) => void;
  /** Sender's squad profile id (guest mode) or undefined (owner). */
  defaultFromProfileId?: string;
  /** Optional team label seeded into the form. Owners often want
   *  "Data Governance" or similar; guests can leave blank. */
  defaultTeamName?: string;
  /** Recipient options — populated by the parent based on mode. */
  recipients: RecipientOption[];
  /** Called when the user clicks Send AND all validations pass. The
   *  parent is responsible for upserting + broadcasting; the form
   *  only builds the Kudos shape. */
  onSubmit: (kudos: Kudos) => Promise<void> | void;
  /** Called when the user clicks Download. The parent invokes
   *  `exportPng` against the live-preview card; the form passes the
   *  current preview Kudos for filename construction. */
  onDownload: (kudos: Kudos, cardEl: HTMLDivElement) => void;
  /** Optional slot above the Send button (used by the parent to render
   *  the AI-prompt generator). */
  aiSuggestSlot?: React.ReactNode;
  /**
   * Phase 3 — predicted recipient (from `usePredictedDefault`). When set
   * AND the user hasn't picked one yet, the form prefills the To select
   * with the matching recipient option. Single-shot via
   * `didAutoSelectRef` so subsequent updates don't clobber a manual pick.
   */
  predictedRecipientId?: string;
  /**
   * Phase 3 — inline hint shown above the form. The parent (owner-side
   * only) renders an under-recognised teammate suggestion here with a
   * one-click "send to them" button. Free-form ReactNode keeps the form
   * agnostic to whether the hint came from fairness, LLM, or a manual
   * prompt.
   */
  fairnessHintSlot?: React.ReactNode;
  /**
   * Phase 3 — when the parent's "send to under-recognised X" button
   * fires it bumps a counter via this callback shape: `{recipientId, token}`.
   * The token monotonically increases per click; the form treats a bump
   * as a forced override of the auto-select latch and snaps the picker
   * to `recipientId`. A bump that lands BEFORE the user has typed in
   * the free-text field is safe; one that lands AFTER still wins (the
   * user explicitly clicked the hint button). Optional — the form
   * works without it.
   */
  forcedRecipient?: { id: string; token: number };
}

const newKudosId = (): string => {
  // Use crypto.randomUUID when available (every browser we target +
  // Node ≥ 16 / Edge). Fall back to a coarse random string in the
  // rare case where the global isn't present.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `kud_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `kud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export function KudosForm({
  defaultFromName,
  fromPlaceholder,
  onFromNameChange,
  defaultFromProfileId,
  defaultTeamName,
  recipients,
  onSubmit,
  onDownload,
  aiSuggestSlot,
  predictedRecipientId,
  fairnessHintSlot,
  forcedRecipient,
}: Props) {
  const [theme, setTheme] = useState<KudosTheme>("awesome");
  const [recipientId, setRecipientId] = useState<string>("");
  const [freeRecipient, setFreeRecipient] = useState("");
  const [teamName, setTeamName] = useState(defaultTeamName ?? "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Auto-select the first recipient ONCE per mount. Without the "once"
  // latch the effect re-fires every time `recipients` changes — e.g.
  // when an async fetch resolves AFTER the user has started reading
  // the form. A user who chose "Pick a recipient…" (value="") then
  // typed in the free-text field would see the dropdown jump to
  // recipients[0] mid-edit and might Send to the wrong person.
  //
  // Phase 3 — if a predicted recipient is provided, prefer it over the
  // raw alphabetical first pick. Same one-shot latch: a predicted match
  // that lands AFTER the user has started picking should NOT overwrite
  // their choice.
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (recipientId) return;
    if (recipients.length === 0) return;
    if (predictedRecipientId) {
      const match = recipients.find((r) => r.profileId === predictedRecipientId);
      if (match) {
        setRecipientId(match.id);
        didAutoSelectRef.current = true;
        return;
      }
    }
    setRecipientId(recipients[0].id);
    didAutoSelectRef.current = true;
  }, [recipientId, recipients, predictedRecipientId]);

  // Phase 3 — forced recipient override (fires when the parent's
  // under-recognised hint button is clicked). Re-runs ONLY when the
  // monotonic token changes; the latch is intentionally not consulted
  // here because the user explicitly clicked the hint.
  const lastForcedTokenRef = useRef<number>(forcedRecipient?.token ?? -1);
  useEffect(() => {
    if (!forcedRecipient) return;
    if (forcedRecipient.token === lastForcedTokenRef.current) return;
    lastForcedTokenRef.current = forcedRecipient.token;
    setRecipientId(forcedRecipient.id);
    didAutoSelectRef.current = true;
  }, [forcedRecipient]);

  // Phase 3 — debounced sentiment classifier. Surfaces an inline soft
  // warning when the model reads the message as backhanded; it does NOT
  // gate the Send button. Send-on-failure means a missing BYOK key or a
  // model error simply leaves `sentiment` as null and the warning never
  // shows.
  //
  // Phase 5 — gated on the device-local "Sentiment analysis" toggle. The
  // settings dialog promises "turn off any feature you don't want sent to
  // the LLM"; before this gate the full message body still went to the
  // user's BYOK provider on every debounce tick with the switch off.
  const aiSentiment = useKudosSettingsStore((s) => s.aiSentiment);
  const [sentiment, setSentiment] = useState<KudosSentiment | null>(null);
  const sentimentAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // Reset on every keystroke; only the final call after the debounce
    // window actually issues. Clearing here also wipes a stale warning
    // when the user edits past the sarcasm — and clears the inline
    // warning the moment the feature is switched off.
    setSentiment(null);
    sentimentAbortRef.current?.abort();
    if (!aiSentiment) return;
    const trimmed = message.trim();
    // Don't bill the LLM for short text — sarcasm needs context. Aligns
    // with the form's "needs >= 1 word" gate so we skip the no-op call
    // when the textarea is empty.
    if (trimmed.length < 12) return;
    const controller = new AbortController();
    sentimentAbortRef.current = controller;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await analyseSentiment({ message: trimmed, theme }, controller.signal);
          if (controller.signal.aborted) return;
          setSentiment(result);
        } catch {
          /* send-on-failure — no warning is fine */
        }
      })();
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [message, theme, aiSentiment]);

  // Phase 5 — the picker used to map only the seven built-in
  // KUDOS_THEMES, so a custom theme created in the settings dialog was
  // impossible to actually select. Merge the device-local catalog in;
  // custom entries carry the inline `KudosCustomTheme` object as their
  // value (which is exactly what the wire + card renderer accept).
  const customThemes = useKudosSettingsStore((s) => s.customThemes);
  const themeOptions = useMemo(() => {
    const builtIns = KUDOS_THEMES.map((t) => ({
      key: t.id as string,
      value: t.id as KudosTheme,
      title: t.title,
      emoji: t.emoji,
      accent: t.accent,
      hex: t.hex,
      custom: false,
    }));
    const custom = customThemes.map((t) => ({
      // Namespaced so a custom theme that reuses a built-in id can't
      // collide with it in the selected-state comparison.
      key: `custom:${t.id}`,
      value: { id: t.id, title: t.title, emoji: t.emoji, hex: t.hex } as KudosTheme,
      title: t.title,
      emoji: t.emoji,
      // Custom themes ship a hex, not Tailwind classes — the selected
      // ring is applied inline below.
      accent: "border-border text-text",
      hex: t.hex,
      custom: true,
    }));
    return [...builtIns, ...custom];
  }, [customThemes]);
  const selectedThemeKey = typeof theme === "string" ? theme : `custom:${theme.id}`;

  const selectedRecipient = useMemo<RecipientOption | null>(() => {
    if (recipientId === "free") {
      const cleaned = freeRecipient.trim();
      if (!cleaned) return null;
      return { id: "free", displayName: cleaned, source: "free" };
    }
    return recipients.find((r) => r.id === recipientId) ?? null;
  }, [recipientId, freeRecipient, recipients]);

  // Validation state.
  const messageWords = countWords(message);
  const toWords = countWords(selectedRecipient?.displayName ?? "");
  const teamWords = countWords(teamName);
  const fromWords = countWords(defaultFromName);
  const messageOk = messageWords > 0 && messageWords <= KUDOS_WORD_LIMITS.message;
  const toOk = !!selectedRecipient && toWords > 0 && toWords <= KUDOS_WORD_LIMITS.to;
  const teamOk = teamWords <= KUDOS_WORD_LIMITS.team;
  // Sender name is fixed; if it overflows the limit (e.g. a 5-word
  // squad display name), surface a warning but don't block send — the
  // user can't fix it from here.
  const fromOk = fromWords <= KUDOS_WORD_LIMITS.from;
  const canSubmit = messageOk && toOk && teamOk && !submitting;

  // Build the live-preview Kudos. Used by both the inline preview and
  // the PNG-export path; `id` and `sentAt` are stable across renders
  // by reusing the same nanoid, so the preview ID matches the saved
  // record exactly — important when the parent dedupes broadcasts.
  const previewIdRef = useRef<string>(newKudosId());
  const preview: Kudos = useMemo(
    () => ({
      id: previewIdRef.current,
      theme,
      toName: selectedRecipient?.displayName.trim() || "Recipient's Name",
      toProfileId: selectedRecipient?.profileId,
      fromName: defaultFromName.trim() || "—",
      fromProfileId: defaultFromProfileId,
      teamName: teamName.trim() || undefined,
      message: message.trim() || "Your wonderful message will appear here…",
      // Updated on submit to the actual moment of send; the preview
      // shows today's date so the user sees what the card will say.
      sentAt: new Date().toISOString(),
    }),
    [theme, selectedRecipient, defaultFromName, defaultFromProfileId, teamName, message]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selectedRecipient) return;
    setSubmitting(true);
    setError(null);
    try {
      const finalised: Kudos = {
        ...preview,
        sentAt: new Date().toISOString(),
      };
      await onSubmit(finalised);
      // Reset the form for the next kudos. Keep theme so a user
      // sending several "Thank You" cards doesn't have to re-pick.
      setMessage("");
      setRecipientId("");
      setFreeRecipient("");
      previewIdRef.current = newKudosId();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send kudos");
      // Regenerate the preview id on failure too. Without this, a
      // retry attempt — possibly with an edited message — reuses the
      // same id; the store dedupes correctly, but any peer that
      // received the partial first broadcast keeps the OLD message
      // because dedup-by-id replaces in place. Fresh id forces a new
      // append on every retry.
      previewIdRef.current = newKudosId();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = () => {
    if (!cardRef.current) return;
    onDownload(preview, cardRef.current);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {fairnessHintSlot}
      <SectionCard
        title="Compose kudos"
        className="border-border bg-surface"
        headerClassName="pb-3"
        contentClassName="flex flex-col gap-4"
      >
        {/* Theme picker — chip-style for tactile feel. Matches the
            "kudos type" select in the original HTML. */}
        <div className="flex flex-col gap-2">
          <p id="kudos-type-label" className="text-sm font-medium leading-none text-sub">
            Kudos type
          </p>
          <div
            role="group"
            aria-labelledby="kudos-type-label"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          >
            {themeOptions.map((t) => {
              const isSelected = selectedThemeKey === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  aria-pressed={isSelected}
                  style={t.custom && isSelected ? { borderColor: t.hex, color: t.hex } : undefined}
                  className={[
                    "min-touch-coarse rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                    "flex items-center gap-1.5 justify-center",
                    isSelected
                      ? `${t.accent} bg-accent/5`
                      : "border-border bg-surface-deep text-sub hover:border-border hover:text-text",
                  ].join(" ")}
                >
                  <span aria-hidden="true">{t.emoji}</span>
                  <span>{t.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recipient picker. Dropdown of squad profiles + team members,
            with a "Type a name…" free-text fallback. */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="kudos-to" className="text-sub text-sm">
            To
          </Label>
          <select
            id="kudos-to"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="h-10 [@media(pointer:coarse)]:h-11 rounded-md bg-surface-deep border border-border px-3 text-sm text-text"
          >
            {recipients.length === 0 && <option value="">No teammates yet</option>}
            {recipients.length > 0 && <option value="">Pick a recipient…</option>}
            {recipients.filter((r) => r.source === "squad").length > 0 && (
              <optgroup label="Squad">
                {recipients
                  .filter((r) => r.source === "squad")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
              </optgroup>
            )}
            {recipients.filter((r) => r.source === "team").length > 0 && (
              <optgroup label="Team members">
                {recipients
                  .filter((r) => r.source === "team")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
              </optgroup>
            )}
            <option value="free">— Type a name…</option>
          </select>
          {recipientId === "free" && (
            <Input
              placeholder="Recipient name"
              aria-label="Recipient name"
              value={freeRecipient}
              onChange={(e) => setFreeRecipient(e.target.value)}
              maxLength={64}
              autoFocus
              className="bg-surface-deep border-border text-text mt-1"
            />
          )}
          {!toOk && selectedRecipient && (
            <p className="text-xs text-warning">Up to {KUDOS_WORD_LIMITS.to} words.</p>
          )}
        </div>

        {/* Sender — read-only display + optional team label. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            {onFromNameChange ? (
              <>
                <Label htmlFor="kudos-from" className="text-sub text-sm">
                  From
                </Label>
                <Input
                  id="kudos-from"
                  placeholder={fromPlaceholder}
                  value={defaultFromName}
                  onChange={(e) => onFromNameChange(e.target.value)}
                  maxLength={48}
                  className="bg-surface-deep border-border text-text"
                />
              </>
            ) : (
              <>
                <Label htmlFor="kudos-from" className="text-sub text-sm">
                  From
                </Label>
                <Input
                  id="kudos-from"
                  value={defaultFromName}
                  readOnly
                  className="bg-surface-deep border-border text-text/80"
                />
              </>
            )}
            {!fromOk && <p className="text-xs text-sub/60">Long names render small on the card.</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kudos-team" className="text-sub text-sm">
              Team (optional)
            </Label>
            <Input
              id="kudos-team"
              placeholder="e.g. Data Governance"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={48}
              className="bg-surface-deep border-border text-text"
            />
          </div>
        </div>

        {/* Message + live word counter. */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="kudos-message" className="text-sub text-sm">
            Message
          </Label>
          <Textarea
            id="kudos-message"
            placeholder="Write your wonderful message here…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className={
              "bg-surface-deep border-border resize-none text-sm text-text" +
              (!messageOk && messageWords > KUDOS_WORD_LIMITS.message ? " border-danger/60" : "")
            }
          />
          <div
            className={`text-xs text-right ${
              messageWords > KUDOS_WORD_LIMITS.message ? "text-danger font-semibold" : "text-sub/60"
            }`}
          >
            {messageWords}/{KUDOS_WORD_LIMITS.message} words
          </div>
          {/* Phase 3 — backhanded warning. Advisory only; the Send
              button stays enabled so the user can override the model. */}
          {sentiment?.label === "backhanded" && (
            <div
              role="status"
              className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                This reads as sarcastic — send anyway?
                {sentiment.tone.length > 0 && (
                  <span className="text-warning/70"> (tone: {sentiment.tone.join(", ")})</span>
                )}
              </span>
            </div>
          )}
        </div>

        {aiSuggestSlot && <div>{aiSuggestSlot}</div>}

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 bg-accent text-[#0a0e1a] hover:bg-accent/80 font-semibold gap-2"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Send kudos
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDownload}
            disabled={!messageOk || !toOk}
            className="border-border text-sub hover:text-text gap-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download PNG
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        title="Live preview"
        className="border-border bg-surface"
        headerClassName="pb-3"
        contentClassName="flex justify-center"
      >
        <KudosCard ref={cardRef} kudos={preview} />
      </SectionCard>
    </form>
  );
}
