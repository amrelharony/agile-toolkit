import { redirect } from "next/navigation";
import { getGuestSession } from "@/lib/auth/guest-session";
import { isSafeGuestNextUrl } from "@/lib/auth/guest-next-url";
import { JoinClient } from "./join-client";

export const metadata = {
  title: "Join",
  description: "Enter a squad code to join.",
};

// Next 14 delivers searchParams values as `string | string[] | undefined`
// for repeatable params. Type accordingly so duplicate ?code= or ?next=
// don't blow up downstream code with a non-string value.
interface SearchParams {
  code?: string | string[];
  next?: string | string[];
}

function firstString(v: string | string[] | undefined): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

export default async function JoinPage({ searchParams }: { searchParams: SearchParams }) {
  const next = firstString(searchParams.next);
  const safeNext = isSafeGuestNextUrl(next) ? next : "/guest";
  // If the visitor already has a valid guest cookie, send them straight
  // to their target — no need to re-prompt for a code + name. This is
  // the "browser remembers you" flow.
  const existing = await getGuestSession();
  if (existing) {
    redirect(safeNext);
  }
  return <JoinClient initialCode={firstString(searchParams.code)} nextUrl={safeNext} />;
}
