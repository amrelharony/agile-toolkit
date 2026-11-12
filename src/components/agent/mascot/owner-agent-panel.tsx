"use client";

/**
 * The owner's agent chat, loaded on demand.
 *
 * Everything the agent needs — the action registry (305 actions + zod), the
 * streaming client, the conversation list — lives behind this module so the
 * mascot ships none of it to visitors. MascotAssistant mounts it with
 * next/dynamic only for a confirmed owner with the panel open.
 *
 * Closing the panel unmounts this, and an answer under way goes on: the turn
 * lives in the agent store and the client, not here. Only Stop, New chat, a
 * thread switch, signing out or the chat changing hands stop it (the store's
 * abortTurn, reset, setActiveConversation and setChatProfile).
 */

// Populate the tool action registry before any agent code reads it.
import "@/lib/actions/register-all";
import { RateLimitBar } from "./rate-limit-bar";
import { AgentConversation } from "../agent-conversation";
import { ConversationList } from "../conversation-list";

interface OwnerAgentPanelProps {
  showHistory: boolean;
  onCloseHistory: () => void;
}

export default function OwnerAgentPanel({ showHistory, onCloseHistory }: OwnerAgentPanelProps) {
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
