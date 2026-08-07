import type { VisualProfile } from '../types/analysis'

// Placeholder until a real calibration flow exists (runs trials -> POST
// /v1/calibration/profile -> store the result). Mirrors the sidepanel's
// hardcoded "Default Profile" display (Spacing: +40% • Text: 1.15x • High Contrast).
export const DEFAULT_PROFILE: VisualProfile = {
  profileId: 'default-profile',
  maxVisibleBlocks: 6,
  spacingMultiplier: 1.4,
  textScale: 1.15,
  contrastMode: 'enhanced',
  reduceMotion: true,
  progressiveReveal: false,
  simplificationStrength: 0.6,
  source: 'manual',
}
