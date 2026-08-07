import { extractPage } from './extract'
import {
  applySimplification,
  canReduceColorVariation,
  isColorVariationReduced,
  isSimplificationActive,
  restoreOriginalPage,
  setReduceColorVariation,
} from './simplify'

console.log('[FocusFit] content script injected on', window.location.href)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'FOCUSFIT_PING':
      sendResponse({ ok: true, title: document.title, url: window.location.href })
      return true
    case 'FOCUSFIT_EXTRACT':
      sendResponse(extractPage())
      return true
    case 'FOCUSFIT_SIMPLIFY':
      sendResponse(applySimplification())
      return true
    case 'FOCUSFIT_RESTORE':
      restoreOriginalPage()
      sendResponse({ ok: true })
      return true
    case 'FOCUSFIT_SET_COLOR_REDUCTION': {
      const applied = setReduceColorVariation(!!message.enabled)
      sendResponse({ applied, active: isColorVariationReduced() })
      return true
    }
    case 'FOCUSFIT_STATUS':
      sendResponse({
        simplified: isSimplificationActive(),
        colorReductionAvailable: canReduceColorVariation(),
        colorReductionActive: isColorVariationReduced(),
      })
      return true
    default:
      return true
  }
})
