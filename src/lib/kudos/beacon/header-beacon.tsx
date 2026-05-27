"use client";

/**
 * Phase 4 — global header beacon.
 *
 * A small Sparkles icon in the app header that pulses + counts whenever
 * a kudos addressed to the local viewer lands. Click opens a popover
 * with the last five received kudos and a CTA to /kudos.
 *
 * Reduced-motion path renders a static dot (no pulse / spring) but
 * keeps the count badge — the count is information, not animation.
 *
 * The component stamps `id="kudos-header-beacon"` on its root so the
 * FlyingCard portal can fall back to the beacon's rect when sender or
 * recipient DOM identity ids are unavailable.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSignal } from "@/lib/signals/signal-bus";
import { useGuestProfile } from "@/lib/auth/guest-profile-provider";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import type { Kudos } from "@/lib/stores/workspace-types";
import { getKudosTheme } from "@/app/(tools)/kudos/types";
import { cn } from "@/lib/utils";

interface RecentResponse {
  kudos?: Kudos[];
}

async function fetchRecent(toProfileId: string | null): Promise<Kudos[]> {
  const params = new URLSearchParams({ limit: "5" });
  if (toProfileId) params.set("to_profile_id", toProfileId);
  try {
    const res = await fetch(`/api/kudos?${params.toString()}`);
    if (!res.ok) return [];
    const json = (await res.json()) as RecentResponse;
    return Array.isArray(json.kudos) ? json.kudos : [];
  } catch {
    return [];
  }
}

export function KudosHeaderBeacon() {
  const reducedMotion = useReducedMotion();
  const guest = useGuestProfile();
  const auth = useAuthOptional();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [pulseTrigger, setPulseTrigger] = useState(0);
  const [recent, setRecent] = useState<Kudos[]>([]);
  const [loading, setLoading] = useState(false);

  // Guests scope by their squad-profile id so the popover only shows
  // kudos addressed to THIS guest. Owners hit the endpoint without a
  // profile filter — workspace-wide wall is theirs by definition.
  const toProfileId = guest?.id ?? null;
  const isAuthenticated = !!auth?.user || !!guest;

  useSignal(["kudos.received"], () => {
    setUnread((n) => n + 1);
    setPulseTrigger((p) => p + 1);
  });

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    setLoading(true);
    let cancelled = false;
    void (async () => {
      const list = await fetchRecent(toProfileId);
      if (!cancelled) {
        setRecent(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, toProfileId]);

  // Render the beacon for everyone (owners + guests) — both can receive
  // kudos. When auth/guest is fully absent we still render so the
  // FlyingCard's fallback rect lookup has a target; the popover just
  // shows the empty state.
  void isAuthenticated;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id="kudos-header-beacon"
          type="button"
          data-no-sound="true"
          className={cn(
            "relative w-9 h-9 rounded-lg flex items-center justify-center",
            "text-sub hover:text-accent hover:bg-accent/5 transition-all duration-fast"
          )}
          aria-label={unread > 0 ? `Kudos beacon — ${unread} new` : "Kudos beacon"}
          title="Kudos"
        >
          {reducedMotion ? (
            <Sparkles className="w-4 h-4" aria-hidden="true" />
          ) : (
            <motion.span
              key={pulseTrigger}
              initial={pulseTrigger === 0 ? false : { scale: 0.6, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 14 }}
              className="inline-flex items-center justify-center"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            </motion.span>
          )}
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-bg text-[10px] leading-[16px] font-semibold text-center"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-text">Recent kudos</span>
          <Link
            href="/kudos"
            className="text-xs text-accent hover:underline"
            onClick={() => setOpen(false)}
          >
            Open wall
          </Link>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-6 text-xs text-sub text-center">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="px-3 py-6 text-xs text-sub text-center">
              No kudos yet — send the first one from the Kudos wall.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((k) => (
                <li key={k.id} className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-base" aria-hidden="true">
                      {getKudosTheme(k.theme).emoji}
                    </span>
                    <span className="text-xs font-medium text-text truncate">
                      {k.fromName} → {k.toName}
                    </span>
                  </div>
                  <p className="text-xs text-sub line-clamp-2 break-words">{k.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
