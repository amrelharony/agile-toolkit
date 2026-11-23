"use client";

/**
 * What the open panel shows anyone who isn't the confirmed owner: the tool
 * finder (VisitorGuide), or, with Amr's AI for visitors on, the panel that
 * adds the consent card and the chat (VisitorPanel).
 *
 * A chunk of its own, never part of Amr's: mascot-assistant loads on every
 * page and stays small, so it reaches this module only through the import()
 * in lazy-visitor-body, which also fetches it ahead when the browser is idle
 * or a pointer or focus first reaches Amr. The guide's data (the jobs, the
 * tool search, the guides index) and its icons come with it.
 *
 * Every visitor still fetches it, so it keeps the every-page rules
 * (test/agent/bundle-boundary.test.ts): no owner runtime, no chat parts, no
 * markdown. The visitor's chat stays a further chunk behind VisitorPanel.
 */

import type { ReactNode } from "react";
import { VisitorGuide } from "./visitor-guide";
import { VisitorPanel } from "./visitor-panel";

export interface VisitorBodyProps {
  /** Amr's AI for visitors is on: the guide first, then consent and the chat. */
  ai: boolean;
  /** A link or a tool was chosen: the panel closes. */
  onNavigate: () => void;
  /** Over the plain tool finder (AI off), such as the unverified-owner note. */
  note?: ReactNode;
}

export function VisitorBody({ ai, onNavigate, note }: VisitorBodyProps) {
  return ai ? (
    <VisitorPanel onNavigate={onNavigate} />
  ) : (
    <VisitorGuide onNavigate={onNavigate} note={note} />
  );
}
