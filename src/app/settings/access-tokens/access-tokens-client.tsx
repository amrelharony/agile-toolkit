"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { KeyRound, Lock, Trash2, Copy, Check, Eye, EyeOff } from "lucide-react";

type AccessLevel = "full" | "write" | "read";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  // Operation ceiling (migration 0022). Optional for back-compat with token
  // rows minted/returned before the column existed.
  access_level?: AccessLevel;
}

const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  full: "Full access",
  write: "Read + write",
  read: "Read-only",
};

interface CreatedToken {
  token: TokenRow;
  rawToken: string;
}

const SIGN_IN_HREF = `/auth/sign-in?next=${encodeURIComponent("/settings/access-tokens")}`;

export function AccessTokensClient() {
  // The middleware already sends non-owners to sign-in; this guard is
  // defence in depth (e.g. a session the owner check rejected after the
  // page loaded), so the token API is never called for a visitor.
  const { isOwner, settled } = useOwnerState();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAccessLevel, setNewAccessLevel] = useState<AccessLevel>("full");
  const [revealed, setRevealed] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);
  // BUG-X4: default the freshly-minted token display to masked, with an
  // explicit reveal toggle (matches the LLM settings dialog's BYOK
  // input pattern). Eliminates the "fullscreen on a projector"
  // shoulder-surf failure mode.
  const [revealVisible, setRevealVisible] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/access-tokens");
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = (await res.json()) as { tokens?: unknown };
      // BUG-X9: validate response shape before set.
      if (!Array.isArray(json?.tokens)) {
        throw new Error("Server returned an unexpected response shape.");
      }
      setTokens(json.tokens as TokenRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOwner) return;
    void refresh();
  }, [isOwner]);

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/access-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, accessLevel: newAccessLevel }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed: ${res.status}`);
      }
      const json = (await res.json()) as CreatedToken;
      // BUG-X9: defensive shape check.
      if (!json || typeof json.rawToken !== "string" || !json.token) {
        throw new Error("Server returned an unexpected response shape.");
      }
      setRevealed(json);
      // Reset reveal visibility for the new token — never inherit the
      // prior token's reveal state.
      setRevealVisible(false);
      setNewName("");
      setNewAccessLevel("full");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (!confirm("Revoke this token? External agents using it will lose access immediately."))
      return;
    try {
      const res = await fetch(`/api/access-tokens/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`Failed: ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can manually copy */
    }
  };

  if (settled && !isOwner) {
    return (
      <div className="max-w-3xl">
        <EmptyState
          icon={Lock}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={SIGN_IN_HREF}>Owner sign in</Link>
            </Button>
          }
        >
          <p className="font-medium text-text">Owner only</p>
          <p className="mt-1 text-sm">
            Access tokens connect agents to the workspace owner&apos;s account. Sign in as the owner
            to manage them.
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Create */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text flex items-center gap-2">
          <KeyRound className="w-4 h-4" aria-hidden="true" />
          Generate a new token
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Claude Desktop on Laptop"
            className="flex-1 min-w-0 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
            maxLength={80}
            disabled={creating}
          />
          <select
            value={newAccessLevel}
            onChange={(e) => setNewAccessLevel(e.target.value as AccessLevel)}
            disabled={creating}
            aria-label="Token access level"
            title="What this token is allowed to do. Enforced server-side on every MCP call."
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-text shrink-0"
          >
            <option value="full">Full access</option>
            <option value="write">Read + write (no intents)</option>
            <option value="read">Read-only</option>
          </select>
          <Button
            type="submit"
            // BUG-X3: block Create while an un-dismissed reveal panel
            // is open. Without this, a second create silently
            // overwrites `revealed` and the first raw token is lost
            // forever (the server doesn't store it).
            disabled={creating || !newName.trim() || revealed !== null}
            title={revealed !== null ? "Dismiss the current reveal panel first" : undefined}
          >
            {creating ? "Creating…" : "Create"}
          </Button>
        </form>
      </section>

      {/* Reveal modal (inline card) */}
      {revealed && (
        <section className="rounded-lg border border-accent/40 bg-accent/5 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-accent">Token created — copy now</h2>
          <p className="text-xs text-sub">
            This is the only time you&apos;ll see <code>{revealed.token.name}</code>&apos;s raw
            value. Store it in your agent&apos;s config (e.g. <code>AGILE_TOOLKIT_PAT</code> env
            var).
          </p>
          <div className="flex flex-wrap gap-2">
            <code className="flex-1 min-w-0 basis-full sm:basis-0 font-mono text-sm bg-bg rounded-md border border-border px-3 py-2 break-all">
              {revealVisible
                ? revealed.rawToken
                : `${revealed.rawToken.slice(0, 8)}${"•".repeat(Math.max(0, revealed.rawToken.length - 8))}`}
            </code>
            <Button
              onClick={() => setRevealVisible((v) => !v)}
              size="icon"
              variant="outline"
              aria-label={revealVisible ? "Hide token" : "Reveal token"}
              title={revealVisible ? "Hide" : "Reveal"}
              className="min-touch-coarse shrink-0"
            >
              {revealVisible ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </Button>
            <Button
              onClick={() => void onCopy(revealed.rawToken)}
              size="icon"
              variant="outline"
              aria-label="Copy token"
              className="min-touch-coarse shrink-0"
            >
              {copied ? (
                <Check className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Copy className="w-4 h-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <Button onClick={() => setRevealed(null)} variant="outline" size="sm">
            I&apos;ve saved it
          </Button>
        </section>
      )}

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-sm p-3"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* List */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text">Your tokens</h2>
        {loading ? (
          <p className="text-sm text-sub">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-sub">No tokens yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((t) => (
              <li key={t.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text truncate flex items-center gap-2">
                    {t.name}
                    {t.access_level && t.access_level !== "full" && (
                      <span className="text-[10px] uppercase tracking-wide text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                        {ACCESS_LEVEL_LABEL[t.access_level]}
                      </span>
                    )}
                    {t.revoked_at && (
                      <span className="text-[10px] uppercase tracking-wide text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-sub mt-0.5 font-mono">
                    {t.prefix}…&nbsp;·&nbsp;
                    {t.last_used_at
                      ? `last used ${new Date(t.last_used_at).toLocaleDateString()}`
                      : "never used"}
                  </div>
                </div>
                {!t.revoked_at && (
                  <Button
                    onClick={() => void onRevoke(t.id)}
                    size="icon"
                    variant="outline"
                    aria-label={`Revoke ${t.name}`}
                    className="min-touch-coarse shrink-0"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="text-xs text-sub space-y-2">
        <h3 className="text-text">Connecting from Claude Desktop / Claude Code</h3>
        <ol className="list-decimal ml-5 space-y-1">
          <li>
            Install the stdio relay: <code>npm i -g @agile-toolkit/mcp</code>
          </li>
          <li>
            Add to your MCP config:
            <pre className="bg-bg border border-border rounded p-2 mt-1 overflow-x-auto">{`{
  "mcpServers": {
    "agile-toolkit": {
      "command": "agile-toolkit-mcp",
      "env": {
        "AGILE_TOOLKIT_PAT": "<your-pat>",
        "AGILE_TOOLKIT_URL": "https://agile.amrelharony.com"
      }
    }
  }
}`}</pre>
          </li>
          <li>
            Restart your MCP client. Tools appear as <code>workspace.sprint.create</code> etc.
          </li>
        </ol>
      </section>
    </div>
  );
}
