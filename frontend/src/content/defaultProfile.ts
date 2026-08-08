import type { VisualProfile } from '../types/analysis'
import { CALIBRATION_STORAGE_KEY, type StoredCalibration } from '../types/calibration'

// Used whenever no calibration profile is stored yet (never run, skipped, or
// storage unavailable). Mirrors the sidepanel's hardcoded "Default Profile"
// display (Spacing: +40% • Text: 1.15x • High Contrast).
export const DEFAULT_PROFILE: VisualProfile = {
  profileId: 'default-profile',
  maxVisibleBlocks: 6,
  spacingMultiplier: 1.4,
  textScale: 1.15,
  contrastMode: 'enhanced',
  // Off by default - a real OS-level "prefers-reduced-motion" preference
  // still suppresses motion independently (see scanAnimation.ts's
  // prefersReducedMotion()), so this only controls Distill's own opinion,
  // not actual accessibility. Defaulting it on suppressed the scan-sweep
  // animation for every uncalibrated user.
  reduceMotion: false,
  progressiveReveal: false,
  simplificationStrength: 0.6,
  source: 'manual',
}

// The calibration wizard (src/calibration/App.tsx) writes its result to
// chrome.storage.local, keyed globally rather than per-site — content
// scripts already have "storage" access via the existing manifest
// permission, so this reads it directly with no messaging round-trip.
export async function loadCalibratedProfile(): Promise<VisualProfile | null> {
  try {
    const stored = await chrome.storage.local.get(CALIBRATION_STORAGE_KEY)
    const record = stored?.[CALIBRATION_STORAGE_KEY] as StoredCalibration | undefined
    return record?.profile ?? null
  } catch {
    return null
  }
}
