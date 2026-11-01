"use client";

import { useRef, useState } from "react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_LICENCE_DRAFT,
  LICENCE_LIMITS,
  validateLicenceDraft,
  type LicenceDraft,
  type LicenceField,
} from "@/lib/comics/licence";

const ENDPOINT = "/api/comics/licence";

type Status = "idle" | "sending" | "sent" | "failed" | "limited" | "full";

/** What the server calls a failure, or nothing when the answer isn't JSON. */
async function errorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.json()) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

const FAILURE: Partial<Record<Status, string>> = {
  failed: "We couldn't take your request just now. Please try again later.",
  limited: "Too many requests from here. Please try again in an hour.",
};

export function LicenceForm() {
  const [status, setStatus] = useState<Status>("idle");
  const honeypot = useRef<HTMLInputElement>(null);

  const send = async (values: LicenceDraft) => {
    setStatus("sending");
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, website: honeypot.current?.value ?? "" }),
      });
      if (!res.ok) {
        if (res.status === 429) setStatus("limited");
        else setStatus((await errorCode(res)) === "inbox_full" ? "full" : "failed");
        return;
      }
      form.reset();
      setStatus("sent");
    } catch {
      setStatus("failed");
    }
  };

  const form = useItemForm<LicenceDraft, LicenceDraft, LicenceField>({
    initial: EMPTY_LICENCE_DRAFT,
    validate: validateLicenceDraft,
    onSave: (values) => {
      if (status !== "sending") void send(values);
    },
    // Kept until the server has it, so a failed send loses nothing.
    resetOnSave: false,
  });
  const { draft, update, errors } = form;

  return (
    <ItemForm form={form} submitLabel={status === "sending" ? "Sending..." : "Send request"}>
      <Field label="Your name" required error={errors.name}>
        {(props) => (
          <Input
            {...props}
            autoComplete="name"
            maxLength={LICENCE_LIMITS.name}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        )}
      </Field>
      <Field label="Company" required error={errors.company}>
        {(props) => (
          <Input
            {...props}
            autoComplete="organization"
            maxLength={LICENCE_LIMITS.company}
            value={draft.company}
            onChange={(e) => update({ company: e.target.value })}
          />
        )}
      </Field>
      <Field label="Work email" required error={errors.email}>
        {(props) => (
          <Input
            {...props}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={LICENCE_LIMITS.email}
            value={draft.email}
            onChange={(e) => update({ email: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="How would you like to use the comic?"
        hint="For example: slides for a training course, or our company newsletter."
        required
        error={errors.intendedUse}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            maxLength={LICENCE_LIMITS.intendedUse}
            value={draft.intendedUse}
            onChange={(e) => update({ intendedUse: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Team size"
        hint="How many people would see it?"
        required
        error={errors.teamSize}
      >
        {(props) => (
          <Input
            {...props}
            maxLength={LICENCE_LIMITS.teamSize}
            value={draft.teamSize}
            onChange={(e) => update({ teamSize: e.target.value })}
          />
        )}
      </Field>
      <Field label="Message (optional)" error={errors.message}>
        {(props) => (
          <Textarea
            {...props}
            rows={4}
            maxLength={LICENCE_LIMITS.message}
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
          Thanks, your request is in. We&apos;ll reply to your work email.
        </p>
      ) : null}
      {FAILURE[status] ? (
        <p role="alert" className="text-sm text-danger">
          {FAILURE[status]}
        </p>
      ) : null}
      {/* Spam can fill the inbox, so a real request needs another way through. */}
      {status === "full" ? (
        <p role="alert" className="text-sm text-danger">
          Our request inbox is full right now. What you typed is still here. Please reach Amr
          through{" "}
          <a
            href="https://amrelharony.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            amrelharony.com
          </a>{" "}
          instead.
        </p>
      ) : null}
    </ItemForm>
  );
}
