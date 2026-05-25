"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Users, Plus, Copy, Check, Trash2, RefreshCw } from "lucide-react";

interface SquadRow {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  revokedAt: string | null;
  profileCount: number;
}

export function SquadsClient() {
  const [squads, setSquads] = useState<SquadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/squads");
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = (await res.json()) as { squads?: unknown };
      if (!Array.isArray(json?.squads)) {
        throw new Error("Server returned an unexpected response shape.");
      }
      setSquads(json.squads as SquadRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load squads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/squads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      const json = (await res.json()) as { squad: SquadRow };
      setSquads((prev) => [json.squad, ...prev]);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create squad");
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async (code: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setError("Clipboard unavailable in this browser.");
      return;
    }
    try {
      const joinUrl = `${window.location.origin}/guest/join?code=${encodeURIComponent(code)}`;
      await navigator.clipboard.writeText(joinUrl);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't copy");
    }
  };

  const onRegenerate = async (id: string) => {
    if (
      !window.confirm(
        "Regenerate the code? Existing members keep working, but the old code stops accepting new joins."
      )
    )
      return;
    try {
      const res = await fetch(`/api/squads/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regenerateCode: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      const json = (await res.json()) as { squad: SquadRow };
      setSquads((prev) => prev.map((s) => (s.id === id ? { ...s, code: json.squad.code } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't regenerate code");
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete squad "${name}"? This removes all guest profiles in it; their history events remain attributed to you (the owner) but lose the guest label.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/squads/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      setSquads((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete squad");
    }
  };

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-accent" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-text">New squad</h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreate();
            }}
            placeholder="Squad name (e.g. Engineering)"
            maxLength={80}
            className="flex-1 bg-surface-deep border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          />
          <Button
            onClick={() => void onCreate()}
            disabled={creating || !newName.trim()}
            className="bg-accent text-bg hover:bg-accent/80"
          >
            {creating ? "Creating…" : "Create squad"}
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border border-red-500/40 bg-red-500/10 rounded px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sub text-sm">Loading squads…</div>
      ) : squads.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center">
          <Users className="w-8 h-8 mx-auto mb-3 text-sub/40" aria-hidden="true" />
          <p className="text-sm text-sub">
            No squads yet. Create one above to start inviting guests.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {squads.map((s) => (
            <li key={s.id} className="bg-surface border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-text">{s.name}</h3>
                  <p className="text-xs text-sub mt-0.5">
                    {s.profileCount} guest{s.profileCount === 1 ? "" : "s"} • created{" "}
                    {new Date(s.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onRegenerate(s.id)}
                    title="Regenerate invite code"
                    className="text-xs gap-1"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                    New code
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onDelete(s.id, s.name)}
                    title="Delete squad"
                    className="text-xs gap-1 text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
              <div className="bg-surface-deep border border-border rounded px-3 py-2 flex items-center gap-2">
                <code className="font-mono text-xs text-text break-all flex-1 min-w-0">
                  {s.code}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onCopy(s.code)}
                  className="gap-1 text-xs shrink-0"
                  title="Copy invite link"
                >
                  {copiedCode === s.code ? (
                    <Check className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  )}
                  {copiedCode === s.code ? "Copied!" : "Copy link"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
