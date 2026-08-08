import { useCallback, useRef, useState } from 'react'
import { WebEyeTrack, WebcamClient, type GazeResult } from 'webeyetrack'

// Deliberately NOT WebEyeTrackProxy - two reasons, both verified against the
// installed package source (webeyetrack@0.0.2), not just its docs:
//   1. The proxy's worker is broken as shipped: the package ships
//      dist/index.worker.js.LICENSE.txt but not the actual worker file, and
//      there is no `new Worker(...)` anywhere in dist/index.js at all.
//   2. WebEyeTrack itself has zero worker dependency - step()/handleClick()
//      run in plain async methods - so a worker was never actually needed
//      for our case (a dedicated calibration tab, not a widget embedded in
//      an arbitrary host page under memory/CPU pressure).
// The proxy also attaches a global `window.addEventListener('click')` that
// feeds every click on the page into calibration, indiscriminately. Driving
// WebEyeTrack directly means we decide exactly when calibration data gets
// registered: the 9 calibration dots, plus (App.tsx's handleTargetHit) a
// correct trial click - never decoy clicks or wrong-shape clicks, which
// don't reliably mean the gaze was actually there. The trial-click path
// exists to correct for head-position drift over the session; the 9-dot
// fit alone doesn't adapt after calibration finishes.
const MAX_CALIBRATION_POINTS = 9

// Shared with App.tsx, which owns the actual <video> element - it must stay
// mounted for the tracker's whole lifetime (calibration AND trials), not
// just while DotCalibration is on screen. WebcamClient's frame loop checks
// `this.videoElement.paused` every tick and silently no-ops otherwise; a
// <video> torn down by React on a step change stalls playback, which reads
// as "gaze samples just stop arriving" with no error anywhere.
export const GAZE_VIDEO_ID = 'distill-gaze-video'

// WebcamClient drives the callback from requestAnimationFrame. The package's
// advertised worker is missing from its published bundle, so MediaPipe + TFJS
// inference runs on the UI thread. Ten samples per second is responsive
// enough for gaze calibration while leaving regular frames for React, CSS and
// input. The in-flight guard in start() is equally important: without it a
// slow inference can overlap the next one and saturate the page completely.
const MIN_FRAME_INTERVAL_MS = 1000 / 10

// How many recent open-eye frames registerCalibrationPoint feeds to a
// single dot's fit. handleClick() (the library's own entry point) only ever
// uses the single most-recent frame - one blink, stray head-turn, or noisy
// prediction at exactly the wrong millisecond then permanently skews that
// dot's contribution to the calibration fit, with no way to detect or
// recover from it. adapt() (also public, WebEyeTrack.d.ts) accepts a batch
// of samples for one label, which both the closed-form affine fit and the
// gradient step use directly - more, consistent samples per dot materially
// improves calibration accuracy over a single frame. At MIN_FRAME_INTERVAL_MS
// (~10Hz) this is roughly the last 800ms of fixation on the dot - sized to
// use nearly the whole CALIBRATION_DOT_INTERVAL_MS dwell instead of only its
// tail.
const CALIBRATION_SAMPLE_BUFFER_SIZE = 8

// Rejects samples whose headVector is far from the buffer's own median -
// catches a stray head-turn or landmark glitch mid-dwell without needing a
// second frame source to cross-check against. MAD-based rather than a fixed
// distance threshold since headVector's scale isn't documented by the
// library. Left as-is (unfiltered) below 4 samples - not enough to estimate
// a reliable median/spread from - and falls back to the unfiltered set if
// filtering would leave fewer than 3 samples, so a genuinely noisy dot still
// contributes something rather than nothing.
function filterByHeadVector(samples: BufferedGazeSample[]): BufferedGazeSample[] {
  if (samples.length < 4) return samples
  const dims = samples[0].headVector.length
  const median = Array.from({ length: dims }, (_, d) => {
    const sorted = samples.map((s) => s.headVector[d]).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })
  const distanceFromMedian = (headVector: number[]) => Math.hypot(...headVector.map((v, d) => v - median[d]))
  const distances = samples.map((s) => distanceFromMedian(s.headVector))
  const sortedDistances = [...distances].sort((a, b) => a - b)
  const mad = sortedDistances[Math.floor(sortedDistances.length / 2)] || 1e-6
  const filtered = samples.filter((_, i) => distances[i] <= mad * 3)
  return filtered.length >= 3 ? filtered : samples
}

interface BufferedGazeSample {
  eyePatch: ImageData
  headVector: number[]
  faceOrigin3D: number[]
}

