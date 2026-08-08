// Decorative scan sweep played while the backend analysis call is in flight.
// Purely a visual overlay: it never gates, delays, or observes the
// simplification pipeline.
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

// Three phases: INTRO plays once (grid wipes in, first beam pass). LOOP
// repeats indefinitely after that — for as long as the backend call is in
// flight, however long that turns out to be. OUTRO plays once stop() is
// called. MIN_VISIBLE_MS floors how soon stop() may start the outro, so a
// very fast response (cache hit, local fallback) can't cut the intro off
// mid-wipe.
const INTRO_MS = 560
const LOOP_MS = 900
const OUTRO_MS = 320
const MIN_VISIBLE_MS = INTRO_MS + 60

const REDUCED_INTRO_MS = 220
const REDUCED_LOOP_MS = 1100
const REDUCED_OUTRO_MS = 220
const REDUCED_MIN_VISIBLE_MS = REDUCED_INTRO_MS + 40

// Safety net, not the normal path: if stop() can never be called, the layer has
// to come down on its own. This is deliberately NOT a time limit — analysis has
// no fixed upper bound (a 100+ block page against a slow LLM legitimately runs
// for a minute), and a sweep that quits while work is still in flight tells the
// user the wrong thing. So the net checks *liveness* instead: the only way the
// caller can lose its ability to call stop() is the extension context going away
// (reload/update/uninstall), which invalidates chrome.runtime. While the context
// is alive, the sweep keeps looping for as long as the work takes.
const LIVENESS_POLL_MS = 5000

function isExtensionContextAlive(): boolean {
  try {
    return !!chrome.runtime?.id
  } catch {
    // Accessing chrome.runtime after invalidation throws rather than returning undefined.
    return false
  }
}

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

// State toggled via classes rather than baking a duration into the CSS text,
// so the same stylesheet serves the whole intro -> loop -> outro sequence —
// JS only ever adds/removes 'looping' and 'outro', never regenerates this.
const STYLE = `
:host {
  /* No box, no position — see the note at the top of this file. */
  display: contents;
}
.root {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  /* Never intercept a click. A full-viewport layer that swallowed a tap on a
     consent banner would be a real problem, not a cosmetic one. */
  pointer-events: none;
  contain: strict;
  opacity: 1;
}
.root.outro {
  animation: distill-scan-fade-out ${OUTRO_MS}ms linear forwards;
}
.root.reduced.outro {
  animation-duration: ${REDUCED_OUTRO_MS}ms;
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
  animation: distill-scan-resolve ${INTRO_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
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
  animation: distill-scan-sweep ${INTRO_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
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
/* After the intro finishes, JS adds .looping — swaps the beam to an
   indefinitely repeating pass so it keeps signaling work while the request
   is still in flight. */
.root.looping .beam {
  animation: distill-scan-sweep-loop ${LOOP_MS}ms linear infinite;
}
/* prefers-reduced-motion: no positional movement. The grid fades in once and
   then breathes gently in place — no beam element at all. */
.root.reduced .grid {
  clip-path: inset(0 0 0% 0);
  opacity: 0;
  animation: distill-scan-breathe-in ${REDUCED_INTRO_MS}ms ease-out forwards;
}
.root.reduced.looping .grid {
  animation: distill-scan-breathe ${REDUCED_LOOP_MS}ms ease-in-out infinite;
}

@keyframes distill-scan-resolve {
  from { clip-path: inset(0 0 100% 0); }
  to   { clip-path: inset(0 0 0% 0); }
}
@keyframes distill-scan-sweep {
  from { transform: translateY(-3px); opacity: 1; }
  85%  { opacity: 1; }
  to   { transform: translateY(100vh); opacity: 0; }
}
@keyframes distill-scan-sweep-loop {
  0%   { transform: translateY(-3px); opacity: 1; }
  85%  { opacity: 1; }
  100% { transform: translateY(100vh); opacity: 0; }
}
@keyframes distill-scan-breathe-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes distill-scan-breathe {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
@keyframes distill-scan-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
`

function removeScanLayer(): void {
  document.getElementById(SCAN_HOST_ID)?.remove()
}

/**
 * Starts the scan sweep and returns a `stop` function. The sweep plays its
 * intro once, then loops indefinitely — call `stop()` when the backend
 * response (or fallback) is ready, and it plays a short outro fade before
 * removing itself. Safe to call repeatedly; an in-flight sweep is torn down
 * and restarted so one Activate press yields exactly one animation.
 *
 * "Indefinitely" is literal: the loop has no time limit and never stops itself
 * because the work is slow. It ends when the caller says the work is done, or —
 * only if the extension context dies and no caller is left to say so — when the
 * liveness check notices.
 *
 * Both starting and stopping return immediately. Callers must not await
 * `startScanAnimation()` or let it sequence work — it is decoration running
 * alongside the real analysis call, never in front of it.
 */
export function startScanAnimation(): () => void {
  if (!document.body) return () => {}

  // Restart rather than stack, so a double-press can't leave two layers running.
  removeScanLayer()

  const reduced = prefersReducedMotion()
  const introMs = reduced ? REDUCED_INTRO_MS : INTRO_MS
  const outroMs = reduced ? REDUCED_OUTRO_MS : OUTRO_MS
  const minVisibleMs = reduced ? REDUCED_MIN_VISIBLE_MS : MIN_VISIBLE_MS

  const host = document.createElement(SCAN_HOST_TAG)
  host.id = SCAN_HOST_ID
  host.setAttribute('aria-hidden', 'true')

  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = STYLE

  const root = document.createElement('div')
  root.className = reduced ? 'root reduced' : 'root'

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

  const startedAt = performance.now()
  let removed = false

  function finish(): void {
    if (removed) return
    removed = true
    window.clearTimeout(introTimer)
    window.clearInterval(livenessTimer)
    root.classList.remove('looping')
    root.classList.add('outro')
    window.setTimeout(removeScanLayer, outroMs + 100)
  }

  // Enter the loop once the intro's own animation has actually finished
  // playing — not tied to stop(), so the loop starts even if the caller
  // takes a while to stop() it.
  const introTimer = window.setTimeout(() => {
    if (!removed) root.classList.add('looping')
  }, introMs)

  // No elapsed-time component: this tears the layer down only once nobody is left
  // who could call stop(), never because the analysis is "taking too long".
  const livenessTimer = window.setInterval(() => {
    if (!isExtensionContextAlive()) finish()
  }, LIVENESS_POLL_MS)

  let stopped = false
  return function stop(): void {
    if (stopped) return
    stopped = true
    const elapsed = performance.now() - startedAt
    const remaining = minVisibleMs - elapsed
    if (remaining > 0) {
      window.setTimeout(finish, remaining)
    } else {
      finish()
    }
  }
}
