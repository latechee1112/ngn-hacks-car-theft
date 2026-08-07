import { isAdLike, isPopupLike, isProtectedFromSimplification, isStickyOrFixed, isVisible } from './dom-heuristics'
import { restoreAllOriginal, saveOriginal } from './originalState'

const SIMPLIFIED_ATTR = 'data-distill-simplified'
const STYLE_TAG_ID = 'distill-global-style'
const RESTORE_BTN_ID = 'distill-restore-button'
const PRIMARY_CLASS = 'distill-primary-content'
const DEEMPHASIZE_CLASS = 'distill-deemphasize'
const UNSTICK_CLASS = 'distill-unstick'
const NEUTRAL_COLOR_CLASS = 'distill-neutral-color'
const NEUTRAL_COLOR_VAR = '--distill-neutral-color'
const NEUTRAL_COLOR_DARK = '#1a1a1a'
const NEUTRAL_COLOR_LIGHT = '#f2f2f2'
const SECTION_HIDDEN_CLASS = 'distill-section-hidden'
const PROGRESSIVE_CONTROLS_ID = 'distill-progressive-controls'
const SECTION_HEADING_SELECTOR = /^h[23]$/i

const NOISE_SELECTOR =
  'nav, aside, footer, [role="navigation"], [role="complementary"], [role="contentinfo"], ' +
  '[class*="ad" i], [id*="ad" i], ins, [class*="modal" i], [id*="modal" i], ' +
  '[class*="popup" i], [id*="popup" i], [class*="overlay" i]'

export interface SimplifyResult {
  primaryFound: boolean
  deemphasizedCount: number
}

function findPrimaryContent(): Element | null {
  const candidates = document.querySelectorAll('main, article, [role="main"]')
  let best: Element | null = null
  let bestLen = 0
  candidates.forEach((el) => {
    if (!isVisible(el)) return
    const len = ((el as HTMLElement).innerText || '').length
    if (len > bestLen) {
      bestLen = len
      best = el
    }
  })
  return best
}

// Prevents nested targets (e.g. an ad div inside an aside) from having opacity applied
// twice — CSS opacity compounds with ancestors, which would make nested targets vanish.
function pruneNested(elements: Element[]): Element[] {
  return elements.filter((el) => !elements.some((other) => other !== el && other.contains(el)))
}

function collectNoiseTargets(primary: Element | null): Element[] {
  const targets = new Set<Element>()

  document.querySelectorAll(NOISE_SELECTOR).forEach((el) => {
    if (primary && (primary === el || primary.contains(el))) return
    if (!isVisible(el)) return
    if (isProtectedFromSimplification(el)) return
    if (isAdLike(el) || isPopupLike(el) || ['nav', 'aside', 'footer'].includes(el.tagName.toLowerCase())) {
      targets.add(el)
      return
    }
    const role = el.getAttribute('role')
    if (role === 'navigation' || role === 'complementary' || role === 'contentinfo') targets.add(el)
  })

  // Sticky/fixed chrome (promo bars, sticky headers) often isn't caught by the selector
  // above, so do a bounded pass over top-level containers by computed style. Safety-critical
  // fixed chrome — cookie/consent banners, warnings — must be excluded here specifically,
  // since "sticky/fixed" is exactly the shape a consent banner normally takes.
  document.querySelectorAll('body > *, header, div, section').forEach((el) => {
    if (targets.has(el)) return
    if (primary && (primary === el || primary.contains(el))) return
    if (!isVisible(el)) return
    if (isProtectedFromSimplification(el)) return
    if (isStickyOrFixed(el)) targets.add(el)
  })

  return pruneNested(Array.from(targets))
}

// Some sites give a fixed/sticky bar its full width via `left: 0; right: 0` rather than
// an explicit width — a trick that only resolves for fixed/absolute positioning. Swapping
// to `position: relative` (UNSTICK_CLASS) drops that computation, so the box collapses to
// shrink-fit its in-flow content, which can also orphan any position:absolute children
// (e.g. a logo anchored to it) that were relying on it staying full-sized. Pinning the
// rendered width as an inline style — captured before the position change — sidesteps the
// site's own CSS mechanism entirely instead of trying to replicate it.
function unstickElement(el: Element): void {
  const rect = el.getBoundingClientRect()
  const htmlEl = el as HTMLElement
  // getBoundingClientRect() is a border-box measurement; force border-box sizing so the
  // pinned width lines up exactly regardless of the page's own box-sizing for this element.
  htmlEl.style.setProperty('box-sizing', 'border-box', 'important')
  htmlEl.style.setProperty('width', `${Math.round(rect.width)}px`, 'important')
  el.classList.add(UNSTICK_CLASS)
}

