import type { Metadata } from "next";
import Link from "next/link";
import { InkArt } from "@/components/ink/ink-art";
import { keyArt } from "@/lib/ink/drawings/pages/key";
import { SignOutButton } from "./sign-out-button";

// The root layout's title template appends " | Agile Toolkit".
export const metadata: Metadata = {
  title: "Not authorized",
  description: "This Google account isn't the Agile Toolkit workspace owner.",
  robots: { index: false, follow: false },
};

/**
 * Where the middleware and the OAuth callback send a signed-in account
 * that can't be the owner. `?reason=` picks the copy:
 *   - "denied" (default): a non-owner Google account. The site is public,
 *     so the page says so instead of describing a locked workspace.
 *   - "config": the deployment can't check ownership at all (Supabase env
 *     or AUTHORIZED_EMAILS missing). Only the owner hits this — on an
 *     owner-only page — so it keeps the operator hint.
 */
export default function NotAuthorizedPage({
  searchParams,
}: {
  searchParams?: { reason?: string | string[] };
}) {
  const config = searchParams?.reason === "config";

  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-6 py-16">
      <div className="ink-host max-w-md w-full text-center space-y-6">
        {/* The owner's key: the one thing this account doesn't hold. */}
        <InkArt drawing={keyArt} boil className="mx-auto h-16 w-16" />
        {config ? (
          <>
            <h1 className="text-2xl font-semibold text-text">Owner sign-in unavailable</h1>
            <p className="text-sub leading-relaxed">
              This deployment can&apos;t verify the workspace owner right now, so owner-only pages
              are closed. Every tool still works without signing in.
            </p>
            <p className="text-xs text-sub">
              If this is your workspace, check that{" "}
              <code className="font-mono">AUTHORIZED_EMAILS</code> and the Supabase variables are
              set correctly in the deployment environment.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-text">Not the owner account</h1>
            <p className="text-sub leading-relaxed">
              This Google account isn&apos;t the workspace owner. Every tool still works without
              signing in, and your work is saved only in this browser.
            </p>
          </>
        )}
        <div className="pt-2">
          <SignOutButton />
        </div>
        <p className="text-xs text-sub">
          On a squad?{" "}
          <Link
            href="/guest/join"
            className="underline underline-offset-4 hover:text-accent transition-colors"
          >
            Join with a squad invite code
          </Link>
        </p>
      </div>
    </main>
  );
}
