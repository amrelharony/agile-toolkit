/**
 * What the voice notice in Amr's AI chat (components/agent/mascot/voice-notice)
 * says before a visitor's first dictation: the browser's own speech
 * recognition may send the sound of their voice to the company that makes the
 * browser. lib/site/disclosures re-exports it with the site's other words
 * about data, and the privacy page quotes it from there.
 *
 * A module of its own so the text ships only with the notice, which the
 * visitor's chat loads on the mic's first press: disclosures.ts rides in
 * several chunks (the comics pages' first load, the tool finder's), and a
 * bundler keeps in a module every export some chunk uses. No imports.
 *
 * A change that says something new bumps VOICE_CONSENT_VERSION
 * (lib/agent/mascot/voice-consent), so the notice asks again.
 */

export const VOICE_INPUT_DISCLOSURE =
  "Dictation uses your browser's own speech recognition. To turn what you say into text, your browser may send the sound of your voice to the company that makes it. This site never gets the sound: the words appear in the message box, and nothing goes to Amr until you send the message.";
