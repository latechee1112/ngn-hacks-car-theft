import { isAdLike, isPopupLike, isStickyOrFixed, isVisible } from './dom-heuristics'
import { restoreAllOriginal, saveOriginal } from './originalState'

const SIMPLIFIED_ATTR = 'data-focusfit-simplified'
const STYLE_TAG_ID = 'focusfit-global-style'
const RESTORE_BTN_ID = 'focusfit-restore-button'
const PRIMARY_CLASS = 'focusfit-primary-content'
const DEEMPHASIZE_CLASS = 'focusfit-deemphasize'
const UNSTICK_CLASS = 'focusfit-unstick'

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
    if (isAdLike(el) || isPopupLike(el) || ['nav', 'aside', 'footer'].includes(el.tagName.toLowerCase())) {
      targets.add(el)
      return
    }
    const role = el.getAttribute('role')
    if (role === 'navigation' || role === 'complementary' || role === 'contentinfo') targets.add(el)
  })

  // Sticky/fixed chrome (cookie banners, sticky headers) often isn't caught by the
  // selector above, so do a bounded pass over top-level containers by computed style.
  document.querySelectorAll('body > *, header, div, section').forEach((el) => {
    if (targets.has(el)) return
    if (primary && (primary === el || primary.contains(el))) return
    if (!isVisible(el)) return
    if (isStickyOrFixed(el)) targets.add(el)
  })

  return pruneNested(Array.from(targets))
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
  position: static !important;
}
#${RESTORE_BTN_ID} {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483647;
  background: #1a1a1a;
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 10px 18px;
  font: 600 13px system-ui, sans-serif;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}
#${RESTORE_BTN_ID}:hover {
  opacity: 0.9;
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
    if (isStickyOrFixed(el)) el.classList.add(UNSTICK_CLASS)
  })

  pauseAutoplayMedia()
  injectGlobalStyle()
  ensureRestoreButton()
  document.documentElement.setAttribute(SIMPLIFIED_ATTR, 'true')

  return { primaryFound: !!primary, deemphasizedCount: targets.length }
}

export function restoreOriginalPage(): void {
  restoreAllOriginal()
  document.documentElement.removeAttribute(SIMPLIFIED_ATTR)
  document.getElementById(STYLE_TAG_ID)?.remove()
  document.getElementById(RESTORE_BTN_ID)?.remove()
}
