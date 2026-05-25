"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionShareModal } from "./session-share-modal";

interface Props {
  toolId: string;
  entityId: string;
  className?: string;
  size?: "sm" | "default";
  label?: string;
}

/**
 * Drop-in "invite squad to this session" button. Tools render it with
 * the current entity id (board id, poker round id, retro id). Owner-
 * only — guests don't see it because guest pages don't mount this.
 */
export function SessionShareButton({
  toolId,
  entityId,
  className,
  size = "sm",
  label = "Invite squad",
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        className={`gap-1.5 border-border hover:border-accent/30 hover:bg-accent/5 text-sub hover:text-accent ${className ?? ""}`}
      >
        <Users className="w-4 h-4" aria-hidden="true" />
        {label}
      </Button>
      {open && (
        <SessionShareModal toolId={toolId} entityId={entityId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
