"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";

/**
 * Shown in the mascot panel to visitors in place of the agent chat.
 *
 * The agent runs on the owner's server key and keeps its threads in the
 * owner's Supabase project, so it is owner-only. Rendering this instead of
 * the chat also means a visitor's panel makes no agent or Supabase requests
 * (conversation list, usage peek, /api/agent/*). In-tool AI prompts are
 * unaffected — they call the provider from the browser with the visitor's
 * own key, which "AI settings" configures.
 */
export function AgentVisitorNotice({ onAction }: { onAction?: () => void }) {
  const pathname = usePathname();
  const openSettings = useLlmUiStore((s) => s.openSettings);
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`;

  return (
    <div
      data-testid="agent-visitor-notice"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <Sparkles className="h-6 w-6 text-accent" aria-hidden="true" />
      <p className="text-sm text-text">
        The toolkit&apos;s AI agent is available to the workspace owner.
      </p>
      <p className="text-xs text-sub">
        Every tool&apos;s built-in AI prompts still work with your own API key.
      </p>
      <Button
        type="button"
        variant="toolkit"
        size="sm"
        onClick={() => {
          onAction?.();
          openSettings();
        }}
      >
        <KeyRound aria-hidden="true" />
        AI settings
      </Button>
      <Link
        href={signInHref}
        onClick={onAction}
        className="text-[11px] text-sub underline-offset-2 hover:text-text hover:underline"
      >
        Owner sign in
      </Link>
    </div>
  );
}
