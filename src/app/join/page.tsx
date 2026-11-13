import type { Metadata } from "next";
import Link from "next/link";
import { Radio } from "lucide-react";
import { visitorRoomsEnabled } from "@/lib/realtime/visitor-rooms";
import { LiveRoomsOff } from "./live-rooms-off";
import { JoinCodeForm } from "./join-code-form";

export const metadata: Metadata = {
  title: "Join a live room",
  description: "Type the code from the host's screen to join a live room.",
  robots: { index: false, follow: false },
};

interface SearchParams {
  code?: string | string[];
}

function firstString(v: string | string[] | undefined): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

/**
 * `/join`: type the code from the host's screen (the big screen says to).
 * `?code=` fills the box in. A bare route like `/join/<tool>/<code>`: no app
 * shell, nothing connects here.
 */
export default function JoinPage({ searchParams }: { searchParams: SearchParams }) {
  if (!visitorRoomsEnabled()) return <LiveRoomsOff />;
  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-4 py-10">
      <section className="w-full max-w-md space-y-5 rounded-xl border border-border bg-surface p-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-text">
            <Radio className="h-5 w-5 text-accent" aria-hidden="true" />
            Join a live room
          </h1>
          <p className="text-sm text-sub">
            Type the code from the host&apos;s screen. You&apos;ll be asked for your name before
            anything connects.
          </p>
        </header>
        <JoinCodeForm initialCode={firstString(searchParams.code)} />
        <Link
          href="/"
          className="min-touch-coarse inline-flex items-center rounded text-sm text-sub hover:text-text"
        >
          Go to the Agile Toolkit
        </Link>
      </section>
    </main>
  );
}
