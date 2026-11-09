import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/**
 * A theme colour backed by a CSS custom property that still honours
 * Tailwind's opacity modifiers.
 *
 * Tailwind 3 can't parse `var(--x)`, so with a bare string every modified
 * class (`bg-accent/10`, `text-sub/60`, `ring-accent/40`, …) silently
 * emitted no CSS: tinted buttons had no fill, danger callouts had no band,
 * hover states never changed. As a function, the colour keeps emitting a
 * plain `var(--x)` when there is no modifier (so every unmodified class
 * renders exactly as before) and mixes in transparency when there is one.
 * `color-mix` also works for tokens that are already translucent (--border,
 * --glow), and it follows the active theme because it reads the variable at
 * paint time.
 */
function themeColor(cssVar: string): string {
  const resolve = ({ opacityValue }: { opacityValue?: string | number }) => {
    if (opacityValue === undefined) return `var(${cssVar})`;
    const raw = String(opacityValue);
    // No modifier: Tailwind passes `var(--tw-bg-opacity, 1)`.
    if (raw.startsWith("var(")) return `var(${cssVar})`;
    const n = Number(raw);
    const amount = Number.isFinite(n)
      ? `${Math.round(Math.min(Math.max(n, 0), 1) * 1000) / 10}%`
      : `calc(${raw} * 100%)`;
    return `color-mix(in srgb, var(${cssVar}) ${amount}, transparent)`;
  };
  // Tailwind accepts colour functions at runtime; its config types only
  // model strings.
  return resolve as unknown as string;
}

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // `src/lib` is NOT just logic — it holds three components mounted app-wide
    // (WeatherWidget, KudosHeaderBeacon from header.tsx; HolidayEngine from
    // app-shell.tsx). Without this glob, JIT never emitted the utilities they
    // use exclusively (`min-w-[16px]`, `leading-[16px]`, `max-h-80`, `w-80`,
    // `top-24`/`bottom-40`/`md:bottom-36`, `bg-card/80`, `bg-card/70`, …), so
    // the kudos unread badge rendered unpositioned, the kudos popover had no
    // width or scroll cap, and every holiday overlay ignored its fixed offsets
    // and landed in flow position on top of the header.
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // ── Breakpoint system ──
    // Default Tailwind breakpoints + two additions:
    //   xs   → 375px  iPhone SE / small Android — gives us a safety net
    //                 between 320px (default base) and 640px (sm).
    //   3xl  → 1920px FullHD-and-above for larger info-density layouts.
    // All min-width (mobile-first), evaluated bottom-up.
    screens: {
      xs: "375px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
      "3xl": "1920px",
    },
    container: {
      center: true,
      // Padding scales mobile-first: 12 → 16 → 24 → 32 → 40px.
      padding: {
        DEFAULT: "0.75rem", // 12px (mobile)
        xs: "1rem", // 16px
        sm: "1.5rem", // 24px
        lg: "2rem", // 32px
        xl: "2.5rem", // 40px
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1440px", // cap the container before the 1536/1920 breakpoints
      },
    },
    extend: {
      colors: {
        // ── Design system core palette (CSS custom properties) ──
        bg: {
          DEFAULT: themeColor("--bg"),
          primary: themeColor("--bg"),
          secondary: themeColor("--bg2"),
          card: themeColor("--card"),
          hover: themeColor("--cardH"),
        },
        bg2: themeColor("--bg2"),
        text: {
          DEFAULT: themeColor("--text"),
          primary: themeColor("--text"),
          secondary: themeColor("--sub"),
          muted: themeColor("--sub"),
        },
        sub: themeColor("--sub"),
        // `danger` was never a defined color, so all ~169 `text-danger`,
        // `bg-danger/5`, `border-danger/40` utilities across the app emitted
        // NOTHING: critical insights rendered flatter than the amber warnings
        // below them, `<CalloutAlert tone="danger">` lost its red band, and
        // the AI run panel's error state was chrome-identical to success.
        // `stat-card.tsx` hit this once and worked around it locally by
        // switching to `destructive`; aliasing here fixes every remaining
        // call site at once and keeps both spellings theme-aware.
        danger: {
          DEFAULT: themeColor("--danger"),
          foreground: themeColor("--destructive-foreground"),
        },
        accent: {
          DEFAULT: themeColor("--accent"),
          2: themeColor("--accent2"),
          3: themeColor("--accent3"),
        },
        card: {
          DEFAULT: themeColor("--card"),
          foreground: themeColor("--card-foreground"),
        },
        "card-hover": themeColor("--cardH"),
        surface: {
          DEFAULT: themeColor("--surface"),
          deep: themeColor("--surface-deep"),
          hover: themeColor("--surface-hover"),
        },
        // Named `glow-color` so `text-glow` stays the text-shadow utility in
        // globals.css — as a colour key it overrode text colour to 15% alpha.
        "glow-color": themeColor("--glow"),
        "glow-strong-color": themeColor("--glowS"),

        // ── Semantic colors (per theme, see globals.css) ──
        success: themeColor("--success"),
        error: themeColor("--danger"),
        warning: themeColor("--warning"),
        info: themeColor("--info"),

        // ── shadcn/ui standard keys ──
        border: themeColor("--border"),
        // The quieter line: table rows, chart grids, `divide-*`.
        rule: themeColor("--rule"),
        input: themeColor("--input"),
        ring: themeColor("--ring"),
        background: themeColor("--background"),
        foreground: themeColor("--foreground"),
        primary: {
          DEFAULT: themeColor("--primary"),
          foreground: themeColor("--primary-foreground"),
        },
        secondary: {
          DEFAULT: themeColor("--secondary"),
          foreground: themeColor("--secondary-foreground"),
        },
        destructive: {
          DEFAULT: themeColor("--destructive"),
          foreground: themeColor("--destructive-foreground"),
        },
        muted: {
          DEFAULT: themeColor("--muted"),
          foreground: themeColor("--muted-foreground"),
        },
        popover: {
          DEFAULT: themeColor("--popover"),
          foreground: themeColor("--popover-foreground"),
        },

        // ── Backward-compatible aliases (existing tool pages use these) ──
        "accent-cyan": themeColor("--accent"),
        // Neon accents and status aliases follow the theme too: the raw hex
        // values were unreadable on paper (#00ff88 is 1.3:1 on white).
        "accent-magenta": themeColor("--neon-magenta"),
        "accent-green": themeColor("--neon-green"),
        "accent-amber": themeColor("--neon-amber"),
        "status-green": themeColor("--success"),
        "status-yellow": themeColor("--warning"),
        "status-red": themeColor("--danger"),
      },
      fontFamily: {
        // Design system fonts
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
        serif: ["var(--font-serif)", "Source Serif 4", "Georgia", "serif"],
        // Hand lettering for headings, through a token so high contrast can
        // swap it for the plain face. Tables, numbers and code stay on
        // font-data / font-mono: those are never lettered by hand.
        display: ["var(--font-display-face)", "var(--font-inter)", "sans-serif"],
        // Backward-compatible aliases
        body: ["var(--font-inter)", "sans-serif"],
        data: ["var(--font-mono)", "monospace"],
      },
      fontSize: {
        // ── Static design-system scale (existing usage; do not break) ──
        display: ["72px", { lineHeight: "1", letterSpacing: "-0.5px" }],
        h1: ["56px", { lineHeight: "1.1" }],
        h2: ["40px", { lineHeight: "1.1" }],
        h3: ["32px", { lineHeight: "1.2" }],
        h4: ["28px", { lineHeight: "1.2", letterSpacing: "-0.5px" }],
        h5: ["20px", { lineHeight: "1.4" }],
        body: ["14px", { lineHeight: "1.6" }],
        caption: ["12px", { lineHeight: "1.4" }],
        // No sizes below 12px: label (11), tiny (10), micro (9) and nano (8)
        // were removed with the type-scale reset — use text-xs.

        // ── Fluid scale (mobile-first, no-media-query) ──
        // Uses clamp(min, viewport-relative, max). Use these for any text
        // that should scale smoothly between 320px and ~1440px viewports.
        // The "ideal" middle term is sized so the text reaches its max
        // around the 1024px breakpoint and stays static beyond.
        "fluid-display": [
          "clamp(2.5rem, 1.6rem + 4.5vw, 4.5rem)",
          { lineHeight: "1.05", letterSpacing: "-0.5px" },
        ],
        "fluid-h1": ["clamp(1.75rem, 1.25rem + 2.5vw, 3rem)", { lineHeight: "1.15" }],
        "fluid-h2": ["clamp(1.5rem, 1.15rem + 1.75vw, 2.25rem)", { lineHeight: "1.2" }],
        "fluid-h3": ["clamp(1.25rem, 1rem + 1.25vw, 1.75rem)", { lineHeight: "1.25" }],
        "fluid-h4": ["clamp(1.125rem, 0.95rem + 0.85vw, 1.5rem)", { lineHeight: "1.3" }],
        "fluid-body": ["clamp(0.875rem, 0.83rem + 0.2vw, 1rem)", { lineHeight: "1.55" }],
      },
      spacing: {
        // ── WCAG 2.2 minimum touch target ──
        // Use as `min-w-touch min-h-touch` (or `size-touch`) on any
        // tap-target. 44px = 11 in Tailwind's 4px scale.
        touch: "2.75rem", // 44px
        "touch-sm": "2.25rem", // 36px — for desktop-only secondary controls
        // Common content widths
        "screen-90": "90vw",
        "screen-80": "80vw",
      },
      maxWidth: {
        // Reading-width helpers, in addition to Tailwind defaults.
        prose: "65ch",
        "tool-content": "80rem", // 1280px
        "tool-narrow": "48rem", // 768px
      },
      // The plain `border` width, as a token: a colour token can't set it, and
      // ~5,000 call sites use the bare class. `border-2` and friends are as ever.
      // divideWidth inherits this.
      borderWidth: {
        DEFAULT: "var(--line-w)",
      },
      divideColor: {
        // `divide-border` draws rows inside a list, so it takes the quieter line.
        border: themeColor("--rule"),
      },
      // Small and slightly uneven, like a pen box. `rounded-full` stays round for
      // avatars and dots; nothing else is pill-shaped.
      borderRadius: {
        xs: "2px",
        sm: "3px",
        md: "4px",
        DEFAULT: "var(--radius)",
        lg: "6px",
        xl: "8px",
        "2xl": "10px",
        "3xl": "12px",
        pill: "12px",
      },
      // Hard offsets from globals.css (--shadow-1…6), so high contrast can turn
      // them all off. The old glow and neon keys stay, and follow the look.
      boxShadow: {
        DEFAULT: "var(--shadow-2)",
        sm: "var(--shadow-1)",
        md: "var(--shadow-2)",
        lg: "var(--shadow-3)",
        xl: "var(--shadow-4)",
        "2xl": "var(--shadow-6)",
        glow: "var(--shadow-3)",
        "glow-strong": "var(--shadow-4)",
        "glow-active": "var(--shadow-2)",
        inset: "inset 0 0 0 0 transparent",
        card: "var(--shadow-3)",
        modal: "var(--shadow-6)",
        // Backward-compatible neon aliases, in the colour the name promised.
        "neon-cyan": "2px 2px 0 0 var(--accent)",
        "neon-magenta": "2px 2px 0 0 var(--neon-magenta)",
        "neon-green": "2px 2px 0 0 var(--neon-green)",
        "neon-amber": "2px 2px 0 0 var(--neon-amber)",
      },
      // Flat washes under the old names: paint doesn't blend in a straight line.
      backgroundImage: {
        "gradient-accent": "linear-gradient(var(--accent), var(--accent))",
        "gradient-spectrum": "linear-gradient(var(--accent), var(--accent))",
        "gradient-diagonal": "linear-gradient(var(--accent), var(--accent))",
        "gradient-shimmer":
          "linear-gradient(105deg, transparent 40%, var(--glow) 50%, transparent 60%)",
      },
      keyframes: {
        // Design system animations
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Translate-only entrance: content is visible from the first frame
        // (no opacity ramp), so it also reads fine before JS hydrates. It
        // ends at `none` and fills `backwards` only (see `animation.rise`).
        rise: {
          from: { transform: "translateY(8px)" },
          to: { transform: "none" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        // An ink shadow pressed down and let go, no glow.
        "glow-pulse": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 transparent",
          },
          "50%": {
            boxShadow: "2px 2px 0 0 var(--accent)",
          },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        // Radix UI keyframes
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "collapsible-down": {
          from: { height: "0" },
          to: { height: "var(--radix-collapsible-content-height)" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out forwards",
        "slide-up": "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        // `backwards`, not `both`: a transform left on the element after the
        // entrance, even translateY(0), makes it the containing block for
        // every position:fixed descendant, so a tool page's drag overlays and
        // fixed popups drew a scroll's height off-screen. There's no delay,
        // so the first frame is the same as before.
        rise: "rise 0.35s cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "scale-in": "scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        shimmer: "shimmer 0.8s ease forwards",
        skeleton: "skeleton-shimmer 1.5s ease-in-out infinite",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.2s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
        elastic: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      },
      transitionDuration: {
        fast: "200ms",
        default: "300ms",
        medium: "400ms",
        slow: "550ms",
      },
      zIndex: {
        behind: "-1",
        base: "0",
        content: "1",
        card: "2",
        component: "10",
        nav: "50",
        header: "100",
        // Toasts: above the header (100) and the sidebar drawer, below modals.
        // globals.css lifts them (to 10000) over an open dialog so errors stay
        // visible.
        toast: "990",
        modal: "1000",
        overlay: "9999",
      },
    },
  },
  // No glass: `backdrop-blur-*` emits nothing, so a translucent bar just shows the
  // paper behind it and the page pays for no blur layers.
  corePlugins: {
    backdropBlur: false,
  },
  // Tailwind resolves plugins synchronously at config load, so `require` is
  // the idiomatic form here and ESM `import` is not equivalent. These two
  // lines predate the `no-require-imports` rule; they only surface now
  // because this file hadn't been touched in a commit since it was enabled.
  /* eslint-disable @typescript-eslint/no-require-imports */
  plugins: [
    require("tailwindcss-animate"),
    // Container-query support: enables `@container` on a parent element
    // and per-card breakpoint variants like `@sm:grid-cols-2`. Used in
    // /insights so each card scales based on its own width — important
    // when the sidebar collapse changes available content width without
    // crossing a viewport breakpoint.
    require("@tailwindcss/container-queries"),
    // Input-type variants. `pointer-coarse:` styles touch screens (phones,
    // tablets) and `pointer-fine:` mouse and trackpad, independent of width:
    // a landscape phone is wider than `md` but still needs 44 px targets, and
    // a narrow desktop window doesn't. Prefer these over raw
    // `[@media(pointer:coarse)]:` arbitrary variants.
    plugin(({ addVariant }) => {
      addVariant("pointer-coarse", "@media (pointer: coarse)");
      addVariant("pointer-fine", "@media (pointer: fine)");
      // Desktop density: `md-fine:` is `md:` for a mouse only, for the
      // primitives that shrink from 44 px to 36 px on md+ (Button sizes).
      // One variant, not `md:pointer-fine:`, on purpose: custom variants
      // sort before the screen variants, so a call site's own `md:h-7` or
      // `md:h-auto` still overrides the shrink, as it did when it was `md:`.
      // A stacked `md:pointer-fine:` would sort after them and win.
      addVariant("md-fine", "@media (min-width: 768px) and (pointer: fine)");
    }),
  ],
  /* eslint-enable @typescript-eslint/no-require-imports */
};
export default config;
