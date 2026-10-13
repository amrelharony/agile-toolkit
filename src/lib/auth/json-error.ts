import { NextResponse } from "next/server";

/**
 * The JSON error shape every owner-only API answers with: `{ error, message }`.
 *
 * Shared by the edge middleware and `requireAuthorizedUser` so a client sees
 * the same body whether the request was stopped at the edge or in the route
 * handler. Edge-safe on purpose — `require-user.ts` imports `next/headers`,
 * which the middleware cannot.
 *
 * `cache-control: no-store` because these answers depend on the caller's
 * cookies; a shared cache must never serve one caller's answer to another.
 */
export function jsonError(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { error: code, message },
    { status, headers: { "cache-control": "no-store", ...headers } }
  );
}
