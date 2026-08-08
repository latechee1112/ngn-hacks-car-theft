import { useEffect, useRef, useState } from 'react'
import {
  CALIBRATION_DOT_INTERVAL_MS,
  CALIBRATION_DOTS,
  CALIBRATION_SETTLE_MS,
  dotToNormalizedPoint,
} from './calibrationFit'
import { GAZE_VIDEO_ID, type GazeTracker } from './useGazeTracker'

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
    // App.tsx renders the actual <video id={GAZE_VIDEO_ID}> element - it
    // mounts in the same commit as this component (both appear together
    // once step becomes 'gazeCalibration'), so it's already in the DOM by
    // the time this effect runs.
    tracker.start(GAZE_VIDEO_ID).catch((err) => onError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!tracker.ready) return
    if (dotIndex >= CALIBRATION_DOTS.length) {
      onDone()
      return
    }
    const dot = CALIBRATION_DOTS[dotIndex]
    // Two-phase dwell: settle discards whatever the buffer picked up while
    // the eye was still moving toward this dot (reaction time + saccade),
    // then capture registers only what accumulates after that - see
    // CALIBRATION_SETTLE_MS in calibrationFit.ts for why this matters more
    // than it looks like it should.
    const settle = window.setTimeout(() => {
      tracker.clearCalibrationBuffer()
    }, CALIBRATION_SETTLE_MS)
    const capture = window.setTimeout(() => {
      const [x, y] = dotToNormalizedPoint(dot)
      tracker.registerCalibrationPoint(x, y)
      setDotIndex((i) => i + 1)
    }, CALIBRATION_DOT_INTERVAL_MS)
    return () => {
      window.clearTimeout(settle)
      window.clearTimeout(capture)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker.ready, dotIndex])

  const dot = CALIBRATION_DOTS[Math.min(dotIndex, CALIBRATION_DOTS.length - 1)]

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background">
      <p className="mb-6 text-body text-on-surface-variant">
        Look at each dot as it appears · {Math.min(dotIndex + 1, CALIBRATION_DOTS.length)} of{' '}
        {CALIBRATION_DOTS.length}
      </p>
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
