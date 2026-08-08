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
// feeds every click on the page into calibration. Driving WebEyeTrack
// directly means we decide exactly when handleClick() is called - only for
// our own 9 calibration dots, never for trial/decoy clicks.
const MAX_CALIBRATION_POINTS = 9

// Shared with App.tsx, which owns the actual <video> element - it must stay
// mounted for the tracker's whole lifetime (calibration AND trials), not
// just while DotCalibration is on screen. WebcamClient's frame loop checks
// `this.videoElement.paused` every tick and silently no-ops otherwise; a
// <video> torn down by React on a step change stalls playback, which reads
// as "gaze samples just stop arriving" with no error anywhere.
export const GAZE_VIDEO_ID = 'distill-gaze-video'

// WebcamClient drives the frame callback off requestAnimationFrame (so up to
// display refresh rate, typically 60Hz) with no throttling of its own.
// step() does a synchronous MediaPipe FaceLandmarker pass + a TFJS BlazeGaze
// forward pass on the main thread every single call, for the whole
// calibration+trials session - gaze position doesn't need to be resolved
// faster than the eye can meaningfully move between samples, so gating to a
// fixed interval here cuts main-thread inference load without losing
// tracking responsiveness.
const MIN_FRAME_INTERVAL_MS = 1000 / 24

export interface GazeTracker {
  ready: boolean
  start: (videoElementId: string) => Promise<void>
  stop: () => void
  // x/y are viewport-normalized, range [-0.5, 0.5], same convention as
  // GazeResult.normPog - see calibrationFit.ts.
  registerCalibrationPoint: (x: number, y: number) => void
}

export function useGazeTracker(onSample: (result: GazeResult, capturedAt: number) => void): GazeTracker {
  const trackerRef = useRef<WebEyeTrack | null>(null)
  const webcamRef = useRef<WebcamClient | null>(null)
  const activeRef = useRef(false)
  const [ready, setReady] = useState(false)

  const start = useCallback(
    async (videoElementId: string) => {
      const tracker = new WebEyeTrack(MAX_CALIBRATION_POINTS)
      await tracker.initialize()
      trackerRef.current = tracker
      activeRef.current = true

      const webcam = new WebcamClient(videoElementId)
      webcamRef.current = webcam
      let lastProcessedAt = 0
      await webcam.startWebcam(async (frame, timestamp) => {
        if (!activeRef.current || !trackerRef.current) return
        const now = performance.now()
        if (now - lastProcessedAt < MIN_FRAME_INTERVAL_MS) return
        lastProcessedAt = now
        const result = await trackerRef.current.step(frame, timestamp)
        // performance.now() at callback time, not GazeResult.timestamp
        // (which is relative to video start, a different clock than the
        // trial start/end markers this later gets compared against).
        onSample(result, performance.now())
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
    setReady(false)
  }, [])

  const registerCalibrationPoint = useCallback((x: number, y: number) => {
    trackerRef.current?.handleClick(x, y)
  }, [])

  return { ready, start, stop, registerCalibrationPoint }
}
