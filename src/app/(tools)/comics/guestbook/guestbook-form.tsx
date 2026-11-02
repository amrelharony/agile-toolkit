"use client";

import { useRef, useState } from "react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_GUESTBOOK_DRAFT,
  GUESTBOOK_LIMITS,
  validateGuestbookDraft,
  type GuestbookDraft,
  type GuestbookField,
} from "@/lib/comics/guestbook";

const ENDPOINT = "/api/comics/guestbook";

type Status = "idle" | "sending" | "sent" | "failed" | "limited" | "full";

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.json()) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

const FAILURE: Partial<Record<Status, string>> = {
  failed: "We couldn't take your note just now. Please try again later.",
  limited: "Too many notes from here. Please try again in an hour.",
  full: "The guestbook has a lot of notes waiting to be read. Please try again in a few days.",
};

/** Leave a note. Nothing shows until Amr has read and approved it. */
export function GuestbookForm() {
  const [status, setStatus] = useState<Status>("idle");
  const honeypot = useRef<HTMLInputElement>(null);

  const send = async (values: GuestbookDraft) => {
    setStatus("sending");
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, website: honeypot.current?.value ?? "" }),
      });
      if (!res.ok) {
        if (res.status === 429) setStatus("limited");
        else setStatus((await errorCode(res)) === "guestbook_full" ? "full" : "failed");
        return;
      }
      form.reset();
      setStatus("sent");
    } catch {
      setStatus("failed");
    }
  };

  const form = useItemForm<GuestbookDraft, GuestbookDraft, GuestbookField>({
    initial: EMPTY_GUESTBOOK_DRAFT,
    validate: validateGuestbookDraft,
    onSave: (values) => {
      if (status !== "sending") void send(values);
    },
    resetOnSave: false,
  });
  const { draft, update, errors } = form;

  return (
    <ItemForm form={form} submitLabel={status === "sending" ? "Sending..." : "Sign the guestbook"}>
      <Field label="Your name" hint="Shown with your note." required error={errors.name}>
        {(props) => (
          <Input
            {...props}
            autoComplete="nickname"
            maxLength={GUESTBOOK_LIMITS.name}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        )}
      </Field>
      <Field label="Your note" required error={errors.message}>
        {(props) => (
          <Textarea
            {...props}
            rows={4}
            maxLength={GUESTBOOK_LIMITS.message}
            value={draft.message}
            onChange={(e) => update({ message: e.target.value })}
          />
        )}
      </Field>

      {/* A trap for bots: hidden from people and from screen readers. */}
      <div aria-hidden="true" className="sr-only">
        <label>
          Leave this field empty
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {status === "sent" ? (
        <p role="status" className="text-sm font-medium text-text">
          Thanks for your note. It will appear here once Amr has read it.
        </p>
      ) : null}
      {FAILURE[status] ? (
        <p role="alert" className="text-sm text-danger">
          {FAILURE[status]}
        </p>
      ) : null}
    </ItemForm>
  );
}
