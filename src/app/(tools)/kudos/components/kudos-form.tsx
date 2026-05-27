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
 *     read-only so they can sanity-check it.
 *
 * Validation mirrors the original HTML's UX (50-word message cap,
 * short word caps on names) with live counters. The Send button is
 * disabled until the form is valid.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Download, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/shared/section-card";
import type { Kudos, KudosTheme } from "@/lib/stores/workspace-types";
import { KUDOS_THEMES, KUDOS_WORD_LIMITS, countWords } from "../types";
import { KudosCard } from "./kudos-card";

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
  /** Sender display name (read-only). */
  defaultFromName: string;
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
  defaultFromProfileId,
  defaultTeamName,
  recipients,
  onSubmit,
  onDownload,
  aiSuggestSlot,
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
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (!recipientId && recipients.length > 0) {
      setRecipientId(recipients[0].id);
      didAutoSelectRef.current = true;
    }
  }, [recipientId, recipients]);

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
      <SectionCard
        title="Compose kudos"
        className="border-border/40 bg-surface"
        headerClassName="pb-3"
        contentClassName="flex flex-col gap-4"
      >
        {/* Theme picker — chip-style for tactile feel. Matches the
            "kudos type" select in the original HTML. */}
        <div className="flex flex-col gap-2">
          <Label className="text-sub text-sm">Kudos type</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {KUDOS_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                aria-pressed={theme === t.id}
                className={[
                  "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                  "flex items-center gap-1.5 justify-center",
                  theme === t.id
                    ? `${t.accent} bg-accent/5`
                    : "border-border/40 bg-surface-deep text-sub hover:border-border hover:text-text",
                ].join(" ")}
              >
                <span aria-hidden="true">{t.emoji}</span>
                <span>{t.title}</span>
              </button>
            ))}
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
            className="h-10 rounded-md bg-surface-deep border border-border/40 px-3 text-sm text-text"
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
              value={freeRecipient}
              onChange={(e) => setFreeRecipient(e.target.value)}
              maxLength={64}
              autoFocus
              className="bg-surface-deep border-border/40 text-text mt-1"
            />
          )}
          {!toOk && selectedRecipient && (
            <p className="text-xs text-amber-400">Up to {KUDOS_WORD_LIMITS.to} words.</p>
          )}
        </div>

        {/* Sender — read-only display + optional team label. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label className="text-sub text-sm">From</Label>
            <Input
              value={defaultFromName}
              readOnly
              className="bg-surface-deep border-border/40 text-text/80"
            />
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
              className="bg-surface-deep border-border/40 text-text"
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
              "bg-surface-deep border-border/40 resize-none text-sm text-text" +
              (!messageOk && messageWords > KUDOS_WORD_LIMITS.message ? " border-red-500/60" : "")
            }
          />
          <div
            className={`text-xs text-right ${
              messageWords > KUDOS_WORD_LIMITS.message
                ? "text-red-400 font-semibold"
                : "text-sub/60"
            }`}
          >
            {messageWords}/{KUDOS_WORD_LIMITS.message} words
          </div>
        </div>

        {aiSuggestSlot && <div>{aiSuggestSlot}</div>}

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
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
            className="border-border/40 text-sub hover:text-text gap-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download PNG
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        title="Live preview"
        className="border-border/40 bg-surface"
        headerClassName="pb-3"
        contentClassName="flex justify-center"
      >
        <KudosCard ref={cardRef} kudos={preview} />
      </SectionCard>
    </form>
  );
}
