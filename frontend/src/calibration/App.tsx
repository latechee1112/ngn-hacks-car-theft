import { useCallback, useRef, useState } from 'react'
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
import { toPagePoint, type PageGazePoint } from './gaze/hitTest'
import { useGazeTracker } from './gaze/useGazeTracker'
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-center">
      <div className="flex items-center gap-2 text-on-surface-variant">
        <Icon name="funnel" />
        <span className="text-meta font-semibold tracking-[0.08em] uppercase">Distill</span>
      </div>
      <div className="flex w-full max-w-lg flex-col items-center gap-6">{children}</div>
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

  const handleGazeSample = useCallback((result: GazeResult, capturedAt: number) => {
    const point = toPagePoint(result, capturedAt)
    if (point) gazeSamplesRef.current.push(point)
  }, [])

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

  if (step === 'welcome') {
    return (
      <Shell>
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
      <Shell>
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

export default App
