"use client";

import { Users, Wifi, WifiOff } from "lucide-react";
import type { PresenceMember } from "@/lib/realtime/use-room";
import { cn } from "@/lib/utils";

interface MultiplayerChipProps {
  members: PresenceMember[];
  isConnected: boolean;
  isLocalOnly: boolean;
}

export function MultiplayerChip({ members, isConnected, isLocalOnly }: MultiplayerChipProps) {
  if (isLocalOnly) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-surface text-sub text-xs">
        <WifiOff className="w-3.5 h-3.5" />
        Local
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs",
        isConnected ? "border-accent/40 bg-accent/5 text-accent" : "border-border bg-surface text-sub"
      )}
    >
      {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
      <Users className="w-3.5 h-3.5" />
      <span className="font-data">{members.length}</span>
      {members.length > 0 && (
        <div className="flex -space-x-1.5 ml-1">
          {members.slice(0, 4).map((m) => (
            <div
              key={m.id}
              title={m.name}
              className="w-5 h-5 rounded-full border-2 border-bg flex items-center justify-center text-[9px] font-bold text-bg"
              style={{ background: m.color }}
            >
              {m.name.slice(0, 1).toUpperCase()}
            </div>
          ))}
          {members.length > 4 && (
            <div className="w-5 h-5 rounded-full border-2 border-bg bg-surface text-sub flex items-center justify-center text-[9px] font-bold">
              +{members.length - 4}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
