"use client";

import { useEffect, useState } from "react";
import Link from "@/components/motion/transition-link";
import { useRouter } from "next/navigation";
import { Download, Eye, FileInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InkArt } from "@/components/ink/ink-art";
import { InkScribble } from "@/components/ink/ink-scribble";
import { brokenLinkArt } from "@/lib/ink/drawings/pages/broken-link";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MarkdownView } from "@/components/share/markdown-view";
import type { SnapshotData } from "@/components/share/share-link-button";
import { getToolById } from "@/lib/constants/tools";
import {
  SnapshotError,
  decodeSnapshot,
  snapshotsSupported,
  type SnapshotEnvelope,
} from "@/lib/share/snapshot";
import { SNAPSHOT_IMPORTERS } from "@/lib/share/snapshot-import";
import { exportToMarkdown } from "@/lib/utils/export";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";

const MAX_MARKDOWN = 200_000;

function isSnapshotData(data: unknown): data is SnapshotData {
  const d = data as SnapshotData | null;
  return (
    !!d &&
    typeof d === "object" &&
    typeof d.markdown === "string" &&
    d.markdown.length > 0 &&
    d.markdown.length <= MAX_MARKDOWN
  );
}

type View =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: SnapshotEnvelope<SnapshotData> };

/**
 * Opens a snapshot link: a read-only copy of a tool's content that travels
 * in the URL fragment (lib/share/snapshot). Rendered from Markdown as React
 * elements, never as HTML. "Copy into my browser" is offered for tools that
 * can import it (lib/share/snapshot-import).
 */
export function SnapshotClient() {
  const router = useRouter();
  const [view, setView] = useState<View>({ status: "loading" });
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash;
      if (!hash || hash === "#") {
        setView({ status: "empty" });
        return;
      }
      if (!snapshotsSupported()) {
        setView({
          status: "error",
          message:
            "This browser can't open snapshot links. Try a current Chrome, Edge, Firefox or Safari.",
        });
        return;
      }
      setView({ status: "loading" });
      decodeSnapshot(hash, isSnapshotData)
        .then((snapshot) => setView({ status: "ready", snapshot }))
        .catch((err) =>
          setView({
            status: "error",
            message:
              err instanceof SnapshotError ? err.message : "The link is damaged or incomplete.",
          })
        );
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  if (view.status === "loading") {
    return (
      <div
        className="container-tool flex flex-col items-start gap-2 py-10 text-sm text-sub"
        role="status"
      >
        <InkScribble />
        <span>Opening the snapshot…</span>
      </div>
    );
  }

  if (view.status === "empty" || view.status === "error") {
    return (
      <div className="ink-host container-tool max-w-xl py-10">
        <InkArt drawing={brokenLinkArt} boil className="mb-3 h-16 w-16" />
        <h1 className="font-display text-fluid-h2 font-bold text-text">
          {view.status === "empty" ? "No snapshot in this link" : "Can't open this snapshot"}
        </h1>
        <p className="mt-2 text-sm text-sub">
          {view.status === "empty"
            ? "Snapshot links carry a read-only copy of a board after the # in the address. Ask whoever shared it to copy the full link again."
            : view.message}
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Go to the toolkit</Link>
        </Button>
      </div>
    );
  }

  const { snapshot } = view;
  const tool = getToolById(snapshot.tool);
  const importer = SNAPSHOT_IMPORTERS[snapshot.tool];
  const canImport = Boolean(importer && snapshot.data.state !== undefined);
  const shared = snapshot.createdAt ? new Date(snapshot.createdAt) : null;

  const doImport = () => {
    if (!importer) return;
    let undo: (() => void) | null = null;
    undoable({
      label: `Copied into your ${tool?.name ?? "toolkit"}`,
      apply: () => {
        undo = importer.importState(snapshot.data.state);
      },
      revert: () => undo?.(),
    });
    if (!undo) {
      toast.error("This snapshot can't be copied", {
        description: "Its data doesn't match the tool. You can still read it and download it.",
      });
      return;
    }
    router.push(importer.href);
  };

  return (
    <div className="container-tool max-w-3xl py-8">
      <div className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-text">
          <Eye className="h-4 w-4 text-accent" aria-hidden="true" />
          Read-only snapshot{tool ? ` from ${tool.name}` : ""}
        </p>
        <p className="mt-1 text-sub">
          {shared && !Number.isNaN(shared.getTime())
            ? `Shared ${shared.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. `
            : ""}
          The content travels inside this link and isn&apos;t stored on any server.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {canImport && (
            <Button
              type="button"
              size="sm"
              onClick={() => (importer!.replaces ? setConfirmOpen(true) : doImport())}
            >
              <FileInput aria-hidden="true" />
              Copy into my browser
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              exportToMarkdown(snapshot.data.markdown, snapshot.title || snapshot.tool)
            }
          >
            <Download aria-hidden="true" />
            Download .md
          </Button>
          {tool && (
            <Button asChild size="sm" variant="ghost">
              <Link href={tool.path}>Open {tool.name}</Link>
            </Button>
          )}
        </div>
        {canImport && <p className="mt-2 text-xs text-sub">{importer!.describe}</p>}
      </div>

      <article aria-label={snapshot.title ?? "Shared snapshot"}>
        <h1 className="sr-only">{snapshot.title ?? `Shared ${tool?.name ?? "snapshot"}`}</h1>
        <MarkdownView markdown={snapshot.data.markdown} />
      </article>

      {importer?.replaces && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Replace your ${tool?.name ?? "board"}?`}
          description={importer.describe}
          confirmLabel="Replace"
          onConfirm={doImport}
        />
      )}
    </div>
  );
}
