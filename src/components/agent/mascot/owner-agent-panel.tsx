"use client";

/**
 * The owner's agent chat, loaded on demand.
 *
 * Everything the agent needs — the action registry (305 actions + zod), the
 * streaming client, the conversation list — lives behind this module so the
 * mascot ships none of it to visitors. MascotAssistant mounts it with
 * next/dynamic only for a confirmed owner with the panel open.
 *
 * It fills the panel header (panel-chrome) from here, so New chat goes through
 * this chunk's store and the header icons arrive with the chat:
 *  - actions: New chat, then History. In History that button is "Back to chat"
 *    with an arrow, the same button (focus stays on it both ways: the chat
 *    coming back offers its composer to the panel's focus owner, which leaves
 *    focus that a control inside the panel holds), and it carries a dot while
 *    a confirm card waits in the chat behind it.
 *  - subtitle: the open thread's title, or "New chat"; "Your chats" in History.
 * Whether History shows is kept by the shell, so it outlasts the panel closing.
 *
 * Closing the panel unmounts this, and an answer under way goes on: the turn
 * lives in the agent store and the client, not here. Only Stop, New chat, a
 * thread switch, signing out or the chat changing hands stop it (the store's
 * abortTurn, reset, setActiveConversation and setChatProfile).
 */

// Populate the tool action registry before any agent code reads it.
import "@/lib/actions/register-all";
import { ArrowLeft, History, Plus } from "lucide-react";
import { AMR_WAITING_FOR_OK } from "@/lib/agent/mascot/outside-narration";
import { useAgentStore } from "@/lib/agent/store";
import { RateLimitBar } from "./rate-limit-bar";
import { PANEL_SUBTITLE, PanelActions, PanelIconButton, PanelSubtitle } from "./panel-chrome";
import { COMPACT_HIDDEN } from "./panel-context";
import { AgentConversation } from "../agent-conversation";
import { ConversationList } from "../conversation-list";

/**
 * Said on "Back to chat" while a confirm card waits in the chat (its tooltip
 * and, after its name, its description): narration, not an Amr line. The
 * bubble beside Amr says the same while the panel is shut.
 */
export const CARD_WAITING_NOTE = AMR_WAITING_FOR_OK;

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
  const thread = useAgentStore((s) => s.activeMeta?.title.trim() || null);
  // A card the owner can't see from History: the way back says so.
  const cardWaits = useAgentStore((s) => s.pendingToolUse !== null) && showHistory;

  return (
    <>
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
        {/* One button both ways, so focus stays on it when History opens. Its
            name says where it goes, so it is not a toggle (no aria-pressed). */}
        <PanelIconButton
          label={showHistory ? "Back to chat" : "Conversation history"}
          title={
            showHistory
              ? cardWaits
                ? `Back to chat · ${CARD_WAITING_NOTE}`
                : "Back to chat"
              : "History"
          }
          onClick={onToggleHistory}
          className="relative"
          // Where focus goes when Escape takes the owner back from History.
          data-panel-history=""
        >
          {showHistory ? <ArrowLeft aria-hidden="true" /> : <History aria-hidden="true" />}
          {cardWaits && (
            <span
              data-card-waiting=""
              aria-hidden="true"
              className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-card forced-colors:bg-[color:CanvasText] forced-colors:forced-color-adjust-none"
            />
          )}
        </PanelIconButton>
      </PanelActions>
      <PanelSubtitle>
        {showHistory ? (
          PANEL_SUBTITLE.history
        ) : thread ? (
          // The whole title on hover: the line truncates.
          <span title={thread}>{thread}</span>
        ) : (
          PANEL_SUBTITLE.owner
        )}
      </PanelSubtitle>
      {showHistory ? (
        <div className="min-h-0 flex-1">
          <ConversationList onClose={onCloseHistory} />
        </div>
      ) : (
        <>
          {/* The usage line waits while the panel is compact (a keyboard is up). */}
          <div className={COMPACT_HIDDEN}>
            <RateLimitBar />
          </div>
          {/* A flex column that may shrink (min-h-0), so a short panel squeezes
              the log, never the composer. */}
          <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
            <AgentConversation />
          </div>
        </>
      )}
    </>
  );
}