export interface GazeTracker {
  ready: boolean
  start: (videoElementId: string) => Promise<void>
  stop: () => void
  // x/y are viewport-normalized, range [-0.5, 0.5], same convention as
  // GazeResult.normPog - see calibrationFit.ts. maxSamples caps how many of
  // the most recent buffered frames get used (default: the whole buffer,
  // same as before this param existed) - App.tsx's trial-click recalibration
  // passes a small number here, since adapt() is a real, non-trivial TFJS
  // computation with no worker (see the top of this file); a full 8-frame
  // buffer on every correct trial click was blocking the main thread long
  // enough to visibly delay the next trial's render.
  registerCalibrationPoint: (x: number, y: number, maxSamples?: number) => void
  // Drops whatever's accumulated in the sample buffer without fitting on
  // it - see CALIBRATION_SETTLE_MS in calibrationFit.ts. Lets a caller
  // discard pre-settle frames after a new dot appears, so only frames
  // captured once the eye has actually arrived end up in the next
  // registerCalibrationPoint call.
  clearCalibrationBuffer: () => void
}

export function useGazeTracker(onSample: (result: GazeResult, capturedAt: number) => void): GazeTracker {
  const trackerRef = useRef<WebEyeTrack | null>(null)
  const webcamRef = useRef<WebcamClient | null>(null)
  const activeRef = useRef(false)
  const [ready, setReady] = useState(false)
  // Rolling window of recent open-eye frames, for registerCalibrationPoint
  // to draw a batch from - see CALIBRATION_SAMPLE_BUFFER_SIZE above.
  const recentSamplesRef = useRef<BufferedGazeSample[]>([])

  const start = useCallback(
    async (videoElementId: string) => {
      const tracker = new WebEyeTrack(MAX_CALIBRATION_POINTS)
      await tracker.initialize()
      trackerRef.current = tracker
      activeRef.current = true

      const webcam = new WebcamClient(videoElementId)
      webcamRef.current = webcam
      let lastProcessedAt = 0
      let inferenceInFlight = false
      await webcam.startWebcam(async (frame, timestamp) => {
        if (!activeRef.current || !trackerRef.current || inferenceInFlight) return
        const now = performance.now()
        if (now - lastProcessedAt < MIN_FRAME_INTERVAL_MS) return
        lastProcessedAt = now
        inferenceInFlight = true
        try {
          const result = await trackerRef.current.step(frame, timestamp)
          // stop() may have been called while inference was yielding to the
          // GPU/WASM backend. Do not publish a late sample into the next step.
          if (!activeRef.current || !trackerRef.current) return
          if (result.gazeState === 'open') {
            recentSamplesRef.current.push({
              eyePatch: result.eyePatch,
              headVector: result.headVector,
              faceOrigin3D: result.faceOrigin3D,
            })
            if (recentSamplesRef.current.length > CALIBRATION_SAMPLE_BUFFER_SIZE) {
              recentSamplesRef.current.shift()
            }
          }
          // performance.now() at callback time, not GazeResult.timestamp
          // (which is relative to video start, a different clock than the
          // trial start/end markers this later gets compared against).
          onSample(result, performance.now())
        } finally {
          inferenceInFlight = false
        }
      })
      setReady(true)
    },
    [onSample],
  )

  const stop = useCallback(() => {
    activeRef.current = false
    webcamRef.current?.stopWebcam()
    webcamRef.current = null
    trackerRef.current = null
    recentSamplesRef.current = []
    setReady(false)
  }, [])

  const registerCalibrationPoint = useCallback((x: number, y: number, maxSamples?: number) => {
    // Buffer is cleared after every dot, so a dot with the eyes closed or
    // face lost for its whole dwell window (recentSamplesRef empty) simply
    // contributes nothing rather than fitting on stale frames left over
    // from the previous dot.
    if (!trackerRef.current || recentSamplesRef.current.length === 0) return
    // Always the *most recent* frames, not the oldest - those are the ones
    // closest to the moment being registered (a click, or the end of a
    // dot's dwell), same reasoning as the rolling buffer's own shift() above.
    const pool =
      maxSamples && maxSamples < recentSamplesRef.current.length
        ? recentSamplesRef.current.slice(-maxSamples)
        : recentSamplesRef.current
    const samples = filterByHeadVector(pool)
    trackerRef.current.adapt(
      samples.map((s) => s.eyePatch),
      samples.map((s) => s.headVector),
      samples.map((s) => s.faceOrigin3D),
      samples.map(() => [x, y]),
    )
    recentSamplesRef.current = []
  }, [])

  const clearCalibrationBuffer = useCallback(() => {
    recentSamplesRef.current = []
  }, [])

  return { ready, start, stop, registerCalibrationPoint, clearCalibrationBuffer }
}
