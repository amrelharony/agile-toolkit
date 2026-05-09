# Design DNA Specification — amrelharony.com Ecosystem

> Extracted from the main portfolio site. This document codifies the visual identity, interaction patterns, and atmosphere that make visitors feel they're in the same ecosystem across all apps.

---

## 1. Design Philosophy

**Style:** Glassmorphic Dark
**Mood:** Premium, immersive, interactive — like a high-end SaaS dashboard meets a creative portfolio
**Accent Triad:** Cyan (#00e1ff) + Indigo (#6366f1) + Purple (#a855f7)

The site creates depth through layered transparency:
1. Deep dark background (#06080f) as the void
2. Slowly drifting mesh gradient blobs as ambient light
3. SVG noise texture for organic grain
4. Glassmorphic cards floating above with backdrop-blur
5. Cyan glow accents as focal points

Every interactive element rewards engagement with satisfying micro-interactions — shimmer effects, lift animations, glow transitions.

---

## 2. Color System

### 2.1 Dark Mode (Default)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#06080f` | Page background |
| `--bg2` | `#0c1018` | Secondary/elevated background |
| `--text` | `#f0f2f5` | Primary text |
| `--sub` | `#8a95a8` | Secondary/muted text |
| `--accent` | `#00e1ff` | Primary accent (cyan) — CTAs, active states, links |
| `--accent2` | `#6366f1` | Secondary accent (indigo) — gradient endpoints, charts |
| `--accent3` | `#a855f7` | Tertiary accent (purple) — decorative, gradient endpoints |
| `--card` | `rgba(12, 16, 24, 0.65)` | Card/panel background |
| `--cardH` | `rgba(255, 255, 255, 0.07)` | Card hover background |
| `--border` | `rgba(255, 255, 255, 0.08)` | Borders, dividers |
| `--glow` | `rgba(0, 225, 255, 0.15)` | Glow effects (standard) |
| `--glowS` | `rgba(0, 225, 255, 0.4)` | Glow effects (strong/hover) |

### 2.2 Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#f4f6fb` | Page background |
| `--bg2` | `#ffffff` | Card/elevated background |
| `--text` | `#0a0f1a` | Primary text |
| `--sub` | `#5a6578` | Secondary text |
| `--accent` | `#0066ff` | Primary accent (blue) |
| `--accent2` | `#4f46e5` | Secondary accent (indigo) |
| `--accent3` | `#9333ea` | Tertiary accent (purple) |
| `--card` | `rgba(255, 255, 255, 0.7)` | Card background |
| `--border` | `rgba(0, 0, 0, 0.06)` | Borders |
| `--glow` | `rgba(0, 102, 255, 0.08)` | Glow effects |
| `--glowS` | `rgba(0, 102, 255, 0.2)` | Strong glow |

### 2.3 Sepia Reading Mode (Book App)

| Token | Value |
|-------|-------|
| `--bg` | `#f5f0e8` |
| `--bg2` | `#ebe5d9` |
| `--text` | `#3d3929` |
| `--sub` | `#7a7260` |
| `--accent` | `#8b6914` |
| `--border` | `rgba(0, 0, 0, 0.08)` |

### 2.4 Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| success | `#22c55e` | Positive states, online indicators |
| error | `#ef4444` | Errors, destructive actions |
| warning | `#fbbf24` | Warnings, achievements |
| info | `#3b82f6` | Informational elements |

### 2.5 Gradients

| Name | Value | Usage |
|------|-------|-------|
| Accent | `linear-gradient(90deg, #00e1ff, #6366f1)` | Progress bars, underlines, CTAs |
| Spectrum | `linear-gradient(90deg, #00e1ff, #6366f1, #a855f7)` | Hero text, special headings |
| Diagonal | `linear-gradient(135deg, #00e1ff, #6366f1)` | Badges, decorative elements |
| Shimmer | `linear-gradient(105deg, transparent 40%, var(--glow) 50%, transparent 60%)` | Card hover sweep |

---

## 3. Typography System

### 3.1 Font Stack

| Font | Weights | Role |
|------|---------|------|
| Inter | 300, 400, 600, 800 | Primary sans-serif — body, UI, headings |
| JetBrains Mono | 400, 700 | Monospace — code, labels, timestamps, tags |
| Source Serif 4 | 400, 600, 700, 400i | Serif — long-form article/book content |
| Noto Sans Arabic | 400, 600, 800 | Arabic text support |

**Google Fonts Import:**
```
https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&display=swap
```

### 3.2 Type Scale

| Level | Size | Weight | Font | Letter-Spacing | Usage |
|-------|------|--------|------|----------------|-------|
| Display | 72px | 800 | Inter | -0.5px | Hero heading |
| H1 | 56px | 800 | Inter | — | Large section heads |
| H2 | 40px | 700 | Inter | — | Section heads |
| H3 | 32px | 700 | Inter | — | Subsection heads |
| H4 | 28px | 700 | Inter | -0.5px | Article titles |
| H5 | 20px | 600 | Inter | — | Subheadings |
| Body | 14-16px | 400 | Inter | — | Default content |
| Label | 8-11px | 700 | JetBrains Mono | 1.5-2px | Tags, labels (UPPERCASE) |
| Caption | 12px | 400 | Inter | — | Secondary info |
| Code | 13px | 400 | JetBrains Mono | — | Code blocks, tech content |

### 3.3 Text Effects

**Gradient Text:**
```css
.gradient-text {
  background: linear-gradient(135deg, var(--accent), var(--accent2), var(--accent3));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

**Animated Gradient Text:**
```css
.gradient-text-animated {
  background: linear-gradient(135deg, var(--accent), var(--accent2), var(--accent3));
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: gradient-shift 6s ease-in-out infinite;
}
```

**Text Glow:**
```css
.text-glow { text-shadow: 0 0 8px rgba(0, 225, 255, 0.3); }
.text-glow-strong { text-shadow: 0 0 24px rgba(0, 225, 255, 0.35); }
```

---

## 4. Glassmorphism System

The signature visual treatment. Every card, panel, and overlay uses this stack:

### 4.1 Standard Card

```css
.glass-card {
  background: var(--card);                          /* rgba(12, 16, 24, 0.65) */
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border: 1px solid var(--border);                  /* rgba(255, 255, 255, 0.08) */
  border-radius: 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
```

### 4.2 Card Hover State

```css
.glass-card:hover {
  background: var(--cardH);                         /* rgba(255, 255, 255, 0.07) */
  border-color: rgba(0, 225, 255, 0.15);
  transform: translateY(-3px);
  box-shadow: 0 8px 32px rgba(0, 225, 255, 0.1),
              inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
```

### 4.3 Elevated Panel (Modals, Overlays)

```css
.glass-elevated {
  background: rgba(8, 12, 30, 0.78);
  backdrop-filter: blur(40px) saturate(1.6);
  -webkit-backdrop-filter: blur(40px) saturate(1.6);
  border: 1px solid rgba(0, 225, 255, 0.1);
  border-radius: 20px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.45),
              inset 0 1px 0 rgba(255, 255, 255, 0.03),
              0 0 80px rgba(0, 225, 255, 0.04);
}
```

### 4.4 Backdrop Overlay (behind modals)

```css
.glass-backdrop {
  background: rgba(6, 8, 15, 0.6);
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
}
```

---

## 5. Animation System

### 5.1 Primary Easing Functions

| Name | Value | Usage |
|------|-------|-------|
| Spring | `cubic-bezier(0.16, 1, 0.3, 1)` | Primary interactive easing — hovers, entrances, toggles |
| Elastic | `cubic-bezier(0.175, 0.885, 0.32, 1.275)` | Flip cards, pop-ins, playful elements |
| Material | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard motion |

### 5.2 Duration Scale

| Speed | Duration | Usage |
|-------|----------|-------|
| Fast | 0.2s | Icon toggles, small state changes |
| Default | 0.3s | Standard micro-interactions |
| Medium | 0.4s | Card hovers, reveals |
| Slow | 0.55s | Modal/overlay entrances |
| Elastic | 0.8s | Flip animations, special reveals |

### 5.3 Entrance Animation Sequences

**Page load stagger pattern (GSAP → Framer Motion translation):**
1. Hero elements: `opacity 0→1, y 0, duration 0.9, delay 0.8 + i*0.08` (power3.out)
2. Role tags: `scale 0.7→1, opacity 0→1, y 10→0, duration 0.5, delay 1.1 + i*0.1` (back.out(2))
3. Link cards: `opacity 0→1, y 50→0, scale 0.92→1, blur 6px→0, duration 0.8, delay 1.4 + i*0.12` (power3.out)
4. Nav items: `opacity 0→1, x -20→0, duration 0.6, delay 2 + i*0.1` (power2.out)

### 5.4 Card Hover Shimmer

The signature card interaction:
1. Shimmer overlay positioned absolute, inset 0
2. Default: `translateX(-100%)` (hidden left)
3. On hover: `animation: shimmer 0.8s ease forwards` (sweeps right)
4. Gradient: `linear-gradient(105deg, transparent 40%, var(--glow) 50%, transparent 60%)`

### 5.5 3D Card Tilt

Profile card uses perspective-based tilt on mousemove:
```
perspective(800px) rotateX(Xdeg) rotateY(Ydeg) scale3d(1.01, 1.01, 1.01)
```
- Lerp factor: 0.12 (smooth follow)
- Reset on mouseleave with spring easing

---

## 6. Component Patterns

### 6.1 Navigation (Top Buttons)

```
Position: fixed, top 16px, right 16px, z-index 100
Size: 32x32px per button
Style: glassmorphic card, border-radius 20px
Hover: background rgba(0, 225, 255, 0.08), color → accent
Transition: 0.2s ease
Mobile: collapses behind toggle button
```

### 6.2 Link Cards (Primary CTA Pattern)

```html
<a class="glass-card flex items-center p-3.5 px-4 rounded-2xl gap-3.5 group">
  <div class="icon-box w-11 h-11 rounded-xl glass flex-shrink-0 flex items-center justify-center">
    <img src="..." class="w-5 h-5" />
  </div>
  <div class="flex-1 min-w-0">
    <div class="text-sm font-semibold text-[var(--text)]">Title</div>
    <div class="text-xs text-[var(--sub)]">Subtitle</div>
  </div>
  <div class="text-[var(--sub)] opacity-40 group-hover:opacity-100 group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-default">
    →
  </div>
  <!-- Shimmer overlay (absolute, hidden until hover) -->
</a>
```

### 6.3 Role Tags

```
Font: JetBrains Mono, 9px, uppercase, letter-spacing 1.5px
Padding: 4px 10px
Border-radius: 4px
Background: var(--card), backdrop-filter: blur(10px)
Border: 1px solid var(--border)
Hover: border-color → accent, color → accent
Transition: 0.3s all
```

### 6.4 Section Headers

```
Label: JetBrains Mono, 11px, uppercase, letter-spacing 2px, color accent
Title: Inter, 20px, weight 700, color text
Decoration: 2px accent underline or gradient bar below
```

### 6.5 Impact Metrics

```
Number: JetBrains Mono, 20px, weight 700, color accent, text-shadow glow
Label: JetBrains Mono, 8px, uppercase, color sub
Layout: flex row, gap 24px, center-aligned
```

### 6.6 Conference Badges (Glassmorphic)

```
Background: rgba(255, 255, 255, 0.04), backdrop-filter blur(20px) saturate(1.4)
Border: 1px solid rgba(255, 255, 255, 0.08)
Hover: rotating conic-gradient border (confSpin 8s), translateY(-3px), glow shadow
```

### 6.7 Modals

```
Entrance: scale(0.85) translateY(20px) → scale(1) translateY(0)
Duration: 0.55s cubic-bezier(0.16, 1, 0.3, 1)
Backdrop: rgba(6, 8, 15, 0.6) + backdrop-filter blur(32px)
Card: border-radius 20px, glassmorphic elevated treatment
Close: ESC key, click outside, close button
```

---

## 7. Atmosphere Recipe

### 7.1 Mesh Background Layer

Three large radial gradient blobs positioned absolutely behind all content:

```css
.mesh-blob {
  position: fixed;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.06;
  pointer-events: none;
  will-change: transform;
}

.mesh-blob-1 {
  width: 40vw; height: 40vw;
  background: radial-gradient(circle, #00e1ff 0%, transparent 70%);
  top: -10%; left: -5%;
  animation: mf1 20s ease-in-out infinite;
}

.mesh-blob-2 {
  width: 35vw; height: 35vw;
  background: radial-gradient(circle, #6366f1 0%, transparent 70%);
  top: 50%; right: -10%;
  animation: mf2 25s ease-in-out infinite;
}

.mesh-blob-3 {
  width: 30vw; height: 30vw;
  background: radial-gradient(circle, #a855f7 0%, transparent 70%);
  top: 40%; left: 50%;
  animation: mf3 18s ease-in-out infinite;
}
```

### 7.2 Noise Overlay

SVG turbulence filter creating organic grain:
```css
.noise-overlay::after {
  content: '';
  position: fixed;
  inset: 0;
  opacity: 0.03;
  pointer-events: none;
  background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  z-index: -1;
}
```

### 7.3 Per-App Atmosphere Intensity

| Layer | Main Site | Agile Toolkit | Book App |
|-------|-----------|---------------|----------|
| Mesh blobs | 3 at 0.06 | 2 at 0.04 | 1 at 0.03 |
| Mesh blur | 100px | 120px | 140px |
| Noise overlay | Yes (0.03) | Yes (0.02) | No |
| Cursor glow | Yes | No | No |
| Particles | Yes | No | No |

**Why:** Data-heavy UIs (Agile Toolkit) need visual clarity for charts and tables. Reading apps (Book App) need minimal distraction for sustained focus. The mesh blobs provide enough "family resemblance" without competing with content.

---

## 8. Responsive Strategy

### 8.1 Breakpoints

| Name | Value | Target |
|------|-------|--------|
| xs | 380px | Extra small phones |
| sm | 600px | Primary mobile breakpoint |
| md | 768px | Tablets |
| lg | 1024px | Desktop |
| xl | 1280px | Wide desktop |

### 8.2 Container

```
Max-width: 480px (main site — single column portfolio)
Max-width: 1200px (toolkit/book app — multi-column layouts)
Padding: 48px 24px 120px (generous top/bottom scroll room)
```

### 8.3 Mobile Adaptations

- Font sizes scale down proportionally (hero 72px → 40px)
- Card padding reduces (14px → 10px)
- Grid columns collapse (2→1 for skills, 3→2→1 for certs)
- Mesh blobs reduce by 1 (fewer renders on mobile)
- Cursor glow and hover effects disabled on touch devices
- Backdrop-filter blur reduced for performance

---

## 9. Accessibility

### 9.1 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 9.2 Focus Styles

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

### 9.3 ARIA Patterns

- All buttons: `aria-label`
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-label`
- Tabs: `role="tablist"`, `role="tab"`, `aria-controls`, `aria-selected`
- Theme toggle: `aria-pressed`

---

## 10. Performance Guidelines

### 10.1 Font Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
```

All fonts loaded with `display=swap` for immediate text rendering.

### 10.2 Animation Performance

- Use `will-change: transform` on animated elements (mesh blobs, cursor glow)
- Prefer `transform` and `opacity` for animations (compositor-only properties)
- Suspend animations when tab is hidden (`document.hidden` check)
- Disable particle canvas and cursor glow on mobile/touch devices

### 10.3 Glassmorphism Performance

- `backdrop-filter` is GPU-intensive — limit to visible viewport elements
- Reduce blur values on mobile (20px → 12px)
- Avoid stacking multiple glassmorphic layers

---

## 11. Cross-App Navigation

A persistent 32px bar connecting all ecosystem sites:

```
┌─────────────────────────────────────────────────┐
│  ◆ AE   amrelharony.com  │  agile.  │  books.  │
└─────────────────────────────────────────────────┘
```

- Glassmorphic background, fixed top, z-index 100
- "AE" monogram in gradient text
- Current site: accent color + underline
- Other sites: muted, hover → accent with glow
- Mobile: collapses to "AE" icon with dropdown

See `shared/EcosystemNav.tsx` for implementation.
