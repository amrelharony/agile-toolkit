"use client";

/**
 * Realtime sync for the workspace kudos wall.
 *
 * Channel scope: `tool:kudos:room:workspace-${roomKey}`. Per-workspace,
 * NOT global, so squad A never receives squad B's kudos. The key is derived
 * on the server from the owner's id (lib/realtime/room-keys): it used to be
 * the owner id itself, which isn't secret, so anyone could join.
 *
 * State source-of-truth depends on mode:
 *   * Owner — workspace store (persists across reloads, syncs to cloud)
 *   * Guest — ephemeral useState (the guest's localStorage is shared
 *     with whatever owner happens to use the same browser later, so
 *     we deliberately don't pollute the workspace persist slot)
 *
 * Both modes broadcast on send and apply inbound events identically;
 * only the local-write target differs.
 *
 * Protocol:
 *   * `kudos:created { kudos, by }` — sender emits on save. Receivers
 *     dedup by id, skip self-echoes via `by === userId`. The `kudos`
 *     object carries every optional v2 field (sender/recipient identity
 *     ids, sentiment, fairness score) — Phase 4's flying-card beacon
 *     resolves DOM rects from `senderIdentityId` + `recipientIdentityId`
 *     on every peer's local DOM, so the wire payload is intentionally
 *     the full upgraded shape rather than a diff.
 *   * `kudos:snapshot { kudos[], by }` — host-side keepalive every
 *     10 s with the 20 most recent kudos. Skipped when nothing changed
 *     OR no peers are present to receive it — bandwidth saver.
 *
 * Role gating: viewers cannot broadcast. The page-level UI already
 * hides the form for viewers, but `sendKudos` defends in depth so a
 * patched/hot-reloaded client can't side-step the role.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRoom } from "@/lib/realtime/use-room";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { emitSignal } from "@/lib/signals/signal-bus";
import { emit } from "@/lib/sonification/emit";
import type { Kudos } from "@/lib/stores/workspace-types";
import { KUDOS_TOOL_ID, isValidKudos } from "./types";

const HEARTBEAT_MS = 10_000;
const SNAPSHOT_SIZE = 20;
const GUEST_CAP = 500;

export type KudosRole = "editor" | "viewer" | "commenter";

/** Shape of a room key from the server (base64url, as room-keys derives it). */
const ROOM_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The owner's kudos room key, fetched from the server. `null` until it has
 * loaded, if the server can't derive keys, or when there's no owner: the
 * wall then works locally and joins the channel once the key arrives.
 */
export function useOwnerKudosRoomKey(ownerId: string | null): string | null {
  const [roomKey, setRoomKey] = useState<string | null>(null);
  useEffect(() => {
    setRoomKey(null);
    if (!ownerId) return;
    let alive = true;
    fetch("/api/realtime/kudos-room", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        const key = (body as { roomKey?: unknown } | null)?.roomKey;
        if (alive && typeof key === "string" && ROOM_KEY_RE.test(key)) setRoomKey(key);
      })
      .catch(() => {
        /* offline or not the owner: stay local-only */
      });
    return () => {
      alive = false;
    };
  }, [ownerId]);
  return roomKey;
}

export interface UseKudosRoomOptions {
  /** Whether this peer is the room host (the workspace owner). Hosts
   *  emit the keepalive snapshot; guests don't. */
  isHost: boolean;
  /** The workspace's kudos room key, from the server (the owner fetches it
   *  from /api/realtime/kudos-room; a guest's invite page renders it).
   *  Scopes the realtime channel per workspace. `null` keeps the hook
   *  local-only (e.g. before the key has loaded). */
  roomKey: string | null;
  /** Persistence mode:
   *   * `"workspace"` — owner side: kudos flow through the workspace
   *     store (persist + cloud sync).
   *   * `"ephemeral"` — guest side: kudos live in local useState only,
   *     so closing the tab doesn't pollute the shared
   *     `agile-toolkit:workspace` localStorage slot. */
  persistence: "workspace" | "ephemeral";
  /** Sender's role — determines whether `sendKudos` actually broadcasts.
   *  Viewers never broadcast (read-only). */
  role: KudosRole;
}

export interface KudosRoomHook {
  isConnected: boolean;
  isLocalOnly: boolean;
  /** Stable per-peer id (auth user, squad profile, or solo nanoid). */
  userId: string;
  /** Source-of-truth kudos array. Owner reads from workspace store;
   *  guest reads from local ephemeral state. The hook unifies both
   *  so consumers don't have to branch. */
  kudos: Kudos[];
  /** Append + broadcast. No-ops in viewer mode. */
  sendKudos: (kudos: Kudos) => void;
}

function dedupAndAppend(list: Kudos[], k: Kudos): Kudos[] {
  const idx = list.findIndex((x) => x.id === k.id);
  if (idx >= 0) {
    if (list[idx] === k) return list;
    const next = list.slice();
    next[idx] = k;
    return next;
  }
  const appended = [...list, k];
  return appended.length > GUEST_CAP ? appended.slice(-GUEST_CAP) : appended;
}

