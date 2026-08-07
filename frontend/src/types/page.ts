// Wire contract with the backend's PageBlock/BoundingBox models
// (backend/models/common.py). Field names and shape must match exactly —
// the backend is the source of truth; this file follows it, not vice versa.

export type ElementType =
  | 'heading'
  | 'paragraph'
  | 'article'
  | 'section'
  | 'nav'
  | 'sidebar'
  | 'ad'
  | 'form'
  | 'input'
  | 'button'
  | 'image'
  | 'video'
  | 'popup'
  | 'sticky'
  | 'link-group'
  | 'other'

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

// Load-bearing classification/safety signals (e.g. isConsentControl caught the
// consent-banner-hiding bug) — grouped here but every flag must still be set
// exactly as before, just nested.
export interface SafetyFlags {
  isFormControl: boolean
  isFormInstruction: boolean
  isPasswordField: boolean
  isPaymentField: boolean
  isConsentControl: boolean
  isWarning: boolean
  isAd: boolean
  isRepeatedLink: boolean
}

export interface PageBlock {
  id: string
  tag: string
  role?: string
  textPreview: string
  elementType: ElementType
  isInteractive: boolean
  isFixed: boolean
  hasAnimation: boolean
  linkCount: number
  boundingBox?: BoundingBox
  safetyFlags: SafetyFlags
  visible: boolean
}

export interface ExtractionResult {
  url: string
  extractedAt: number
  blocks: PageBlock[]
  hasSensitiveForms: boolean
}
