/**
 * A visitor's agreement to Amr's AI, kept in this browser only. One agreement
 * covers the chat and the tools' Ask Amr buttons: the card in the mascot panel
 * (components/agent/mascot/visitor-ai-consent.tsx) and the compact one on
 * tool pages (components/ai/ai-consent-compact.tsx) both read and write it
 * here.
 *
 * The key holds a version, so a change to what the card says asks again: v2
 * added the Ask Amr buttons. data/backup.ts leaves the key out of backups, so
 * each browser is asked for itself.
 *
 * No imports: safe in either bundle, and light enough for any page.
 */

/** Where the visitor's agreement is kept (localStorage), and its version. */
export const VISITOR_AI_CONSENT_KEY = "agile-toolkit:amr-ai-consent";
export const VISITOR_AI_CONSENT_VERSION = "v2";

/** Whether this browser already agreed to the current version of the card. */
export function hasVisitorAiConsent(): boolean {
  try {
    return window.localStorage.getItem(VISITOR_AI_CONSENT_KEY) === VISITOR_AI_CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** Remember the agreement (best effort: a blocked storage just asks again next time). */
export function storeVisitorAiConsent(): void {
  try {
    window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
  } catch {
    /* storage unavailable: the card shows again next time */
  }
}
