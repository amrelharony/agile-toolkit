"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsOwner } from "@/lib/auth/use-is-owner";
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
 * only — guest pages don't mount this, and it renders nothing for public
 * visitors, whose squad/session APIs would only answer 401.
 */
export function SessionShareButton({
  toolId,
  entityId,
  className,
  size = "sm",
  label = "Invite squad",
}: Props) {
  const [open, setOpen] = useState(false);
  const isOwner = useIsOwner();
  if (!isOwner) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
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
