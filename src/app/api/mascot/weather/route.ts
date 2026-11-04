/**
 * GET /api/mascot/weather: the weather where the visitor roughly is, for Amr
 * (src/lib/agent/mascot/context/weather.ts). 204 when the place isn't known,
 * which is always the case in local dev unless `?at=lat,lon` is given.
 *
 * Reachable without a session through an exact-match middleware bypass. It
 * reads only Vercel's geolocation headers, rounds them to about 11 km, and
 * answers with the weather alone, never the place. See weather-server.ts.
 */

import type { NextRequest } from "next/server";
import { placeFrom, readWeather, WEATHER_TTL_S } from "@/lib/agent/mascot/context/weather-server";

export const dynamic = "force-dynamic";

const nothing = () =>
  new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: NextRequest) {
  const allowOverride = process.env.VERCEL_ENV !== "production";
  const place = placeFrom(req.headers, req.nextUrl.searchParams, allowOverride);
  if (!place) return nothing();
  const weather = await readWeather(place);
  if (!weather) return nothing();
  return Response.json(weather, {
    headers: { "Cache-Control": `private, max-age=${WEATHER_TTL_S}` },
  });
}
