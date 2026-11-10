/**
 * Amr's offer to feel the phone.
 *
 * iPhones, and browsers that follow them, send tilt and shake readings only
 * after the visitor says yes to the browser's own prompt, and that prompt may
 * only be raised from a tap. So on those phones he asks first, in a bubble beside
 * him: "Tilt your phone, I'll feel it", Allow or No thanks. Allow raises the
 * browser's prompt from that very tap.
 *
 * He asks once, ever (store.motionAsked): not again after an answer, and not
 * again if the bubble was left alone. That is once on each phone: the mark that
 * he asked stays on the device and out of backups, so a phone restored from
 * another phone's backup is still asked (unless the backup carries an answer,
 * which is a choice and travels). The switch in his panel stays for a change
 * of mind. Never under reduced motion, and never where the phone sends motion
 * without asking (there he feels it from the start). On Quiet, in Focus and in
 * the quiet hours he holds the question for another time (lib/agent/mascot/say.ts).
 */

import { MOTION_INVITE } from "@/lib/agent/mascot/lines";
import { say } from "@/lib/agent/mascot/say";
import { useMascotStore } from "@/lib/agent/mascot/store";
import {
  canFeelPhone,
  motionNeedsPermission,
  requestMotionPermission,
} from "./engine/interactions/sensors";

export const MOTION_INVITE_ID = "motion-invite";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Whether this is the moment to ask: a phone that needs asking, and he hasn't yet. */
export function shouldInviteMotion(): boolean {
  const m = useMascotStore.getState();
  return (
    m.ready &&
    m.feelPhone === null &&
    !m.motionAsked &&
    canFeelPhone() &&
    motionNeedsPermission() &&
    !prefersReducedMotion()
  );
}

/** Raise the browser's prompt (call from the tap) and keep the answer. */
export async function allowMotion(): Promise<boolean> {
  const granted = await requestMotionPermission();
  const mascot = useMascotStore.getState();
  mascot.setFeelPhone(granted);
  if (granted) mascot.playNow("startle");
  return granted;
}

/** Show the offer if this is the moment for it. True when it was shown. */
export function inviteMotion(): boolean {
  if (!shouldInviteMotion()) return false;
  const asked = say("ask", {
    id: MOTION_INVITE_ID,
    text: MOTION_INVITE.text,
    actions: [
      { label: MOTION_INVITE.allow, run: () => void allowMotion() },
      { label: MOTION_INVITE.decline, run: () => useMascotStore.getState().setFeelPhone(false) },
    ],
  });
  if (asked) useMascotStore.getState().setMotionAsked();
  return asked;
}
