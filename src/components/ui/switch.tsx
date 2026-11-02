"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // 20 × 36 track on desktop; 24 × 44 on touch — matches iOS default
      // and clears WCAG 2.2's 44-px touch floor without bloating the
      // desktop visual. Thumb adjusts in tandem (h-4 → h-5).
      "peer relative inline-flex h-5 w-9 [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      // Invisible expand-hitbox so taps adjacent to the switch still register.
      "after:absolute after:inset-[-6px] after:content-['']",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5",
        "rounded-full bg-background ring-0 transition-transform",
        // Slide distance scales with the larger track on coarse pointers.
        "data-[state=checked]:translate-x-4 [@media(pointer:coarse)]:data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
