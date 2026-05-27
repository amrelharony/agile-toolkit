"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // R10: neutral popover background instead of `bg-primary`.
        // Accent-coloured tooltips were BRIGHT BLUE in light + YELLOW
        // in HC — every tooltip became a coloured flag. `bg-popover`
        // matches the standard shadcn surface system. Also z-bumped
        // 50 → 1001 so tooltips inside an open bottom-sheet (z-81)
        // aren't clipped behind it.
        //
        // Mobile width guard: viewport-aware max-width so a long tooltip
        // (the keyboard-shortcut hints in the header, BYOK status copy)
        // never escapes a 320-px screen edge — Radix positions correctly
        // but doesn't constrain width on its own.
        "z-[1001] overflow-hidden rounded-md bg-popover text-popover-foreground border border-border shadow-md px-3 py-1.5 text-xs max-w-[min(20rem,calc(100vw-1rem))] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
