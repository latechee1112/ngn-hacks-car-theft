import type { BlockAction, LayoutSettings } from '../types/analysis'
import {
  AD_HIDDEN_CLASS,
  isAdLike,
  isAdNetworkFrame,
  isPopupLike,
  isProtectedFromSimplification,
  isSponsoredLabel,
  isStickyOrFixed,
  isVisible,
} from './dom-heuristics'
import { FF_ID_ATTR } from './extract'
import { restoreAllOriginal, saveOriginal } from './originalState'

const SIMPLIFIED_ATTR = 'data-distill-simplified'
const REDUCE_MOTION_ATTR = 'data-distill-reduce-motion'
const STYLE_TAG_ID = 'distill-global-style'
const RESTORE_BTN_ID = 'distill-restore-button'
const PRIMARY_CLASS = 'distill-primary-content'
const DEEMPHASIZE_CLASS = 'distill-deemphasize'
const UNSTICK_FIXED_CLASS = 'distill-unstick-fixed'
const UNSTICK_STICKY_CLASS = 'distill-unstick-sticky'
const NEUTRAL_COLOR_CLASS = 'distill-neutral-color'
const NEUTRAL_COLOR = '#1a1a1a'
const SECTION_HIDDEN_CLASS = 'distill-section-hidden'
const PROGRESSIVE_CONTROLS_ID = 'distill-progressive-controls'
const SECTION_HEADING_SELECTOR = /^h[23]$/i
const BLUR_INTENSITY_PROP = '--distill-blur-intensity'
// Matches the sidepanel's new Intensity default (75%) - deemphasized content
// should already read as strongly blurred/censored the first time a page is
// simplified, before the user ever touches the slider.
const DEFAULT_BLUR_INTENSITY = 0.75
// Blur radius at 100% intensity. Strong enough to make text illegible (true
// "censoring") without needing an opaque overlay.
const MAX_BLUR_PX = 8

const NOISE_SELECTOR =
  'nav, aside, footer, [role="navigation"], [role="complementary"], [role="contentinfo"], ' +
  '[class*="ad" i], [id*="ad" i], ins, [class*="modal" i], [id*="modal" i], ' +
  '[class*="popup" i], [id*="popup" i], [class*="overlay" i]'

