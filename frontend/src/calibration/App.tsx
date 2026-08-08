import { useCallback, useEffect, useRef, useState } from 'react'
import type { GazeResult } from 'webeyetrack'
import Icon from '../sidepanel/Icon'
import {
  CALIBRATION_STORAGE_KEY,
  type CalibrationProfileResponse,
  type CalibrationTrial,
  type GazeSummary,
  type StoredCalibration,
} from '../types/calibration'
import { combineGazeStats, computeTrialGazeStats, type TrialGazeStats } from './gaze/aggregate'
import DotCalibration from './gaze/DotCalibration'
import { currentTargetRect, isOnTarget, toPagePoint, type PageGazePoint } from './gaze/hitTest'
import { GAZE_VIDEO_ID, useGazeTracker } from './gaze/useGazeTracker'
import TrialTask from './TrialTask'
import { TRIALS } from './trials'

// Local dev backend — same origin the background service worker's
// analyze-page calls use. Unlike a content script, this page runs at the
// extension's own chrome-extension:// origin, which is already on the
// backend's CORS allowlist (see backend/.env's CORS_ORIGINS), so it can
// call the backend directly instead of proxying through the background
// worker.
const BACKEND_URL = 'http://127.0.0.1:8000'

async function markDismissed() {
  try {
    const record: StoredCalibration = { dismissed: true }
    await chrome.storage.local.set({ [CALIBRATION_STORAGE_KEY]: record })
  } catch {
    // Best-effort — worst case the popup's "Finish setup" banner reappears.
  }
}

async function storeResult(response: CalibrationProfileResponse) {
  const record: StoredCalibration = {
    profile: response.profile,
    explanation: response.explanation,
    completedAt: Date.now(),
    dismissed: false,
  }
  await chrome.storage.local.set({ [CALIBRATION_STORAGE_KEY]: record })
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface-variant focus-visible:ring-offset-2 focus-visible:ring-offset-background'

type Step = 'welcome' | 'camera' | 'gazeCalibration' | 'trials' | 'submitting' | 'results' | 'error' | 'skipped'

function PrimaryButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md bg-accent px-6 py-3 text-body font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60 ${FOCUS_RING}`}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border border-outline bg-surface px-6 py-3 text-body font-medium text-on-surface transition-colors hover:bg-surface-hover ${FOCUS_RING}`}
    >
      {children}
    </button>
  )
}

function Shell({ children, showGlow = false }: { children: React.ReactNode; showGlow?: boolean }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-background px-6 py-16 text-center">
      {showGlow && (
        <>
          <div className="bg-glow bg-glow-top" aria-hidden="true" />
          <div className="bg-glow bg-glow-bottom" aria-hidden="true" />
        </>
      )}
      <div className="relative z-10 flex items-center gap-2 text-on-surface-variant">
        <Icon name="funnel" />
        <span className="text-meta font-semibold tracking-[0.08em] uppercase">Distill</span>
      </div>
      <div className="relative z-10 flex w-full max-w-lg flex-col items-center gap-6">{children}</div>
    </div>
  )
}

