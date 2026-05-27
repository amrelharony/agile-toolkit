"use client";

/**
 * Realtime sync for the workspace kudos wall.
 *
 * Protocol:
 *   * `kudos:created { kudos, by }` — sender emits on save. Receivers
 *     dedup by `id` (against the local store) before appending. Skip
 *     self-echoes via `by === userId`.
 *   * `kudos:snapshot { kudos[], by }` — owner-side keepalive every
 *     10 s with the 20 most recent kudos. Guests joining after the
 *     last `kudos:created` get caught up within one heartbeat.
 *
 * Workspace store is the source of truth on the owner side. Guests'
 * stores are ephemeral (their (guest) tree doesn't mount the
 * persistence provider that owners get from AppShell); the heartbeat
 * keeps them populated.
 *
 * Adopts the `roomRef` pattern from `use-canvas-room` /
 * `use-poker-session` so the heartbeat interval and inbound
 * subscription don't churn on every parent re-render — `useRoom`
 * returns a fresh object literal each call.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRoom } from "@/lib/realtime/use-room";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KUDOS_TOOL_ID, KUDOS_ENTITY_ID, isValidKudos } from "./types";

const HEARTBEAT_MS = 10_000;
const SNAPSHOT_SIZE = 20;

export interface KudosRoomHook {
  isConnected: boolean;
  isLocalOnly: boolean;
  /** Stable per-peer id (auth user, squad profile, or solo nanoid). */
  userId: string;
  /** Send a kudos: append locally + broadcast. The local append goes
   *  through `upsertKudos` so the 500-cap + shape validator both run. */
  sendKudos: (kudos: Kudos) => void;
}

export function useKudosRoom(opts: { isHost: boolean }): KudosRoomHook {
  // We don't use useRoom's built-in state-sync channel — reject all
  // state-sync broadcasts so a hostile peer can't spam setStateInternal.
  const room = useRoom<unknown>(KUDOS_TOOL_ID, KUDOS_ENTITY_ID, null, {
    validateState: (_raw): _raw is unknown => false,
  });

  const upsertKudos = useWorkspaceStore((s) => s.upsertKudos);

  // Ref the live room so the effects don't depend on `room` itself —
  // useRoom returns a new object every render, and putting it in a
  // dep array would tear down + recreate the subscription / interval
  // on every parent re-render.
  const roomRef = useRef(room);
  roomRef.current = room;

  // Inbound: validate shape, skip self-echoes, dedup by id, write.
  useEffect(() => {
    if (room.isLocalOnly) return;
    const offCreated = roomRef.current.subscribeToEvent("kudos:created", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { kudos?: unknown; by?: unknown };
      if (typeof env.by === "string" && env.by === roomRef.current.userId) return;
      if (!isValidKudos(env.kudos)) return;
      // upsertKudos already dedupes by id and runs its own validator;
      // it's a safe no-op for events we've already accepted.
      upsertKudos(env.kudos);
    });
    const offSnapshot = roomRef.current.subscribeToEvent("kudos:snapshot", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { kudos?: unknown; by?: unknown };
      if (typeof env.by === "string" && env.by === roomRef.current.userId) return;
      if (!Array.isArray(env.kudos)) return;
      // Bound the snapshot size we accept — a hostile peer broadcasting
      // 50k entries shouldn't be able to overwhelm the receiver.
      const slice = env.kudos.slice(0, SNAPSHOT_SIZE);
      for (const k of slice) {
        if (isValidKudos(k)) upsertKudos(k);
      }
    });
    return () => {
      offCreated();
      offSnapshot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.isLocalOnly]);

  // Host-side heartbeat — broadcasts the 20 most recent kudos every
  // HEARTBEAT_MS so late joiners converge without waiting for the
  // next send. Skipped silently when the wall is empty.
  useEffect(() => {
    if (!opts.isHost || room.isLocalOnly || !room.isConnected) return;
    const id = setInterval(() => {
      const list = useWorkspaceStore.getState().kudos ?? [];
      if (list.length === 0) return;
      const recent = list.slice(-SNAPSHOT_SIZE);
      roomRef.current.broadcast("kudos:snapshot", {
        kudos: recent,
        by: roomRef.current.userId,
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.isHost, room.isLocalOnly, room.isConnected]);

  const sendKudos = useCallback(
    (kudos: Kudos) => {
      upsertKudos(kudos);
      if (!roomRef.current.isLocalOnly) {
        roomRef.current.broadcast("kudos:created", {
          kudos,
          by: roomRef.current.userId,
        });
      }
    },
    [upsertKudos]
  );

  return {
    isConnected: room.isConnected,
    isLocalOnly: room.isLocalOnly,
    userId: room.userId,
    sendKudos,
  };
}
