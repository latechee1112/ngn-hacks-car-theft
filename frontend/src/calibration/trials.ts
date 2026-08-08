// Fixed 5-trial calibration sequence. Each trial's `condition` string and
// `objectCount` are chosen to line up exactly with the backend's rule
// matching in backend/services/profile_rules.py:
//   - clutter rule buckets ALL trials by objectCount (<=6 vs >6)
//   - spacing/contrast/motion rules compare a "baseline" bucket (condition
//     null, or containing "baseline") against a bucket matching "spac" /
//     "contrast" / "motion" respectively
//
// baseline-low + baseline-high together feed the clutter rule and serve as
// the baseline bucket the other three trials get compared against.

export type TrialVariant = 'plain' | 'spacing' | 'contrast' | 'motion'

export interface TrialConfig {
  id: string
  // null matches the backend's "condition is None" baseline bucket.
  condition: string | null
  objectCount: number
  variant: TrialVariant
  instructions: string
}

export const TRIAL_TIMEOUT_MS = 15000

export const TRIALS: TrialConfig[] = [
  {
    id: 'baseline-low',
    condition: null,
    objectCount: 4,
    variant: 'plain',
    instructions: 'Click the blue circle as fast as you can.',
  },
  {
    id: 'baseline-high',
    condition: null,
    objectCount: 10,
    variant: 'plain',
    instructions: 'Click the blue circle as fast as you can.',
  },
  {
    id: 'spacing',
    condition: 'increasedSpacing',
    objectCount: 10,
    variant: 'spacing',
    instructions: 'Same task, more room between shapes this time.',
  },
  {
    id: 'contrast',
    condition: 'enhancedContrast',
    objectCount: 10,
    variant: 'contrast',
    instructions: 'Same task, higher contrast this time.',
  },
  {
    id: 'motion',
    condition: 'reducedMotion',
    objectCount: 10,
    variant: 'motion',
    instructions: 'Same task — ignore the drifting shapes.',
  },
]
