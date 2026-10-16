"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for a single tool route.
 *
 * Without it a crash in one tool reached the shell-wide boundary, which
 * replaced the sidebar and header too and showed only the raw error. This
 * keeps the navigation in place and tells the user their data is safe —
 * tool state lives in this browser's storage, not in the crashed component.
 */
export default function ToolError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[tool error]", error);
  }, [error]);

  return (
    <div className="container-tool py-12 sm:py-16" role="alert">
      <div className="max-w-xl">
        <h1 className="font-display text-fluid-h3 font-bold text-text">This tool hit a problem</h1>
        <p className="mt-3 text-fluid-body text-sub">
          Your work is still saved in this browser. Try loading the tool again; if it keeps
          happening, go back to the tool list and reopen it.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={reset} className="gap-2">
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Link href="/" className="text-sm font-medium text-accent hover:underline">
            Back to all tools
          </Link>
        </div>
        {error.digest && <p className="mt-6 text-xs text-sub">Error reference: {error.digest}</p>}
      </div>
    </div>
  );
}
