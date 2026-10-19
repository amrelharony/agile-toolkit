import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active-press [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        // shadcn's stock `hover:bg-accent` assumes "accent" is a subtle grey;
        // here it is the brand cyan, so the label sat at ~1.4:1 (and vanished
        // entirely where a call site added `hover:text-accent`). Tint instead.
        outline:
          "border border-input bg-background shadow-sm hover:border-accent/40 hover:bg-accent/10 hover:text-accent",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent/10 hover:text-text",
        link: "text-primary underline-offset-4 hover:underline",
        // Toolkit-specific: cyan-tinted "primary action" button used for
        // Add / Save / Apply throughout the tools (e.g. Add Sprint,
        // Save to History). Replaces the inline
        // `bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40`
        // pattern.
        toolkit:
          "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40 disabled:opacity-40",
        // Toolkit-specific: muted "icon-only delete" button used in dense
        // rows (impediments, refinement criteria, sprint-review features).
        // Replaces the inline `text-sub hover:text-danger hover:bg-danger/10`
        // pattern.
        "danger-ghost": "text-sub hover:text-danger hover:bg-danger/10",
      },
      size: {
        // Mobile-first: meet 44px touch target; shrink to 36px on md+ for density
        default: "min-h-[44px] md:min-h-9 md:h-9 px-4 py-2",
        sm: "min-h-[36px] md:h-8 rounded-md px-3 text-xs",
        lg: "min-h-[48px] md:h-10 rounded-md px-8",
        icon: "min-h-[44px] min-w-[44px] md:h-9 md:w-9 md:min-h-0 md:min-w-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

// Default haptic patterns per variant — consumed by the haptics event-router
// via the data-haptic attribute set in the component.
const VARIANT_HAPTIC: Record<string, string | undefined> = {
  default: "tick",
  destructive: "impact-heavy",
  outline: "tick",
  secondary: "tick",
  ghost: "tick",
  link: undefined,
  toolkit: "tick",
  "danger-ghost": "tick",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Override the default haptic pattern for this button (e.g., "success", "error"). */
  haptic?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, haptic, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const resolvedHaptic = haptic ?? VARIANT_HAPTIC[variant ?? "default"];
    // `data-variant` drives sonification palette; `data-haptic` drives the
    // haptics event-router (same global delegated listener).
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        data-variant={variant ?? "default"}
        data-haptic={resolvedHaptic}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
