"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  LogOut,
  MonitorPlay,
  QrCode as QrCodeIcon,
  Radio,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QrCode } from "@/components/collab/qr-code";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { toast } from "@/lib/utils/toast";
import { useFlash } from "@/hooks/use-flash";
import { cn } from "@/lib/utils";
import {
  VISITOR_LIMITS,
  joinUrl,
  visitorRoomsEnabled,
  type VisitorTool,
} from "@/lib/realtime/visitor-rooms";
import { groupRoomCode } from "@/lib/realtime/visitor-code";

export interface VisitorRoomChipProps {
  tool: VisitorTool;
  code: string;
  /** People in the room now, this person included. */
  memberCount: number;
  /** The host gets "End room"; everyone else gets "Leave". */
  isHost: boolean;
  /** Host only: end the room for everyone. */
  onEnd?: () => void;
  /** Participant only: leave the room. */
  onLeave?: () => void;
  /**
   * Appended to the copied link and to the QR code, e.g. `#k=<host key>`
   * for a vote round. A fragment stays in the browser: it never reaches the
   * server or its logs. Ignored unless it is `#` plus up to 64 URL-safe
   * characters.
   */
  linkFragment?: string;
  /**
   * Host: offer "Big screen", which puts the room on a shared screen (code,
   * QR code, who's in, the round) through `RoomBigScreen`.
   */
  onBigScreen?: () => void;
  className?: string;
}

const LINK_FRAGMENT_RE = /^#[A-Za-z0-9=_-]{1,64}$/;

/**
 * The header chip for a visitor live room: its code (in groups of four,
 * ABCD-EFGH-JKMN, for reading aloud), "Copy link", "Show QR code", how full
 * it is, the host's "Big screen" when the room offers it, and End room
 * (host) or Leave (participant). Announces joins and leaves politely.
 * Renders nothing while the feature flag is off or for a malformed code.
 *
 * The QR code holds the same link as Copy link, fragment included, so a
 * phone that scans it lands in the room with the vote round's host key. It
 * is drawn only while its dialog is open, from the page's own origin, with
 * the grouped code beside it.
 */
export function VisitorRoomChip({
  tool,
  code,
  memberCount,
  isHost,
  onEnd,
  onLeave,
  linkFragment,
  onBigScreen,
  className,
}: VisitorRoomChipProps) {
  const announce = useAnnounce();
  const { flash, isFlashing } = useFlash();
  const copied = isFlashing();
  const [qrOpen, setQrOpen] = useState(false);
  const prevCount = useRef<number | null>(null);
  const max = VISITOR_LIMITS.maxMembers;

  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = memberCount;
    if (prev === null || prev === memberCount) return;
    const what = memberCount > prev ? "Someone joined" : "Someone left";
    announce(`${what}. ${memberCount} of ${max} people in the room.`);
  }, [memberCount, max, announce]);

  const path = joinUrl(tool, code);
  if (!visitorRoomsEnabled() || !path) return null;

  /** The whole join link: this page's origin, the path, and the fragment if it is well formed. */
  const link = () => {
    const fragment = linkFragment && LINK_FRAGMENT_RE.test(linkFragment) ? linkFragment : "";
    return `${window.location.origin}${path}${fragment}`;
  };

  const copyLink = async () => {
    const url = link();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      flash("Link copied. Share it only with your team.");
    } catch {
      toast.error(`Couldn't copy. The link is ${url}`);
    }
  };

  const full = memberCount >= max;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-2.5 py-1 text-xs text-text",
        className
      )}
    >
      <span className="flex items-center gap-1.5 text-accent">
        <Radio className="w-3.5 h-3.5" aria-hidden="true" />
        Live room
      </span>
      <span className="font-data tracking-wider">
        <span className="sr-only">Room code </span>
        {groupRoomCode(code)}
      </span>
      <span className={cn("flex items-center gap-1 font-data", full ? "text-warning" : "text-sub")}>
        <Users className="w-3.5 h-3.5" aria-hidden="true" />
        <span aria-hidden="true">
          {memberCount}/{max}
        </span>
        <span className="sr-only">
          {memberCount} of {max} people
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1"
        title="Share it only with your team"
        onClick={() => void copyLink()}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
        ) : (
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1"
        aria-haspopup="dialog"
        onClick={() => setQrOpen(true)}
      >
        <QrCodeIcon className="w-3.5 h-3.5" aria-hidden="true" />
        Show QR code
      </Button>
      {isHost && onBigScreen && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1"
          title="Show the room on a shared screen"
          onClick={onBigScreen}
        >
          <MonitorPlay className="w-3.5 h-3.5" aria-hidden="true" />
          Big screen
        </Button>
      )}
      {isHost
        ? onEnd && (
            <Button
              type="button"
              variant="danger-ghost"
              size="sm"
              className="gap-1"
              onClick={onEnd}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              End room
            </Button>
          )
        : onLeave && (
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={onLeave}>
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              Leave
            </Button>
          )}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <JoinQr link={link} code={code} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The dialog's body: the code to scan, the room code beside it in groups,
 * and the link it holds written out. Mounted only while the dialog is open,
 * so `link` (which reads the page's origin) runs in the browser.
 */
function JoinQr({ link, code }: { link: () => string; code: string }) {
  const url = link();
  return (
    <>
      <DialogHeader>
        <DialogTitle>Scan to join</DialogTitle>
        <DialogDescription>
          Point a phone camera at the code to open the room. Share it only with your team.
        </DialogDescription>
      </DialogHeader>
      <QrCode
        text={url}
        label="QR code for the join link"
        className="mx-auto w-full max-w-[18rem] rounded-sm border border-border"
        fallback={
          <p className="text-sm text-sub">
            This link is too long for a QR code. Use Copy link instead.
          </p>
        }
      />
      <p className="text-center font-data text-2xl font-bold tracking-wider text-text">
        <span className="sr-only">Room code </span>
        {groupRoomCode(code)}
      </p>
      <p className="break-all text-center font-data text-xs text-sub">{url}</p>
    </>
  );
}
