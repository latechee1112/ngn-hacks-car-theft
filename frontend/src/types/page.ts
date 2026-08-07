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

export interface PageBlockPosition {
  x: number
  y: number
  width: number
  height: number
}

export interface PageBlock {
  id: string
  tag: string
  role: string
  textPreview: string
  elementType: ElementType
  position: PageBlockPosition
  isInteractive: boolean
  isFixed: boolean
  hasAnimation: boolean
  linkCount: number
}

export interface ExtractionResult {
  url: string
  extractedAt: number
  blocks: PageBlock[]
  hasSensitiveForms: boolean
}
