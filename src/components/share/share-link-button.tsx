"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/**
 * Create a snapshot link for a tool's content and copy it, with toasts for
 * the outcome. Used by ShareLinkButton and the Export menu.
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
}): Promise<void> {
  if (!snapshotsSupported()) {
    toast.error("This browser can't create share links", {
      description: "Use Export → Copy as Markdown instead.",
    });
    return;
  }
  try {
    const { url } = await buildSnapshotUrl(window.location.origin, toolId, title, {
      markdown,
      state,
    });
    if (!(await copyToClipboard(url))) {
      toast.error("Couldn't copy the link");
      return;
    }
    toast.success("Share link copied", {
      description:
        url.length > SNAPSHOT_WARN_CHARS
          ? "It's a long link; some chat apps cut long links, so check it opens. The content travels inside the link and isn't stored anywhere."
          : "Anyone with the link sees a read-only copy. The content travels inside the link and isn't stored anywhere.",
    });
  } catch (err) {
    toast.error(err instanceof SnapshotError ? err.message : "Couldn't create the link");
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
  const share = async () => {
    setBusy(true);
    try {
      await shareSnapshotLink({ toolId, title, markdown, state });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={share}
      disabled={busy}
      className={className}
    >
      <Link2 aria-hidden="true" />
      Share link
    </Button>
  );
}
