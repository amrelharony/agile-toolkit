import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  isVisitorRoomCode,
  isVisitorTool,
  visitorRoomsEnabled,
} from "@/lib/realtime/visitor-rooms";
import { LiveRoomsOff } from "../../live-rooms-off";
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
 * before it connects (and, for a signed room (a vote round, a show room or
 * a wall room), first checks the link carries the host's key).
 *
 * Someone who has only the code types it at `/join` instead.
 */
export default function JoinRoomPage({ params }: { params: Params }) {
  const { tool, code } = params;
  if (!isVisitorTool(tool) || !isVisitorRoomCode(code)) notFound();
  if (!visitorRoomsEnabled()) return <LiveRoomsOff />;
  return <JoinRoom tool={tool} code={code} />;
}
