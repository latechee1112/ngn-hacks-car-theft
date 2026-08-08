// Wire contract with the backend's calibration models (backend/models/calibration.py).
// Field names and shape must match exactly.

import type { VisualProfile } from './analysis'

export interface CalibrationTrial {
  objectCount?: number
  completionTimeMs?: number
  errorCount?: number
  // baseline | increasedSpacing | enhancedContrast | reducedMotion | ...
  condition?: string | null
  success?: boolean
}

export interface GazeSummary {
  enabled: boolean
  sampleCount?: number
  averageDispersion?: number
  averageTargetAcquisitionMs?: number
  distractorGazeRatio?: number
}

export interface ManualPreferences {
  reduceMotion?: boolean
  progressiveReveal?: boolean
}

export interface CalibrationRequest {
  trials: CalibrationTrial[]
  gazeSummary?: GazeSummary
  manualPreferences?: ManualPreferences
}

export interface CalibrationProfileResponse {
  profile: VisualProfile
  explanation: string[]
}

// chrome.storage.local key the calibration wizard writes to and the content
// script reads from. Local (not sync) and keyed globally, not per-site —
// the whole point is that it applies no matter what page you're on.
export const CALIBRATION_STORAGE_KEY = 'distillCalibrationProfile'

export interface StoredCalibration {
  profile?: VisualProfile
  explanation?: string[]
  completedAt?: number
  // Set when the user explicitly skips, so the popup's "Finish setup"
  // banner doesn't nag every time it's reopened.
  dismissed: boolean
}
