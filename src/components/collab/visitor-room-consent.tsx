"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Radio } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cleanName, MAX_NAME_LENGTH } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS, visitorRoomsEnabled } from "@/lib/realtime/visitor-rooms";

/** What the dialog tells people before any channel opens. Exported for tests. */
export const VISITOR_ROOM_CONSENT_TEXT =
  "What you type passes through our realtime provider (Supabase) to everyone with the link. " +
  "We don't store it; the room disappears when everyone leaves. " +
  "Share the link only with your team.";

/**
 * The vote-round variant: answers are numbers, encrypted to the host's
 * browser, and only totals are kept and shown. It promises no more than
 * that: the totals of a unanimous question show everyone's answer.
 * Exported for tests.
 */
export const VOTE_ROOM_CONSENT_TEXT =
  "Answers are encrypted in each person's browser, so only the host's browser can read them, " +
  "and it keeps the totals only. They pass through our realtime provider (Supabase). " +
  "Others in the room see your name and whether you've answered, not what. " +
  "After the host reveals the results, everyone in the room sees the totals, for questions " +
  "with enough answers; if everyone gives the same answer, the totals show it. " +
  "Share the link only with your team.";

/** The box people tick, per variant. */
const CONSENT_CHECKBOX = {
  board: "I understand that anyone with the link can see what I type.",
  vote: "I understand that everyone in the room sees my name and whether I've answered.",
} as const;

export interface VisitorRoomConsentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "start": the person opening a new room. "join": someone following a link. */
  mode: "start" | "join";
  /** Shown in the title, e.g. "Planning Poker". */
  toolName: string;
  /** Prefills the name field each time the dialog opens. */
  defaultName?: string;
  /**
   * "board" (default): Poker and Retro, where what people type is shared.
   * "vote": an anonymous vote round, where only encrypted numbers are.
   */
  variant?: "board" | "vote";
  /**
   * Called once, with the cleaned name, after the person gave a name and
   * ticked the consent box. Open the channel only from here (typically
   * `saveVisitorIdentity(code, name)` then `useRoom(…, { visitor: true })`).
   */
  onConfirm: (name: string) => void;
}

/**
 * Consent and name in one step, before a visitor room connects. Renders
 * nothing while the feature flag is off.
 */
export function VisitorRoomConsent({
  open,
  onOpenChange,
  mode,
  toolName,
  defaultName = "",
  variant = "board",
  onConfirm,
}: VisitorRoomConsentProps) {
  const [name, setName] = useState(defaultName);
  const [agreed, setAgreed] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const consentId = useId();
  const consentErrorId = `${consentId}-error`;

  // Start fresh every time the dialog opens: consent is never carried over.
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setAgreed(false);
    setNameError(null);
    setConsentError(null);
  }, [open, defaultName]);

  if (!visitorRoomsEnabled()) return null;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = name.trim() === "" ? null : cleanName(name);
    const nextNameError =
      name.trim() === ""
        ? "Enter your name."
        : clean === null
          ? "That name contains hidden formatting characters. Type it again without them."
          : null;
    const nextConsentError = agreed ? null : "Tick the box to confirm before you continue.";
    setNameError(nextNameError);
    setConsentError(nextConsentError);
    if (nextNameError || nextConsentError || clean === null) return;
    onConfirm(clean);
  };

  const action = mode === "start" ? "Start room" : "Join room";
  const consentText = variant === "vote" ? VOTE_ROOM_CONSENT_TEXT : VISITOR_ROOM_CONSENT_TEXT;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-accent" aria-hidden="true" />
              {mode === "start"
                ? `Start a live ${toolName} room`
                : `Join the live ${toolName} room`}
            </DialogTitle>
            <DialogDescription>{consentText}</DialogDescription>
          </DialogHeader>

          <p className="text-xs text-sub">
            Up to {VISITOR_LIMITS.maxMembers} people. The room closes after{" "}
            {Math.round(VISITOR_LIMITS.hardTtlMs / 3_600_000)} hours at most.
          </p>

          <Field label="Your name" hint="Everyone in the room sees it." error={nameError} required>
            {(props) => (
              <Input
                {...props}
                value={name}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="nickname"
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
              />
            )}
          </Field>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-2 text-sm text-text cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={agreed}
                aria-invalid={consentError ? true : undefined}
                aria-describedby={consentError ? consentErrorId : undefined}
                onChange={(e) => {
                  setAgreed(e.target.checked);
                  if (e.target.checked) setConsentError(null);
                }}
              />
              <span>{CONSENT_CHECKBOX[variant]}</span>
            </label>
            {consentError && (
              <p id={consentErrorId} className="text-xs text-danger" role="alert">
                {consentError}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="toolkit">
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
