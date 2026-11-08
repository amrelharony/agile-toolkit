"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IDENTITY_INK } from "@/lib/squads/colors";
import { LogOut, Sparkles, ArrowRight } from "lucide-react";

interface Session {
  id: string;
  toolId: string;
  entityId: string;
  role: "editor" | "viewer" | "commenter";
  sharedBy: string;
  createdAt: string;
  expiresAt: string | null;
}

interface Props {
  profile: {
    id: string;
    displayName: string;
    color: string;
    squadId: string;
  };
}

export function GuestHomeClient({ profile }: Props) {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/guest/sessions");
        if (res.status === 401) {
          // Revoked mid-session — kick to join screen
          if (!cancelled) router.push("/guest/join");
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as { sessions?: Session[] };
        if (cancelled) return;
        setSessions(Array.isArray(json.sessions) ? json.sessions : []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const onSignOut = async () => {
    await fetch("/api/guest/me", { method: "DELETE" });
    // Sweep any presence leftover from a pre-fix session that wrote the
    // global `agile-toolkit:user` slot directly. New code paths thread
    // identity through PresenceIdentityProvider and never touch this
    // key, but a returning user might still have it set from an older
    // build — clear it so a subsequent owner sign-in on this browser
    // doesn't inherit the guest identity.
    try {
      window.localStorage.removeItem("agile-toolkit:user");
    } catch {
      /* private mode — already not persisting anyway */
    }
    router.push("/guest/join");
    router.refresh();
  };

  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-semibold shrink-0"
              style={{ backgroundColor: profile.color, color: IDENTITY_INK }}
              aria-hidden="true"
            >
              {profile.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-text truncate">{profile.displayName}</h1>
              <p className="text-xs text-sub">Signed in as guest</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onSignOut()}
            className="gap-1.5 text-xs"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            Sign out
          </Button>
        </header>

        {error && (
          <div
            role="alert"
            className="border border-danger/40 bg-danger/10 rounded px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sub text-sm">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <section className="border border-dashed border-border rounded-lg p-8 text-center bg-surface/40">
            <Sparkles className="w-8 h-8 mx-auto mb-3 text-accent/40" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text mb-1">No sessions yet</h2>
            <p className="text-xs text-sub max-w-sm mx-auto">
              When the owner shares a tool session with your squad, it&apos;ll appear here. Leave
              this tab open or come back later.
            </p>
          </section>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <a
                  href={`/guest/${encodeURIComponent(s.toolId)}/${encodeURIComponent(s.entityId)}`}
                  className="flex items-center gap-3 bg-surface border border-border rounded-lg p-3 hover:border-accent/40 transition group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-text truncate">
                        {formatToolName(s.toolId)}
                      </h3>
                      <span
                        className={`text-xs uppercase font-bold ${
                          s.role === "editor"
                            ? "text-warning"
                            : s.role === "commenter"
                              ? "text-success"
                              : "text-accent"
                        }`}
                      >
                        {s.role}
                      </span>
                    </div>
                    <p className="text-xs text-sub mt-0.5 truncate">Shared by {s.sharedBy}</p>
                  </div>
                  <ArrowRight
                    className="w-4 h-4 text-sub group-hover:text-accent transition"
                    aria-hidden="true"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function formatToolName(toolId: string): string {
  return toolId
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
