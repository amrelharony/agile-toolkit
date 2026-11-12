"use client";

/**
 * The owner's agent chat, loaded on demand.
 *
 * Everything the agent needs — the action registry (305 actions + zod), the
 * streaming client, the conversation list — lives behind this module so the
 * mascot ships none of it to visitors. MascotAssistant mounts it with
 * next/dynamic only for a confirmed owner with the panel open.
 *
 * Its header icons, New chat and History, are its own: it draws them into the
 * panel header's actions slot (panel-chrome), so New chat goes through this
 * chunk's store and they arrive with the chat. In History the subtitle reads
 * "Your chats". Whether History shows is kept by the shell, so it outlasts the
 * panel closing.
 *
 * Closing the panel unmounts this, and an answer under way goes on: the turn
 * lives in the agent store and the client, not here. Only Stop, New chat, a
 * thread switch, signing out or the chat changing hands stop it (the store's
 * abortTurn, reset, setActiveConversation and setChatProfile).
 */

// Populate the tool action registry before any agent code reads it.
import "@/lib/actions/register-all";
import { History, Plus } from "lucide-react";
import { useAgentStore } from "@/lib/agent/store";
import { RateLimitBar } from "./rate-limit-bar";
import { PANEL_SUBTITLE, PanelActions, PanelIconButton, PanelSubtitle } from "./panel-chrome";
import { AgentConversation } from "../agent-conversation";
import { ConversationList } from "../conversation-list";

interface OwnerAgentPanelProps {
  showHistory: boolean;
  onToggleHistory: () => void;
  onCloseHistory: () => void;
}

export default function OwnerAgentPanel({
  showHistory,
  onToggleHistory,
  onCloseHistory,
}: OwnerAgentPanelProps) {
  const actions = (
    <PanelActions>
      <PanelIconButton
        label="New chat"
        onClick={() => {
          // Stops an answer under way too (the store's reset aborts the turn).
          useAgentStore.getState().reset();
          onCloseHistory();
        }}
      >
        <Plus aria-hidden="true" />
      </PanelIconButton>
      <PanelIconButton
        label="Conversation history"
        title="History"
        aria-pressed={showHistory}
        onClick={onToggleHistory}
      >
        <History aria-hidden="true" />
      </PanelIconButton>
    </PanelActions>
  );
  if (showHistory) {
    return (
      <>
        {actions}
        <PanelSubtitle>{PANEL_SUBTITLE.history}</PanelSubtitle>
        <div className="min-h-0 flex-1">
          <ConversationList onClose={onCloseHistory} />
        </div>
      </>
    );
  }
  return (
    <>
      {actions}
      <RateLimitBar />
      <div className="min-h-0 flex-1 px-3 py-2">
        <AgentConversation />
      </div>
    </>
  );
}
