"use client";

import { toast as sonnerToast, type ExternalToast } from "sonner";
import { emitUiEvent } from "@/lib/sonification/emit";

type ToastInput = Parameters<typeof sonnerToast>[0];
type ToastOpts = ExternalToast | undefined;

function run(method: "success" | "error" | "info" | "warning" | "message", message: ToastInput, opts?: ToastOpts) {
  try {
    emitUiEvent(`toast-${method === "message" ? "info" : method}`);
  } catch {
    /* never let audio errors block a toast */
  }
  return (sonnerToast as unknown as Record<string, (m: ToastInput, o?: ToastOpts) => string | number>)[method](
    message,
    opts
  );
}

/**
 * Drop-in replacement for `import { toast } from "sonner"` that also sonifies.
 * Preserves sonner's fluent API: `.success`, `.error`, `.info`, `.warning`, `.message`.
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
    try {
      emitUiEvent("toast-info");
    } catch {
      /* swallow */
    }
    return sonnerToast(message, opts);
  },
  {
    success: (m: ToastInput, o?: ToastOpts) => run("success", m, o),
    error: (m: ToastInput, o?: ToastOpts) => run("error", m, o),
    info: (m: ToastInput, o?: ToastOpts) => run("info", m, o),
    warning: (m: ToastInput, o?: ToastOpts) => run("warning", m, o),
    message: (m: ToastInput, o?: ToastOpts) => run("message", m, o),
    dismiss: sonnerToast.dismiss.bind(sonnerToast),
    promise: sonnerToast.promise.bind(sonnerToast),
    loading: sonnerToast.loading.bind(sonnerToast),
  }
);
