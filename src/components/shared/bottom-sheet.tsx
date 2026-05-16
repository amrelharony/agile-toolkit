"use client";

import { type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-media-query";

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Override the mobile check (e.g., force centered on desktop even on mobile). */
  forceDesktop?: boolean;
  className?: string;
}

/**
 * Responsive modal: bottom-sheet on mobile (drag-to-dismiss), centered dialog
 * on tablet+.  Wraps Radix Dialog for accessibility primitives (focus trap,
 * escape, ARIA), adds a gesture layer on small screens.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  forceDesktop = false,
  className,
}: BottomSheetProps) {
  const isMobile = useIsMobile();
  const asSheet = isMobile && !forceDesktop;

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 500) onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </Dialog.Overlay>
            {/* Radix auto-wires aria-describedby from <Dialog.Description>
                when it's a child; manually setting it to undefined here was a
                no-op leftover. When the caller provides no description we set
                aria-describedby explicitly to undefined to suppress Radix's
                runtime warning about missing descriptions. */}
            <Dialog.Content
              asChild
              {...(description ? {} : { "aria-describedby": undefined })}
            >
              {asSheet ? (
                <motion.div
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.4 }}
                  onDragEnd={handleDragEnd}
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 32, stiffness: 320 }}
                  className={cn(
                    "fixed bottom-0 left-0 right-0 z-[81] max-h-[85dvh] overflow-y-auto",
                    "rounded-t-2xl border-t border-border bg-card backdrop-blur-xl pb-safe",
                    className,
                  )}
                >
                  {/* Drag handle */}
                  <div className="sticky top-0 z-10 flex justify-center bg-card pt-2 pb-1">
                    <div className="h-1 w-10 rounded-full bg-border" />
                  </div>
                  <div className="px-4 pb-4">
                    {title ? (
                      <Dialog.Title className="text-base font-semibold text-text">
                        {title}
                      </Dialog.Title>
                    ) : null}
                    {description ? (
                      <Dialog.Description className="mt-1 text-xs text-sub">
                        {description}
                      </Dialog.Description>
                    ) : null}
                    <div className="mt-3">{children}</div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  className={cn(
                    "fixed left-1/2 top-1/2 z-[81] w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2",
                    "rounded-xl border border-border bg-card p-5 shadow-2xl",
                    className,
                  )}
                >
                  {title ? (
                    <Dialog.Title className="text-base font-semibold text-text">
                      {title}
                    </Dialog.Title>
                  ) : null}
                  {description ? (
                    <Dialog.Description className="mt-1 text-xs text-sub">
                      {description}
                    </Dialog.Description>
                  ) : null}
                  <Dialog.Close asChild>
                    <button
                      aria-label="Close"
                      className="absolute right-3 top-3 rounded-md p-1 text-sub transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                  <div className="mt-3">{children}</div>
                </motion.div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
