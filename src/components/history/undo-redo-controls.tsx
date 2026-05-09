"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2 } from "lucide-react";
import { useTimeTravel } from "@/lib/stores/use-time-travel";
import { cn } from "@/lib/utils";

interface UndoRedoControlsProps {
  toolId: string;
}

/**
 * Per-tool undo/redo controls. Only renders when the tool's store has opted
 * into the `withTimeTravel` middleware. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z are
 * wired globally; this component just exposes click affordances.
 */
export function UndoRedoControls({ toolId }: UndoRedoControlsProps) {
  const { controls, canUndo, canRedo, available } = useTimeTravel(toolId);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(
      typeof navigator !== "undefined" &&
        (navigator.platform.toUpperCase().includes("MAC") ||
          navigator.userAgent.includes("Mac"))
    );
  }, []);

  if (!available) return null;

  const undoTip = `Undo (${isMac ? "⌘" : "Ctrl"}+Z)`;
  const redoTip = `Redo (${isMac ? "⌘⇧" : "Ctrl+Shift"}+Z)`;

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-[var(--card)] overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        disabled={!canUndo}
        onClick={() => controls?.undo()}
        title={undoTip}
        aria-label={undoTip}
        className={cn(
          "rounded-none h-8 px-2 min-h-0",
          "disabled:opacity-30"
        )}
      >
        <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
      </Button>
      <div className="w-px h-5 bg-border" aria-hidden="true" />
      <Button
        variant="ghost"
        size="sm"
        disabled={!canRedo}
        onClick={() => controls?.redo()}
        title={redoTip}
        aria-label={redoTip}
        className={cn(
          "rounded-none h-8 px-2 min-h-0",
          "disabled:opacity-30"
        )}
      >
        <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
