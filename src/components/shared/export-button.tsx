"use client";

import { useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";
import {
  Check,
  Download,
  Copy,
  FileJson,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Link2,
} from "lucide-react";
import { getToolByPath } from "@/lib/constants/tools";
import {
  SHARE_LINK_COPIED,
  SHARE_LINK_SHORT_NOTE,
  shareSnapshotLink,
} from "@/components/share/share-link-button";
import {
  exportToCSV,
  exportToJSON,
  exportToMarkdown,
  exportToPNG,
  copyToClipboard,
} from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";
import { useFlash } from "@/hooks/use-flash";

type MenuAlign = "start" | "center" | "end";

interface ExportButtonProps {
  filename: string;
  clipboardText?: string;
  csvData?: { headers: string[]; rows: (string | number)[][] };
  jsonData?: unknown;
  /** The tool's content as Markdown, for pasting into a wiki, ticket or chat.
   *  Also enables "Copy share link" (a read-only snapshot at /s). */
  markdown?: string;
  /** Structured state carried in the share link so the recipient can
   *  "Copy into my browser" (tools listed in lib/share/snapshot-import). */
  shareState?: unknown;
  targetRef?: React.RefObject<HTMLElement | null>;
  /** Which edge of the button the menu lines up with. Left out, it follows
   *  the button (see menuAlignFor). */
  align?: MenuAlign;
  /** What this button exports, for a screen reader, when a page has several
   *  (e.g. one per saved wall): the name becomes "Export: <context>". */
  context?: string;
}

/**
 * The menu opens inward, toward the middle of the screen: lined up with the
 * button's start edge when the button sits in the left half (a phone, where
 * a tool's actions wrap to the left), with its end edge in the right half (the
 * right-aligned action rows on wider screens, which always used "end").
 */
export function menuAlignFor(
  button: Pick<DOMRect, "left" | "width">,
  viewportWidth: number
): "start" | "end" {
  return button.left + button.width / 2 < viewportWidth / 2 ? "start" : "end";
}

export function ExportButton({
  filename,
  clipboardText,
  csvData,
  jsonData,
  markdown,
  shareState,
  targetRef,
  align,
  context,
}: ExportButtonProps) {
  const pathname = usePathname();
  const tool = pathname ? getToolByPath(pathname) : undefined;
  // The menu closes on click, so the trigger itself confirms: "Copied ✓" /
  // "Exported ✓" for a moment, no toast. Failures still get a toast.
  const { flash, flashing } = useFlash();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [autoAlign, setAutoAlign] = useState<"start" | "end">("end");

  // Controlled so the alignment is worked out in the same update that opens
  // the menu; the first frame already sits on the right side.
  const handleOpenChange = (next: boolean) => {
    if (next && !align && triggerRef.current) {
      setAutoAlign(menuAlignFor(triggerRef.current.getBoundingClientRect(), window.innerWidth));
    }
    setOpen(next);
  };

  const handleCopy = async () => {
    if (clipboardText) {
      const success = await copyToClipboard(clipboardText);
      if (success) flash("Copied to clipboard", "copied");
      else toast.error("Failed to copy");
    }
  };

  const handleCSV = () => {
    if (csvData) {
      exportToCSV(csvData.headers, csvData.rows, filename);
      flash("CSV exported", "exported");
    }
  };

  const handleCopyMarkdown = async () => {
    if (!markdown) return;
    if (await copyToClipboard(markdown)) flash("Copied as Markdown", "copied");
    else toast.error("Failed to copy");
  };

  const handleShare = () => {
    if (!markdown || !tool) return;
    void shareSnapshotLink({
      toolId: tool.id,
      title: filename,
      markdown,
      state: shareState,
    }).then((ok) => {
      if (ok) flash(SHARE_LINK_COPIED, "copied");
    });
  };

  const handleMarkdown = () => {
    if (!markdown) return;
    exportToMarkdown(markdown, filename);
    flash("Markdown exported", "exported");
  };

  const handleJSON = () => {
    if (jsonData) {
      exportToJSON(jsonData, filename);
      flash("JSON exported", "exported");
    }
  };

  const handlePNG = async () => {
    const el = targetRef?.current;
    if (!el) {
      toast.error("Chart not ready yet — try again in a moment");
      return;
    }
    try {
      await exportToPNG(el, filename);
      flash("PNG exported", "exported");
    } catch {
      toast.error("Failed to export PNG");
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild ref={triggerRef}>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border hover:border-accent/30 hover:bg-accent/5 text-sub hover:text-text"
        >
          {flashing ? (
            <Check className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4" aria-hidden="true" />
          )}
          {flashing === "copied" ? "Copied" : flashing === "exported" ? "Exported" : "Export"}
          {context && !flashing && <span className="sr-only">: {context}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align ?? autoAlign} className="bg-surface border-border">
        {clipboardText && (
          <DropdownMenuItem onClick={handleCopy} className="gap-2 cursor-pointer">
            <Copy className="w-4 h-4" />
            Copy to Clipboard
          </DropdownMenuItem>
        )}
        {markdown && (
          <>
            <DropdownMenuItem onClick={handleCopyMarkdown} className="gap-2 cursor-pointer">
              <Copy className="w-4 h-4" aria-hidden="true" />
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleMarkdown} className="gap-2 cursor-pointer">
              <FileText className="w-4 h-4" aria-hidden="true" />
              Download Markdown (.md)
            </DropdownMenuItem>
            {tool && (
              <DropdownMenuItem onClick={handleShare} className="gap-2 cursor-pointer items-start">
                <Link2 className="w-4 h-4 mt-0.5" aria-hidden="true" />
                <span className="flex flex-col">
                  Copy share link
                  <span className="text-xs text-sub">{SHARE_LINK_SHORT_NOTE}</span>
                </span>
              </DropdownMenuItem>
            )}
          </>
        )}
        {csvData && (
          <DropdownMenuItem onClick={handleCSV} className="gap-2 cursor-pointer">
            <FileSpreadsheet className="w-4 h-4" />
            Export CSV
          </DropdownMenuItem>
        )}
        {jsonData !== undefined && (
          <DropdownMenuItem onClick={handleJSON} className="gap-2 cursor-pointer">
            <FileJson className="w-4 h-4" />
            Export JSON
          </DropdownMenuItem>
        )}
        {/* Render the PNG option whenever a ref prop is provided; reading
            `targetRef.current` here only works on the second render (refs are
            null during the first pass), which made PNG export disappear on
            initial page load. */}
        {targetRef && (
          <DropdownMenuItem onClick={handlePNG} className="gap-2 cursor-pointer">
            <ImageIcon className="w-4 h-4" />
            Export PNG
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
