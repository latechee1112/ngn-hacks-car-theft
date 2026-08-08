import { useEffect, useRef, useState } from 'react'
import {
  CALIBRATION_DOT_DEBOUNCE_MS,
  CALIBRATION_DOT_DWELL_MS,
  CALIBRATION_DOTS,
  dotToNormalizedPoint,
} from './calibrationFit'
import type { GazeTracker } from './useGazeTracker'

const VIDEO_ID = 'distill-gaze-video'

function DotCalibration({
  tracker,
  onDone,
  onError,
}: {
  tracker: GazeTracker
  onDone: () => void
  onError: (message: string) => void
}) {
  const [dotIndex, setDotIndex] = useState(0)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    tracker.start(VIDEO_ID).catch((err) => onError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!tracker.ready) return
    if (dotIndex >= CALIBRATION_DOTS.length) {
      onDone()
      return
    }
    const dot = CALIBRATION_DOTS[dotIndex]
    // Dwell so the user has actually fixated before we register the point,
    // then the library's own 1000ms click-debounce before advancing - two
    // separate delays, both required (see calibrationFit.ts).
    const dwell = window.setTimeout(() => {
      const [x, y] = dotToNormalizedPoint(dot)
      tracker.registerCalibrationPoint(x, y)
      window.setTimeout(() => setDotIndex((i) => i + 1), CALIBRATION_DOT_DEBOUNCE_MS)
    }, CALIBRATION_DOT_DWELL_MS)
    return () => window.clearTimeout(dwell)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker.ready, dotIndex])

  const dot = CALIBRATION_DOTS[Math.min(dotIndex, CALIBRATION_DOTS.length - 1)]

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background">
      <p className="mb-6 text-body text-on-surface-variant">
        Look at each dot as it appears · {Math.min(dotIndex + 1, CALIBRATION_DOTS.length)} of{' '}
        {CALIBRATION_DOTS.length}
      </p>
      <video id={VIDEO_ID} autoPlay muted playsInline className="fixed top-4 right-4 h-24 w-32 rounded-md object-cover" />
      {dotIndex < CALIBRATION_DOTS.length && (
        <div
          className="fixed h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-all duration-300"
          style={{ left: `${dot.xFraction * 100}%`, top: `${dot.yFraction * 100}%` }}
        />
      )}
    </div>
  )
}

export default DotCalibration
