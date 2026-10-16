"use client";

/**
 * The owner's agent chat, loaded on demand.
 *
 * Everything the agent needs — the action registry (305 actions + zod), the
 * streaming client, the conversation list — lives behind this module so the
 * mascot ships none of it to visitors. MascotAssistant mounts it with
 * next/dynamic only for a confirmed owner with the panel open.
 */

// Populate the tool action registry before any agent code reads it.
import "@/lib/actions/register-all";
import { useEffect } from "react";
import { abortInFlight } from "@/lib/agent/client";
import { RateLimitBar } from "./rate-limit-bar";
import { AgentConversation } from "../agent-conversation";
import { ConversationList } from "../conversation-list";

interface OwnerAgentPanelProps {
  showHistory: boolean;
  onCloseHistory: () => void;
}

export default function OwnerAgentPanel({ showHistory, onCloseHistory }: OwnerAgentPanelProps) {
  // Closing the panel, signing out or leaving the shell unmounts this panel:
  // stop any in-flight turn (its tool calls run in this tab).
  useEffect(() => () => abortInFlight(), []);

  if (showHistory) {
    return (
      <div className="min-h-0 flex-1">
        <ConversationList onClose={onCloseHistory} />
      </div>
    );
  }
  return (
    <>
      <RateLimitBar />
      <div className="min-h-0 flex-1 px-3 py-2">
        <AgentConversation />
      </div>
    </>
  );
}
