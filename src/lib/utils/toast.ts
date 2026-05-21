"use client";

import { toast as sonnerToast, type ExternalToast } from "sonner";
import { emitUiEvent } from "@/lib/sonification/emit";

type ToastInput = Parameters<typeof sonnerToast>[0];
type ToastOpts = ExternalToast | undefined;

/**
 * Sonify safely — never let an audio/haptics rejection bubble out of the
 * toast helpers. `emitUiEvent` does dynamic imports (audio engine, haptics)
 * which can reject async; the original try/catch only caught sync throws,
 * letting promise rejections escape unhandled. Wrap in
 * `Promise.resolve(...).catch(...)` for true safety.
 */
function safeEmit(name: string) {
  try {
    // emitUiEvent has return type `void` in its current signature, but a
    // future change to make it dynamic-import-aware could return a Promise.
    // Cast through unknown so we can still defensively `.catch` if a Promise
    // does show up — no TS error from "void truthiness" today, and we get
    // forward-compat for free.
    const result = emitUiEvent(name) as unknown;
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).catch(() => {
        /* swallow async emit failures */
      });
    }
  } catch {
    /* swallow sync emit failures */
  }
}

/**
 * Drop-in replacement for `import { toast } from "sonner"` that also sonifies.
 * Preserves sonner's fluent API: `.success`, `.error`, `.info`, `.warning`, `.message`.
 *
 * Methods call sonner directly (no Record-cast indirection) so TS catches
 * any future sonner rename or signature change at build time.
 */
export const toast: {
  (message: ToastInput, opts?: ToastOpts): string | number;
  success: (message: ToastInput, opts?: ToastOpts) => string | number;
  error: (message: ToastInput, opts?: ToastOpts) => string | number;
  info: (message: ToastInput, opts?: ToastOpts) => string | number;
  warning: (message: ToastInput, opts?: ToastOpts) => string | number;
  message: (message: ToastInput, opts?: ToastOpts) => string | number;
  dismiss: (id?: string | number) => void;
  promise: typeof sonnerToast.promise;
  loading: typeof sonnerToast.loading;
} = Object.assign(
  function toast(message: ToastInput, opts?: ToastOpts) {
    safeEmit("toast-info");
    return sonnerToast(message, opts);
  },
  {
    success: (m: ToastInput, o?: ToastOpts) => {
      safeEmit("toast-success");
      return sonnerToast.success(m, o);
    },
    error: (m: ToastInput, o?: ToastOpts) => {
      safeEmit("toast-error");
      return sonnerToast.error(m, o);
    },
    info: (m: ToastInput, o?: ToastOpts) => {
      safeEmit("toast-info");
      return sonnerToast.info(m, o);
    },
    warning: (m: ToastInput, o?: ToastOpts) => {
      safeEmit("toast-warning");
      return sonnerToast.warning(m, o);
    },
    message: (m: ToastInput, o?: ToastOpts) => {
      safeEmit("toast-info");
      return sonnerToast.message(m, o);
    },
    dismiss: sonnerToast.dismiss.bind(sonnerToast),
    promise: sonnerToast.promise.bind(sonnerToast),
    loading: ((m: Parameters<typeof sonnerToast.loading>[0], o?: Parameters<typeof sonnerToast.loading>[1]) => {
      safeEmit("toast-info");
      return sonnerToast.loading(m, o);
    }) as typeof sonnerToast.loading,
  }
);
