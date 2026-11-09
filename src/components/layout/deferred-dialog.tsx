"use client";

import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/utils/toast";
import { ErrorBoundary } from "./error-boundary";

type Loader<P> = () => Promise<ComponentType<P>>;

function lazyFrom<P extends object>(load: Loader<P>): ComponentType<P> {
  const Lazy = lazy(() => load().then((Component) => ({ default: Component })));
  // It takes the loaded component's props; TypeScript can't follow a generic P
  // through React's ref-aware lazy props type.
  return Lazy as unknown as ComponentType<P>;
}

interface DeferredDialogProps<P extends object> {
  /** Imports the dialog. A failed import is tried again on the next open. */
  load: Loader<P>;
  /** Whether it's open. It mounts, and so loads its code, the first time it is. */
  open: boolean;
  /**
   * Mount it closed ahead of time, so its first open is a plain prop change
   * with nothing left to load. A warm-up that fails stays quiet.
   */
  warm?: boolean;
  /** What it is, mid-sentence: "search", "AI settings". */
  label: string;
  /** Closes it: its code couldn't load. */
  onClose: () => void;
  /** The dialog's own props. */
  props: P;
}

/**
 * A dialog whose code loads only when it's needed. Once mounted it stays
 * mounted, so it can animate shut and reopens at once.
 *
 * The import can fail: offline before the service worker has cached the
 * chunk, or in a tab left open across a deploy. That failure stops here, as
 * a toast that closes the dialog, instead of reaching the app shell's error
 * boundary and replacing the page the visitor was working in. While an
 * opened dialog's code is on its way (a phone on a slow line), a small note
 * says it's opening, so a tap never seems to do nothing.
 */
export function DeferredDialog<P extends object>({
  load,
  open,
  warm = false,
  label,
  onClose,
  props,
}: DeferredDialogProps<P>) {
  const [Dialog, setDialog] = useState(() => lazyFrom(load));
  const [mounted, setMounted] = useState(false);
  const [warmFailed, setWarmFailed] = useState(false);
  // After a failed open, nothing tries again until it has been closed.
  const [blocked, setBlocked] = useState(false);
  const wanted = !blocked && (open || (warm && !warmFailed));
  // Adjusting state while rendering, as React documents for state derived
  // from props: this render already mounts it, and the latch keeps it.
  if (blocked && !open) setBlocked(false);
  if (wanted && !mounted) setMounted(true);

  const failed = () => {
    // React.lazy keeps a rejection for good: the next mount gets a fresh one,
    // so opening it again tries the import again.
    setDialog(() => lazyFrom(load));
    setMounted(false);
    setWarmFailed(true);
    if (open) {
      setBlocked(true);
      onClose();
      toast.error(`Couldn't open ${label}. Check your connection, or reload the page.`);
    }
  };

  if (!mounted && !wanted) return null;
  return (
    <ErrorBoundary name={`Deferred ${label}`} fallback={() => <LoadFailed onFailed={failed} />}>
      <Suspense fallback={open ? <Opening label={label} /> : null}>
        <Dialog {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Reports the failure once it has rendered: closing it sets the parent's state. */
function LoadFailed({ onFailed }: { onFailed: () => void }) {
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onFailed();
  }, [onFailed]);
  return null;
}

function Opening({ label }: { label: string }) {
  return (
    <p
      role="status"
      className="panel fixed left-1/2 top-[20%] z-modal flex -translate-x-1/2 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm text-text"
    >
      <Loader2
        className="h-4 w-4 shrink-0 text-accent motion-safe:animate-spin"
        aria-hidden="true"
      />
      Opening {label}…
    </p>
  );
}
