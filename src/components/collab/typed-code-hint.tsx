"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * For a room that stays empty: someone who typed a bare code at `/join`
 * picks the tool themselves (a code doesn't say which), and a wrong pick
 * opens an empty channel that just waits. This says what to check and
 * links back to `/join` with the code filled in. `afterMs`: show it only
 * after that long (0: at once, for a hint already shown late).
 */
export function TypedCodeHint({
  code,
  toolName,
  afterMs = 0,
}: {
  code: string;
  /** What the host's screen calls this room, e.g. "Planning Poker". */
  toolName: string;
  afterMs?: number;
}) {
  const [show, setShow] = useState(afterMs <= 0);
  useEffect(() => {
    if (afterMs <= 0) return;
    const t = window.setTimeout(() => setShow(true), afterMs);
    return () => window.clearTimeout(t);
  }, [afterMs]);
  if (!show) return null;
  return (
    <p className="max-w-sm text-sm text-sub">
      Typed the code? Check that the host&apos;s screen says {toolName}, or{" "}
      <Link
        href={`/join?code=${encodeURIComponent(code)}`}
        className="rounded text-accent underline underline-offset-2 hover:text-text"
      >
        type it again and pick another room
      </Link>
      .
    </p>
  );
}
