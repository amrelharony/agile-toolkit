"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Users, AlertTriangle } from "lucide-react";
import { SQUAD_COLORS } from "@/lib/squads/colors";

interface Props {
  initialCode: string;
  nextUrl: string;
}

export function JoinClient({ initialCode, nextUrl }: Props) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState<string>(SQUAD_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedCode = code.trim();
    const trimmedName = displayName.trim();
    if (!trimmedCode || !trimmedName) {
      setError("Code and display name are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/guest/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: trimmedCode,
          displayName: trimmedName,
          color,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const code = j.error ?? `failed_${res.status}`;
        if (code === "squad_not_found") {
          setError("That code isn't valid. Double-check with whoever shared it.");
        } else if (code === "invalid_input") {
          setError("Display name or color is invalid.");
        } else if (code === "service_unavailable") {
          setError("The guest service is not configured on this deployment.");
        } else {
          setError("Couldn't join. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      router.push(nextUrl || "/guest");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-6">
        <header className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent/10 text-accent">
            <Users className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-text">Join as a guest</h1>
          <p className="text-sub text-sm">
            Enter the squad code you were given, then pick a display name.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 rounded px-3 py-2 text-sm text-red-200"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs text-sub mb-1 block">Squad code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste your invite code"
              autoComplete="off"
              spellCheck={false}
              // h-11 on phones (44 px tap floor); shrink to 36 px on md+.
              // text-base also kills iOS auto-zoom on focus.
              className="w-full h-11 md:h-9 bg-surface border border-border rounded px-3 text-base md:text-sm text-text font-mono focus:outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-xs text-sub mb-1 block">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others will see you"
              maxLength={60}
              className="w-full h-11 md:h-9 bg-surface border border-border rounded px-3 text-base md:text-sm text-text focus:outline-none focus:border-accent"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-xs text-sub">Your color</legend>
            <div className="flex flex-wrap gap-2">
              {SQUAD_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  style={{ backgroundColor: c }}
                  className={`min-touch-coarse w-8 h-8 rounded-full border-2 transition ${
                    color === c ? "border-text scale-110" : "border-transparent hover:scale-105"
                  }`}
                />
              ))}
            </div>
          </fieldset>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-accent text-bg hover:bg-accent/80"
          >
            {submitting ? "Joining…" : "Join squad"}
          </Button>
        </form>
      </div>
    </main>
  );
}
