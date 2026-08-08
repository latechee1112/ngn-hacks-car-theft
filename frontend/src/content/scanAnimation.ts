// Decorative scan sweep played when the user presses Activate. Purely a visual
// overlay: it never gates, delays, or observes the simplification pipeline.
//
// Detection-safety is the whole design constraint here. extractPage() runs
// synchronously at the start of handleSimplify(), so this element is in the DOM
// while block detection walks it. Three things keep it out of that walk, and all
// three are load-bearing — none of the gating code knows this module exists:
//
//   1. Custom tag name, no class, no [role] — misses extract.ts's
//      CANDIDATE_SELECTOR entirely, so it is never even a candidate block.
//   2. display: contents on the host — generates no box, so
//      getBoundingClientRect() is 0x0 and isVisible() is false. That is the
//      early-out in both of collectNoiseTargets()'s passes, including the
//      `body > *` sweep that would otherwise match.
//   3. Shadow DOM — document.querySelectorAll() does not pierce the boundary,
//      so the fixed-position layers inside are unreachable from every selector
//      in extract.ts and simplify.ts.
//
// Consequence of (2): the host must stay display:contents and must never take a
// position of its own. Anything fixed/sticky lives inside the shadow root.
// The id/tag also avoid the ad/modal/popup/overlay/sidebar/consent/warning
// substrings those selectors and dom-heuristics.ts match on.

const SCAN_HOST_TAG = 'distill-scan'
const SCAN_HOST_ID = 'distill-scan-layer'

const SWEEP_MS = 560
const TOTAL_MS = 900
const REDUCED_MS = 320

// Two-tier mesh: fine cells inside heavier major cells. Reads as a denser,
// more deliberate scan than a single grid at the same line weight would.
const GRID_MAJOR = 32
const GRID_MINOR = 8
const LINE_MAJOR = 'rgba(126, 182, 236, 0.55)'
const LINE_MINOR = 'rgba(126, 182, 236, 0.16)'
const WASH = 'rgba(47, 111, 181, 0.11)'
const BEAM = 'rgba(186, 222, 250, 0.98)'
const BEAM_GLOW = 'rgba(90, 158, 224, 0.55)'
const BEAM_BLOOM = 'rgba(47, 111, 181, 0.28)'
const TRAIL = 'rgba(64, 132, 200, 0.30)'
const TRAIL_HEIGHT = 160

function prefersReducedMotion(): boolean {
  // Both the OS setting and Distill's own reduce-motion state suppress the
  // sweep. This is an accessibility tool — a full-viewport moving band is
  // exactly the kind of motion the setting exists to stop.
  if (document.documentElement.hasAttribute('data-distill-reduce-motion')) return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function styleText(reduced: boolean): string {
  const gridAnimation = reduced
    ? 'none'
    : `distill-scan-resolve ${SWEEP_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`

  return `
:host {
  /* No box, no position — see the note at the top of this file. */
  display: contents;
}
.root {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  /* Never intercept a click. A full-viewport layer that swallowed a tap on a
     consent banner for 600ms would be a real problem, not a cosmetic one. */
  pointer-events: none;
  contain: strict;
  animation: ${reduced ? `distill-scan-fade-quiet ${REDUCED_MS}ms` : `distill-scan-fade ${TOTAL_MS}ms`} linear forwards;
}
.grid {
  position: absolute;
  inset: 0;
  background-color: ${WASH};
  /* Major lines painted over minor: first image in the list wins. */
  background-image:
    linear-gradient(to right, ${LINE_MAJOR} 1px, transparent 1px),
    linear-gradient(to bottom, ${LINE_MAJOR} 1px, transparent 1px),
    linear-gradient(to right, ${LINE_MINOR} 1px, transparent 1px),
    linear-gradient(to bottom, ${LINE_MINOR} 1px, transparent 1px);
  background-size:
    ${GRID_MAJOR}px ${GRID_MAJOR}px,
    ${GRID_MAJOR}px ${GRID_MAJOR}px,
    ${GRID_MINOR}px ${GRID_MINOR}px,
    ${GRID_MINOR}px ${GRID_MINOR}px;
  clip-path: inset(0 0 100% 0);
  animation: ${gridAnimation};
}
.beam {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 3px;
  background: ${BEAM};
  box-shadow: 0 0 18px 3px ${BEAM_GLOW}, 0 0 44px 12px ${BEAM_BLOOM};
  transform: translateY(-3px);
  animation: distill-scan-sweep ${SWEEP_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
/* Body trailing the leading edge, over the region already resolved. */
.beam::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: ${TRAIL_HEIGHT}px;
  background: linear-gradient(to top, ${TRAIL}, transparent);
}

/* Same duration and easing as .beam, so the leading edge of the grid and the
   beam stay locked together for the whole sweep. */
@keyframes distill-scan-resolve {
  from { clip-path: inset(0 0 100% 0); }
  to   { clip-path: inset(0 0 0% 0); }
}
@keyframes distill-scan-sweep {
  from { transform: translateY(-3px); opacity: 1; }
  85%  { opacity: 1; }
  to   { transform: translateY(100vh); opacity: 0; }
}
@keyframes distill-scan-fade {
  0%, 70% { opacity: 1; }
  100%    { opacity: 0; }
}
@keyframes distill-scan-fade-quiet {
  0%   { opacity: 0; }
  40%  { opacity: 1; }
  100% { opacity: 0; }
}
`
}

function removeScanLayer(): void {
  document.getElementById(SCAN_HOST_ID)?.remove()
}

/**
 * Plays the scan sweep once. Safe to call repeatedly — an in-flight sweep is
 * torn down and restarted so one Activate press yields exactly one animation.
 *
 * Returns immediately. Callers must not await it or sequence work behind it.
 */
export function playScanAnimation(): void {
  if (!document.body) return

  // Restart rather than stack, so a double-press can't leave two layers running.
  removeScanLayer()

  const reduced = prefersReducedMotion()
  const host = document.createElement(SCAN_HOST_TAG)
  host.id = SCAN_HOST_ID
  host.setAttribute('aria-hidden', 'true')

  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = styleText(reduced)

  const root = document.createElement('div')
  root.className = 'root'

  const grid = document.createElement('div')
  grid.className = 'grid'
  root.appendChild(grid)

  if (!reduced) {
    const beam = document.createElement('div')
    beam.className = 'beam'
    root.appendChild(beam)
  }

  shadow.append(style, root)
  document.body.appendChild(host)

  // animationend is the normal path; the timer is the guarantee. Background
  // tabs throttle animation frames, and a stuck decorative layer would sit on
  // the page forever.
  const duration = reduced ? REDUCED_MS : TOTAL_MS
  const timer = window.setTimeout(removeScanLayer, duration + 150)
  root.addEventListener('animationend', (event) => {
    if (event.target !== root) return
    window.clearTimeout(timer)
    removeScanLayer()
  })
}
