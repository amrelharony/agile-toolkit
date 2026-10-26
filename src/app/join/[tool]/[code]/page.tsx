import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Radio } from "lucide-react";
import {
  isVisitorRoomCode,
  isVisitorTool,
  visitorRoomsEnabled,
} from "@/lib/realtime/visitor-rooms";
import { JoinRoom } from "./join-room";

// Reached by a link someone shared, never by search. robots.ts disallows
// /join too; this covers crawlers that ignore it.
export const metadata: Metadata = {
  title: "Join a live room",
  description: "Join a teammate's live room.",
  robots: { index: false, follow: false },
};

interface Params {
  tool: string;
  code: string;
}

/**
 * `/join/<tool>/<code>`: where a visitor live room's link lands.
 *
 * The tool and code are checked here, on the server, before anything
 * renders: anything but a visitor tool (`VISITOR_TOOLS`) with a
 * 12-character room code is a 404. With `NEXT_PUBLIC_VISITOR_ROOMS` off,
 * the page says so and links home; no client code that could open a
 * channel is sent. With it on, the client asks for a name and consent
 * before it connects (and, for a vote round, first checks the link carries
 * the host's key).
 */
export default function JoinRoomPage({ params }: { params: Params }) {
  const { tool, code } = params;
  if (!isVisitorTool(tool) || !isVisitorRoomCode(code)) notFound();
  if (!visitorRoomsEnabled()) return <LiveRoomsOff />;
  return <JoinRoom tool={tool} code={code} />;
}

function LiveRoomsOff() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 flex flex-col gap-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-text">
          <Radio className="h-5 w-5 text-sub" aria-hidden="true" />
          Live rooms are off
        </h1>
        <p className="text-sm text-sub">
          This site isn&apos;t running live rooms at the moment, so this link can&apos;t connect.
          You can still run the tools on one shared screen, or ask the host to count hands.
        </p>
        <Link
          href="/"
          className="self-start rounded-md border border-border px-3 py-2 text-sm text-text hover:border-accent/40 hover:text-accent"
        >
          Go to the Agile Toolkit
        </Link>
      </section>
    </main>
  );
}
