export const AD_PATTERN = /(^|[-_ ])ad([-_ ]|$)|advert|sponsor|adsbygoogle/i
export const POPUP_PATTERN = /modal|popup|overlay|lightbox/i
export const SIDEBAR_PATTERN = /sidebar/i
export const CONSENT_CLASS_PATTERN = /cookie|consent|gdpr/i
export const CONSENT_TEXT_PATTERN = /cookie|consent|gdpr|privacy preference/i
export const CONSENT_ACTION_PATTERN =
  /accept(?:\s+all)?|reject(?:\s+all)?|decline|allow all|manage (?:cookie|preference)|cookie setting|got it|i agree|^agree$/i
export const WARNING_PATTERN = /warning|error|alert/i
export const PAYMENT_FIELD_PATTERN = /card.?number|cvv|cvc|expir|credit.?card/i

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

function isInteractiveish(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return true
  const role = el.getAttribute('role')
  return !!role && ['button', 'link'].includes(role)
}

// Just the accept/reject/manage action wording — real banner buttons ("Accept", "Reject
// All", "Manage preferences") virtually never restate "cookie"/"consent" in the button's
// own text, so this stays intentionally topic-agnostic. Used as a sub-check by
// isConsentBannerLike, which supplies the surrounding topic context itself.
function hasConsentActionWording(el: Element): boolean {
  if (!isInteractiveish(el)) return false
  const hay = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`
  return CONSENT_ACTION_PATTERN.test(hay)
}

// A single control (button/link) that is self-sufficient evidence of being a cookie/
// consent action on its own — both the action wording AND the cookie/consent topic are
// present together, e.g. "Accept All Cookies" or a button classed "cookie-accept-btn".
// Stricter than hasConsentActionWording on purpose: without banner context, a bare
// "Accept"/"Agree" button is just as likely to belong to a ToS modal or newsletter signup.
export function isConsentControlLike(el: Element): boolean {
  if (!hasConsentActionWording(el)) return false
  const hay = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`
  return CONSENT_TEXT_PATTERN.test(hay) || CONSENT_CLASS_PATTERN.test(classNameString(el))
}

// A container that IS (or wraps) a cookie/consent notice — the shape that gets caught
// by generic "sticky/fixed chrome" sweeps and must be excluded from them. Matches on
// class/id naming, dialog role + consent-flavored aria-label, or consent-flavored banner
// text paired with a nested accept/reject/manage button (the button need not itself repeat
// "cookie"/"consent" — the banner's own text already establishes the topic).
export function isConsentBannerLike(el: Element): boolean {
  const cls = classNameString(el)
  if (CONSENT_CLASS_PATTERN.test(cls)) return true

  const role = el.getAttribute('role')
  const ariaLabel = el.getAttribute('aria-label') || ''
  if ((role === 'dialog' || role === 'alertdialog') && CONSENT_TEXT_PATTERN.test(ariaLabel)) return true

  const text = el.textContent || ''
  if (!CONSENT_TEXT_PATTERN.test(text) && !CONSENT_TEXT_PATTERN.test(ariaLabel)) return false
  return Array.from(el.querySelectorAll('button, a, [role="button"]')).some(hasConsentActionWording)
}

// role=alert / aria-live=assertive / warning-flavored class naming — form validation
// errors, safety warnings, etc.
export function isWarningLike(el: Element): boolean {
  const role = el.getAttribute('role')
  if (role === 'alert' || role === 'alertdialog') return true
  if (el.getAttribute('aria-live') === 'assertive') return true
  return WARNING_PATTERN.test(classNameString(el))
}

// A password or payment field anywhere inside the element — safety-critical per the
// backend's is_safety_critical() contract, so containers holding one must never collapse.
export function containsSensitiveField(el: Element): boolean {
  if (el.querySelector('input[type="password"]')) return true
  const fields = el.querySelectorAll('input, select, textarea')
  for (const field of Array.from(fields)) {
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

const PROTECTED_DESCENDANT_SELECTOR =
  '[class*="cookie" i], [class*="consent" i], [class*="gdpr" i], ' +
  '[role="dialog"], [role="alertdialog"], [role="alert"], [aria-live="assertive"]'

// Safety-critical per the backend's is_safety_critical()/is_protected_from_collapse()
// contract: consent banners, warnings, and anything holding a password/payment field
// must never be dimmed, hidden, or collapsed by simplification. Also true if a protected
// element is merely nested inside — dimming an ancestor's opacity dims its children too,
// so a container wrapping a cookie banner is just as unsafe to target as the banner itself.
export function isProtectedFromSimplification(el: Element): boolean {
  if (isConsentBannerLike(el) || isConsentControlLike(el) || isWarningLike(el) || containsSensitiveField(el)) {
    return true
  }
  return !!el.querySelector(PROTECTED_DESCENDANT_SELECTOR)
}
