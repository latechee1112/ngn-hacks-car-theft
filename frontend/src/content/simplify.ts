import type { BlockAction, LayoutSettings } from '../types/analysis'
import {
  AD_HIDDEN_CLASS,
  DEEMPHASIZE_CLASS,
  isAdLike,
  isAdNetworkFrame,
  isPopupLike,
  isProtectedFromSimplification,
  isSponsoredLabel,
  isStickyOrFixed,
  isVisible,
  SECTION_HIDDEN_CLASS,
  UNSTICK_FIXED_CLASS,
  UNSTICK_STICKY_CLASS,
} from './dom-heuristics'
import { FF_ID_ATTR } from './extract'
import { pruneDetachedOriginals, restoreAllOriginal, saveOriginal } from './originalState'
import { applySiteRules, findSiteRule, HARD_BLUR_CLASS } from './siteRules'

const SIMPLIFIED_ATTR = 'data-distill-simplified'
const REDUCE_MOTION_ATTR = 'data-distill-reduce-motion'
const STYLE_TAG_ID = 'distill-global-style'
const RESTORE_BTN_ID = 'distill-restore-button'
const PRIMARY_CLASS = 'distill-primary-content'
const READING_COLUMN_CLASS = 'distill-reading-column'
const NEUTRAL_COLOR_CLASS = 'distill-neutral-color'
const NEUTRAL_COLOR = '#1a1a1a'
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

// A reading column only helps actual reading. Prose is text-dense with few links per
// character; a feed or results grid is the opposite — thousands of characters that are
// almost all link text, spread across cards. Narrowing the latter to 760px is what
// squeezes a YouTube home page into a strip.
const PROSE_MIN_TEXT = 600
const PROSE_MIN_PARAGRAPHS = 3
const PROSE_MIN_CHARS_PER_LINK = 60

function isProseLike(el: Element): boolean {
  const text = ((el as HTMLElement).innerText || '').length
  if (text < PROSE_MIN_TEXT) return false
  if (el.querySelectorAll('p').length < PROSE_MIN_PARAGRAPHS) return false
  const links = el.querySelectorAll('a[href]').length
  return text / Math.max(links, 1) >= PROSE_MIN_CHARS_PER_LINK
}

// Marks an element as the primary region, and gives it the reading column only if it
// actually reads like an article — and only if the page's site rule (if any) hasn't
// opted out, which is how a hand-tuned page keeps its own layout and gets nothing but
// the blur it asked for.
function markPrimary(el: Element): void {
  el.classList.add(PRIMARY_CLASS)
  if (findSiteRule()?.disableReadingColumn) return
  if (isProseLike(el)) el.classList.add(READING_COLUMN_CLASS)
}

// Prevents nested targets (e.g. an ad div inside an aside) from having opacity applied
// twice — CSS opacity compounds with ancestors, which would make nested targets vanish.
//
// Marks the candidates and asks the DOM which ones have a marked ancestor, rather than
// comparing every pair: the pairwise form is O(n²) contains() calls, and a feed page
// produces hundreds of candidates. closest() walks ancestors instead, so this is
// O(n × depth). The attribute is transient — set and removed inside this function —
// and the ad observer watches childList only, so it cannot retrigger anything.
const NESTING_MARK_ATTR = 'data-distill-nesting-mark'

