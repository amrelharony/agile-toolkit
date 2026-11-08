"use client";

import { useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFlash } from "@/hooks/use-flash";
import {
  SNAPSHOT_WARN_CHARS,
  SnapshotError,
  encodeSnapshot,
  snapshotsSupported,
} from "@/lib/share/snapshot";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";

export interface SnapshotData {
  markdown: string;
  /** Structured state, for "Copy into my browser" (lib/share/snapshot-import). */
  state?: unknown;
}

/** Build the share URL for a tool's current content. Exported for tests. */
export async function buildSnapshotUrl(
  origin: string,
  toolId: string,
  title: string | undefined,
  data: SnapshotData
): Promise<{ url: string; withState: boolean }> {
  try {
    const payload = await encodeSnapshot({ tool: toolId, schema: 1, title, data });
    return { url: `${origin}/s#${payload}`, withState: data.state !== undefined };
  } catch (err) {
    // Too big with the structured copy: share the read-only view alone.
    if (!(err instanceof SnapshotError) || data.state === undefined) throw err;
    const payload = await encodeSnapshot({
      tool: toolId,
      schema: 1,
      title,
      data: { markdown: data.markdown },
    });
    return { url: `${origin}/s#${payload}`, withState: false };
  }
}

/** What a share link promises, for the button's tooltip. */
export const SHARE_LINK_NOTE =
  "Anyone with the link sees a read-only copy. The content travels inside the link and isn't stored anywhere.";

/** The short form, shown under the Export menu item. */
export const SHARE_LINK_SHORT_NOTE = "Anyone with it sees a read-only copy.";

/**
 * What a successful copy announces (and the pop-up says, for users who want
 * confirmations as pop-ups): touch users never see the tooltip.
 */
export const SHARE_LINK_COPIED = `Share link copied. ${SHARE_LINK_SHORT_NOTE}`;

/**
 * Create a snapshot link for a tool's content and copy it. Returns true when
 * the link is on the clipboard: the caller confirms that inline ("Link
 * copied ✓"). Failures, and a link long enough that chat apps may cut it,
 * get a toast. Used by ShareLinkButton and the Export menu.
 */
export async function shareSnapshotLink({
  toolId,
  title,
  markdown,
  state,
}: {
  toolId: string;
  title?: string;
  markdown: string;
  state?: unknown;
}): Promise<boolean> {
  if (!snapshotsSupported()) {
    toast.error("This browser can't create share links", {
      description: "Use Export → Copy as Markdown instead.",
    });
    return false;
  }
  try {
    const { url } = await buildSnapshotUrl(window.location.origin, toolId, title, {
      markdown,
      state,
    });
    if (!(await copyToClipboard(url))) {
      toast.error("Couldn't copy the link");
      return false;
    }
    if (url.length > SNAPSHOT_WARN_CHARS) {
      toast.warning("Link copied, but it's long", {
        description: "Some chat apps cut long links, so check it opens.",
      });
    }
    return true;
  } catch (err) {
    toast.error(err instanceof SnapshotError ? err.message : "Couldn't create the link");
    return false;
  }
}

/**
 * "Share link": copies a link that opens a read-only copy of this tool's
 * content (/s). The content travels inside the link's #fragment, which
 * browsers never send to a server, so nothing is uploaded or stored.
 */
export function ShareLinkButton({
  toolId,
  title,
  markdown,
  state,
  className,
}: {
  toolId: string;
  title?: string;
  markdown: string;
  state?: unknown;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  // A ref guards a second click: a native `disabled` on the focused button
  // would drop keyboard focus to <body>.
  const busyRef = useRef(false);
  const { flash, isFlashing } = useFlash();
  const share = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (await shareSnapshotLink({ toolId, title, markdown, state })) flash(SHARE_LINK_COPIED);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const copied = isFlashing();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={share}
      aria-disabled={busy || undefined}
      className={className}
      title={SHARE_LINK_NOTE}
    >
      {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
      {copied ? "Link copied" : "Share link"}
    </Button>
  );
}