function pauseAutoplayMedia(): void {
  document.querySelectorAll<HTMLMediaElement>('video[autoplay], audio[autoplay]').forEach((media) => {
    saveOriginal(media)
    media.pause()
    media.removeAttribute('autoplay')
    media.classList.add(DEEMPHASIZE_CLASS)
  })
}

function injectGlobalStyle(): void {
  if (document.getElementById(STYLE_TAG_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_TAG_ID
  style.textContent = `
html[${SIMPLIFIED_ATTR}] body {
  line-height: 1.7 !important;
}
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} {
  font-size: 1.15em !important;
  line-height: 1.75 !important;
  float: none !important;
}
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} p,
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} li {
  margin-bottom: 1.1em !important;
  font-size: 1.05em !important;
}
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} h1,
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} h2,
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} h3 {
  margin-top: 1.4em !important;
  margin-bottom: 0.6em !important;
}
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} {
  opacity: 0.4 !important;
  filter: grayscale(60%) !important;
  transition: opacity 0.2s ease !important;
}
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS}:hover {
  opacity: 0.85 !important;
}
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} input,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} button,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} select,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} textarea,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} a[href] {
  opacity: 1 !important;
  filter: none !important;
}
html[${SIMPLIFIED_ATTR}] .${UNSTICK_CLASS} {
  /* relative, not static: still pulls the element into normal flow (no longer
     stuck over content), but unlike static it still establishes a positioning
     context, so any position:absolute children (e.g. a logo/nav-links block
     anchored to this element) don't lose their containing block and vanish. */
  position: relative !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  /* A common centering trick pairs left: 50% with transform: translateX(-50%) to
     center a fixed-width fixed/sticky bar. Resetting left above without also resetting
     the transform leaves that shift active on the element's new in-flow position,
     shoving it half its own width off to one side instead of centering it. */
  transform: none !important;
}
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS}.${NEUTRAL_COLOR_CLASS},
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS}.${NEUTRAL_COLOR_CLASS} :not(form):not(form *):not(button):not(button *) {
  color: var(${NEUTRAL_COLOR_VAR}, ${NEUTRAL_COLOR_DARK}) !important;
}
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS}.${NEUTRAL_COLOR_CLASS} a:not(form a):not(button a) {
  text-decoration: underline !important;
}
#${RESTORE_BTN_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  background: #1a1a1a;
  color: #fff;
  border: 2px solid transparent;
  border-radius: 999px;
  padding: 14px 24px;
  min-height: 48px;
  font: 700 16px system-ui, sans-serif;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  cursor: pointer;
}
#${RESTORE_BTN_ID}:hover {
  background: #333;
}
#${RESTORE_BTN_ID}:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 2px;
}
html[${SIMPLIFIED_ATTR}] .${SECTION_HIDDEN_CLASS} {
  display: none !important;
}
#${PROGRESSIVE_CONTROLS_ID} {
  position: fixed;
  bottom: 18px;
  left: 18px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #1a1a1a;
  color: #fff;
  border-radius: 14px;
  padding: 11px 16px;
  font: 700 15px/1.3 system-ui, sans-serif;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
#${PROGRESSIVE_CONTROLS_ID} button {
  background: #333;
  border: 2px solid transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 9px 15px;
  min-height: 44px;
  min-width: 44px;
  border-radius: 9px;
}
#${PROGRESSIVE_CONTROLS_ID} button:disabled {
  opacity: 0.35;
  cursor: default;
}
#${PROGRESSIVE_CONTROLS_ID} button:hover:not(:disabled) {
  background: #4a4a4a;
}
#${PROGRESSIVE_CONTROLS_ID} button:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 2px;
}
#${PROGRESSIVE_CONTROLS_ID} [data-role="label"] {
  opacity: 0.9;
  white-space: nowrap;
}
`
  document.head.appendChild(style)
}

function ensureRestoreButton(): void {
  if (document.getElementById(RESTORE_BTN_ID)) return
  const btn = document.createElement('button')
  btn.id = RESTORE_BTN_ID
  btn.type = 'button'
  btn.textContent = 'Show original page'
  btn.addEventListener('click', restoreOriginalPage)
  document.body.appendChild(btn)
}

export function isSimplificationActive(): boolean {
  return document.documentElement.getAttribute(SIMPLIFIED_ATTR) === 'true'
}

export function applySimplification(): SimplifyResult {
  if (isSimplificationActive()) {
    return {
      primaryFound: !!document.querySelector(`.${PRIMARY_CLASS}`),
      deemphasizedCount: document.querySelectorAll(`.${DEEMPHASIZE_CLASS}`).length,
    }
  }

  const primary = findPrimaryContent()

  if (primary) {
    saveOriginal(primary)
    primary.classList.add(PRIMARY_CLASS)
  }

  const targets = collectNoiseTargets(primary)
  targets.forEach((el) => {
    saveOriginal(el)
    el.classList.add(DEEMPHASIZE_CLASS)
    if (isStickyOrFixed(el)) unstickElement(el)
  })

  pauseAutoplayMedia()
  injectGlobalStyle()
  ensureRestoreButton()
  document.documentElement.setAttribute(SIMPLIFIED_ATTR, 'true')

  return { primaryFound: !!primary, deemphasizedCount: targets.length }
}

function getPrimaryElement(): Element | null {
  return document.querySelector(`.${PRIMARY_CLASS}`)
}

function parseRgbComponents(value: string): [number, number, number, number] | null {
  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match) return null
  const [r, g, b, a = 1] = match[1].split(',').map((part) => parseFloat(part.trim()))
  if ([r, g, b].some((n) => Number.isNaN(n))) return null
  return [r, g, b, a]
}

function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

// null means "not a determinable solid color" (transparent, or unparseable) rather than
// light/dark, so callers can fall back instead of misreading transparency as "light".
function isLightColor(value: string): boolean | null {
  const rgba = parseRgbComponents(value)
  if (!rgba || rgba[3] === 0) return null
  return relativeLuminance(rgba[0], rgba[1], rgba[2]) > 0.5
}

// The page author already solved the contrast problem once: if they set this element's
// text to white, that's direct, reliable evidence the background here is dark — far more
// reliable than trying to detect the background itself, which frequently isn't inspectable
// via computed style at all (a photo rendered through a sibling <img>/<picture>, a canvas,
// a pseudo-element mask — none of these show up as background-color or background-image on
// any ancestor). So: just read the element's own original text-color luminance directly.
function detectNeutralColorFor(el: Element): string {
  return isLightColor(getComputedStyle(el).color) ? NEUTRAL_COLOR_LIGHT : NEUTRAL_COLOR_DARK
}

const COLOR_BOUNDARY_SELECTOR =
  'div, section, article, header, footer, aside, li, figure, h1, h2, h3, h4, h5, h6, p, span, a, blockquote'
const MAX_COLOR_BOUNDARIES = 300

// A single neutral color picked at the primary region's root isn't enough on pages where a
// differently-themed block (a dark promo card with white headline text sitting inside an
// otherwise light/dark article) is nested inside it — that mismatch is exactly what makes
// neutral text vanish. So beyond the root, also override on each element whose own original
// text color deliberately differs from its parent's — a genuine authored color change, not
// just inheritance — keeping every such themed block independently readable.
//
// Must run and finish BEFORE the NEUTRAL_COLOR_CLASS is added to `primary`: once that class
// is on, the injected `color: var(--distill-neutral-color, ...)` rule starts overriding
// every descendant's computed color, so reading getComputedStyle(...).color afterwards would
// just read Distill's own already-applied fallback color back instead of the page's original.
function applyNeutralColorVariables(primary: Element): void {
  ;(primary as HTMLElement).style.setProperty(NEUTRAL_COLOR_VAR, detectNeutralColorFor(primary))

  let processed = 0
  for (const el of Array.from(primary.querySelectorAll(COLOR_BOUNDARY_SELECTOR))) {
    if (processed >= MAX_COLOR_BOUNDARIES) break
    const parent = el.parentElement
    if (!parent) continue
    if (getComputedStyle(el).color === getComputedStyle(parent).color) continue
    processed++
    saveOriginal(el)
    ;(el as HTMLElement).style.setProperty(NEUTRAL_COLOR_VAR, detectNeutralColorFor(el))
  }
}

function clearNeutralColorVariables(primary: Element): void {
  ;(primary as HTMLElement).style.removeProperty(NEUTRAL_COLOR_VAR)
  primary.querySelectorAll(COLOR_BOUNDARY_SELECTOR).forEach((el) => {
    ;(el as HTMLElement).style.removeProperty(NEUTRAL_COLOR_VAR)
  })
}

export function canReduceColorVariation(): boolean {
  return isSimplificationActive() && !!getPrimaryElement()
}

export function isColorVariationReduced(): boolean {
  return getPrimaryElement()?.classList.contains(NEUTRAL_COLOR_CLASS) ?? false
}

// Toggles a single neutral text/link color across the simplified primary region only.
// Reuses the same snapshot-before-mutating + class-toggle pattern as the noise dimming
// above, so restoreOriginalPage() undoes this along with everything else.
export function setReduceColorVariation(enabled: boolean): boolean {
  const primary = getPrimaryElement()
  if (!isSimplificationActive() || !primary) return false

  saveOriginal(primary)
  if (enabled) {
    applyNeutralColorVariables(primary)
  } else {
    clearNeutralColorVariables(primary)
  }
  primary.classList.toggle(NEUTRAL_COLOR_CLASS, enabled)
  return true
}

// --- Progressive reveal ---------------------------------------------------

export interface ProgressiveRevealResult {
  eligible: boolean
  totalSections: number
  currentIndex: number
}

let sections: Element[][] = []
let currentSectionIndex = 0

const HEADING_WRAPPER_TEXT_LIMIT = 150

// Some sites (current Wikipedia included) wrap each top-level section in its own
// container instead of leaving headings as flat siblings of their content — e.g.
// <section><h2>…</h2><p>…</p></section>. Wikipedia goes one level further and wraps
// just the heading itself too: <section><div class="mw-heading"><h2>…</h2></div>…</section>.
// Treat a container as a section wrapper if its first child either IS a heading, or is a
// short "heading wrapper" div/span (a handful of characters — enough for a heading, edit
// link, anchor) that itself contains one.
function isSectionWrapper(el: Element): boolean {
  const first = el.firstElementChild
  if (!first) return false
  if (SECTION_HEADING_SELECTOR.test(first.tagName)) return true
  const nestedHeading = first.querySelector('h2, h3')
  return !!nestedHeading && (first.textContent || '').length < HEADING_WRAPPER_TEXT_LIMIT
}

function isHeadingBearing(el: Element): boolean {
  return SECTION_HEADING_SELECTOR.test(el.tagName) || isSectionWrapper(el)
}

// Article containers are rarely flat — e.g. Wikipedia nests the real content
// several <div> levels below <main>. Descend into whichever child holds the most
// heading-bearing elements until we land on the level where sections (flat headings
// or per-section wrapper containers) are direct children.
function findContentRoot(root: Element, depth = 0): Element {
  if (depth > 6) return root

  const directHeadingBearingCount = Array.from(root.children).filter(isHeadingBearing).length
  if (directHeadingBearingCount >= 2) return root

  let best: Element | null = null
  let bestCount = 0
  for (const child of Array.from(root.children)) {
    const count = child.querySelectorAll('h2, h3').length
    if (count > bestCount) {
      bestCount = count
      best = child
    }
  }
  if (best && bestCount >= 2) return findContentRoot(best, depth + 1)

  return root
}

// Groups the content root's direct children into sections, handling both shapes:
// flat (headings interspersed with their content as siblings) and wrapped (each
// section pre-packaged in its own container). Never splits an element mid-section.
function buildSections(root: Element): Element[][] {
  const children = Array.from(root.children)
  const wrapperCount = children.filter(isSectionWrapper).length

  if (wrapperCount >= 2) {
    const groups: Element[][] = []
    const intro: Element[] = []
    let seenWrapper = false
    children.forEach((child) => {
      if (isSectionWrapper(child)) {
        if (!seenWrapper && intro.length) groups.push(intro)
        seenWrapper = true
        groups.push([child])
      } else if (!seenWrapper) {
        intro.push(child)
      } else {
        // Trailing content after the last wrapper (e.g. a "Categories" list) rides along with it.
        groups[groups.length - 1]?.push(child)
      }
    })
    if (!seenWrapper && intro.length) groups.push(intro)
    return groups
  }

  const groups: Element[][] = []
  let current: Element[] = []

  children.forEach((child) => {
    if (SECTION_HEADING_SELECTOR.test(child.tagName)) {
      if (current.length) groups.push(current)
      current = [child]
    } else {
      current.push(child)
    }
  })
  if (current.length) groups.push(current)

  return groups
}

function isProgressiveRevealActive(): boolean {
  return sections.length > 0
}

// Block-by-block reveal: only the current section is visible. Every other
// section — before or after — is fully hidden, not faded or peeking.
function applySectionVisibility(): void {
  sections.forEach((group, index) => {
    group.forEach((el) => {
      saveOriginal(el)
      el.classList.remove(DEEMPHASIZE_CLASS, SECTION_HIDDEN_CLASS)
      if (index !== currentSectionIndex) {
        el.classList.add(SECTION_HIDDEN_CLASS)
      }
    })
  })
}

function updateProgressiveControls(): void {
  const bar = document.getElementById(PROGRESSIVE_CONTROLS_ID)
  if (!bar) return
  const label = bar.querySelector('[data-role="label"]')
  if (label) label.textContent = `Section ${currentSectionIndex + 1} of ${sections.length}`
  const prevBtn = bar.querySelector<HTMLButtonElement>('[data-role="prev"]')
  const nextBtn = bar.querySelector<HTMLButtonElement>('[data-role="next"]')
  if (prevBtn) prevBtn.disabled = currentSectionIndex === 0
  if (nextBtn) nextBtn.disabled = currentSectionIndex === sections.length - 1
}

function goToSection(index: number): void {
  currentSectionIndex = Math.max(0, Math.min(index, sections.length - 1))
  applySectionVisibility()
  updateProgressiveControls()
  window.scrollTo({ top: 0, behavior: 'auto' })
}

function removeProgressiveControls(): void {
  document.getElementById(PROGRESSIVE_CONTROLS_ID)?.remove()
}

function ensureProgressiveControls(): void {
  if (document.getElementById(PROGRESSIVE_CONTROLS_ID)) {
    updateProgressiveControls()
    return
  }
  const bar = document.createElement('div')
  bar.id = PROGRESSIVE_CONTROLS_ID
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', 'Progressive reveal navigation')

  const prevBtn = document.createElement('button')
  prevBtn.type = 'button'
  prevBtn.dataset.role = 'prev'
  prevBtn.textContent = '‹ Previous'
  prevBtn.setAttribute('aria-label', 'Show previous section')
  prevBtn.addEventListener('click', () => goToSection(currentSectionIndex - 1))

  const label = document.createElement('span')
  label.dataset.role = 'label'
  label.setAttribute('aria-live', 'polite')

  const nextBtn = document.createElement('button')
  nextBtn.type = 'button'
  nextBtn.dataset.role = 'next'
  nextBtn.textContent = 'Next ›'
  nextBtn.setAttribute('aria-label', 'Show next section')
  nextBtn.addEventListener('click', () => goToSection(currentSectionIndex + 1))

  const showAllBtn = document.createElement('button')
  showAllBtn.type = 'button'
  showAllBtn.dataset.role = 'show-all'
  showAllBtn.textContent = 'Show All'
  showAllBtn.setAttribute('aria-label', 'Show all sections')
  showAllBtn.addEventListener('click', disableProgressiveReveal)

  bar.append(prevBtn, label, nextBtn, showAllBtn)
  document.body.appendChild(bar)
  updateProgressiveControls()
}

export function canUseProgressiveReveal(): boolean {
  return isSimplificationActive() && !!getPrimaryElement()
}

export function isProgressiveRevealOn(): boolean {
  return isProgressiveRevealActive()
}

export function enableProgressiveReveal(): ProgressiveRevealResult {
  const primary = getPrimaryElement()
  if (!isSimplificationActive() || !primary) {
    return { eligible: false, totalSections: 0, currentIndex: 0 }
  }

  const root = findContentRoot(primary)
  const built = buildSections(root)
  const headingSectionCount = built.filter((group) => isHeadingBearing(group[0])).length

  // Too few headings to meaningfully paginate — leave the article fully visible.
  if (headingSectionCount < 2) {
    sections = []
    return { eligible: false, totalSections: 0, currentIndex: 0 }
  }

  sections = built
  currentSectionIndex = 0
  applySectionVisibility()
  ensureProgressiveControls()

  return { eligible: true, totalSections: sections.length, currentIndex: currentSectionIndex }
}

export function disableProgressiveReveal(): void {
  sections.forEach((group) => {
    group.forEach((el) => el.classList.remove(DEEMPHASIZE_CLASS, SECTION_HIDDEN_CLASS))
  })
  sections = []
  currentSectionIndex = 0
  removeProgressiveControls()
}

export function restoreOriginalPage(): void {
  disableProgressiveReveal()
  restoreAllOriginal()
  document.documentElement.removeAttribute(SIMPLIFIED_ATTR)
  document.getElementById(STYLE_TAG_ID)?.remove()
  document.getElementById(RESTORE_BTN_ID)?.remove()
}
