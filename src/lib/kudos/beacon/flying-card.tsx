"use client";

/**
 * Phase 4 — flying card portal.
 *
 * On every `kudos.sent` signal, render a clone of the KudosCard and fly
 * it from the sender's avatar to the recipient's avatar on every peer's
 * screen. Sender + recipient are resolved locally via the
 * `data-identity-id` attribute (stamped by Phase 0's identity hooks);
 * when either lookup fails we fall back to a bottom-right → header-beacon
 * arc so the affordance still fires even with stale rows or guests whose
 * DOM doesn't carry the attribute yet.
 *
 * Reduced-motion is a hard short-circuit — the signal subscription still
 * fires (it's idempotent) but the component returns null so no card,
 * particles, or transitions land on screen.
 *
 * Concurrency is capped at MAX_INFLIGHT to keep the GPU calm during a
 * combo burst; overflow events are dropped silently rather than queued
 * (queuing would mean cards still landing seconds after the wall already
 * showed them, which feels wrong).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSignal, type Signal } from "@/lib/signals/signal-bus";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KudosCard } from "@/app/(tools)/kudos/components/kudos-card";

const MAX_INFLIGHT = 5;
const FLIGHT_DURATION_MS = 900;
// Anchor for the fallback "from nowhere → header beacon" arc. The header
// beacon stamps itself with this id so we don't depend on the layout of
// the buttons next to it.
const HEADER_BEACON_ID = "kudos-header-beacon";

interface Flight {
  /** Stable id — the kudos record id. */
  id: string;
  kudos: Kudos;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

function rectFor(identityId: string | undefined): DOMRect | null {
  if (!identityId || typeof document === "undefined") return null;
  try {
    // Identity ids are sanitised at the validator level — they're
    // alphanumeric/uuid-shaped. CSS.escape covers anything that slips
    // past in older fixtures.
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(identityId) : identityId;
    const el = document.querySelector<HTMLElement>(`[data-identity-id="${escaped}"]`);
    if (!el) return null;
    return el.getBoundingClientRect();
  } catch {
    return null;
  }
}

function centerOf(rect: DOMRect | null): { x: number; y: number } | null {
  if (!rect) return null;
  // viewport coords — we render into a fixed-position portal so client
  // rects line up without scroll offset gymnastics.
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function fallbackTarget(): { x: number; y: number } {
  if (typeof document !== "undefined") {
    const beacon = document.getElementById(HEADER_BEACON_ID);
    if (beacon) {
      const c = centerOf(beacon.getBoundingClientRect());
      if (c) return c;
    }
  }
  if (typeof window === "undefined") return { x: 0, y: 0 };
  // Top-right is where the header beacon lives even when its DOM node
  // isn't yet mounted — minor visual drift on the first render, but
  // never wrong by enough to hurt.
  return { x: window.innerWidth - 40, y: 32 };
}

function fallbackOrigin(): { x: number; y: number } {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return { x: window.innerWidth - 80, y: window.innerHeight - 80 };
}

function lookupKudos(id: string): Kudos | undefined {
  const list = useWorkspaceStore.getState().kudos ?? [];
  return list.find((k) => k.id === id);
}

export function FlyingCardPortal() {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useSignal(["kudos.sent"], (s: Signal) => {
    if (reducedMotion) return;
    const payload = s.payload as { id?: unknown } | null;
    const id = payload && typeof payload.id === "string" ? payload.id : null;
    if (!id) return;
    const kudos = lookupKudos(id);
    if (!kudos) return;
    setFlights((prev) => {
      if (prev.length >= MAX_INFLIGHT) return prev;
      if (prev.some((f) => f.id === id)) return prev;
      const from = centerOf(rectFor(kudos.senderIdentityId)) ?? fallbackOrigin();
      const to = centerOf(rectFor(kudos.recipientIdentityId)) ?? fallbackTarget();
      return [...prev, { id, kudos, from, to }];
    });
  });

  if (!mounted || reducedMotion || typeof document === "undefined") return null;

  const onComplete = (id: string) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-modal"
      style={{ overflow: "hidden" }}
    >
      <AnimatePresence>
        {flights.map((f) => (
          <FlyingCardOne key={f.id} flight={f} onComplete={onComplete} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}

interface OneProps {
  flight: Flight;
  onComplete: (id: string) => void;
}

function FlyingCardOne({ flight, onComplete }: OneProps) {
  // Curve via an intermediate "lift" — pulls the card up between the two
  // endpoints so the trajectory reads as a toss rather than a straight
  // line. The lift height scales with the horizontal distance so long
  // arcs stay airy and short arcs don't arch absurdly.
  const dx = flight.to.x - flight.from.x;
  const dy = flight.to.y - flight.from.y;
  const distance = Math.hypot(dx, dy);
  const lift = Math.min(120, Math.max(40, distance * 0.25));

  return (
    <motion.div
      initial={{
        x: flight.from.x,
        y: flight.from.y,
        opacity: 0,
        scale: 0.6,
        rotate: -4,
      }}
      animate={{
        x: [flight.from.x, (flight.from.x + flight.to.x) / 2, flight.to.x],
        y: [flight.from.y, (flight.from.y + flight.to.y) / 2 - lift, flight.to.y],
        opacity: [0, 1, 1, 0.85, 0],
        scale: [0.6, 1, 0.95, 0.9],
        rotate: [-4, 1, 0],
      }}
      transition={{
        duration: FLIGHT_DURATION_MS / 1000,
        ease: "easeOut",
        times: [0, 0.45, 1],
        opacity: { times: [0, 0.15, 0.55, 0.85, 1], duration: FLIGHT_DURATION_MS / 1000 },
      }}
      onAnimationComplete={() => onComplete(flight.id)}
      style={{
        position: "absolute",
        // The motion x/y above already place the element; the translate
        // here centers the card on the endpoint coords.
        translate: "-50% -50%",
        // Small enough to not steal focus from the wall, large enough to
        // read the recipient name during flight.
        width: 240,
        transformOrigin: "center center",
        willChange: "transform, opacity",
      }}
    >
      <KudosCard kudos={flight.kudos} compact />
    </motion.div>
  );
}
