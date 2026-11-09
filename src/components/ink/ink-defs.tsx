/**
 * The SVG filters ink graphics share, once per document (DNA-SPEC §9).
 *
 * - `ink-boil-0..2`: three slightly different displacements of the same line.
 *   `.ink-boil` steps through them about eight times a second while its host is
 *   hovered, the "line boil" of hand-drawn animation.
 * - `ink-bleed`: a soft, uneven edge for the watercolour washes behind the few
 *   big scenes (home hero, 404, errors). Static: drawn once, never animated.
 *
 * Mounted in the root layout so bare routes (sign-in, join) get it too. It is a
 * zero-size, absolutely positioned SVG rather than `display: none`, because some
 * browsers drop filters defined inside a display-none subtree.
 */
const BOIL_SEEDS = [3, 11, 23];

export function InkDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="pointer-events-none absolute h-0 w-0 overflow-hidden"
    >
      <defs>
        {BOIL_SEEDS.map((seed, i) => (
          <filter key={seed} id={`ink-boil-${i}`} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed={seed} />
            <feDisplacementMap
              in="SourceGraphic"
              scale="2.4"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
        <filter id="ink-bleed" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="12"
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
    </svg>
  );
}