export function useKudosRoom(opts: UseKudosRoomOptions): KudosRoomHook {
  // Scoped channel — without a room key we run local-only.
  const roomId = opts.roomKey ? `workspace-${opts.roomKey}` : null;
  const room = useRoom<unknown>(KUDOS_TOOL_ID, roomId, null, {
    validateState: (_raw): _raw is unknown => false,
  });

  // Always hold both state paths so React's hook order is stable.
  // The actual `kudos` returned to the caller picks the right one
  // based on `persistence` (set once at mount; effectively static).
  const ownerKudos = useWorkspaceStore((s) => s.kudos ?? EMPTY_KUDOS);
  const upsertOwnerKudos = useWorkspaceStore((s) => s.upsertKudos);
  const [ephemeralKudos, setEphemeralKudos] = useState<Kudos[]>([]);

  const persistence = opts.persistence;
  const kudos = persistence === "workspace" ? ownerKudos : ephemeralKudos;

  // Stash the live room in a ref so the effects don't depend on
  // `room` itself — useRoom returns a fresh object every render.
  const roomRef = useRef(room);
  roomRef.current = room;
  // sessionRef-style stash for the latest peer count + kudos list so
  // the heartbeat interval reads current data without re-creating the
  // effect on every store update.
  const kudosRef = useRef(kudos);
  kudosRef.current = kudos;
  const membersRef = useRef(room.members);
  membersRef.current = room.members;
  // Track the last snapshot we broadcast so the heartbeat can skip
  // when nothing changed AND no fresh peer has appeared since.
  const lastSnapshotIdsRef = useRef<string>("");
  const lastMemberCountRef = useRef<number>(0);

  // Inbound: validate + skip self-echo + dedup-by-id + apply.
  useEffect(() => {
    if (room.isLocalOnly) return;
    const apply = (k: Kudos) => {
      if (persistence === "workspace") upsertOwnerKudos(k);
      else setEphemeralKudos((prev) => dedupAndAppend(prev, k));
    };
    const offCreated = roomRef.current.subscribeToEvent("kudos:created", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { kudos?: unknown; by?: unknown };
      if (typeof env.by === "string" && env.by === roomRef.current.userId) return;
      if (!isValidKudos(env.kudos)) return;
      apply(env.kudos);
      // Guest receive-side signal emission. The workspace-store diff in
      // signal-bridge.ts only runs on the owner tree (AppShell installs
      // it); guests mutate `ephemeralKudos` which the bridge never sees.
      // Emit directly so the receive-bridge fan-out (sonification,
      // haptics, mood lift, header-beacon pulse) and the gamification
      // receive-XP path fire on the guest side too. Owners skip this
      // branch — their bridge path already covers it.
      if (
        persistence === "ephemeral" &&
        env.kudos.toProfileId === roomRef.current.userId &&
        env.kudos.fromProfileId !== roomRef.current.userId
      ) {
        emitSignal({
          kind: "kudos.received",
          toolId: "kudos",
          at: new Date().toISOString(),
          payload: { id: env.kudos.id, fromProfileId: env.kudos.fromProfileId },
        });
        emit("kudos", "received");
      }
    });
    const offSnapshot = roomRef.current.subscribeToEvent("kudos:snapshot", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { kudos?: unknown; by?: unknown };
      if (typeof env.by === "string" && env.by === roomRef.current.userId) return;
      if (!Array.isArray(env.kudos)) return;
      const slice = env.kudos.slice(0, SNAPSHOT_SIZE);
      for (const k of slice) {
        if (isValidKudos(k)) apply(k);
      }
    });
    return () => {
      offCreated();
      offSnapshot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.isLocalOnly, persistence]);

  // Host-side heartbeat. Three optimisations vs the naive every-10s:
  //   1. Skip when the wall is empty.
  //   2. Skip when there are no peers (just the host alone — no one
  //      to converge to).
  //   3. Skip when neither the kudos list nor the peer count has
  //      changed since the last broadcast — saves bandwidth in long
  //      idle sessions.
  useEffect(() => {
    if (!opts.isHost || room.isLocalOnly || !room.isConnected) return;
    const id = setInterval(() => {
      const list = kudosRef.current;
      if (list.length === 0) return;
      const memberCount = membersRef.current.length;
      // Always need to broadcast at LEAST once when a new peer joins.
      const peersChanged = memberCount !== lastMemberCountRef.current;
      const recent = list.slice(-SNAPSHOT_SIZE);
      const idsKey = recent.map((k) => k.id).join(",");
      const contentChanged = idsKey !== lastSnapshotIdsRef.current;
      if (!peersChanged && !contentChanged) return;
      // If we're alone in the room there's no one to receive it.
      // Skip but DO update the last-snapshot ref so the next genuine
      // peer arrival triggers a broadcast.
      if (memberCount <= 1) {
        lastSnapshotIdsRef.current = idsKey;
        lastMemberCountRef.current = memberCount;
        return;
      }
      roomRef.current.broadcast("kudos:snapshot", {
        kudos: recent,
        by: roomRef.current.userId,
      });
      lastSnapshotIdsRef.current = idsKey;
      lastMemberCountRef.current = memberCount;
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.isHost, room.isLocalOnly, room.isConnected]);

  const role = opts.role;
  const sendKudos = useCallback(
    (kudos: Kudos) => {
      // Defence-in-depth: the page-level UI hides the form for
      // viewers, but a hot-reload race or a patched build could still
      // call sendKudos. Refuse at the hook level.
      if (role === "viewer") return;
      if (persistence === "workspace") {
        upsertOwnerKudos(kudos);
      } else {
        setEphemeralKudos((prev) => dedupAndAppend(prev, kudos));
      }
      if (!roomRef.current.isLocalOnly) {
        roomRef.current.broadcast("kudos:created", {
          kudos,
          by: roomRef.current.userId,
        });
      }
    },
    [persistence, role, upsertOwnerKudos]
  );

  return {
    isConnected: room.isConnected,
    isLocalOnly: room.isLocalOnly,
    userId: room.userId,
    kudos,
    sendKudos,
  };
}

// Stable empty-array reference so a workspace-mode hook with no kudos
// doesn't trigger re-renders on every store mutation due to a fresh
// `s.kudos ?? []` allocation.
const EMPTY_KUDOS: Kudos[] = [];
