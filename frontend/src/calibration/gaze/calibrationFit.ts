// 9-point calibration sequence. No manual model-fitting needed here -
// WebEyeTrack.handleClick(normX, normY) already does the whole affine fit +
// gradient fine-tune internally (see useGazeTracker.ts), using whatever
// GazeResult it most recently computed as the paired sample. This module is
// just the dot layout.

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

// handleClick() debounces calls within 1000ms of each other (and ignores a
// click within ~0.05 normalized units of the last one, which 9 spread-out
// dots never trigger) - so consecutive dots must be spaced out at least this
// long or a dot's calibration sample is silently dropped, not queued.
export const CALIBRATION_DOT_DEBOUNCE_MS = 1000
// Extra time to let the user actually fixate before we register the point.
export const CALIBRATION_DOT_DWELL_MS = 900
