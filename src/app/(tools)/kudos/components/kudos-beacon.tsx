"use client";

/**
 * Phase 4 — ambient HUD pill.
 *
 * Fixed bottom-right of the kudos page. Glows when Phase 3 raises a
 * `kudos.fairness_alert` (somebody on the squad is being under-recognized),
 * pulses + counts when a kudos addressed to the local viewer lands.
 * Click opens a small popover; from there an idle-glow state offers
 * one-click "scroll to form" so the user can act on the hint without
 * digging for the input.
 *
 * Reduced-motion: renders, doesn't animate. The information value of
 * the count + alert state survives the visual reduction.
 *
 * The Phase 3 fairness cache helper is intentionally imported via a
 * dynamic import — the LLM stack is being assembled in parallel and we
 * must not hard-fail when its module is missing.
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSignal } from "@/lib/signals/signal-bus";
import { cn } from "@/lib/utils";

interface Candidate {
  profileId: string;
  reason?: string;
}

async function loadFairnessCandidates(): Promise<Candidate[]> {
  try {
    // Dynamic so the kudos page still loads even if Phase 3's barrel
    // export is mid-rebuild — fail closed to empty rather than throwing
    // on the page mount path.
    const mod = await import("@/lib/kudos/llm").catch(() => null);
    if (!mod || typeof mod.getLastFairnessResult !== "function") return [];
    const result = mod.getLastFairnessResult();
    const list = result?.underRecognised;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 5).map((u) => ({ profileId: u.profileId, reason: u.reason }));
  } catch {
    return [];
  }
}

function scrollToForm() {
  if (typeof document === "undefined") return;
  const form = document.querySelector("form");
  form?.scrollIntoView({ behavior: "smooth", block: "center" });
  // Focus the first selectable input — the "To" recipient picker is
  // ahead of the message textarea in markup order on every variant of
  // the form, so it's a safe default. Wrapped in a microtask so the
  // scroll has settled before focus moves the viewport again.
  void Promise.resolve().then(() => {
    const candidate = form?.querySelector<HTMLElement>(
      'select, input:not([type="hidden"]), textarea, button'
    );
    candidate?.focus({ preventScroll: true });
  });
}

export function KudosBeacon() {
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [idleGlow, setIdleGlow] = useState(false);
  const [pulseTrigger, setPulseTrigger] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  useSignal(["kudos.received"], () => {
    setUnread((n) => n + 1);
    setPulseTrigger((p) => p + 1);
  });

  useSignal(["kudos.fairness_alert"], () => {
    setIdleGlow(true);
  });

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    let cancelled = false;
    void (async () => {
      const list = await loadFairnessCandidates();
      if (!cancelled) setCandidates(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSendTo = () => {
    setOpen(false);
    setIdleGlow(false);
    scrollToForm();
  };

  return (
    <div
      // Use viewport-anchored insets that respect iOS home-indicator
      // safe-area. Without this, the beacon sits ON TOP of the home bar
      // on a notched device and the tap-area is partially occluded.
      // Phones lift it above Amr's band (--amr-band-bottom). From sm up Amr
      // stands in the bottom-right corner with no band, so the beacon sits
      // 9rem to his left: Amr (z-50, outside the page's stacking context)
      // would otherwise cover it and take its clicks.
      className="fixed right-[max(1rem,env(safe-area-inset-right))] sm:right-[calc(max(1rem,env(safe-area-inset-right))+9rem)] bottom-[calc(max(1rem,env(safe-area-inset-bottom))+var(--amr-band-bottom,0px))] z-modal pointer-events-auto"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-no-sound="true"
            aria-label={
              unread > 0
                ? `Kudos beacon — ${unread} new`
                : idleGlow
                  ? "Recognize someone — kudos beacon fairness hint"
                  : "Kudos beacon"
            }
            className={cn(
              "relative inline-flex items-center gap-2 rounded-full px-3 py-2 pointer-coarse:min-h-11",
              "border border-border bg-surface/80 backdrop-blur-sm shadow-md",
              "text-text hover:bg-surface transition-all duration-fast",
              idleGlow && !reducedMotion && "ring-2 ring-accent/60 shadow-accent/30"
            )}
          >
            {reducedMotion || pulseTrigger === 0 ? (
              <Sparkles
                className={cn("w-4 h-4", idleGlow ? "text-accent" : "text-sub")}
                aria-hidden="true"
              />
            ) : (
              <motion.span
                key={pulseTrigger}
                initial={{ scale: 0.5, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 12 }}
                className="inline-flex items-center justify-center"
              >
                <Sparkles
                  className={cn("w-4 h-4", idleGlow ? "text-accent" : "text-sub")}
                  aria-hidden="true"
                />
              </motion.span>
            )}
            <span className="text-xs font-medium">
              {unread > 0 ? `${unread} new` : idleGlow ? "Recognize someone" : "Kudos beacon"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-72 p-0">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-sm font-semibold text-text">
              {candidates.length > 0 ? "Under-recognized teammates" : "Beacon"}
            </span>
          </div>
          <div className="px-3 py-3 space-y-2">
            {candidates.length === 0 ? (
              <p className="text-xs text-sub">
                {idleGlow
                  ? "Fairness signal detected — open the form and send some recognition."
                  : "No fairness hints right now. Keep an eye out for great work and send kudos!"}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {candidates.map((c) => (
                  <li key={c.profileId} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="text-text font-medium truncate">{c.profileId}</div>
                      {c.reason && <div className="text-sub truncate">{c.reason}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={handleSendTo}
                      className="shrink-0 text-xs px-2 py-1 rounded border border-border hover:border-accent hover:text-accent transition"
                    >
                      Send
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleSendTo}
                className="w-full text-xs px-2 py-1.5 rounded bg-accent text-bg hover:bg-accent/90 transition font-medium"
              >
                Open the form
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
