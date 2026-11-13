"use client";

/**
 * `/join`'s "type a code" box, for someone who can see the host's code but
 * can't scan its QR code or open its link.
 *
 * It takes the code however it comes (`readJoinInput`): any case, with or
 * without spaces and dashes, full-width characters, or the whole join link
 * pasted in. A pasted link already names its room (its `/join/<tool>/<code>`
 * channel) and carries the host's key, so it goes straight there. A bare
 * code names no tool, and only Planning Poker and Retro rooms can be joined
 * with the code alone: the vote, show and wall rooms trust only the host
 * key in their link (`roomNeedsHostKey`), so for those the box says to scan
 * the QR code or ask for the link, rather than open a room it can't prove.
 *
 * Nothing connects here: the room's own page asks for a name and consent.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  VISITOR_ROOM_KIND,
  joinUrl,
  roomNeedsHostKey,
  type VisitorTool,
} from "@/lib/realtime/visitor-rooms";
import {
  JOIN_INPUT_MAX_CHARS,
  groupRoomCode,
  joinInputMessage,
  readJoinInput,
} from "@/lib/realtime/visitor-code";

/** The rooms a typed code can open, with what the host's screen calls them. */
export const TYPED_CODE_ROOMS: readonly { tool: VisitorTool; name: string }[] = [
  { tool: "planning-poker", name: "Planning Poker" },
  { tool: "retro", name: "Retro" },
];

export interface JoinCodeFormProps {
  /** From `/join?code=…`: filled in, not submitted. */
  initialCode?: string;
}

export function JoinCodeForm({ initialCode = "" }: JoinCodeFormProps) {
  const router = useRouter();
  const [text, setText] = useState(initialCode.slice(0, JOIN_INPUT_MAX_CHARS));
  const [error, setError] = useState<string | null>(null);
  const [which, setWhich] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const whichRef = useRef<HTMLHeadingElement>(null);

  const go = (tool: VisitorTool, code: string, fragment: string | null) => {
    const path = joinUrl(tool, code);
    if (path) router.push(`${path}${fragment ?? ""}`);
  };

  const submit = () => {
    const input = readJoinInput(text);
    if (!input.ok) {
      setError(joinInputMessage(input));
      inputRef.current?.focus();
      return;
    }
    setError(null);
    if (input.tool) {
      if (roomNeedsHostKey(VISITOR_ROOM_KIND[input.tool]) && !input.keyFragment) {
        setError(
          "That link is missing the part that proves the room comes from the host. Ask the host to send it again with Copy link, or scan the QR code."
        );
        inputRef.current?.focus();
        return;
      }
      go(input.tool, input.code, input.keyFragment);
      return;
    }
    setWhich(input.code);
    // The question replaces the box: put focus on it.
    requestAnimationFrame(() => whichRef.current?.focus());
  };

  if (which) {
    return (
      <section aria-labelledby="join-which" className="space-y-4">
        <h2
          id="join-which"
          ref={whichRef}
          tabIndex={-1}
          className="text-base font-semibold text-text outline-none"
        >
          Which room is <span className="font-data tracking-wider">{groupRoomCode(which)}</span>?
        </h2>
        <p className="text-sm text-sub">The host&apos;s screen says which tool is running.</p>
        <div className="flex flex-wrap gap-2">
          {TYPED_CODE_ROOMS.map((r) => (
            <Button
              key={r.tool}
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={() => go(r.tool, which, null)}
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {r.name}
            </Button>
          ))}
        </div>
        <p className="text-sm text-sub">
          A vote, a picker, a team mix, a wall or a card deck needs its QR code or link: the code
          alone can&apos;t show that what you see comes from the host. Scan the code on the
          host&apos;s screen, or ask for the link.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setWhich(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Type another code
        </Button>
      </section>
    );
  }

  const preview = readJoinInput(text);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field
        label="Room code"
        hint="The 12 characters on the host's screen, like ABCD-EFGH-JKMN. Any case, with or without dashes. You can paste the whole link too."
        error={error}
      >
        {(props) => (
          <Input
            {...props}
            ref={inputRef}
            value={text}
            maxLength={JOIN_INPUT_MAX_CHARS}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="font-data tracking-wider"
          />
        )}
      </Field>
      <p className="min-h-5 text-sm text-sub" aria-live="polite">
        {preview.ok && !preview.tool && (
          <>
            Room{" "}
            <span className="font-data tracking-wider text-text">
              {groupRoomCode(preview.code)}
            </span>
          </>
        )}
      </p>
      <Button type="submit" variant="toolkit" className="gap-1.5">
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Join
      </Button>
    </form>
  );
}
