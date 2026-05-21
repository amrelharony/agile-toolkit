"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Copy, Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";
import { nanoid } from "nanoid";
import { isRealtimeAvailable } from "@/lib/realtime/supabase-client";

interface InviteDialogProps {
  toolName: string;
  currentRoomId: string | null;
  onRoomIdChange?: (roomId: string) => void;
}

export function InviteDialog({ toolName, currentRoomId, onRoomIdChange }: InviteDialogProps) {
  const [roomId, setRoomId] = useState(currentRoomId ?? "");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [available, setAvailable] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAvailable(isRealtimeAvailable());
  }, []);

  // Clear any pending "Copied!" reset timer on unmount so we don't
  // setState on an unmounted component (dev warning + tiny mem leak).
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setRoomId(currentRoomId ?? "");
  }, [currentRoomId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!roomId) {
      setUrl("");
      return;
    }
    const u = new URL(window.location.href);
    u.searchParams.set("room", roomId);
    setUrl(u.toString());
  }, [roomId]);

  const handleCreate = () => {
    const fresh = nanoid(10);
    setRoomId(fresh);
    onRoomIdChange?.(fresh);
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.set("room", fresh);
      window.history.replaceState({}, "", u.toString());
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      toast.success("Invite link copied");
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-border hover:border-accent/30 hover:bg-accent/5 text-sub hover:text-accent"
        >
          <Users className="w-4 h-4" />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-bg border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text">
            <Link2 className="w-5 h-5 text-accent" />
            Invite to {toolName}
          </DialogTitle>
          <DialogDescription className="text-sub">
            {available
              ? "Share this link for real-time multiplayer. Anyone with the link can join."
              : "Supabase is not configured. Running in local-only mode. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable multiplayer."}
          </DialogDescription>
        </DialogHeader>

        {available && (
          <div className="space-y-3">
            {!roomId && (
              <Button
                onClick={handleCreate}
                className="w-full bg-accent text-bg hover:bg-accent/90"
              >
                Create Room
              </Button>
            )}
            {roomId && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="invite-room-id" className="text-xs text-sub">Room ID</label>
                  <Input
                    id="invite-room-id"
                    value={roomId}
                    readOnly
                    className="bg-surface border-border text-text font-data"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="invite-link" className="text-xs text-sub">Invite link</label>
                  <div className="flex gap-2">
                    <Input
                      id="invite-link"
                      value={url}
                      readOnly
                      className="bg-surface border-border text-text font-data text-xs"
                    />
                    <Button
                      variant="outline"
                      onClick={handleCopy}
                      className="gap-1.5 border-border hover:border-accent/30"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
