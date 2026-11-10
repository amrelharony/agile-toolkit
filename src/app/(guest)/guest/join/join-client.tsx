"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { SQUAD_COLORS } from "@/lib/squads/colors";
import { InkArt } from "@/components/ink/ink-art";
import { squadArt } from "@/lib/ink/drawings/pages/squad";

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
    // Codes are base64url, so any whitespace came from a paste that wrapped
    // or picked up a space; the server compares the exact 32 characters.
    const trimmedCode = code.replace(/\s+/g, "");
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
    <main className="min-h-screen-dvh flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg space-y-6">
        {/* A bare page, with no Amr: the squad, inked, says who's inviting. */}
        <header className="ink-host text-center space-y-2">
          <InkArt drawing={squadArt} boil className="mx-auto h-16 w-16" />
          <h1 className="text-2xl font-semibold text-text">Join as a guest</h1>
          <p className="text-sub text-sm">
            Enter the squad code you were given, then pick a display name.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border border-danger/40 bg-danger/10 rounded px-3 py-2 text-sm text-danger"
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
              // The code is case-sensitive: iOS would capitalise the first
              // letter and the server would say it isn't valid.
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              // 44 px tall with 16 px text on touch at any width (iOS zooms
              // on a focused field under 16 px, and a landscape phone is
              // wider than md); 36 px / 14 px only for a mouse at md+.
              className="w-full h-11 pointer-fine:md:h-9 bg-surface border border-border rounded px-3 text-base pointer-fine:md:text-sm text-text font-mono focus:outline-none focus:border-accent"
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
              className="w-full h-11 pointer-fine:md:h-9 bg-surface border border-border rounded px-3 text-base pointer-fine:md:text-sm text-text focus:outline-none focus:border-accent"
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
