import type { BoundingBox, ExtractionResult, Landmark, PageBlock } from '../types/page'
import {
  isAdLike,
  isConsentControlLike,
  isPopupLike,
  isSidebarLike,
  isStickyOrFixed,
  isVisible,
  isWarningLike,
  PAYMENT_FIELD_PATTERN,
} from './dom-heuristics'

export const FF_ID_ATTR = 'data-distill-id'

const TEXT_MAX = 300
const LINK_GROUP_MIN_LINKS = 4

// Broad net of tags/attributes worth inspecting. isExtractable() does the real filtering.
const CANDIDATE_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'main', 'article', 'section', 'nav', 'aside', 'header', 'footer',
  'form', 'label', 'input', 'select', 'textarea', 'button', 'dialog',
  'img', 'picture', 'svg', 'video', 'iframe',
  '[role]',
  '[class*="ad" i]', '[id*="ad" i]',
  '[class*="modal" i]', '[id*="modal" i]',
  '[class*="popup" i]', '[id*="popup" i]',
  '[class*="overlay" i]',
  '[class*="sidebar" i]', '[id*="sidebar" i]',
].join(',')

const VIDEO_EMBED_PATTERN = /youtube|vimeo|player/i

function isExtractable(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (isPopupLike(el)) return true
  if (isAdLike(el)) return true
  if (isSidebarLike(el)) return true
  if (isStickyOrFixed(el)) return true
  if (
    [
      'nav', 'aside', 'article', 'section', 'header', 'footer', 'main',
      'form', 'dialog', 'label', 'input', 'select', 'textarea', 'button',
      'img', 'picture', 'svg', 'video', 'iframe', 'p',
    ].includes(tag)
  ) {
    return true
  }
  return /^h[1-6]$/.test(tag)
}

function findLinkGroups(): Element[] {
  const counts = new Map<Element, number>()
  document.querySelectorAll('a[href]').forEach((a) => {
    const parent = a.parentElement
    if (!parent) return
    counts.set(parent, (counts.get(parent) || 0) + 1)
  })
  const groups: Element[] = []
  counts.forEach((count, parent) => {
    if (count >= LINK_GROUP_MIN_LINKS && !parent.closest('nav')) {
      groups.push(parent)
    }
  })
  return groups
}

function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const implicit: Record<string, string> = {
    nav: 'navigation',
    header: 'banner',
    footer: 'contentinfo',
    main: 'main',
    aside: 'complementary',
    button: 'button',
    form: 'form',
    img: 'img',
  }
  return implicit[el.tagName.toLowerCase()] || el.tagName.toLowerCase()
}

// Maps to the backend's landmark vocabulary: main, article, nav, aside,
// header, footer, form, dialog, other. Non-landmark elements get undefined
// rather than "other" so the field is only set when it's actually meaningful.
function landmarkOf(el: Element): Landmark | undefined {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role')
  if (tag === 'main' || role === 'main') return 'main'
  if (tag === 'article') return 'article'
  if (tag === 'nav' || role === 'navigation') return 'nav'
  if (tag === 'aside' || role === 'complementary') return 'aside'
  if (tag === 'header' || role === 'banner') return 'header'
  if (tag === 'footer' || role === 'contentinfo') return 'footer'
  if (tag === 'form' || role === 'form') return 'form'
  if (tag === 'dialog' || role === 'dialog' || el.getAttribute('aria-modal') === 'true') return 'dialog'
  return undefined
}

function isInteractiveOf(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) return true
  const role = el.getAttribute('role')
  if (role && ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch'].includes(role)) return true
  if (el.hasAttribute('onclick')) return true
  const tabIndex = (el as HTMLElement).tabIndex
  if (tabIndex !== undefined && tabIndex >= 0) return true
  return getComputedStyle(el).cursor === 'pointer'
}

function isFormControlOf(el: Element): boolean {
  return ['input', 'select', 'textarea'].includes(el.tagName.toLowerCase())
}

function isFormInstructionOf(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'label' || tag === 'legend') return true
  if (!el.closest('form')) return false
  return tag === 'p' || tag === 'small'
}

function isPasswordFieldOf(el: Element): boolean {
  return el.tagName.toLowerCase() === 'input' && (el as HTMLInputElement).type === 'password'
}

function isPaymentFieldOf(el: Element): boolean {
  if (!isFormControlOf(el)) return false
  const autocomplete = el.getAttribute('autocomplete') || ''
  if (autocomplete.startsWith('cc-')) return true
  const hay = [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
  ]
    .filter(Boolean)
    .join(' ')
  return PAYMENT_FIELD_PATTERN.test(hay)
}

