"use client";

/**
 * Probes /api/agent/stream once to learn the SERVER agent backend (OpenClaw or
 * GLM) so UI like the header chip can show "AI: OpenClaw" when the agent works
 * server-side without a user BYOK key. Cached module-wide — the route's answer
 * doesn't change within a session.
 */

import { useEffect, useState } from "react";

export interface AgentBackend {
  mode: "server" | "client";
  provider: string | null;
  model: string | null;
}

let cached: AgentBackend | null = null;

export function useAgentBackend(): AgentBackend | null {
  const [state, setState] = useState<AgentBackend | null>(cached);

  useEffect(() => {
    if (cached) {
      setState(cached);
      return;
    }
    let cancelled = false;
    fetch("/api/agent/stream", { method: "GET" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { mode?: string; provider?: string | null; model?: string | null } | null) => {
        if (cancelled || !j) return;
        cached = {
          mode: j.mode === "server" ? "server" : "client",
          provider: typeof j.provider === "string" ? j.provider : null,
          model: typeof j.model === "string" ? j.model : null,
        };
        setState(cached);
      })
      .catch(() => {
        /* unauth or offline — leave null, chip falls back to BYOK display */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
