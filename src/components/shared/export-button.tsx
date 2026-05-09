"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Download, Copy, FileJson, FileSpreadsheet, ImageIcon } from "lucide-react";
import { exportToCSV, exportToJSON, exportToPNG, copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";

interface ExportButtonProps {
  filename: string;
  clipboardText?: string;
  csvData?: { headers: string[]; rows: (string | number)[][] };
  jsonData?: unknown;
  targetRef?: React.RefObject<HTMLElement | null>;
}

export function ExportButton({
  filename,
  clipboardText,
  csvData,
  jsonData,
  targetRef,
}: ExportButtonProps) {
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
      <DropdownMenuContent
        align="end"
        className="bg-surface border-border"
      >
        {clipboardText && (
          <DropdownMenuItem onClick={handleCopy} className="gap-2 cursor-pointer">
            <Copy className="w-4 h-4" />
            Copy to Clipboard
          </DropdownMenuItem>
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