function App() {
  const [step, setStep] = useState<Step>('welcome')
  const [trialIndex, setTrialIndex] = useState(0)
  const [trials, setTrials] = useState<CalibrationTrial[]>([])
  const [result, setResult] = useState<CalibrationProfileResponse | null>(null)
  const [error, setError] = useState('')

  // Gaze state lives in refs, not React state - samples arrive many times a
  // second via the tracker's callback and never need a re-render themselves.
  const gazeEnabledRef = useRef(false)
  const gazeSamplesRef = useRef<PageGazePoint[]>([])
  const trialGazeStatsRef = useRef<TrialGazeStats[]>([])
  const trialStartRef = useRef(0)
  // Gaze samples update a ref without re-rendering React. A lightweight
  // requestAnimationFrame loop below interpolates the blob between those
  // samples using compositor-only transforms, so lowering AI inference
  // frequency does not make its motion look lower-frame-rate.
  const gazeDotRef = useRef<HTMLDivElement | null>(null)
  const latestGazePointRef = useRef<PageGazePoint | null>(null)

  // What's actually drawn on screen chases the raw gaze target at a capped
  // rate rather than snapping to it every tick - eyes dart (saccades move
  // essentially instantly), and following that exactly is what read as
  // "darting"/sudden movement. Deliberately lagging behind fast eye motion,
  // rather than teleporting with it, is what makes this read as calm.
  // Separate ref from latestGazePointRef (which still holds the raw, un-
  // smoothed sample for e.g. trial scoring elsewhere).
  const displayedPosRef = useRef<{ x: number; y: number } | null>(null)
  const prevTickAtRef = useRef(0)
  // Retains the calm follow effect without the previous multi-second trail.
  // A 1000px move now takes at most ~0.9s instead of ~2.2s.
  const DISPLAY_MAX_SPEED_PX_MS = 1.1

  // Comet stretch: derived from the *displayed* (already speed-limited)
  // position's own motion, then smoothed further - see VELOCITY_SMOOTHING.
  const prevDisplayedPosRef = useRef<{ x: number; y: number } | null>(null)
  const smoothedVelRef = useRef({ x: 0, y: 0 })
  // Time-based smoothing behaves consistently on 60Hz and high-refresh
  // displays instead of depending on how frequently the callback happens.
  const VELOCITY_SMOOTHING_MS = 160
  // Below this fraction of DISPLAY_MAX_SPEED_PX_MS, treat as "not moving"
  // and hold a plain circle - without this, residual jitter below the
  // smoothing floor still nudges scaleX/scaleY off 1 and makes the
  // (otherwise invisible-when-circular) rotation visible as a wobble.
  const SPEED_DEADZONE = 0.2
  const STRETCH_K = 0.35
  const SQUASH_K = 0.12

  const handleGazeSample = useCallback((result: GazeResult, capturedAt: number) => {
    const point = toPagePoint(result, capturedAt)
    if (point) {
      gazeSamplesRef.current.push(point)
      latestGazePointRef.current = point
    }
  }, [])

  useEffect(() => {
    if (step !== 'trials' || !gazeEnabledRef.current) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frameId = 0
    let lastConsumedPoint: PageGazePoint | null = null
    let rawTarget: { x: number; y: number } | null = null

    const animate = (now: number) => {
      frameId = window.requestAnimationFrame(animate)
      const point = latestGazePointRef.current
      const dot = gazeDotRef.current
      if (!point || !dot) return

      // Recalculate hit-testing only when a new inference sample arrives;
      // getBoundingClientRect on every display frame would needlessly force
      // repeated layout reads while the target has not changed.
      if (point !== lastConsumedPoint) {
        const targetRect = currentTargetRect()
        rawTarget =
          targetRect && isOnTarget(point, targetRect)
            ? {
                x: point.x * 0.4 + (targetRect.left + targetRect.width / 2) * 0.6,
                y: point.y * 0.4 + (targetRect.top + targetRect.height / 2) * 0.6,
              }
            : point
        lastConsumedPoint = point
      }
      if (!rawTarget) return

      const dt = prevTickAtRef.current ? now - prevTickAtRef.current : 0

      // Speed-limited follow: step the displayed position toward rawTarget
      // by at most DISPLAY_MAX_SPEED_PX_MS * dt this tick. First tick (or
      // after a reduced-motion skip) just snaps once, since there's nothing
      // to lag behind yet.
      let showAt: { x: number; y: number }
      const cur = displayedPosRef.current
      if (!cur || reduceMotion || dt <= 0) {
        showAt = rawTarget
      } else {
        const dx = rawTarget.x - cur.x
        const dy = rawTarget.y - cur.y
        const dist = Math.hypot(dx, dy)
        const maxStep = DISPLAY_MAX_SPEED_PX_MS * dt
        showAt = dist <= maxStep ? rawTarget : { x: cur.x + (dx / dist) * maxStep, y: cur.y + (dy / dist) * maxStep }
      }
      displayedPosRef.current = showAt

      let normSpeed = 0
      let angleDeg = 0
      const prevDisplayed = prevDisplayedPosRef.current
      if (!reduceMotion && prevDisplayed && dt > 0) {
        const instVx = (showAt.x - prevDisplayed.x) / dt
        const instVy = (showAt.y - prevDisplayed.y) / dt
        const vel = smoothedVelRef.current
        const smoothing = 1 - Math.exp(-dt / VELOCITY_SMOOTHING_MS)
        vel.x += (instVx - vel.x) * smoothing
        vel.y += (instVy - vel.y) * smoothing
        const speedPxMs = Math.hypot(vel.x, vel.y)
        normSpeed = Math.min(1, speedPxMs / DISPLAY_MAX_SPEED_PX_MS)
        if (normSpeed < SPEED_DEADZONE) {
          normSpeed = 0
        } else {
          angleDeg = Math.atan2(vel.y, vel.x) * (180 / Math.PI)
        }
      }
      prevDisplayedPosRef.current = showAt
      prevTickAtRef.current = now

      dot.style.transform =
        `translate3d(${showAt.x}px, ${showAt.y}px, 0) translate(-50%, -50%) ` +
        `rotate(${angleDeg}deg) scaleX(${1 + normSpeed * STRETCH_K}) scaleY(${1 - normSpeed * SQUASH_K})`
      dot.style.opacity = '1'
    }

    frameId = window.requestAnimationFrame(animate)
    return () => {
      window.cancelAnimationFrame(frameId)
      displayedPosRef.current = null
      prevDisplayedPosRef.current = null
      prevTickAtRef.current = 0
      smoothedVelRef.current = { x: 0, y: 0 }
    }
  }, [step])

  const tracker = useGazeTracker(handleGazeSample)

  function handleSkip() {
    markDismissed()
    setStep('skipped')
  }

  function enableCamera() {
    setStep('gazeCalibration')
  }

  function handleGazeCalibrationDone() {
    gazeEnabledRef.current = true
    trialStartRef.current = performance.now()
    setStep('trials')
  }

  function handleGazeCalibrationError(message: string) {
    console.warn('[Distill] gaze calibration failed, continuing without camera:', message)
    tracker.stop()
    gazeEnabledRef.current = false
    trialStartRef.current = performance.now()
    setStep('trials')
  }

  function handleTrialComplete(outcome: CalibrationTrial) {
    console.log('[Distill] trial complete', outcome)
    if (gazeEnabledRef.current) {
      const trialEnd = performance.now()
      const windowSamples = gazeSamplesRef.current.filter(
        (s) => s.capturedAt >= trialStartRef.current && s.capturedAt <= trialEnd,
      )
      trialGazeStatsRef.current.push(computeTrialGazeStats(windowSamples, trialStartRef.current))
      trialStartRef.current = trialEnd
    }

    const next = [...trials, outcome]
    setTrials(next)
    if (trialIndex + 1 < TRIALS.length) {
      setTrialIndex(trialIndex + 1)
    } else {
      submit(next)
    }
  }

  async function submit(finishedTrials: CalibrationTrial[]) {
    // Camera is no longer needed once trials are done, win or lose.
    if (gazeEnabledRef.current) tracker.stop()

    setStep('submitting')
    setError('')
    try {
      const gazeSummary: GazeSummary = gazeEnabledRef.current
        ? combineGazeStats(trialGazeStatsRef.current)
        : { enabled: false }
      const response = await fetch(`${BACKEND_URL}/v1/calibration/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trials: finishedTrials, gazeSummary }),
      })
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`)
      }
      const data = (await response.json()) as CalibrationProfileResponse
      console.log('[Distill] calibration profile result', data)
      await storeResult(data)
      setResult(data)
      setStep('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  function retrySubmit() {
    submit(trials)
  }

  // Renders the per-step screen. Kept as a nested function (rather than
  // inline in the final return) so the <video> element below can sit
  // outside this step-conditional entirely - it must stay mounted across
  // the 'gazeCalibration' -> 'trials' transition (see GAZE_VIDEO_ID's
  // comment in useGazeTracker.ts), which an early-return per step here
  // would otherwise defeat by unmounting the whole tree on every step change.
  function renderStep() {
  if (step === 'welcome') {
    return (
      <Shell showGlow>
        <h1 className="text-title font-semibold text-on-background">Let's set up Distill for you</h1>
        <p className="text-body text-on-surface-variant">
          A few quick tasks (about a minute) tell Distill how you scan a page, so it can pick spacing, contrast,
          and motion settings that actually work for you — instead of one-size-fits-all defaults.
        </p>
        <div className="flex gap-3">
          <PrimaryButton onClick={() => setStep('camera')}>Get started</PrimaryButton>
          <SecondaryButton onClick={handleSkip}>Skip for now</SecondaryButton>
        </div>
      </Shell>
    )
  }

  if (step === 'camera') {
    return (
      <Shell showGlow>
        <h1 className="text-title font-semibold text-on-background">One optional step</h1>
        <p className="text-body text-on-surface-variant">
          Distill can use your camera to see where you're looking during the tasks below, which makes the result
          more specific to you — for example, noticing if your attention keeps drifting to distracting elements.
          Nothing is ever recorded or sent anywhere; it's only used live, on this page, to score the tasks.
        </p>
        <div className="flex gap-3">
          <PrimaryButton onClick={enableCamera}>Enable camera</PrimaryButton>
          <SecondaryButton onClick={() => setStep('trials')}>Skip — continue without camera</SecondaryButton>
        </div>
      </Shell>
    )
  }

  if (step === 'gazeCalibration') {
    return (
      <DotCalibration
        tracker={tracker}
        onDone={handleGazeCalibrationDone}
        onError={handleGazeCalibrationError}
      />
    )
  }

  if (step === 'trials') {
    return (
      <Shell>
        {gazeEnabledRef.current && (
          // Outer div: position + velocity only (JS-written transform every
          // animation frame, see the effect above). Inner div: the organic
          // morph animation (gaze-blob-morph, index.css) - kept on a
          // separate element so the two animations don't fight over the
          // same style properties. Sized off hitTest.ts's own ~85-90px gaze
          // error estimate scaled up per design ask ("much bigger, more
          // modern") - still honestly reads as an uncertainty blob, not a
          // precise cursor. Cyan, not accent's blue (#2f6fb5) - the target
          // shape itself is bg-accent, so the gaze indicator needs a
          // visibly different hue to stay distinguishable from what's
          // actually being clicked.
          <div
            ref={gazeDotRef}
            aria-hidden="true"
            // Position/stretch are written once per animation frame. Only
            // opacity is transitioned; transitioning transform as well would
            // restart a second interpolation on every frame and reintroduce
            // the stutter this loop is designed to remove.
            className="pointer-events-none fixed top-0 left-0 z-50 h-[350px] w-[350px] opacity-0 transition-opacity duration-200 ease-out will-change-transform"
          >
            <div className="gaze-blob-morph absolute inset-0 bg-[radial-gradient(circle,_rgb(94_211_255_/_55%)_0%,_rgb(94_211_255_/_22%)_45%,_transparent_75%)]" />
          </div>
        )}
        <p className="text-meta font-semibold tracking-[0.08em] text-on-surface-variant uppercase">
          Step {trialIndex + 1} of {TRIALS.length}
        </p>
        <TrialTask key={TRIALS[trialIndex].id} trial={TRIALS[trialIndex]} onComplete={handleTrialComplete} />
      </Shell>
    )
  }

  if (step === 'submitting') {
    return (
      <Shell>
        <Icon name="spinner" className="h-6 w-6 animate-spin text-accent-text" />
        <p className="text-body text-on-surface-variant">Analyzing your results…</p>
      </Shell>
    )
  }

  if (step === 'error') {
    return (
      <Shell>
        <h1 className="text-title font-semibold text-on-background">Couldn't reach Distill's backend</h1>
        <p className="text-meta text-danger-text">{error}</p>
        <p className="text-body text-on-surface-variant">
          Make sure the backend is running, or skip for now — you can redo this anytime.
        </p>
        <div className="flex gap-3">
          <PrimaryButton onClick={retrySubmit}>Try again</PrimaryButton>
          <SecondaryButton onClick={handleSkip}>Skip for now</SecondaryButton>
        </div>
      </Shell>
    )
  }

  if (step === 'skipped') {
    return (
      <Shell>
        <h1 className="text-title font-semibold text-on-background">No problem</h1>
        <p className="text-body text-on-surface-variant">
          Distill will use sensible defaults. You can close this tab — the "Finish setup" reminder in the extension
          popup will bring you back here anytime.
        </p>
        <PrimaryButton onClick={() => window.close()}>Close this tab</PrimaryButton>
      </Shell>
    )
  }

  // results
  return (
    <Shell>
      <div className="flex items-center gap-2 text-accent-text">
        <Icon name="check" />
        <h1 className="text-title font-semibold text-on-background">You're all set</h1>
      </div>
      <ul className="flex w-full flex-col gap-2 text-left">
        {result?.explanation.map((line) => (
          <li
            key={line}
            className="rounded-md border border-outline bg-surface px-4 py-3 text-body text-on-surface"
          >
            {line}
          </li>
        ))}
      </ul>
      <PrimaryButton onClick={() => window.close()}>Close this tab</PrimaryButton>
    </Shell>
  )
  }

  // The camera feed itself: must stay mounted for the tracker's whole
  // lifetime (see GAZE_VIDEO_ID's comment in useGazeTracker.ts), so it lives
  // here rather than inside any per-step screen - visible in the corner only
  // during calibration, visually hidden (but still playing) afterwards.
  return (
    <>
      <video
        id={GAZE_VIDEO_ID}
        autoPlay
        muted
        playsInline
        className={
          step === 'gazeCalibration' ? 'fixed top-4 right-4 h-24 w-32 rounded-md object-cover' : 'sr-only'
        }
      />
      {renderStep()}
    </>
  )
}

export default App
