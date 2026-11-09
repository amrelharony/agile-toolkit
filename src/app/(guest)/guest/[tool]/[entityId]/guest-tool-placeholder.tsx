"use client";

/**
 * Phase 2 placeholder for the guest-side tool view.
 *
 * Phase 3 will replace this with the actual tool component rendered
 * in `chrome="minimal"` mode (starting with canvas). For now it
 * proves the end-to-end wiring works: an invited guest reaches this
 * route, the framework hook reports the correct mode, and a sample
 * action can be logged + broadcast.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InkArt } from "@/components/ink/ink-art";
import { toolboxArt } from "@/lib/ink/drawings/pages/toolbox";
import { useCollaborativeSession } from "@/lib/collab/use-collaborative-session";

interface Props {
  toolId: string;
  entityId: string;
  role: "editor" | "viewer" | "commenter";
  profile: { id: string; displayName: string; color: string };
}

export function GuestToolPlaceholder({ toolId, entityId, role, profile }: Props) {
  const collab = useCollaborativeSession(toolId, entityId);
  const [pings, setPings] = useState<Array<{ from: string; at: number }>>([]);

  useEffect(() => {
    return collab.subscribeToEvent("guest-placeholder-ping", (raw) => {
      const p = raw as { from?: unknown; at?: unknown };
      if (typeof p?.from === "string" && typeof p?.at === "number") {
        setPings((prev) => [...prev.slice(-9), { from: p.from as string, at: p.at as number }]);
      }
    });
  }, [collab]);

  const onPing = () => {
    collab.broadcast("guest-placeholder-ping", { from: profile.displayName, at: Date.now() });
    collab.log("ping", { from: profile.displayName });
  };

  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-4">
        <header className="flex items-center justify-between gap-3">
          <Link
            href="/guest"
            className="inline-flex items-center gap-1.5 text-xs text-sub hover:text-text"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Back
          </Link>
          <span
            className={`text-xs uppercase font-bold ${
              role === "editor"
                ? "text-warning"
                : role === "commenter"
                  ? "text-success"
                  : "text-accent"
            }`}
          >
            {role}
          </span>
        </header>

        <div className="ink-host bg-surface border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            {/* The toolbox: this tool's own view isn't built for guests yet. */}
            <InkArt drawing={toolboxArt} boil className="h-12 w-12 shrink-0" />
            <h1 className="text-base font-semibold text-text">{formatToolName(toolId)}</h1>
          </div>
          <p className="text-xs text-sub">
            Session id: <code className="font-mono text-text">{entityId}</code>
          </p>
          <p className="text-xs text-sub">
            You&apos;re here as{" "}
            <span className="inline-flex items-center gap-1.5 font-semibold text-text">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: profile.color }}
                aria-hidden="true"
              />
              {profile.displayName}
            </span>
            .
          </p>
          <div className="text-xs text-sub flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            {collab.isLocalOnly
              ? "Realtime offline (Supabase not configured)"
              : collab.isConnected
                ? `${collab.members.length} present`
                : "Connecting…"}
          </div>

          {role !== "viewer" && (
            <Button variant="outline" size="sm" onClick={onPing} className="gap-1.5 text-xs">
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              Send a ping
            </Button>
          )}

          {pings.length > 0 && (
            <div className="text-xs text-sub border-t border-border pt-2">
              <div className="uppercase font-mono mb-1">Recent pings</div>
              <ul className="space-y-0.5">
                {pings
                  .slice()
                  .reverse()
                  .map((p, i) => (
                    <li key={`${p.from}-${p.at}-${i}`}>
                      <span className="text-text">{p.from}</span>{" "}
                      <span className="text-sub">at {new Date(p.at).toLocaleTimeString()}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-sub italic pt-2 border-t border-border">
            Generic placeholder for tools without a guest renderer yet.
          </p>
        </div>
      </div>
    </main>
  );
}

function formatToolName(toolId: string): string {
  return toolId
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
