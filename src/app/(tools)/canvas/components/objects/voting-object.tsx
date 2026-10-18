"use client";

/**
 * Voting widget (Phase 27).
 *
 * Renders a question + one button per option. Each click records the
 * voter's choice keyed by their user id; identical clicks toggle off.
 * Tallies stay hidden until the "Reveal" button is pressed (Planning
 * Poker convention).
 *
 * Bidirectional sync with Story.points: when `storyId` is set and the
 * vote is revealed, the canvas-level handler can push the most common
 * vote back into `Story.points`. That logic lives in the canvas (so
 * it can call upsertStory); this component just emits the mutations.
 */

import { memo, useMemo } from "react";
import { Eye, EyeOff, RotateCcw, CheckCircle2 } from "lucide-react";
import type { WhiteboardVoting } from "@/lib/stores/workspace-types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

interface VotingObjectProps {
  object: WhiteboardVoting;
  selected: boolean;
  selfId: string;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMutate: (patch: Partial<WhiteboardVoting>) => void;
}

function VotingObjectImpl({
  object: o,
  selected,
  selfId,
  onPointerDown,
  onMutate,
}: VotingObjectProps) {
  const myVote = o.votes[selfId];

  // Tally aggregated by option for the revealed state.
  const tally = useMemo(() => {
    const t: Record<string, number> = {};
    for (const opt of o.options) t[opt] = 0;
    for (const v of Object.values(o.votes)) {
      if (v in t) t[v]++;
    }
    return t;
  }, [o.votes, o.options]);

  const totalVotes = Object.keys(o.votes).length;
  // For revealed state: which option got the most votes (for highlight).
  const topOption = useMemo(() => {
    let top: string | null = null;
    let topCount = 0;
    for (const [opt, count] of Object.entries(tally)) {
      if (count > topCount) {
        topCount = count;
        top = opt;
      }
    }
    return top;
  }, [tally]);

  const castVote = (opt: string) => {
    // R5: read the LIVE votes from the workspace store inside the
    // handler (not from the captured `o` prop). Two peers voting
    // simultaneously previously each captured the prop's `o.votes`,
    // both wrote `{prev, mine}` at v+1, and the LWW-loser's vote was
    // dropped. Reading from getState() narrows the race window from
    // "between renders" to "between read and the next patch broadcast"
    // — only a sub-RTT collision can still race, and that's bounded by
    // the 100ms patch throttle.
    //
    // R11-fix: switched from `require()` to a static import at file
    // top. The dynamic require worked today via webpack's runtime
    // shim but would throw under native ESM (Next.js 15+ with ESM
    // packages). voting-object → workspace-store is NOT actually a
    // circular dep (workspace-store doesn't import voting-object),
    // so the static import is safe.
    let liveVotes: Record<string, string> = o.votes;
    const live = (useWorkspaceStore.getState().whiteboardObjects ?? []).find((x) => x.id === o.id);
    if (live && live.type === "voting") liveVotes = live.votes;
    const next: Record<string, string> = { ...liveVotes };
    if (next[selfId] === opt) {
      delete next[selfId]; // toggle off
    } else {
      next[selfId] = opt;
    }
    onMutate({ votes: next });
  };

  return (
    <div
      onPointerDown={onPointerDown}
      data-canvas-object-kind="voting"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
        width: o.w,
        height: o.h,
        background: "#0b0f17",
        border: `2px solid ${selected ? "#00f0ff" : "#475569"}`,
        borderRadius: 10,
        boxShadow: selected ? "0 0 12px rgba(0,240,255,0.4)" : "0 1px 3px rgba(0,0,0,0.3)",
        cursor: o.locked ? "default" : "move",
        zIndex: o.z,
        opacity: o.locked ? 0.85 : 1,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        padding: 10,
        boxSizing: "border-box",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, flex: 1, lineHeight: 1.2 }}>
          {o.question || "Untitled vote"}
        </div>
        <div style={{ display: "flex", gap: 4 }} onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onMutate({ revealed: !o.revealed })}
            aria-label={o.revealed ? "Hide votes" : "Reveal votes"}
            title={o.revealed ? "Hide votes" : "Reveal votes"}
            style={iconBtn}
          >
            {o.revealed ? (
              <EyeOff style={{ width: 12, height: 12 }} />
            ) : (
              <Eye style={{ width: 12, height: 12 }} />
            )}
          </button>
          <button
            type="button"
            onClick={() => onMutate({ votes: {}, revealed: false })}
            aria-label="Reset votes"
            title="Reset"
            style={iconBtn}
          >
            <RotateCcw style={{ width: 12, height: 12 }} />
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          flex: 1,
          alignContent: "flex-start",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {o.options.map((opt) => {
          const isMine = myVote === opt;
          const count = tally[opt];
          const isTop = o.revealed && opt === topOption && count > 0;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => castVote(opt)}
              aria-label={`Vote ${opt}${o.revealed ? ` (${count} votes)` : ""}`}
              aria-pressed={isMine}
              style={{
                minWidth: 32,
                height: 32,
                padding: "0 8px",
                borderRadius: 6,
                border: isMine ? "2px solid #00f0ff" : "1px solid #475569",
                background: isTop
                  ? "rgba(52, 211, 153, 0.18)"
                  : isMine
                    ? "rgba(0, 240, 255, 0.12)"
                    : "#1e293b",
                color: "#e5e7eb",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>{opt}</span>
              {o.revealed && count > 0 && (
                <span style={{ fontSize: 10, color: "#94a3b8" }}>·{count}</span>
              )}
              {isMine && <CheckCircle2 style={{ width: 10, height: 10, color: "#00f0ff" }} />}
            </button>
          );
        })}
      </div>
      <div
        // aria-live="polite" so screen readers announce vote tally
        // changes (e.g. "3 votes" → "4 votes") as peers cast votes.
        // Polite (not assertive) so it doesn't interrupt ongoing
        // speech / cursor-chat announcements.
        aria-live="polite"
        aria-atomic="true"
        style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}
      >
        {totalVotes} vote{totalVotes === 1 ? "" : "s"}
        {!o.revealed && totalVotes > 0 && " (hidden)"}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 4,
  border: "none",
  background: "rgba(148,163,184,0.15)",
  color: "#cbd5e1",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const VotingObject = memo(VotingObjectImpl);