function pruneNested(elements: Element[]): Element[] {
  elements.forEach((el) => el.setAttribute(NESTING_MARK_ATTR, ''))
  const outermost = elements.filter((el) => !el.parentElement?.closest(`[${NESTING_MARK_ATTR}]`))
  elements.forEach((el) => el.removeAttribute(NESTING_MARK_ATTR))
  return outermost
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

// `roots` scopes the scan. The first pass covers the whole document; rescans driven
// by the observer pass only the subtrees that were actually inserted, which is what
// keeps an infinite feed from re-querying every element on the page as you scroll.
function collectAdTargets(primary: Element | null, roots: Element[] = [document.documentElement]): Element[] {
  const targets = new Set<Element>()

  const consider = (el: Element) => {
    // Already resolved by an earlier pass — the expensive checks below can be skipped.
    if (el.classList.contains(AD_HIDDEN_CLASS) || el.closest(`.${AD_HIDDEN_CLASS}`)) return
    if (isProtectedFromSimplification(el)) return
    // The primary content itself is never an ad, and hiding an ancestor of it
    // would blank the page.
    if (primary && (el === primary || el.contains(primary))) return
    if (el === document.body || el === document.documentElement) return
    targets.add(el)
  }

  const scan = (root: Element, selector: string, handle: (el: Element) => void) => {
    // querySelectorAll skips the root itself, but an inserted node is very often
    // exactly the ad card, so it has to be tested directly.
    if (root.matches(selector)) handle(root)
    root.querySelectorAll(selector).forEach(handle)
  }

  roots.forEach((root) => {
    if (!root.isConnected) return
    scan(root, AD_CANDIDATE_SELECTOR, (el) => {
      if (isAdLike(el) || isAdNetworkFrame(el)) consider(el)
    })
    scan(root, SPONSORED_LABEL_SELECTOR, (el) => {
      if (isSponsoredLabel(el)) consider(findAdCard(el, primary))
    })
  })

  return pruneNested(Array.from(targets))
}

// --- Obvious secondary content -------------------------------------------
// Blurred locally in the same pre-filter pass as ads, for the same reason: a right
// rail of "Top Stories", a nav, a footer, a related-articles module is secondary on
// essentially every page, and waiting for the backend to say so leaves it sharp and
// competing with the article. The backend can still overrule any of it — see the
// emphasize/keep cases in applyBackendActions().

const SECONDARY_SELECTOR =
  'nav, aside, footer, [role="navigation"], [role="complementary"], [role="contentinfo"], ' +
  '[class*="sidebar" i], [id*="sidebar" i], [class*="rail" i], [id*="rail" i], ' +
  '[class*="related" i], [class*="recommend" i], [class*="trending" i], [class*="popular" i], ' +
  '[class*="most-read" i], [class*="top-stories" i], [class*="more-from" i], ' +
  '[class*="newsletter" i], [class*="subscribe" i], [class*="social" i], [class*="share" i], ' +
  '[class*="widget" i], [class*="promo" i]'

// A sidebar is often named nothing useful at all (AccuWeather's is "page-column-2"),
// so shape is the more reliable signal: a column sitting beside a much wider,
// much text-heavier sibling, carrying a handful of links. That is a rail, whatever
// it calls itself.
const SIDEBAR_MAX_WIDTH_RATIO = 0.6
const SIDEBAR_MAX_TEXT_RATIO = 0.5
const SIDEBAR_MIN_LINKS = 3
// Bounds the rect reads on very large documents. Generous — a deep page settles well
// under this — but keeps the pass from ever becoming the slow part of simplification.
const COLUMN_SCAN_BUDGET = 4000

function isSideBySide(a: DOMRect, b: DOMRect): boolean {
  const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  return verticalOverlap > Math.min(a.height, b.height) * 0.5 && horizontalOverlap <= 4
}

function collectSidebarColumns(): Element[] {
  const found: Element[] = []
  const queue: Element[] = [document.body]
  let budget = COLUMN_SCAN_BUDGET

  while (queue.length && budget > 0) {
    const node = queue.shift() as Element
    const children = Array.from(node.children).filter(isVisible)
    budget -= children.length

    if (children.length >= 2 && children.length <= 4) {
      const rects = children.map((c) => c.getBoundingClientRect())
      const texts = children.map((c) => ((c as HTMLElement).innerText || '').length)
      const mainIndex = texts.indexOf(Math.max(...texts))
      children.forEach((child, i) => {
        if (i === mainIndex) return
        if (!isSideBySide(rects[mainIndex], rects[i])) return
        if (rects[i].width > rects[mainIndex].width * SIDEBAR_MAX_WIDTH_RATIO) return
        if (texts[i] > texts[mainIndex] * SIDEBAR_MAX_TEXT_RATIO) return
        if (child.querySelectorAll('a[href]').length < SIDEBAR_MIN_LINKS) return
        found.push(child)
      })
    }

    children.forEach((c) => queue.push(c))
  }

  return found
}

// `spared` holds the blocks the backend explicitly ruled 'keep' or 'emphasize'. This
// pass runs after the backend's, so without that list it would re-blur, on shape alone,
// blocks the model just read the page and decided to keep — the exact precedence the
// emphasize/keep cases exist to establish.
function collectSecondaryTargets(primary: Element | null, spared: Element[] = []): Element[] {
  const targets = new Set<Element>()

  const consider = (el: Element) => {
    if (!isVisible(el)) return
    if (isProtectedFromSimplification(el)) return
    // Never blur the article itself, or anything wrapping it.
    if (primary && (el === primary || el.contains(primary) || primary.contains(el))) return
    if (el === document.body || el === document.documentElement) return
    if (el.closest(`.${AD_HIDDEN_CLASS}`)) return
    // Blurring an ancestor blurs the spared block with it, so overlap in either
    // direction disqualifies the target.
    if (spared.some((keep) => keep === el || keep.contains(el) || el.contains(keep))) return
    targets.add(el)
  }

  document.querySelectorAll(SECONDARY_SELECTOR).forEach(consider)
  collectSidebarColumns().forEach(consider)

  return pruneNested(Array.from(targets))
}

function deemphasizeSecondary(primary: Element | null, spared: Element[] = []): number {
  const targets = collectSecondaryTargets(primary, spared)
  targets.forEach((el) => {
    saveOriginal(el)
    el.classList.add(DEEMPHASIZE_CLASS)
    unstick(el)
  })
  return targets.length
}

// Stage 1 of simplification, run by content.ts BEFORE the page is extracted and sent
// to the backend. Everything unambiguous — "Promoted"/"Sponsored" badges, ad-network
// frames, ad-named containers — is resolved locally and instantly: the user sees the
// clutter go immediately instead of waiting on a network round-trip, and extractPage()
// then skips these blocks, so the backend only spends its judgement on the genuinely
// ambiguous rest of the page.
export interface PrefilterResult {
  adsHidden: number
  deemphasized: number
}

export function prefilterPage(): PrefilterResult {
  injectGlobalStyle()
  // Nothing is marked primary yet (the backend hasn't answered), so the local
  // article detector supplies the "don't touch this" region for both passes.
  const primary = findPrimaryContent()
  const adsHidden = hideAds(primary)
  // On a hand-tuned page, no blur at all during the loading phase: the guessed
  // pre-filter blur would land first, then get corrected a second or two later when
  // the analysis returns, and what the user sees is the page flickering between two
  // different blurs. Deferring it means the page sits sharp while the scan runs and
  // blurs once, in its final state. Ads still go immediately — that's a removal, not
  // a blur, and nothing later revises it.
  const deemphasized = findSiteRule() ? 0 : deemphasizeSecondary(primary)
  startAdObserver()
  return { adsHidden, deemphasized }
}

function hideAds(primary: Element | null, roots?: Element[]): number {
  const targets = collectAdTargets(primary, roots)
  targets.forEach((el) => {
    saveOriginal(el)
    el.classList.add(AD_HIDDEN_CLASS)
  })
  return targets.length
}

// Feeds stream new promoted posts in as you scroll, so a one-shot sweep only holds
// until the next page of results.
//
// Two things keep the rescan off the scroll path. It is debounced on idle rather than
// run per frame — a feed mutates continuously while scrolling, and a per-frame
// full-document sweep is felt as jank. And it scans only the subtrees that were
// actually inserted, not the whole page. Only childList is observed, so our own class
// changes can't re-trigger it.
const AD_RESCAN_DEBOUNCE_MS = 250
let adObserver: MutationObserver | null = null
let rescanTimer = 0
let pendingRoots: Element[] = []

function startAdObserver(): void {
  if (adObserver) return

  adObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) pendingRoots.push(node as Element)
      })
    })
    if (!pendingRoots.length) return

    window.clearTimeout(rescanTimer)
    rescanTimer = window.setTimeout(() => {
      const roots = pendingRoots
      pendingRoots = []
      hideAds(getPrimaryElement(), roots)
      // Feeds recycle nodes aggressively; without this the snapshot map would
      // hold every card the feed ever rendered.
      pruneDetachedOriginals()
    }, AD_RESCAN_DEBOUNCE_MS)
  })

  adObserver.observe(document.body, { childList: true, subtree: true })
}

