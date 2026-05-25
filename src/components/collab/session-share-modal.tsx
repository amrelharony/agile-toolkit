"use client";

/**
 * Owner-side UI: invite squad members to a (tool, entity) session.
 *
 * Exports two pieces:
 *   * `SessionShareContent` — the body (form + active-invites list).
 *     Designed to be embedded as a tab pane inside an existing modal
 *     (e.g. canvas's ShareModal).
 *   * `SessionShareModal` — a self-contained modal that wraps the
 *     body. Useful for tools that don't already have a modal of
 *     their own.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Plus, Trash2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SquadOption {
  id: string;
  name: string;
  profileCount: number;
}

interface ProfileOption {
  id: string;
  displayName: string;
  color: string;
}

interface Invite {
  id: string;
  squadId: string;
  toolId: string;
  entityId: string;
  role: "editor" | "viewer" | "commenter";
  profileId: string | null;
  profile: { displayName: string; color: string } | null;
  createdAt: string;
  expiresAt: string | null;
}

interface ContentProps {
  toolId: string;
  entityId: string;
}

export function SessionShareContent({ toolId, entityId }: ContentProps) {
  const [squads, setSquads] = useState<SquadOption[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSquadId, setSelectedSquadId] = useState<string>("");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [profilesBySquad, setProfilesBySquad] = useState<Record<string, ProfileOption[]>>({});
  const [role, setRole] = useState<"editor" | "viewer" | "commenter">("editor");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sqRes, invRes] = await Promise.all([
        fetch("/api/squads"),
        fetch(
          `/api/sessions?toolId=${encodeURIComponent(toolId)}&entityId=${encodeURIComponent(entityId)}`
        ),
      ]);
      if (!sqRes.ok) throw new Error(`squads_${sqRes.status}`);
      if (!invRes.ok) throw new Error(`invites_${invRes.status}`);
      const sqJson = (await sqRes.json()) as { squads?: SquadOption[] };
      const invJson = (await invRes.json()) as { invites?: Invite[] };
      const sqs = Array.isArray(sqJson.squads) ? sqJson.squads : [];
      setSquads(sqs);
      setInvites(Array.isArray(invJson.invites) ? invJson.invites : []);
      setSelectedSquadId((prev) => prev || (sqs[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [toolId, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedSquadId) return;
    if (profilesBySquad[selectedSquadId]) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/squads/${selectedSquadId}/profiles`);
        if (!res.ok) return;
        const json = (await res.json()) as { profiles?: ProfileOption[] };
        if (cancelled) return;
        setProfilesBySquad((prev) => ({
          ...prev,
          [selectedSquadId]: Array.isArray(json.profiles) ? json.profiles : [],
        }));
      } catch {
        /* dropdown stays at "anyone" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSquadId, profilesBySquad]);

  const onCreate = async () => {
    if (!selectedSquadId) {
      setError("Pick a squad first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          squadId: selectedSquadId,
          toolId,
          entityId,
          role,
          profileId: selectedProfileId || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create invite");
    } finally {
      setSubmitting(false);
    }
  };

  const onRevoke = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      setInvites((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't revoke");
    }
  };

  const profilesForSelected = useMemo(
    () => profilesBySquad[selectedSquadId] ?? [],
    [profilesBySquad, selectedSquadId]
  );

  return (
    <div className="p-4 space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 rounded px-3 py-2 text-sm text-red-200"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="text-sub text-sm">Loading…</div>
      ) : squads.length === 0 ? (
        <div className="text-sm text-sub">
          No squads yet. Visit{" "}
          <a href="/settings/squads" className="text-accent underline">
            Settings → Squads
          </a>{" "}
          to create one.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-sub flex flex-col gap-1">
              Squad
              <select
                value={selectedSquadId}
                onChange={(e) => {
                  setSelectedSquadId(e.target.value);
                  setSelectedProfileId("");
                }}
                className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              >
                {squads.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.profileCount})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-sub flex flex-col gap-1">
              Pin to profile
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              >
                <option value="">Anyone in squad</option>
                {profilesForSelected.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-xs text-sub flex flex-col gap-1">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer" | "commenter")}
              className="bg-surface-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
            >
              <option value="editor">Editor (full collaboration)</option>
              <option value="commenter">Commenter (read + comments)</option>
              <option value="viewer">Viewer (read-only)</option>
            </select>
          </label>
          <Button
            type="button"
            onClick={() => void onCreate()}
            disabled={submitting}
            className="w-full bg-accent text-bg hover:bg-accent/80 gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {submitting ? "Inviting…" : "Send invite"}
          </Button>

          <div className="pt-2 border-t border-border">
            <div className="text-xs uppercase font-mono text-sub mb-2">
              Active invites ({invites.length})
            </div>
            {invites.length === 0 ? (
              <div className="text-xs text-sub italic">No invites for this session yet.</div>
            ) : (
              <ul className="space-y-1.5">
                {invites.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center gap-2 text-xs bg-surface-deep border border-border rounded px-2 py-1.5"
                  >
                    {i.profile ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: i.profile.color }}
                          aria-hidden="true"
                        />
                        <span className="text-text font-medium">{i.profile.displayName}</span>
                      </span>
                    ) : (
                      <span className="text-text font-medium">Anyone in squad</span>
                    )}
                    <span
                      className={`text-[10px] uppercase font-bold ${
                        i.role === "editor"
                          ? "text-amber-300"
                          : i.role === "commenter"
                            ? "text-emerald-300"
                            : "text-cyan-300"
                      }`}
                    >
                      {i.role}
                    </span>
                    <span className="text-sub flex-1" />
                    <button
                      type="button"
                      onClick={() => void onRevoke(i.id)}
                      aria-label="Revoke invite"
                      className="text-sub hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface ModalProps extends ContentProps {
  onClose: () => void;
}

export function SessionShareModal({ toolId, entityId, onClose }: ModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite squad to session"
      className="fixed inset-0 z-modal flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-surface border border-border rounded-xl max-w-lg w-[92vw] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text">Invite squad</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-sub hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <SessionShareContent toolId={toolId} entityId={entityId} />
      </div>
    </div>
  );
}