function isAutoplayMediaOf(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if ((tag === 'video' || tag === 'audio') && (el as HTMLMediaElement).autoplay) return true
  if (tag === 'iframe') {
    const src = el.getAttribute('src') || ''
    return VIDEO_EMBED_PATTERN.test(src) && /autoplay=1/i.test(src)
  }
  return false
}

// Viewport-relative fractions (0-1), matching the backend's BoundingBox contract —
// getBoundingClientRect() is already viewport-relative, so no scroll offset is added.
// Clamped because elements partially or fully outside the viewport otherwise produce
// values <0 or >1, which the backend rejects outright.
function boundingBoxOf(el: Element): BoundingBox {
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth || document.documentElement.clientWidth || 1
  const vh = window.innerHeight || document.documentElement.clientHeight || 1
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  return {
    x: clamp(rect.left / vw),
    y: clamp(rect.top / vh),
    width: clamp(rect.width / vw),
    height: clamp(rect.height / vh),
  }
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > TEXT_MAX ? `${collapsed.slice(0, TEXT_MAX)}…` : collapsed
}

function getAssociatedLabelText(el: Element): string {
  const id = el.id
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`)
    if (label) return label.textContent || ''
  }
  const closestLabel = el.closest('label')
  return closestLabel?.textContent || ''
}

// Never reads .value — only label/placeholder/aria text, so field contents (passwords,
// payment numbers, any user input) never leave the page.
function textOf(el: Element): string {
  if (isFormControlOf(el)) {
    const label = getAssociatedLabelText(el) || el.getAttribute('placeholder') || el.getAttribute('aria-label') || ''
    return truncate(label)
  }
  const text = (el as HTMLElement).innerText ?? el.textContent ?? ''
  return truncate(text)
}

function detectSensitiveForms(): boolean {
  if (document.querySelector('input[type="password"]')) return true
  const fields = document.querySelectorAll('input, select, textarea')
  for (const field of fields) {
    const autocomplete = field.getAttribute('autocomplete') || ''
    if (autocomplete.startsWith('cc-')) return true
    const hay = [
      field.getAttribute('name'),
      field.getAttribute('id'),
      field.getAttribute('placeholder'),
      field.getAttribute('aria-label'),
    ]
      .filter(Boolean)
      .join(' ')
    if (PAYMENT_FIELD_PATTERN.test(hay)) return true
  }
  return false
}

function nextIdCounter(): number {
  let max = 0
  document.querySelectorAll(`[${FF_ID_ATTR}]`).forEach((el) => {
    const match = el.getAttribute(FF_ID_ATTR)?.match(/^ff-(\d+)$/)
    if (match) max = Math.max(max, parseInt(match[1], 10))
  })
  return max + 1
}

function buildBlock(el: Element, counter: { n: number }, opts: { repeatedLink?: boolean } = {}): PageBlock {
  let id = el.getAttribute(FF_ID_ATTR)
  if (!id) {
    id = `ff-${counter.n++}`
    el.setAttribute(FF_ID_ATTR, id)
  }
  return {
    blockId: id,
    tag: el.tagName.toLowerCase(),
    landmark: landmarkOf(el),
    role: roleOf(el),
    text: textOf(el),
    isInteractive: isInteractiveOf(el),
    isFormControl: isFormControlOf(el),
    isFormInstruction: isFormInstructionOf(el),
    isPasswordField: isPasswordFieldOf(el),
    isPaymentField: isPaymentFieldOf(el),
    isConsentControl: isConsentControlLike(el),
    isWarning: isWarningLike(el),
    isAd: isAdLike(el),
    isStickyPromo: isStickyOrFixed(el) || isPopupLike(el),
    isAutoplayMedia: isAutoplayMediaOf(el),
    isRepeatedLink: !!opts.repeatedLink,
    visible: true,
    boundingBox: boundingBoxOf(el),
  }
}

export function extractPage(): ExtractionResult {
  const seen = new Set<Element>()
  const blocks: PageBlock[] = []
  const counter = { n: nextIdCounter() }

  document.querySelectorAll(CANDIDATE_SELECTOR).forEach((el) => {
    if (seen.has(el) || !isVisible(el) || !isExtractable(el)) return
    seen.add(el)
    blocks.push(buildBlock(el, counter))
  })

  findLinkGroups().forEach((el) => {
    if (seen.has(el) || !isVisible(el)) return
    seen.add(el)
    blocks.push(buildBlock(el, counter, { repeatedLink: true }))
  })

  return {
    url: window.location.href,
    extractedAt: Date.now(),
    blocks,
    hasSensitiveForms: detectSensitiveForms(),
  }
}
