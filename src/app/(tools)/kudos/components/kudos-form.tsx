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
 *   * `rosterRecipients` — the owner's typed recipient is matched to the
 *     Team roster (and can be added to it, as an explicit click); a guest's
 *     stays plain text, since the roster in a guest's browser isn't the
 *     owner's team.
 *
 *   * `delivery` — "room" (the default: the owner and squad guests) hands
 *     the kudos to the parent to save and broadcast; "link" (a signed-out
 *     visitor) keeps it private: Send makes a link that holds the card and
 *     a card image, and the parent keeps a copy on the device only when
 *     "Keep a copy on this device" is ticked.
 *
 * The cards are the printed Agile at Work ones (lib/kudos/card-designs),
 * picked with CardPicker: a theme (the four habits, or Open), then one of
 * its cards, a book episode's card or "Thank you!" / "Great teamwork!",
 * which can name the episode it reminds the sender of. A kudos keeps only
 * the card's theme id and its episode number. `initialEpisode` (from
 * /kudos?ep=NN) picks that episode's card. The fields are the printed card's
 * back: To, Thank you for, From.
 *
 * Nothing is sent until the draft is valid: a recipient (never picked on
 * the sender's behalf), a message of 1–50 words, and the short word caps on
 * names. Send stays enabled; pressing it on an incomplete draft shows what's
 * missing and focuses the first field to fix. Ctrl/Cmd+Enter in the message
 * sends.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Send, Download, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/shared/section-card";
import { PersonPicker } from "@/components/team/person-picker";
import { findRosterMember, useTeamRoster } from "@/lib/team/use-team-roster";
import { focusFirstInvalid } from "@/lib/utils/form";
import type { Kudos, KudosSentiment } from "@/lib/stores/workspace-types";
import { MESSAGE_CHAR_MAX } from "@/lib/kudos/parse";
import { cardDesign, designFor, episodeDesign, type CardDesignKey } from "@/lib/kudos/card-designs";
import { KUDOS_WORD_LIMITS, countWords } from "../types";
import { RECIPIENT_MAX, validateKudosDraft } from "../form";
import { CardPicker } from "./card-picker";
import { KudosCard } from "./kudos-card";
import { KudosSent } from "./kudos-sent";
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
  /** The roster member (TeamMember.id): stamps `toMemberId`, so a later
   *  rename on the Team page still counts the kudos for them. */
  memberId?: string;
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
  /** Recipient options — populated by the parent based on mode. */
  recipients: RecipientOption[];
  /**
   * Owner only: a typed recipient is picked with the Team roster's
   * PersonPicker (suggestions, and an explicit "Add to the team"), and a
   * name on the roster stamps `toMemberId`.
   */
  rosterRecipients?: boolean;
  /** The recipient is a plain text box, with no list to pick from (a visitor). */
  plainRecipient?: boolean;
  /** How a sent kudos leaves: through the parent ("room") or as a private link ("link"). */
  delivery?: "room" | "link";
  /** A book episode's printed card to start on. A new token picks it again. */
  initialEpisode?: { ep: number; token: number };
  /** Called when the user clicks Send AND all validations pass. The
   *  parent is responsible for upserting + broadcasting; the form
   *  only builds the Kudos shape. With "link" delivery, `keep` says
   *  whether to keep a copy on this device. */
  onSubmit: (kudos: Kudos, options: { keep: boolean }) => Promise<void> | void;
  /** Called when the user clicks Download. The parent invokes
   *  `exportPng` against the live-preview card; the form passes the
   *  current preview Kudos for filename construction. */
  onDownload: (kudos: Kudos, cardEl: HTMLDivElement) => void;
  /** Optional slot above the Send button (used by the parent to render
   *  the AI-prompt generator). */
  aiSuggestSlot?: React.ReactNode;
  /**
   * Phase 3 — predicted recipient (from `usePredictedDefault`). Shown as
   * a "Suggested: X" button while nobody is picked; it never picks the
   * recipient by itself.
   */
  predictedRecipientId?: string;
  /**
   * Phase 3 — inline hint shown above the form. The parent (owner-side
   * only) renders an under-recognized teammate suggestion here with a
   * one-click "send to them" button. Free-form ReactNode keeps the form
   * agnostic to whether the hint came from fairness, LLM, or a manual
   * prompt.
   */
  fairnessHintSlot?: React.ReactNode;
  /**
   * Phase 3 — when the parent's "send to under-recognized X" button
   * fires it bumps a counter via this callback shape: `{recipientId, token}`.
   * The token monotonically increases per click; the form treats a bump
   * as an explicit pick and snaps the picker to `recipientId`. Optional —
   * the form works without it.
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

const SELECT_CLASS =
  "h-10 [@media(pointer:coarse)]:h-11 rounded-md bg-surface-deep border border-border px-3 text-sm text-text aria-[invalid=true]:border-danger";

/** The card a new kudos starts on. */
const DEFAULT_DESIGN: CardDesignKey = "open-thank-you";

export function KudosForm({
  defaultFromName,
  fromPlaceholder,
  onFromNameChange,
  defaultFromProfileId,
  recipients,
  rosterRecipients = false,
  plainRecipient = false,
  delivery = "room",
  initialEpisode,
  onSubmit,
  onDownload,
  aiSuggestSlot,
  predictedRecipientId,
  fairnessHintSlot,
  forcedRecipient,
}: Props) {
  const [design, setDesign] = useState<CardDesignKey>(DEFAULT_DESIGN);
  // The book episode an open card reminds the sender of (only its number is kept).
  const [remindsOf, setRemindsOf] = useState<number | null>(null);
  const card = cardDesign(design) ?? designFor(null);
  // What the kudos keeps: the card's theme id, and the episode of an
  // episode's card, or the one an open card reminds the sender of.
  const theme = card.theme;
  const episode = card.kind === "episode" ? card.ep : remindsOf;
  const [recipientId, setRecipientId] = useState<string>("");
  const [freeRecipient, setFreeRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [keepCopy, setKeepCopy] = useState(false);
  const [sent, setSent] = useState<{ kudos: Kudos; kept: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Errors show after the first failed Send, then follow the typing.
  const [attempt, setAttempt] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const roster = useTeamRoster();

  useEffect(() => {
    if (attempt > 0) focusFirstInvalid(formRef.current);
  }, [attempt]);

  // Phase 3 — forced recipient override (fires when the parent's
  // under-recognized hint button is clicked). Re-runs ONLY when the
  // monotonic token changes. The message is what's left to write, so
  // focus goes there (which also brings the form into view).
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const lastForcedTokenRef = useRef<number>(forcedRecipient?.token ?? -1);
  useEffect(() => {
    if (!forcedRecipient) return;
    if (forcedRecipient.token === lastForcedTokenRef.current) return;
    lastForcedTokenRef.current = forcedRecipient.token;
    if (plainRecipient) {
      // The plain To box is a typed name: fill it, and the roster match still stamps the member.
      const target = recipients.find((r) => r.id === forcedRecipient.id);
      if (target) setFreeRecipient(target.displayName);
    } else {
      setRecipientId(forcedRecipient.id);
    }
    messageRef.current?.focus();
  }, [forcedRecipient, plainRecipient, recipients]);

  // /kudos?ep=NN: start on that episode's printed card.
  const lastEpisodeTokenRef = useRef<number>(-1);
  useEffect(() => {
    if (!initialEpisode || initialEpisode.token === lastEpisodeTokenRef.current) return;
    lastEpisodeTokenRef.current = initialEpisode.token;
    const picked = episodeDesign(initialEpisode.ep);
    if (picked) setDesign(picked.key);
  }, [initialEpisode]);

  // The predicted recipient is offered, never picked: the first kudos
  // after load used to go to whoever the prediction (or the list) put first.
  const suggested =
    !recipientId && predictedRecipientId
      ? recipients.find((r) => r.profileId === predictedRecipientId)
      : undefined;

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

  const selectedRecipient = useMemo<RecipientOption | null>(() => {
    // A visitor's typed name is the recipient: there's no list to pick from.
    if (plainRecipient || recipientId === "free") {
      const cleaned = freeRecipient.trim();
      if (!cleaned) return null;
      // A typed name that is on the roster is that member (owner only).
      const member = rosterRecipients ? findRosterMember(roster, cleaned) : undefined;
      return {
        id: "free",
        displayName: member?.name ?? cleaned,
        ...(member ? { memberId: member.id } : {}),
        source: "free",
      };
    }
    return recipients.find((r) => r.id === recipientId) ?? null;
  }, [plainRecipient, recipientId, freeRecipient, recipients, rosterRecipients, roster]);

  const checked = validateKudosDraft({
    to: selectedRecipient?.displayName ?? "",
    message,
    team: "",
  });
  const errors = attempt > 0 && !checked.ok ? checked.errors : {};
  // The "To" error sits on the typed name when typing, else on the picker.
  const toError = recipientId === "free" && !plainRecipient ? undefined : errors.to;
  const freeError = recipientId === "free" ? errors.to : undefined;
  const messageWords = countWords(message);
  // Sender name is fixed; if it overflows the limit (e.g. a 5-word
  // squad display name), surface a warning but don't block send — the
  // user can't fix it from here.
  const fromOk = countWords(defaultFromName) <= KUDOS_WORD_LIMITS.from;

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
      ...(selectedRecipient?.memberId ? { toMemberId: selectedRecipient.memberId } : {}),
      fromName: defaultFromName.trim() || "—",
      fromProfileId: defaultFromProfileId,
      ...(episode !== null ? { episode } : {}),
      message: message.trim() || "what they did, in a few words…",
      // Updated on submit to the actual moment of send; the preview
      // shows today's date so the user sees what the card will say.
      sentAt: new Date().toISOString(),
    }),
    [theme, episode, selectedRecipient, defaultFromName, defaultFromProfileId, message]
  );

  const send = async () => {
    if (submitting) return;
    if (!checked.ok || !selectedRecipient) {
      setAttempt((a) => a + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const finalised: Kudos = {
        ...preview,
        toName: checked.values.to,
        message: checked.values.message,
        sentAt: new Date().toISOString(),
      };
      const keep = delivery === "room" || keepCopy;
      await onSubmit(finalised, { keep });
      // A private kudos leaves as its link and image, from the panel above the form.
      if (delivery === "link") setSent({ kudos: finalised, kept: keep });
      // Reset the form for the next kudos. Keep the card (and the episode
      // it reminds of) so a user sending several doesn't have to re-pick.
      setMessage("");
      setRecipientId("");
      setFreeRecipient("");
      setAttempt(0);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send();
  };

  const onMessageKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    void send();
  };

  const handleDownload = () => {
    if (!cardRef.current) return;
    onDownload(preview, cardRef.current);
  };

  const squad = recipients.filter((r) => r.source === "squad");
  const team = recipients.filter((r) => r.source === "team");

  // The next card starts at To (the card picked stays as it was).
  const recipientRef = useRef<HTMLDivElement>(null);
  const writeAnother = () => {
    setSent(null);
    recipientRef.current?.querySelector<HTMLElement>("input, select")?.focus();
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Outside the form, so Enter in its link box sends nothing; a new card mounts a new panel. */}
      {sent ? (
        <KudosSent key={sent.kudos.id} kudos={sent.kudos} kept={sent.kept} onDone={writeAnother} />
      ) : null}
      <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {fairnessHintSlot}
        <SectionCard
          title="Compose kudos"
          className="border-border bg-surface"
          headerClassName="pb-3"
          contentClassName="flex flex-col gap-4"
        >
          <p className="rounded-md border border-border bg-surface-deep px-3 py-2 text-sm text-text">
            First names and general thanks only. No customer names or internal details.
          </p>
          {/* The printed cards: a theme, then one of its cards. */}
          <CardPicker
            design={design}
            remindsOf={remindsOf}
            onDesignChange={setDesign}
            onRemindsOfChange={setRemindsOf}
          />

          {/* Recipient. A visitor types a name; everyone else picks from the
            squad profiles + team members, with a "Type a name…" fallback.
            data-kudos-to: the page's "Send your own" starts here too. */}
          <div ref={recipientRef} data-kudos-to>
            {plainRecipient ? (
              <Field label="To" error={errors.to}>
                {(props) => (
                  <Input
                    {...props}
                    placeholder="Their first name"
                    value={freeRecipient}
                    onChange={(e) => setFreeRecipient(e.target.value)}
                    maxLength={RECIPIENT_MAX}
                    className="bg-surface-deep border-border text-text"
                  />
                )}
              </Field>
            ) : (
              <div className="flex flex-col gap-2">
                <Field label="To" error={toError}>
                  {(props) => (
                    <select
                      {...props}
                      value={recipientId}
                      onChange={(e) => setRecipientId(e.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">
                        {recipients.length === 0 ? "No teammates yet" : "Pick a recipient…"}
                      </option>
                      {squad.length > 0 && (
                        <optgroup label="Squad">
                          {squad.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.displayName}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {team.length > 0 && (
                        <optgroup label="Team members">
                          {team.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.displayName}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value="free">— Type a name…</option>
                    </select>
                  )}
                </Field>
                {suggested && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-sub">
                    <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    <span>Suggested:</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setRecipientId(suggested.id)}
                    >
                      {suggested.displayName}
                    </Button>
                  </p>
                )}
                {recipientId === "free" &&
                  (rosterRecipients ? (
                    <PersonPicker
                      label="Recipient name"
                      value={freeRecipient}
                      onChange={setFreeRecipient}
                      error={freeError}
                      placeholder="Recipient name"
                    />
                  ) : (
                    <Field label="Recipient name" error={freeError}>
                      {(props) => (
                        <Input
                          {...props}
                          placeholder="Recipient name"
                          value={freeRecipient}
                          onChange={(e) => setFreeRecipient(e.target.value)}
                          maxLength={RECIPIENT_MAX}
                          autoFocus
                          className="bg-surface-deep border-border text-text"
                        />
                      )}
                    </Field>
                  ))}
              </div>
            )}
          </div>

          {/* Message + live word counter. */}
          <div className="flex flex-col gap-2">
            <Field
              label="Thank you for"
              error={errors.message}
              hint={
                <span
                  className={`block text-right ${
                    messageWords > KUDOS_WORD_LIMITS.message ? "font-semibold text-danger" : ""
                  }`}
                >
                  {messageWords}/{KUDOS_WORD_LIMITS.message} words · Ctrl+Enter sends
                </span>
              }
            >
              {(props) => (
                <Textarea
                  {...props}
                  ref={messageRef}
                  maxLength={MESSAGE_CHAR_MAX}
                  placeholder="What they did, in a few words"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={onMessageKeyDown}
                  rows={4}
                  className={
                    "bg-surface-deep border-border resize-none text-sm text-text" +
                    (messageWords > KUDOS_WORD_LIMITS.message ? " border-danger/60" : "")
                  }
                />
              )}
            </Field>
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
                    <span className="text-warning"> (tone: {sentiment.tone.join(", ")})</span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Sender — read-only display, or a visitor's own name. */}
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
            {!fromOk && <p className="text-xs text-sub">Long names render small on the card.</p>}
          </div>

          {aiSuggestSlot && <div>{aiSuggestSlot}</div>}

          {delivery === "link" ? (
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-sm text-text pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={keepCopy}
                  onChange={(e) => setKeepCopy(e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                Keep a copy on this device
              </label>
              <p className="text-xs text-sub">
                Send gives you a link and a card image to pass on. The card travels in the link
                itself, so nothing is saved anywhere unless you keep a copy here.
              </p>
            </div>
          ) : null}

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
              disabled={submitting}
              className="flex-1 bg-accent text-bg hover:bg-accent/80 font-semibold gap-2"
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
              disabled={!checked.ok}
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
    </div>
  );
}
