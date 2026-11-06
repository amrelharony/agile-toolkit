import { cn } from "@/lib/utils";
import { printTheme, type PrintThemeName } from "@/lib/comics/print-themes";

/**
 * An episode's habit, in the colour its poster and kudos card are printed in.
 * Like a kudos card, the colours are the print's in every page theme, always a
 * fill under their own ink (lib/comics/print-themes).
 */
export function PrintThemeChip({
  theme,
  className,
}: {
  theme: PrintThemeName;
  className?: string;
}) {
  const { name, colour, ink } = printTheme(theme);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        className
      )}
      style={{ backgroundColor: colour, color: ink }}
    >
      {name}
    </span>
  );
}
