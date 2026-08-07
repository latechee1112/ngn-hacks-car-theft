import type { ElementType, ExtractionResult, PageBlock, PageBlockPosition } from '../types/page'
import { isAdLike, isPopupLike, isSidebarLike, isVisible } from './dom-heuristics'

export const FF_ID_ATTR = 'data-distill-id'

const TEXT_PREVIEW_MAX = 300
const LINK_GROUP_MIN_LINKS = 4

// Broad net of tags/attributes worth inspecting. categorize() does the real filtering.
const CANDIDATE_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'article', 'section', 'nav', 'aside', 'header', 'footer',
  'form', 'input', 'select', 'textarea', 'button',
  'img', 'picture', 'svg', 'video', 'iframe',
  '[role]',
  '[class*="ad" i]', '[id*="ad" i]',
  '[class*="modal" i]', '[id*="modal" i]',
  '[class*="popup" i]', '[id*="popup" i]',
  '[class*="overlay" i]',
  '[class*="sidebar" i]', '[id*="sidebar" i]',
].join(',')

const VIDEO_EMBED_PATTERN = /youtube|vimeo|player/i
const PAYMENT_FIELD_PATTERN = /card.?number|cvv|cvc|expir|credit.?card/i

function categorize(el: Element): ElementType | null {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role')

  if (isPopupLike(el)) return 'popup'
  if (isAdLike(el)) return 'ad'
  if (tag === 'nav' || role === 'navigation') return 'nav'
  if (isSidebarLike(el)) return 'sidebar'
  if (tag === 'article') return 'article'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'form') return 'form'
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return 'input'
  if (
    tag === 'button' ||
    role === 'button' ||
    (tag === 'input' && ['submit', 'button'].includes((el as HTMLInputElement).type))
  ) {
    return 'button'
  }
  if (tag === 'video' || (tag === 'iframe' && VIDEO_EMBED_PATTERN.test(el.getAttribute('src') || ''))) return 'video'
  if (tag === 'img' || tag === 'picture' || tag === 'svg') return 'image'
  if (tag === 'p') return 'paragraph'
  if (tag === 'section') return 'section'

  const cs = getComputedStyle(el)
  if (cs.position === 'fixed' || cs.position === 'sticky') return 'sticky'

  return null
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

function isFixedOf(el: Element): boolean {
  const position = getComputedStyle(el).position
  return position === 'fixed' || position === 'sticky'
}

function hasAnimationOf(el: Element): boolean {
  const cs = getComputedStyle(el)
  if (cs.animationName !== 'none') return true
  return cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0)
}

function positionOf(el: Element): PageBlockPosition {
  const rect = el.getBoundingClientRect()
  return {
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top + window.scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > TEXT_PREVIEW_MAX ? `${collapsed.slice(0, TEXT_PREVIEW_MAX)}…` : collapsed
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
function textPreviewOf(el: Element, elementType: ElementType): string {
  if (elementType === 'input') {
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

function buildBlock(el: Element, elementType: ElementType, counter: { n: number }): PageBlock {
  let id = el.getAttribute(FF_ID_ATTR)
  if (!id) {
    id = `ff-${counter.n++}`
    el.setAttribute(FF_ID_ATTR, id)
  }
  return {
    id,
    tag: el.tagName.toLowerCase(),
    role: roleOf(el),
    textPreview: textPreviewOf(el, elementType),
    elementType,
    position: positionOf(el),
    isInteractive: isInteractiveOf(el),
    isFixed: isFixedOf(el),
    hasAnimation: hasAnimationOf(el),
    linkCount: el.querySelectorAll('a').length,
  }
}

export function extractPage(): ExtractionResult {
  const seen = new Set<Element>()
  const blocks: PageBlock[] = []
  const counter = { n: nextIdCounter() }

  document.querySelectorAll(CANDIDATE_SELECTOR).forEach((el) => {
    if (seen.has(el) || !isVisible(el)) return
    const elementType = categorize(el)
    if (!elementType) return
    seen.add(el)
    blocks.push(buildBlock(el, elementType, counter))
  })

  findLinkGroups().forEach((el) => {
    if (seen.has(el) || !isVisible(el)) return
    seen.add(el)
    blocks.push(buildBlock(el, 'link-group', counter))
  })

  return {
    url: window.location.href,
    extractedAt: Date.now(),
    blocks,
    hasSensitiveForms: detectSensitiveForms(),
  }
}
