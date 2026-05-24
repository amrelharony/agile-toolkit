"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { KeyRound, Trash2, Copy, Check, Eye, EyeOff } from "lucide-react";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface CreatedToken {
  token: TokenRow;
  rawToken: string;
}

export function AccessTokensClient() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
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
    void refresh();
  }, []);

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/access-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
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
          className="flex gap-2"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Claude Desktop on Laptop"
            className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
            maxLength={80}
            disabled={creating}
          />
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
          <div className="flex gap-2">
            <code className="flex-1 font-mono text-sm bg-bg rounded-md border border-border px-3 py-2 break-all">
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