function stopAdObserver(): void {
  adObserver?.disconnect()
  adObserver = null
  window.clearTimeout(rescanTimer)
  pendingRoots = []
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
/* The narrow reading column is applied via its own class, NOT to every primary
   region: on a card grid (a YouTube feed, a search results page) forcing 760px
   and a larger font squeezes the grid into a narrow strip in the middle of an
   otherwise empty page. isProseLike() decides who gets this. */
html[${SIMPLIFIED_ATTR}] .${READING_COLUMN_CLASS} {
  max-width: 760px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  font-size: calc(1em * var(--distill-text-scale, 1.15)) !important;
  line-height: 1.75 !important;
  float: none !important;
}
html[${SIMPLIFIED_ATTR}] .${READING_COLUMN_CLASS} p,
html[${SIMPLIFIED_ATTR}] .${READING_COLUMN_CLASS} li {
  /* em, relative to the container's already-scaled font-size above - not an
     independent multiply, or textScale would compound quadratically. */
  margin-bottom: calc(1.1em * var(--distill-spacing, 1)) !important;
  font-size: 1.05em !important;
}
html[${SIMPLIFIED_ATTR}] .${READING_COLUMN_CLASS} h1,
html[${SIMPLIFIED_ATTR}] .${READING_COLUMN_CLASS} h2,
html[${SIMPLIFIED_ATTR}] .${READING_COLUMN_CLASS} h3 {
  margin-top: 1.4em !important;
  margin-bottom: 0.6em !important;
}
/* Like the ad rule, deliberately not gated on [${SIMPLIFIED_ATTR}]: the local
   pre-filter blurs obvious secondary content before the backend answers, which is
   before that attribute is set. The classes are only ever added by us and are
   cleared on restore, so the gate bought nothing. */
.${DEEMPHASIZE_CLASS} {
  opacity: 0.4 !important;
  filter: blur(calc(var(${BLUR_INTENSITY_PROP}, ${DEFAULT_BLUR_INTENSITY}) * ${MAX_BLUR_PX}px)) grayscale(60%) !important;
  transition: opacity 0.2s ease, filter 0.2s ease !important;
}
.${DEEMPHASIZE_CLASS}:hover {
  opacity: 0.85 !important;
  filter: grayscale(60%) !important;
}
.${DEEMPHASIZE_CLASS} input,
.${DEEMPHASIZE_CLASS} button,
.${DEEMPHASIZE_CLASS} select,
.${DEEMPHASIZE_CLASS} textarea,
.${DEEMPHASIZE_CLASS} a[href] {
  opacity: 1 !important;
  filter: none !important;
}
/* Hand-tuned per-site targets (siteRules.ts). Unlike .${DEEMPHASIZE_CLASS}, this does
   NOT exempt nested links/buttons — every one of these targets (Like button, team
   member links, tab links) is interactive, and blurring social proof only works if it
   covers those too. Hover still reveals, so nothing becomes unreachable, and
   pointer-events stay on so the revealed control is clickable. */
.${HARD_BLUR_CLASS},
.${HARD_BLUR_CLASS} a[href],
.${HARD_BLUR_CLASS} button,
.${HARD_BLUR_CLASS} img {
  filter: blur(calc(var(${BLUR_INTENSITY_PROP}, ${DEFAULT_BLUR_INTENSITY}) * ${MAX_BLUR_PX}px)) grayscale(60%) !important;
  transition: filter 0.2s ease, opacity 0.2s ease !important;
}
.${HARD_BLUR_CLASS} {
  opacity: 0.5 !important;
}
.${HARD_BLUR_CLASS}:hover,
.${HARD_BLUR_CLASS}:focus-within,
.${HARD_BLUR_CLASS}:hover a[href],
.${HARD_BLUR_CLASS}:focus-within a[href],
.${HARD_BLUR_CLASS}:hover button,
.${HARD_BLUR_CLASS}:focus-within button,
.${HARD_BLUR_CLASS}:hover img,
.${HARD_BLUR_CLASS}:focus-within img {
  filter: none !important;
  opacity: 1 !important;
}
/* Un-sticking must not change layout. position:static would drop a fixed header into
   normal flow, pushing everything below it down — on a site whose hero sizes itself
   against that header, the hero visibly grows by exactly the header's height.
   absolute/relative stop the element from following the scroll while it keeps the
   exact box it already had: fixed elements stay out of flow, sticky ones keep the
   space flow already reserved for them. */
.${UNSTICK_FIXED_CLASS} {
  position: absolute !important;
  max-width: 100% !important;
}
.${UNSTICK_STICKY_CLASS} {
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
    markPrimary(primary)
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
  // The only place the hand-tuned blur is applied: after the analysis, so the page
  // never flickers mid-load, and last, so a backend 'keep'/'emphasize' on a block
  // that overlaps a hand-tuned region can't un-blur it — a hardcoded rule is a
  // deliberate choice and outranks any inference.
  applySiteRules()
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
      // emphasize/keep also clear any blur the local pre-filter put on this block:
      // the pre-filter guesses from shape alone, the backend actually read the page,
      // so where they disagree the backend wins.
      case 'emphasize':
        el.classList.remove(DEEMPHASIZE_CLASS)
        markPrimary(el)
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
        el.classList.remove(DEEMPHASIZE_CLASS)
        break
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
  // The only place the hand-tuned blur is applied: after the analysis, so the page
  // never flickers mid-load, and last, so a backend 'keep'/'emphasize' on a block
  // that overlaps a hand-tuned region can't un-blur it — a hardcoded rule is a
  // deliberate choice and outranks any inference.
  applySiteRules()
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
