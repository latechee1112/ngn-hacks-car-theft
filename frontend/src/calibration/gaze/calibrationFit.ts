// 9-point calibration sequence. No manual model-fitting needed here -
// useGazeTracker.ts's registerCalibrationPoint does the whole affine fit +
// gradient fine-tune internally via WebEyeTrack.adapt(), fed a rolling
// buffer of recent open-eye frames rather than a single clicked-moment
// sample. This module is just the dot layout.

export interface CalibrationDot {
  id: string
  // Viewport fractions, 0-1. Corners + edge midpoints + center - the
  // library's own default maxPoints is 5; raised to 9 for headroom.
  xFraction: number
  yFraction: number
}

export const CALIBRATION_DOTS: CalibrationDot[] = [
  { id: 'top-left', xFraction: 0.08, yFraction: 0.1 },
  { id: 'top-center', xFraction: 0.5, yFraction: 0.1 },
  { id: 'top-right', xFraction: 0.92, yFraction: 0.1 },
  { id: 'mid-left', xFraction: 0.08, yFraction: 0.5 },
  { id: 'center', xFraction: 0.5, yFraction: 0.5 },
  { id: 'mid-right', xFraction: 0.92, yFraction: 0.5 },
  { id: 'bottom-left', xFraction: 0.08, yFraction: 0.9 },
  { id: 'bottom-center', xFraction: 0.5, yFraction: 0.9 },
  { id: 'bottom-right', xFraction: 0.92, yFraction: 0.9 },
]

// WebEyeTrack.handleClick(x, y) expects the same normalization its own
// normPog output uses: viewport-relative, origin at center, range [-0.5, 0.5].
export function dotToNormalizedPoint(dot: CalibrationDot): [number, number] {
  return [dot.xFraction - 0.5, dot.yFraction - 0.5]
}

// Time to dwell on each dot before registering it. Serves two purposes:
// lets the user actually fixate before we start counting frames toward that
// dot's fit, and gives registerCalibrationPoint's rolling sample buffer
// (CALIBRATION_SAMPLE_BUFFER_SIZE in useGazeTracker.ts, ~625ms of frames at
// ~24Hz) time to fill with fresh, on-target frames rather than leftover
// frames from the previous dot or the transition between them.
export const CALIBRATION_DOT_INTERVAL_MS = 1050
