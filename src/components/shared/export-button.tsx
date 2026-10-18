"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";
import {
  Download,
  Copy,
  FileJson,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Link2,
} from "lucide-react";
import { getToolByPath } from "@/lib/constants/tools";
import { shareSnapshotLink } from "@/components/share/share-link-button";
import {
  exportToCSV,
  exportToJSON,
  exportToMarkdown,
  exportToPNG,
  copyToClipboard,
} from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";

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
}

export function ExportButton({
  filename,
  clipboardText,
  csvData,
  jsonData,
  markdown,
  shareState,
  targetRef,
}: ExportButtonProps) {
  const pathname = usePathname();
  const tool = pathname ? getToolByPath(pathname) : undefined;

  const handleCopy = async () => {
    if (clipboardText) {
      const success = await copyToClipboard(clipboardText);
      if (success) toast.success("Copied to clipboard");
      else toast.error("Failed to copy");
    }
  };

  const handleCSV = () => {
    if (csvData) {
      exportToCSV(csvData.headers, csvData.rows, filename);
      toast.success("CSV exported");
    }
  };

  const handleCopyMarkdown = async () => {
    if (!markdown) return;
    if (await copyToClipboard(markdown)) toast.success("Copied as Markdown");
    else toast.error("Failed to copy");
  };

  const handleShare = () => {
    if (!markdown || !tool) return;
    void shareSnapshotLink({ toolId: tool.id, title: filename, markdown, state: shareState });
  };

  const handleMarkdown = () => {
    if (!markdown) return;
    exportToMarkdown(markdown, filename);
    toast.success("Markdown exported");
  };

  const handleJSON = () => {
    if (jsonData) {
      exportToJSON(jsonData, filename);
      toast.success("JSON exported");
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
      toast.success("PNG exported");
    } catch {
      toast.error("Failed to export PNG");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border hover:border-accent/30 hover:bg-accent/5 text-sub hover:text-text"
        >
          <Download className="w-4 h-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-surface border-border">
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
              <DropdownMenuItem onClick={handleShare} className="gap-2 cursor-pointer">
                <Link2 className="w-4 h-4" aria-hidden="true" />
                Copy share link
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
