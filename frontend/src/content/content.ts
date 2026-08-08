import type { AnalyzeBackendResult, VisualProfile } from '../types/analysis'
import { DEFAULT_PROFILE } from './defaultProfile'
import { extractPage } from './extract'
import { startScanAnimation } from './scanAnimation'
import {
  applyBackendActions,
  applyLayoutPreferences,
  applySimplification,
  canReduceColorVariation,
  canUseProgressiveReveal,
  disableProgressiveReveal,
  enableProgressiveReveal,
  hiddenAdCount,
  INCREASED_SPACING_MULTIPLIER,
  isColorVariationReduced,
  isProgressiveRevealOn,
  isReduceMotionOn,
  isSimplificationActive,
  isSpacingIncreased,
  prefilterAds,
  restoreOriginalPage,
  setBlurIntensity,
  setIncreaseSpacing,
  setReduceColorVariation,
  setReduceMotion,
  type SimplifyResult,
} from './simplify'

console.log('[Distill] content script injected on', window.location.href)

// The sidepanel's Simplification Controls, as sent with DISTILL_SIMPLIFY.
export interface SimplifySettings {
  // 0..1 — the sidepanel's Intensity slider (1-100%) divided by 100.
  simplificationStrength: number
  reduceMotion: boolean
  increaseSpacing: boolean
}

// Used when the sidepanel sends no settings (older panel build, or a simplify
// triggered from somewhere other than the panel).
const FALLBACK_SETTINGS: SimplifySettings = {
  simplificationStrength: DEFAULT_PROFILE.simplificationStrength,
  reduceMotion: DEFAULT_PROFILE.reduceMotion,
  increaseSpacing: DEFAULT_PROFILE.spacingMultiplier > 1,
}

function profileFor(settings: SimplifySettings): VisualProfile {
  return {
    ...DEFAULT_PROFILE,
    simplificationStrength: settings.simplificationStrength,
    reduceMotion: settings.reduceMotion,
    spacingMultiplier: settings.increaseSpacing ? INCREASED_SPACING_MULTIPLIER : 1,
  }
}

function requestBackendAnalysis(profile: VisualProfile): Promise<AnalyzeBackendResult> {
  const extraction = extractPage()
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: 'DISTILL_ANALYZE_PAGE',
        payload: { ...extraction, profile },
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

// Two stages, in this order:
//
//   1. Local pre-filter — the unambiguous stuff (a "Promoted"/"Sponsored" badge, an
//      ad-network iframe, a container literally named "ad"/"sponsor"). No model needed
//      to call those, so they are hidden immediately, before anything is sent anywhere.
//   2. Backend analysis — runs on the *remaining* page, since extractPage() skips
//      whatever stage 1 already resolved. Its judgement is spent on the genuinely
//      ambiguous blocks, not on re-deciding obvious ads.
//
// Backend-driven simplification is the primary path for stage 2; the local heuristic
// (no LLM, no task-awareness) is only a fallback for when the backend is unreachable.
// Stage 1 stands on its own either way — if the backend is down, the ads still go.
async function handleSimplify(settings: SimplifySettings): Promise<SimplifyResult> {
  const prefiltered = prefilterAds()
  console.log(`[Distill] pre-filter hid ${prefiltered} ad/sponsored block(s) before analysis`)

  const result = await requestBackendAnalysis(profileFor(settings))

  let outcome: SimplifyResult
  if (result.ok) {
    console.log(
      `[Distill] backend analysis succeeded: "${result.data.summary}" (${result.data.actions.length} actions, warnings: ${JSON.stringify(result.data.warnings)})`,
    )
    outcome = applyBackendActions(result.data.actions, result.data.layout)
  } else {
    console.warn('[Distill] backend analysis unavailable, using local heuristic instead:', result.error)
    outcome = applySimplification()
  }

  // Applied last, on both paths, so the user's explicit toggles override the
  // backend's suggested layout — and so they still apply when the local
  // heuristic runs, which sets no layout variables of its own.
  applyLayoutPreferences({
    reduceMotion: settings.reduceMotion,
    increaseSpacing: settings.increaseSpacing,
  })
  // Same Intensity value the backend used for classification also drives how
  // strongly blurred deemphasized (not collapsed) content looks.
  setBlurIntensity(settings.simplificationStrength)

  return outcome
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'DISTILL_PING':
      sendResponse({ ok: true, title: document.title, url: window.location.href })
      return true
    case 'DISTILL_EXTRACT':
      sendResponse(extractPage())
      return true
    case 'DISTILL_SIMPLIFY': {
      // Deliberately not awaited: the sweep is decoration running alongside
      // the analysis call, never in front of it. stop() must fire on every
      // path — success or failure — because the sweep now loops for as long as
      // the analysis runs and has no time limit of its own to fall back on.
      // Activate only — restoring the page does not replay it.
      const settings: SimplifySettings = { ...FALLBACK_SETTINGS, ...(message.settings ?? {}) }
      const stopScan = startScanAnimation()
      handleSimplify(settings)
        .then(sendResponse)
        .catch((err) => {
          console.error('[Distill] simplify failed:', err)
        })
        .finally(stopScan)
      return true
    }
    case 'DISTILL_RESTORE':
      restoreOriginalPage()
      sendResponse({ ok: true })
      return true
    case 'DISTILL_SET_COLOR_REDUCTION': {
      const applied = setReduceColorVariation(!!message.enabled)
      sendResponse({ applied, active: isColorVariationReduced() })
      return true
    }
    case 'DISTILL_SET_REDUCE_MOTION': {
      // applied:false just means there is no simplified page yet — the panel
      // keeps the preference and it ships with the next DISTILL_SIMPLIFY.
      const applied = setReduceMotion(!!message.enabled)
      sendResponse({ applied, active: isReduceMotionOn() })
      return true
    }
    case 'DISTILL_SET_SPACING': {
      const applied = setIncreaseSpacing(!!message.enabled)
      sendResponse({ applied, active: isSpacingIncreased() })
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
        adsHidden: hiddenAdCount(),
        colorReductionAvailable: canReduceColorVariation(),
        colorReductionActive: isColorVariationReduced(),
        progressiveRevealAvailable: canUseProgressiveReveal(),
        progressiveRevealActive: isProgressiveRevealOn(),
        reduceMotionActive: isReduceMotionOn(),
        spacingIncreased: isSpacingIncreased(),
      })
      return true
    default:
      return true
  }
})
