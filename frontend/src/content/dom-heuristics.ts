export const AD_PATTERN = /(^|[-_ ])ad([-_ ]|$)|advert|sponsor|adsbygoogle/i
export const POPUP_PATTERN = /modal|popup|overlay|lightbox/i
export const SIDEBAR_PATTERN = /sidebar/i

export function classNameString(el: Element): string {
  const raw = typeof el.className === 'string' ? el.className : ''
  return `${raw} ${el.id || ''}`
}

export function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement
  if (htmlEl.hidden) return false
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const cs = getComputedStyle(el)
  return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
}

export function isAdLike(el: Element): boolean {
  const cls = classNameString(el)
  return AD_PATTERN.test(cls) || (el.tagName.toLowerCase() === 'ins' && cls.includes('adsbygoogle'))
}

export function isPopupLike(el: Element): boolean {
  const cls = classNameString(el)
  return POPUP_PATTERN.test(cls) || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true'
}

export function isSidebarLike(el: Element): boolean {
  const cls = classNameString(el)
  return el.tagName.toLowerCase() === 'aside' || SIDEBAR_PATTERN.test(cls) || el.getAttribute('role') === 'complementary'
}

export function isStickyOrFixed(el: Element): boolean {
  const position = getComputedStyle(el).position
  return position === 'fixed' || position === 'sticky'
}
