/**
 * A visitor's yes to dictation in Amr's AI chat, remembered in this browser.
 *
 * Browser dictation (the Web Speech API) may send the sound of the visitor's
 * voice to the company that makes the browser, so the visitor's chat asks
 * once before its mic first listens (components/agent/mascot/voice-notice,
 * in the words of lib/site/disclosures VOICE_INPUT_DISCLOSURE). "Use voice"
 * is kept here, under a versioned key, so the notice shows once per browser,
 * and again if what it says changes. "Not now" is not kept: the next press
 * of the mic says the visitor wants to dictate now, so it asks again.
 *
 * Per browser on purpose: a backup file never carries it (lib/data/backup
 * names the key), and clearing the site's data forgets it. Storage that
 * throws (a private window, blocked site data) reads as "not asked yet".
 *
 * The owner's chat never asks (dictation there is the owner's own choice),
 * so only the visitor's chat imports this. No imports.
 */

/** Where the visitor's yes is kept (localStorage). */
export const VOICE_CONSENT_KEY = "agile-toolkit:amr-voice-consent";
/** Its version: a change to VOICE_INPUT_DISCLOSURE that says something new bumps it, so the notice asks again. */
export const VOICE_CONSENT_VERSION = "v1";

/** Whether this browser already said "Use voice" to the current notice. */
export function hasVoiceConsent(): boolean {
  try {
    return window.localStorage.getItem(VOICE_CONSENT_KEY) === VOICE_CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** Remember "Use voice" (best effort: storage that throws just asks again next time). */
export function storeVoiceConsent(): void {
  try {
    window.localStorage.setItem(VOICE_CONSENT_KEY, VOICE_CONSENT_VERSION);
  } catch {
    /* storage unavailable: the notice shows again on the next first press */
  }
}
