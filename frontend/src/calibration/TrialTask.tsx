import { useEffect, useRef, useState } from 'react'
import type { CalibrationTrial } from '../types/calibration'
import { TRIAL_TIMEOUT_MS, type TrialConfig } from './trials'

interface Shape {
  index: number
  isTarget: boolean
}

function buildShapes(count: number): Shape[] {
  const targetIndex = Math.floor(Math.random() * count)
  return Array.from({ length: count }, (_, index) => ({ index, isTarget: index === targetIndex }))
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface-variant focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function TrialTask({
  trial,
  onComplete,
}: {
  trial: TrialConfig
  onComplete: (result: CalibrationTrial) => void
}) {
  // App.tsx mounts a fresh TrialTask per trial (key={trial.id}), so these only
  // ever need to be computed once per mount — no reset-on-prop-change effect.
  const [shapes] = useState<Shape[]>(() => buildShapes(trial.objectCount))
  // Refs, not state: click/timeout handlers need the current count and a
  // one-shot guard without waiting on a re-render.
  const errorsRef = useRef(0)
  const startRef = useRef(performance.now())
  const doneRef = useRef(false)

  useEffect(() => {
    const timeout = window.setTimeout(() => finish(false), TRIAL_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function finish(success: boolean) {
    if (doneRef.current) return
    doneRef.current = true
    onComplete({
      objectCount: trial.objectCount,
      completionTimeMs: performance.now() - startRef.current,
      errorCount: errorsRef.current,
      condition: trial.condition,
      success,
    })
  }

  function handleClick(shape: Shape) {
    if (doneRef.current) return
    if (shape.isTarget) {
      finish(true)
    } else {
      errorsRef.current += 1
    }
  }

  const gapClass = trial.variant === 'spacing' ? 'gap-8' : 'gap-3'

  return (
    <div className="flex flex-col items-center gap-8">
      <p className="text-body text-on-surface">{trial.instructions}</p>
      <div className={`grid grid-cols-5 ${gapClass}`}>
        {shapes.map((shape) => (
          <button
            key={shape.index}
            type="button"
            onClick={() => handleClick(shape)}
            aria-label={shape.isTarget ? 'Target shape' : 'Distractor shape'}
            className={`h-14 w-14 rounded-full transition-transform hover:scale-105 ${FOCUS_RING} ${
              shape.isTarget
                ? `bg-accent ${trial.variant === 'contrast' ? 'ring-4 ring-accent-text ring-offset-2 ring-offset-background' : ''}`
                : trial.variant === 'contrast'
                  ? 'border border-outline bg-surface'
                  : 'bg-outline-strong'
            } ${trial.variant === 'motion' && !shape.isTarget ? 'animate-[trial-drift_1.6s_ease-in-out_infinite]' : ''}`}
            style={
              trial.variant === 'motion' && !shape.isTarget
                ? { animationDelay: `${(shape.index % 5) * 120}ms` }
                : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

export default TrialTask
