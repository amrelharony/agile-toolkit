"use client";

import { Users, Wifi, WifiOff } from "lucide-react";
import type { PresenceMember } from "@/lib/realtime/use-room";
import { IDENTITY_INK } from "@/lib/squads/colors";
import { cn } from "@/lib/utils";

interface MultiplayerChipProps {
  members: PresenceMember[];
  isConnected: boolean;
  isLocalOnly: boolean;
}

export function MultiplayerChip({ members, isConnected, isLocalOnly }: MultiplayerChipProps) {
  if (isLocalOnly) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-surface text-sub text-xs"
        role="status"
        aria-label="Local mode — multiplayer disabled"
      >
        <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
        Local
      </div>
    );
  }

  const count = members.length;
  // Connection status drives both the visual + the screen-reader summary
  // (0 peers when connected vs disconnected are distinct states; previously
  // both rendered "0" with no semantic difference).
  const statusLabel = !isConnected
    ? "Disconnected — reconnecting"
    : count === 0
      ? "Connected, no other peers"
      : count === 1
        ? "Connected with 1 other peer"
        : `Connected with ${count} other peers`;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs",
        isConnected
          ? "border-accent/40 bg-accent/5 text-accent"
          : "border-border bg-surface text-sub"
      )}
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
    >
      {isConnected ? (
        <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      <Users className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="font-data">{count}</span>
      {count > 0 && (
        <div className="flex -space-x-1.5 ml-1" aria-hidden="true">
          {members.slice(0, 4).map((m) => (
            <div
              key={m.id}
              title={m.name}
              className="w-5 h-5 rounded-full border-2 border-bg flex items-center justify-center text-xs font-bold"
              style={{ background: m.color, color: IDENTITY_INK }}
            >
              {/* Defensive slice — an empty name (defended against in
                  use-presence's sanitize but worth a belt-and-braces
                  pass here) would crash `.slice(0, 1)[0]` consumers. */}
              {(m.name || "?").slice(0, 1).toUpperCase()}
            </div>
          ))}
          {count > 4 && (
            <div className="w-5 h-5 rounded-full border-2 border-bg bg-surface text-sub flex items-center justify-center text-xs font-bold">
              +{count - 4}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