export interface SimplifyResult {
  primaryFound: boolean
  deemphasizedCount: number
  adsHidden: number
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

// --- Ads and sponsored content -------------------------------------------
// Ads are removed from view outright (display:none) rather than dimmed like other
// noise: a faded ad is still an ad competing for attention. Nothing is deleted —
// this is the same class-toggle + saveOriginal machinery as everything else, so
// restoreOriginalPage() brings them all back.

// Deliberately loose — every hit is re-checked with isAdLike(), which is the part
// that actually decides. Cheap to over-select here, expensive to miss.
const AD_CANDIDATE_SELECTOR =
  '[class*="ad" i], [id*="ad" i], [class*="sponsor" i], [id*="sponsor" i], ' +
  '[class*="promot" i], [id*="promot" i], [data-testid*="ad" i], [data-testid*="promot" i], ' +
  '[aria-label*="advertisement" i], [aria-label*="sponsored" i], ' +
  '[data-ad-client], [data-ad-slot], [data-ad-unit], ins, iframe, embed'

// Anything text-bearing small enough to be a badge. Excludes the structural tags a
// whole post card uses, so the walk-up below starts from the label, not the card.
const SPONSORED_LABEL_SELECTOR = 'span, div, p, a, small, em, strong, b, h4, h5, h6, label, li'

const CARD_TAGS = new Set(['article', 'li', 'section'])
const MAX_CARD_WALK_DEPTH = 8
// A container holding this much text is a feed/page region, not a single ad card.
const MAX_CARD_TEXT_LENGTH = 4000

// Three or more same-tag children means `parent` is the list and `child` is one entry —
// so `child` is the whole ad card and climbing any further would take out the feed.
function isFeedContainer(parent: Element, child: Element): boolean {
  return Array.from(parent.children).filter((c) => c.tagName === child.tagName).length >= 3
}

// A "Promoted" badge is a few nodes deep inside the post it labels; hiding just the
// badge would leave the ad itself sitting there. Climb to the post card and stop
// short of the feed that holds it.
function findAdCard(label: Element, primary: Element | null): Element {
  let el: Element = label
  for (let depth = 0; depth < MAX_CARD_WALK_DEPTH; depth++) {
    const parent = el.parentElement
    if (!parent || parent === document.body || parent === document.documentElement) break
    if (parent === primary || parent.tagName.toLowerCase() === 'main') break
    if (isProtectedFromSimplification(parent)) break
    if ((parent.textContent || '').length > MAX_CARD_TEXT_LENGTH) break
    if (isFeedContainer(parent, el)) break
    if (CARD_TAGS.has(parent.tagName.toLowerCase()) || parent.getAttribute('role') === 'article' || isAdLike(parent)) {
      return parent
    }
    el = parent
  }
  return el
}

function collectAdTargets(primary: Element | null): Element[] {
  const targets = new Set<Element>()

  const consider = (el: Element) => {
    if (isProtectedFromSimplification(el)) return
    // The primary content itself is never an ad, and hiding an ancestor of it
    // would blank the page.
    if (primary && (el === primary || el.contains(primary))) return
    if (el === document.body || el === document.documentElement) return
    targets.add(el)
  }

  document.querySelectorAll(AD_CANDIDATE_SELECTOR).forEach((el) => {
    if (isAdLike(el) || isAdNetworkFrame(el)) consider(el)
  })

  document.querySelectorAll(SPONSORED_LABEL_SELECTOR).forEach((el) => {
    if (!isSponsoredLabel(el)) return
    consider(findAdCard(el, primary))
  })

  return pruneNested(Array.from(targets))
}

// Stage 1 of simplification, run by content.ts BEFORE the page is extracted and sent
// to the backend. Everything unambiguous — "Promoted"/"Sponsored" badges, ad-network
// frames, ad-named containers — is resolved locally and instantly: the user sees the
// clutter go immediately instead of waiting on a network round-trip, and extractPage()
// then skips these blocks, so the backend only spends its judgement on the genuinely
// ambiguous rest of the page.
export function prefilterAds(): number {
  injectGlobalStyle()
  const count = hideAds(getPrimaryElement())
  startAdObserver()
  return count
}

function hideAds(primary: Element | null): number {
  const targets = collectAdTargets(primary)
  targets.forEach((el) => {
    saveOriginal(el)
    el.classList.add(AD_HIDDEN_CLASS)
  })
  return targets.length
}

// Feeds stream new promoted posts in as you scroll, so a one-shot sweep only holds
// until the next page of results. Re-runs the sweep on DOM insertions, coalesced to
// one pass per frame. Only childList is observed, so our own class changes can't
// re-trigger it.
let adObserver: MutationObserver | null = null

function startAdObserver(): void {
  if (adObserver) return
  let scheduled = false
  adObserver = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      if (isSimplificationActive()) hideAds(getPrimaryElement())
    })
  })
  adObserver.observe(document.body, { childList: true, subtree: true })
}

function stopAdObserver(): void {
  adObserver?.disconnect()
  adObserver = null
}

// Sticky and fixed need different replacements to stay layout-neutral, and only the
// computed style knows which one this is — so the choice is made here, in JS, rather
// than by one blanket CSS rule.
function unstick(el: Element): void {
  const position = getComputedStyle(el).position
  if (position === 'fixed') el.classList.add(UNSTICK_FIXED_CLASS)
  else if (position === 'sticky') el.classList.add(UNSTICK_STICKY_CLASS)
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
  max-width: 760px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  font-size: calc(1em * var(--distill-text-scale, 1.15)) !important;
  line-height: 1.75 !important;
  float: none !important;
}
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} p,
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS} li {
  /* em, relative to the container's already-scaled font-size above - not an
     independent multiply, or textScale would compound quadratically. */
  margin-bottom: calc(1.1em * var(--distill-spacing, 1)) !important;
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
  filter: blur(calc(var(${BLUR_INTENSITY_PROP}, ${DEFAULT_BLUR_INTENSITY}) * ${MAX_BLUR_PX}px)) grayscale(60%) !important;
  transition: opacity 0.2s ease, filter 0.2s ease !important;
}
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS}:hover {
  opacity: 0.85 !important;
  filter: grayscale(60%) !important;
}
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} input,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} button,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} select,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} textarea,
html[${SIMPLIFIED_ATTR}] .${DEEMPHASIZE_CLASS} a[href] {
  opacity: 1 !important;
  filter: none !important;
}
/* Un-sticking must not change layout. position:static would drop a fixed header into
   normal flow, pushing everything below it down — on a site whose hero sizes itself
   against that header, the hero visibly grows by exactly the header's height.
   absolute/relative stop the element from following the scroll while it keeps the
   exact box it already had: fixed elements stay out of flow, sticky ones keep the
   space flow already reserved for them. */
