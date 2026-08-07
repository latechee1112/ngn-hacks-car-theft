import type { BoundingBox, ElementType, ExtractionResult, PageBlock } from '../types/page'
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

function findLinkGroups(): { el: Element; count: number }[] {
  const counts = new Map<Element, number>()
  document.querySelectorAll('a[href]').forEach((a) => {
    const parent = a.parentElement
    if (!parent) return
    counts.set(parent, (counts.get(parent) || 0) + 1)
  })
  const groups: { el: Element; count: number }[] = []
  counts.forEach((count, parent) => {
    if (count >= LINK_GROUP_MIN_LINKS && !parent.closest('nav')) {
      groups.push({ el: parent, count })
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

// Maps our DOM classification onto the backend's ElementType enum
// (backend/models/common.py::ElementType). The old `landmark` vocabulary
// (main/article/nav/aside/header/footer/form/dialog/other) and the boolean
// flags were never mutually exclusive, but elementType is a single value, so
// this imposes a priority order where more than one classification applies.
// Tags with no clean enum equivalent (header, footer, main, label, legend,
// and generic non-video iframes) fall through to 'other' — flagged as guesses,
// see task summary.
function elementTypeOf(el: Element, opts: { isLinkGroup?: boolean } = {}): ElementType {
  if (opts.isLinkGroup) return 'link-group'
  const tag = el.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (isPopupLike(el) || tag === 'dialog') return 'popup'
  if (isAdLike(el)) return 'ad'
  if (isStickyOrFixed(el)) return 'sticky'
  if (tag === 'form') return 'form'
  if (['input', 'select', 'textarea'].includes(tag)) return 'input'
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'button'
  if (['img', 'picture', 'svg'].includes(tag)) return 'image'
  if (tag === 'video') return 'video'
  if (tag === 'iframe') return isAutoplayMediaOf(el) ? 'video' : 'other'
  if (tag === 'article') return 'article'
  if (tag === 'section') return 'section'
  if (tag === 'nav') return 'nav'
  if (tag === 'aside' || isSidebarLike(el)) return 'sidebar'
  if (tag === 'p') return 'paragraph'
  return 'other'
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

function buildBlock(
  el: Element,
  counter: { n: number },
  opts: { repeatedLink?: boolean; linkCount?: number } = {},
): PageBlock {
  let id = el.getAttribute(FF_ID_ATTR)
  if (!id) {
    id = `ff-${counter.n++}`
    el.setAttribute(FF_ID_ATTR, id)
  }
  return {
    id,
    tag: el.tagName.toLowerCase(),
    role: roleOf(el),
    textPreview: textOf(el),
    elementType: elementTypeOf(el, { isLinkGroup: !!opts.repeatedLink }),
    isInteractive: isInteractiveOf(el),
    isFixed: isStickyOrFixed(el),
    hasAnimation: false,
    linkCount: opts.linkCount ?? 0,
    boundingBox: boundingBoxOf(el),
    safetyFlags: {
      isFormControl: isFormControlOf(el),
      isFormInstruction: isFormInstructionOf(el),
      isPasswordField: isPasswordFieldOf(el),
      isPaymentField: isPaymentFieldOf(el),
      isConsentControl: isConsentControlLike(el),
      isWarning: isWarningLike(el),
      isAd: isAdLike(el),
      isRepeatedLink: !!opts.repeatedLink,
    },
    visible: true,
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

  findLinkGroups().forEach(({ el, count }) => {
    if (seen.has(el) || !isVisible(el)) return
    seen.add(el)
    blocks.push(buildBlock(el, counter, { repeatedLink: true, linkCount: count }))
  })

  return {
    url: window.location.href,
    extractedAt: Date.now(),
    blocks,
    hasSensitiveForms: detectSensitiveForms(),
  }
}
