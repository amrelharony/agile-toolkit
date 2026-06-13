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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, Plus, Trash2, AlertTriangle, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/utils/toast";
import { useFocusTrap } from "@/hooks/use-focus-trap";

interface SquadOption {
  id: string;
  name: string;
  profileCount: number;
  revokedAt?: string | null;
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

// "Expires in N days" rendering for the active-invites list. Returns a
// short, glance-able label; absolute ISO is left for tooltips/screen
// readers where precision matters.
function formatExpiry(iso: string | null): string {
  if (!iso) return "No expiry";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Expired";
  const days = Math.ceil(ms / 86400000);
  if (days === 1) return "Expires in 1 day";
  if (days < 30) return `Expires in ${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? "Expires in ~1 month" : `Expires in ~${months} months`;
}

function buildGuestUrl(toolId: string, entityId: string): string {
  if (typeof window === "undefined") return "";
  const origin = window.location.origin;
  const enc = encodeURIComponent(entityId);
  // Tools with first-class guest routes get the dedicated path so the
  // bookmarkable URL matches the page tree; everything else falls back
  // to the generic /guest/<toolId>/<entityId> shape.
  if (toolId === "canvas") return `${origin}/guest/canvas/${enc}`;
  if (toolId === "planning-poker") return `${origin}/guest/planning-poker/${enc}`;
  if (toolId === "kudos") return `${origin}/guest/kudos/${enc}`;
  return `${origin}/guest/${encodeURIComponent(toolId)}/${enc}`;
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
  // `null` = "Never expires"; numeric values = TTL in days. Server
  // omits `expires_at` when no ttlDays is sent.
  const [ttlDays, setTtlDays] = useState<number | null>(7);
  const [submitting, setSubmitting] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const load = useCallback(
    async (cancelledRef: { current: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const [sqRes, invRes] = await Promise.all([
          fetch("/api/squads"),
          fetch(
            `/api/sessions?toolId=${encodeURIComponent(toolId)}&entityId=${encodeURIComponent(entityId)}`
          ),
        ]);
        if (cancelledRef.current) return;
        if (!sqRes.ok) throw new Error(`squads_${sqRes.status}`);
        if (!invRes.ok) throw new Error(`invites_${invRes.status}`);
        const sqJson = (await sqRes.json()) as { squads?: SquadOption[] };
        const invJson = (await invRes.json()) as { invites?: Invite[] };
        if (cancelledRef.current) return;
        // Defence in depth: even if the API forgets to filter revoked
        // squads, the dropdown shouldn't show them.
        const sqs = (Array.isArray(sqJson.squads) ? sqJson.squads : []).filter(
          (s) => s.revokedAt == null
        );
        setSquads(sqs);
        setInvites(Array.isArray(invJson.invites) ? invJson.invites : []);
        setSelectedSquadId((prev) => prev || (sqs[0]?.id ?? ""));
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    },
    [toolId, entityId]
  );

  // Tracks unmount so async reloads kicked off by user actions (onCreate)
  // don't setState on an unmounted component — mirrors the mount effect's
  // per-run cancellation, but lives for the component's whole lifetime.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };
    void load(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
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
          ttlDays: ttlDays === null ? undefined : ttlDays,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; existed?: boolean };
      if (!res.ok) {
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      if (j.existed) {
        toast.info("This invite already exists");
      } else {
        toast.success("Invite created");
      }
      await load(unmountedRef);
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

  const onCopyLink = async (invite: Invite) => {
    const url = buildGuestUrl(invite.toolId, invite.entityId);
    if (!url || typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Clipboard unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInviteId(invite.id);
      setTimeout(() => setCopiedInviteId((cur) => (cur === invite.id ? null : cur)), 2000);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const profilesForSelected = useMemo(
    () => profilesBySquad[selectedSquadId] ?? [],
    [profilesBySquad, selectedSquadId]
  );

  const squadNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of squads) m[s.id] = s.name;
    return m;
  }, [squads]);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-sub flex flex-col gap-1">
              Squad
              <select
                value={selectedSquadId}
                onChange={(e) => {
                  setSelectedSquadId(e.target.value);
                  setSelectedProfileId("");
                }}
                className="h-11 md:h-9 bg-surface-deep border border-border rounded px-2 text-base md:text-sm text-text focus:outline-none focus:border-accent"
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
                className="h-11 md:h-9 bg-surface-deep border border-border rounded px-2 text-base md:text-sm text-text focus:outline-none focus:border-accent"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-sub flex flex-col gap-1">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "editor" | "viewer" | "commenter")}
                className="h-11 md:h-9 bg-surface-deep border border-border rounded px-2 text-base md:text-sm text-text focus:outline-none focus:border-accent"
              >
                <option value="editor">Editor (full collaboration)</option>
                <option value="commenter">Commenter (read + comments)</option>
                <option value="viewer">Viewer (read-only)</option>
              </select>
            </label>
            <label className="text-xs text-sub flex flex-col gap-1">
              Expires in
              <select
                value={ttlDays === null ? "never" : String(ttlDays)}
                onChange={(e) => {
                  const v = e.target.value;
                  setTtlDays(v === "never" ? null : Number(v));
                }}
                className="h-11 md:h-9 bg-surface-deep border border-border rounded px-2 text-base md:text-sm text-text focus:outline-none focus:border-accent"
              >
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="never">Never expires</option>
              </select>
            </label>
          </div>
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
                {invites.map((i) => {
                  const squadName = squadNameById[i.squadId] ?? "Unknown squad";
                  const expiryLabel = formatExpiry(i.expiresAt);
                  return (
                    <li
                      key={i.id}
                      className="flex flex-col gap-1 text-xs bg-surface-deep border border-border rounded px-2 py-1.5"
                    >
                      <div className="flex items-center gap-2">
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
                          onClick={() => void onCopyLink(i)}
                          aria-label="Copy guest link"
                          className="text-sub hover:text-accent"
                        >
                          {copiedInviteId === i.id ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onRevoke(i.id)}
                          aria-label="Revoke invite"
                          className="text-sub hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-sub pl-0.5">
                        <span>{squadName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{expiryLabel}</span>
                      </div>
                    </li>
                  );
                })}
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
  // Stable callback ref so the Esc handler doesn't re-register on every
  // parent render (parents typically pass an inline `() => setOpen(false)`).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      // Let form controls own their own Esc behaviour (SELECT collapses
      // its dropdown, INPUT reverts edits, contentEditable cancels
      // composition) instead of closing the modal out from under them.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite squad to session"
      ref={dialogRef}
      className="fixed inset-0 z-modal flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-surface border border-border rounded-xl max-w-lg w-[92vw] max-h-[85dvh] overflow-auto overscroll-contain"
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
            className="min-touch-coarse inline-flex items-center justify-center -m-1 p-1 rounded text-sub hover:text-text"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <SessionShareContent toolId={toolId} entityId={entityId} />
      </div>
    </div>
  );
}