html[${SIMPLIFIED_ATTR}] .${UNSTICK_FIXED_CLASS} {
  position: absolute !important;
  max-width: 100% !important;
}
html[${SIMPLIFIED_ATTR}] .${UNSTICK_STICKY_CLASS} {
  position: relative !important;
  top: auto !important;
  bottom: auto !important;
}
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS}.${NEUTRAL_COLOR_CLASS},
html[${SIMPLIFIED_ATTR}] .${PRIMARY_CLASS}.${NEUTRAL_COLOR_CLASS} :not(form):not(form *):not(button):not(button *) {
  color: ${NEUTRAL_COLOR} !important;
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
/* Deliberately NOT gated on [${SIMPLIFIED_ATTR}]: the ad pre-filter runs before the
   backend analysis, so this has to bite while the page is still "not simplified yet".
   Swap display:none for filter: blur(6px) + pointer-events:none to keep filtered
   units visible-but-muted instead of gone. */
.${AD_HIDDEN_CLASS} {
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
html[${SIMPLIFIED_ATTR}][${REDUCE_MOTION_ATTR}] *,
html[${SIMPLIFIED_ATTR}][${REDUCE_MOTION_ATTR}] *::before,
html[${SIMPLIFIED_ATTR}][${REDUCE_MOTION_ATTR}] *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
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

export function hiddenAdCount(): number {
  return document.querySelectorAll(`.${AD_HIDDEN_CLASS}`).length
}

export function isSimplificationActive(): boolean {
  return document.documentElement.getAttribute(SIMPLIFIED_ATTR) === 'true'
}

export function applySimplification(): SimplifyResult {
  if (isSimplificationActive()) {
    return {
      primaryFound: !!document.querySelector(`.${PRIMARY_CLASS}`),
      deemphasizedCount: document.querySelectorAll(`.${DEEMPHASIZE_CLASS}`).length,
      adsHidden: document.querySelectorAll(`.${AD_HIDDEN_CLASS}`).length,
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
    unstick(el)
  })

  const adsHidden = hideAds(primary)

  pauseAutoplayMedia()
  injectGlobalStyle()
  ensureRestoreButton()
  document.documentElement.setAttribute(SIMPLIFIED_ATTR, 'true')
  startAdObserver()

  return { primaryFound: !!primary, deemphasizedCount: targets.length, adsHidden }
}

function findByBlockId(blockId: string): Element | null {
  return document.querySelector(`[${FF_ID_ATTR}="${CSS.escape(blockId)}"]`)
}

// Renders the backend's transformation instructions - the backend never sends HTML/CSS/JS,
// only {blockId, action, priority, reason} per block plus page-wide layout numbers, so this
// is the only place that ever turns those instructions into actual DOM changes. Reuses the
// exact same saveOriginal()/class-toggle machinery as the local heuristic, so restoreOriginalPage()
// undoes either path identically.
export function applyBackendActions(actions: BlockAction[], layout: LayoutSettings): SimplifyResult {
  if (isSimplificationActive()) {
    return {
      primaryFound: !!document.querySelector(`.${PRIMARY_CLASS}`),
      deemphasizedCount: document.querySelectorAll(`.${DEEMPHASIZE_CLASS}`).length,
      adsHidden: document.querySelectorAll(`.${AD_HIDDEN_CLASS}`).length,
    }
  }

  let primaryFound = false
  let deemphasizedCount = 0

  actions.forEach((action) => {
    const el = findByBlockId(action.blockId)
    if (!el) return
    saveOriginal(el)

    switch (action.action) {
      case 'emphasize':
        el.classList.add(PRIMARY_CLASS)
        primaryFound = true
        break
      case 'deemphasize':
        el.classList.add(DEEMPHASIZE_CLASS)
        unstick(el)
        deemphasizedCount++
        break
      case 'collapse':
        // Reuses the progressive-reveal "hidden" class - display:none, but still
        // present in the DOM and fully restorable, never deleted.
        el.classList.add(SECTION_HIDDEN_CLASS)
        break
      case 'keep':
      default:
        break
    }
  })

  document.documentElement.style.setProperty('--distill-text-scale', String(layout.textScale))
  document.documentElement.style.setProperty('--distill-spacing', String(layout.spacingMultiplier))
  document.documentElement.toggleAttribute(REDUCE_MOTION_ATTR, layout.reduceMotion)

  // Runs regardless of what the backend returned: ads are a client-side call the
  // extraction can't always see (cross-origin frames, feed units injected after
  // extraction), so this pass is not conditional on any action list.
  const adsHidden = hideAds(document.querySelector(`.${PRIMARY_CLASS}`))

  pauseAutoplayMedia()
  injectGlobalStyle()
  ensureRestoreButton()
  document.documentElement.setAttribute(SIMPLIFIED_ATTR, 'true')
  startAdObserver()

  if (layout.progressiveReveal && primaryFound) {
    enableProgressiveReveal()
  }

  return { primaryFound, deemphasizedCount, adsHidden }
}

function getPrimaryElement(): Element | null {
  return document.querySelector(`.${PRIMARY_CLASS}`)
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
  primary.classList.toggle(NEUTRAL_COLOR_CLASS, enabled)
  return true
}

// --- Live layout preferences ----------------------------------------------
// Reduce motion and increased spacing are user toggles, not analysis results.
// Both are pure CSS switches on <html> (the rules already exist in
// injectGlobalStyle), so they apply instantly to an already-simplified page and
// need no snapshot — restoreOriginalPage() already clears both.
//
// These deliberately win over the backend's suggested `layout` block: an
// explicit toggle is stronger intent than a profile-derived default.

// Matches DEFAULT_PROFILE.spacingMultiplier. The backend's VisualProfile
// constrains spacingMultiplier to 1.0–3.0, so "off" is 1, never 0.
export const INCREASED_SPACING_MULTIPLIER = 1.4
const BASE_SPACING_MULTIPLIER = 1

export interface LayoutPreferences {
  reduceMotion: boolean
  increaseSpacing: boolean
}

export function isReduceMotionOn(): boolean {
  return document.documentElement.hasAttribute(REDUCE_MOTION_ATTR)
}

// Returns false when there is no simplified page to apply to — the caller keeps
// the preference stored and it takes effect on the next simplify.
export function setReduceMotion(enabled: boolean): boolean {
  if (!isSimplificationActive()) return false
  document.documentElement.toggleAttribute(REDUCE_MOTION_ATTR, enabled)
  return true
}

export function isSpacingIncreased(): boolean {
  const raw = document.documentElement.style.getPropertyValue('--distill-spacing')
  return Number.parseFloat(raw) > BASE_SPACING_MULTIPLIER
}

export function setIncreaseSpacing(enabled: boolean): boolean {
  if (!isSimplificationActive()) return false
  document.documentElement.style.setProperty(
    '--distill-spacing',
    String(enabled ? INCREASED_SPACING_MULTIPLIER : BASE_SPACING_MULTIPLIER),
  )
  return true
}

export function applyLayoutPreferences(prefs: LayoutPreferences): void {
  setReduceMotion(prefs.reduceMotion)
  setIncreaseSpacing(prefs.increaseSpacing)
}

// --- Deemphasis blur intensity ---------------------------------------------
// Drives how strongly blurred/"censored" deemphasized (not collapsed) content
// looks. Fed by the sidepanel's Intensity slider (same 0-1 value already sent
// to the backend as simplificationStrength) - one dial controls both how much
// gets collapsed outright and how illegible whatever's merely deemphasized is.

export function getBlurIntensity(): number {
  const raw = document.documentElement.style.getPropertyValue(BLUR_INTENSITY_PROP)
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : DEFAULT_BLUR_INTENSITY
}

// fraction is 0-1, matching SimplifySettings.simplificationStrength.
export function setBlurIntensity(fraction: number): boolean {
  if (!isSimplificationActive()) return false
  document.documentElement.style.setProperty(BLUR_INTENSITY_PROP, String(fraction))
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
    let intro: Element[] = []
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
  stopAdObserver()
  disableProgressiveReveal()
  restoreAllOriginal()
  document.documentElement.removeAttribute(SIMPLIFIED_ATTR)
  document.documentElement.removeAttribute(REDUCE_MOTION_ATTR)
  document.documentElement.style.removeProperty('--distill-text-scale')
  document.documentElement.style.removeProperty('--distill-spacing')
  document.documentElement.style.removeProperty(BLUR_INTENSITY_PROP)
  document.getElementById(STYLE_TAG_ID)?.remove()
  document.getElementById(RESTORE_BTN_ID)?.remove()
}
