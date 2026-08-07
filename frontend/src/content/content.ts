import type { AnalyzeBackendResult } from '../types/analysis'
import { DEFAULT_PROFILE } from './defaultProfile'
import { extractPage } from './extract'
import {
  applyBackendActions,
  applySimplification,
  canReduceColorVariation,
  canUseProgressiveReveal,
  disableProgressiveReveal,
  enableProgressiveReveal,
  isColorVariationReduced,
  isProgressiveRevealOn,
  isSimplificationActive,
  restoreOriginalPage,
  setReduceColorVariation,
  type SimplifyResult,
} from './simplify'

console.log('[Distill] content script injected on', window.location.href)

function requestBackendAnalysis(): Promise<AnalyzeBackendResult> {
  const extraction = extractPage()
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: 'DISTILL_ANALYZE_PAGE',
        payload: { ...extraction, profile: DEFAULT_PROFILE },
      },
      (response: AnalyzeBackendResult | undefined) => {
        if (chrome.runtime.lastError || !response) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError?.message || 'No response from background service worker',
          })
          return
        }
        resolve(response)
      },
    )
  })
}

// Backend-driven simplification is the primary path; the local heuristic (no LLM,
// no task-awareness) is only a fallback for when the backend is unreachable.
async function handleSimplify(): Promise<SimplifyResult> {
  const result = await requestBackendAnalysis()
  if (result.ok) {
    console.log(
      `[Distill] backend analysis succeeded: "${result.data.summary}" (${result.data.actions.length} actions, warnings: ${JSON.stringify(result.data.warnings)})`,
    )
    return applyBackendActions(result.data.actions, result.data.layout)
  }
  console.warn('[Distill] backend analysis unavailable, using local heuristic instead:', result.error)
  return applySimplification()
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'DISTILL_PING':
      sendResponse({ ok: true, title: document.title, url: window.location.href })
      return true
    case 'DISTILL_EXTRACT':
      sendResponse(extractPage())
      return true
    case 'DISTILL_SIMPLIFY':
      handleSimplify().then(sendResponse)
      return true
    case 'DISTILL_RESTORE':
      restoreOriginalPage()
      sendResponse({ ok: true })
      return true
    case 'DISTILL_SET_COLOR_REDUCTION': {
      const applied = setReduceColorVariation(!!message.enabled)
      sendResponse({ applied, active: isColorVariationReduced() })
      return true
    }
    case 'DISTILL_SET_PROGRESSIVE_REVEAL': {
      if (message.enabled) {
        const result = enableProgressiveReveal()
        sendResponse({ applied: result.eligible, active: result.eligible })
      } else {
        disableProgressiveReveal()
        sendResponse({ applied: true, active: false })
      }
      return true
    }
    case 'DISTILL_STATUS':
      sendResponse({
        simplified: isSimplificationActive(),
        colorReductionAvailable: canReduceColorVariation(),
        colorReductionActive: isColorVariationReduced(),
        progressiveRevealAvailable: canUseProgressiveReveal(),
        progressiveRevealActive: isProgressiveRevealOn(),
      })
      return true
    default:
      return true
  }
})
