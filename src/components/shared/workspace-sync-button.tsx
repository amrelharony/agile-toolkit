"use client";

import { useState } from "react";
import { Database, Download, Upload, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/utils/toast";

interface WorkspaceSyncButtonProps {
  toolName: string;
  hasImport?: boolean;
  hasPush?: boolean;
  onImport?: () => number | void;
  onPush?: () => number | void;
  onUnlink?: () => void;
  disabled?: boolean;
}

export function WorkspaceSyncButton({
  toolName,
  hasImport = true,
  hasPush = true,
  onImport,
  onPush,
  onUnlink,
  disabled,
}: WorkspaceSyncButtonProps) {
  const [open, setOpen] = useState(false);

  // A count of 0 means nothing moved, so it gets a neutral notice rather
  // than a success toast claiming work was done.
  const handleImport = () => {
    const n = onImport?.();
    if (n === 0) toast.info("Nothing new to import from Workspace");
    else if (typeof n === "number")
      toast.success(`Imported ${n} item${n === 1 ? "" : "s"} from Workspace`);
    else if (onImport) toast.success("Imported from Workspace");
    setOpen(false);
  };

  const handlePush = () => {
    // Push overwrites the workspace copy of this tool's entities with the
    // tool's local state. A double-click on the dropdown shouldn't trigger
    // it accidentally — confirm before destroying potentially-newer data.
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Overwrite Workspace data for "${toolName}" with this tool's current state? This cannot be undone.`
      )
    ) {
      setOpen(false);
      return;
    }
    const n = onPush?.();
    if (n === 0) toast.info("Nothing to push to Workspace");
    else if (typeof n === "number")
      toast.success(`Pushed ${n} item${n === 1 ? "" : "s"} to Workspace`);
    else if (onPush) toast.success("Pushed to Workspace");
    setOpen(false);
  };

  const handleUnlink = () => {
    if (typeof window !== "undefined" && !window.confirm(`Unlink "${toolName}" from Workspace?`)) {
      setOpen(false);
      return;
    }
    onUnlink?.();
    toast.success("Unlinked from Workspace");
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-2 border-border hover:border-accent/30 hover:bg-accent/5 text-sub hover:text-text"
        >
          <Database className="w-4 h-4" />
          Workspace
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-surface border-border min-w-[200px]">
        <DropdownMenuLabel className="text-xs text-sub">{toolName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hasImport && onImport && (
          <DropdownMenuItem onClick={handleImport} className="gap-2 cursor-pointer">
            <Download className="w-4 h-4" />
            Import from Workspace
          </DropdownMenuItem>
        )}
        {hasPush && onPush && (
          <DropdownMenuItem onClick={handlePush} className="gap-2 cursor-pointer">
            <Upload className="w-4 h-4" />
            Push to Workspace
          </DropdownMenuItem>
        )}
        {onUnlink && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleUnlink} className="gap-2 cursor-pointer text-danger">
              <Unlink className="w-4 h-4" />
              Unlink
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
