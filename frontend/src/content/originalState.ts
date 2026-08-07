// Snapshots className/inline-style before FocusFit touches an element, so any transform
// (local rules here, or backend TransformationActions later) can be undone exactly.
// Nodes are never removed — only class/style are ever mutated — so restoring these two
// values is always sufficient to put the page back exactly as it was.

interface OriginalSnapshot {
  className: string
  style: string
}

const originalMap = new Map<Element, OriginalSnapshot>()

export function saveOriginal(el: Element): void {
  if (originalMap.has(el)) return
  const htmlEl = el as HTMLElement
  originalMap.set(el, {
    className: htmlEl.className,
    style: htmlEl.getAttribute('style') || '',
  })
}

export function restoreAllOriginal(): void {
  originalMap.forEach((snapshot, el) => {
    const htmlEl = el as HTMLElement
    htmlEl.className = snapshot.className
    if (snapshot.style) {
      htmlEl.setAttribute('style', snapshot.style)
    } else {
      htmlEl.removeAttribute('style')
    }
  })
  originalMap.clear()
}

export function hasSavedOriginals(): boolean {
  return originalMap.size > 0
}
