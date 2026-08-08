import type { AnalyzeBackendResult, SimplifyResponse, VisualProfile } from '../types/analysis'
import { DEFAULT_PROFILE, loadCalibratedProfile } from './defaultProfile'
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
  getBlurIntensity,
  hiddenAdCount,
  INCREASED_SPACING_MULTIPLIER,
  isColorVariationReduced,
  isProgressiveRevealOn,
  isReduceMotionOn,
  isSimplificationActive,
  isSpacingIncreased,
  prefilterPage,
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

// Calibration result (if any) is the base; the sidepanel's live Simplification
// Controls always win over it for these three fields, same as they already
// win over DEFAULT_PROFILE — an explicit toggle is stronger intent than a
// one-time calibration result.
async function profileFor(settings: SimplifySettings): Promise<VisualProfile> {
  const base = (await loadCalibratedProfile()) ?? DEFAULT_PROFILE
  return {
    ...base,
    simplificationStrength: settings.simplificationStrength,
    reduceMotion: settings.reduceMotion,
    spacingMultiplier: settings.increaseSpacing ? INCREASED_SPACING_MULTIPLIER : 1,
  }
}

// The scan sweep plays until handleSimplify() settles, so nothing in that pipeline may
// hang forever. sendMessage's callback is the one link that can silently never fire:
// if the service worker is torn down mid-request — which is what closing the side panel
// can trigger — no reply and no lastError ever arrive, the promise below stays pending,
// and the user is left watching a sweep loop over a page nothing is analyzing.
//
// The ceiling sits above the background's own 60s analyze timeout plus network slack, so
// a legitimately slow analysis still wins the race and only a truly dead request trips
// it. Timing out is not a failure state: it resolves like any other unreachable-backend
// result, so the local heuristic runs and the page still gets simplified.
const ANALYSIS_HARD_TIMEOUT_MS = 70000

function requestBackendAnalysis(profile: VisualProfile): Promise<AnalyzeBackendResult> {
  const extraction = extractPage()
  return new Promise((resolve) => {
    // Whichever settles first wins; the loser's resolve() is a no-op.
    const timer = window.setTimeout(
      () =>
        resolve({
          ok: false,
          error: `No response from background service worker after ${ANALYSIS_HARD_TIMEOUT_MS}ms`,
        }),
      ANALYSIS_HARD_TIMEOUT_MS,
    )

    const settle = (result: AnalyzeBackendResult) => {
      window.clearTimeout(timer)
      resolve(result)
    }

    chrome.runtime.sendMessage(
      {
        type: 'DISTILL_ANALYZE_PAGE',
        payload: { ...extraction, profile },
      },
      (response: AnalyzeBackendResult | undefined) => {
        if (chrome.runtime.lastError || !response) {
          settle({
            ok: false,
            error: chrome.runtime.lastError?.message || 'No response from background service worker',
          })
          return
        }
        settle(response)
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
  const prefiltered = prefilterPage()
  console.log(
    `[Distill] pre-filter hid ${prefiltered.adsHidden} ad/sponsored block(s) before analysis (nothing is blurred until it returns)`,
  )

  const result = await requestBackendAnalysis(await profileFor(settings))

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
      // Closing the side panel while the scan runs closes the channel this reply goes
      // down, and sendResponse then throws. That must not be mistaken for the analysis
      // failing: unguarded, the throw lands in the .catch below, which rolls the whole
      // page back — so closing the panel would silently undo the simplification the
      // user asked for. Nobody is listening either way, so the failure is ignorable.
      const respond = (payload: SimplifyResponse) => {
        try {
          sendResponse(payload)
        } catch {
          // Panel already gone.
        }
      }
      handleSimplify(settings)
        .then((result) => respond({ ok: true, ...result } satisfies SimplifyResponse))
        .catch((err) => {
          console.error('[Distill] simplify failed:', err)
          // prefilterPage() has already hidden ads and blurred secondary content by
          // the time anything downstream can throw, and the restore button is only
          // added on the success paths. Rolling back is the one state we can still
          // guarantee is coherent, and it's the state the panel will show.
          restoreOriginalPage()
          respond({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies SimplifyResponse)
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
    case 'DISTILL_SET_BLUR': {
      // Pure CSS variable — no re-analysis, so a slider drag repaints the page
      // live. applied:false only means nothing is simplified yet; the panel keeps
      // the value and it ships with the next DISTILL_SIMPLIFY.
      const applied = setBlurIntensity(Number(message.intensity))
      sendResponse({ applied, intensity: getBlurIntensity() })
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
        blurIntensity: getBlurIntensity(),
      })
      return true
    default:
      return true
  }
})
