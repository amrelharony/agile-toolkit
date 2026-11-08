"use client";

import {
  dismissNotification,
  isLegacyNotifyPolicy,
  notify,
  notifyLegacy,
  sonnerDismiss,
  sonnerPromise,
  type NotifyOptions,
  type ToastInput,
  type ToastMethod,
} from "@/lib/notify/notify";

export type { NotifyOptions as ToastOptions } from "@/lib/notify/notify";

type ToastOpts = NotifyOptions | undefined;

/**
 * Every toast goes through the notification policy (lib/notify/policy.ts):
 * its kind decides how long it stays, whether it has a close button, plays
 * a sound or vibrates, and whether it waits for a calmer moment (typing on a
 * phone, an open dialog, a live ceremony, Focus, quiet hours). Repeats within
 * 10 s update one toast as "(×N)".
 *
 * The kind comes from the helper (`toast.success` → success, `toast.error` →
 * error, `toast`/`.info`/`.message` → info, `.loading` → progress) unless the
 * caller passes `kind` in the options: `"undo"`, `"echo"`, `"system"`, …
 *
 * Feedback only: a toast plays its sound and haptic but never reaches the
 * gamification engine, so no toast can earn XP or move a badge. Sound and
 * haptics failures never escape these helpers.
 *
 * `NEXT_PUBLIC_NOTIFY_POLICY=legacy` restores the old behaviour.
 */
function route(method: ToastMethod, message: ToastInput, opts?: ToastOpts): string | number {
  return isLegacyNotifyPolicy()
    ? notifyLegacy(method, message, opts)
    : notify(method, message, opts);
}

/**
 * Drop-in replacement for `import { toast } from "sonner"`.
 * Preserves sonner's fluent API: `.success`, `.error`, `.info`, `.warning`,
 * `.message`, `.loading`, `.dismiss`, `.promise`.
 */
export const toast: {
  (message: ToastInput, opts?: ToastOpts): string | number;
  success: (message: ToastInput, opts?: ToastOpts) => string | number;
  error: (message: ToastInput, opts?: ToastOpts) => string | number;
  info: (message: ToastInput, opts?: ToastOpts) => string | number;
  warning: (message: ToastInput, opts?: ToastOpts) => string | number;
  message: (message: ToastInput, opts?: ToastOpts) => string | number;
  dismiss: (id?: string | number) => void;
  promise: typeof sonnerPromise;
  loading: (message: ToastInput, opts?: ToastOpts) => string | number;
} = Object.assign(
  function toast(message: ToastInput, opts?: ToastOpts) {
    return route("plain", message, opts);
  },
  {
    success: (m: ToastInput, o?: ToastOpts) => route("success", m, o),
    error: (m: ToastInput, o?: ToastOpts) => route("error", m, o),
    info: (m: ToastInput, o?: ToastOpts) => route("info", m, o),
    warning: (m: ToastInput, o?: ToastOpts) => route("warning", m, o),
    message: (m: ToastInput, o?: ToastOpts) => route("message", m, o),
    loading: (m: ToastInput, o?: ToastOpts) => route("loading", m, o),
    dismiss: (id?: string | number) => {
      if (isLegacyNotifyPolicy()) sonnerDismiss(id);
      else dismissNotification(id);
    },
    // A promise toast is progress: shown at once, settled by sonner, silent.
    promise: sonnerPromise,
  }
);
