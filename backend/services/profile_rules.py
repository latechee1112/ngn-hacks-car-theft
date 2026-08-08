"""Deterministic calibration -> visual profile rules (POST /v1/calibration/profile).

Every output field is derived from an explicit, explainable rule over the
calibration trials, gaze summary, and manual preferences - never a
diagnosis, never a black box.

Gaze measurements corroborate the object-count clutter rule (never trigger
it alone - see _apply_gaze_support), but the separate decoy-distraction rule
below is deliberately different: clicks on the decoy sidebar/ad are direct
behavioral evidence and can move the profile on their own, same as the other
click-based rules. Gaze alone (camera on, but no decoy clicks) only adds a
modest simplification_strength nudge - it never overrides what the clicks
already decided.
"""

import uuid
from dataclasses import dataclass
from typing import List, Optional, Sequence

from models.calibration import CalibrationRequest, CalibrationTrial, GazeSummary
from models.profile import VisualProfile


@dataclass
class CalibrationProfileResult:
    profile: VisualProfile
    explanation: List[str]


CLUTTER_OBJECT_THRESHOLD = 6
SPACING_IMPROVEMENT_RATIO = 0.15
CONTRAST_IMPROVEMENT_RATIO = 0.15

_DEFAULT_MAX_VISIBLE_BLOCKS = 10
_CLUTTER_MAX_VISIBLE_BLOCKS = 6
_DEFAULT_SPACING_MULTIPLIER = 1.15
_BOOSTED_SPACING_MULTIPLIER = 1.4

# Decoy-distraction rule thresholds. Click evidence is direct (a real
# misclick), so it can move max_visible_blocks on its own, same weight as the
# clutter rule. Gaze evidence alone is softer - it only nudges strength.
_DECOY_CLICK_RATE_THRESHOLD = 0.6  # avg decoy clicks/trial; ~3+ across 5 trials
_DECOY_GAZE_RATIO_THRESHOLD = 0.25
_DECOY_GAZE_MIN_SAMPLES = 50  # below this, the ratio is too noisy to trust
_DECOY_GAZE_ONLY_BONUS = 0.10
_DECOY_BOTH_SIGNALS_BONUS = 0.05


def _condition_matches(trial: CalibrationTrial, keyword: str) -> bool:
    return bool(trial.condition) and keyword in trial.condition.lower()


def _is_baseline(trial: CalibrationTrial) -> bool:
    return _condition_matches(trial, "baseline") or trial.condition is None


def _avg(values: Sequence[float]) -> Optional[float]:
    values = [v for v in values if v is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _avg_error_count(trials: Sequence[CalibrationTrial]) -> Optional[float]:
    return _avg([t.error_count for t in trials if t.error_count is not None])


def _avg_completion_time(trials: Sequence[CalibrationTrial]) -> Optional[float]:
    return _avg([t.completion_time_ms for t in trials if t.completion_time_ms is not None])


def _sharp_increase(low: Optional[float], high: Optional[float]) -> bool:
    if low is None or high is None:
        return False
    if low == 0:
        return high > 0
    return (high / low) >= 1.5


def _ratio_improvement(baseline: Optional[float], candidate: Optional[float]) -> Optional[float]:
    if baseline is None or candidate is None or baseline == 0:
        return None
    return (baseline - candidate) / baseline


def _apply_clutter_rule(trials: Sequence[CalibrationTrial], explanation: List[str]) -> int:
    low = [t for t in trials if t.object_count is not None and t.object_count <= CLUTTER_OBJECT_THRESHOLD]
    high = [t for t in trials if t.object_count is not None and t.object_count > CLUTTER_OBJECT_THRESHOLD]
    low_rate = _avg_error_count(low)
    high_rate = _avg_error_count(high)
    if low and high and _sharp_increase(low_rate, high_rate):
        explanation.append(
            f"Performance decreased sharply when more than {CLUTTER_OBJECT_THRESHOLD} objects were visible."
        )
        return _CLUTTER_MAX_VISIBLE_BLOCKS
    return _DEFAULT_MAX_VISIBLE_BLOCKS


def _apply_spacing_rule(trials: Sequence[CalibrationTrial], explanation: List[str]) -> float:
    baseline = [t for t in trials if _is_baseline(t)]
    spaced = [t for t in trials if _condition_matches(t, "spac")]
    baseline_time = _avg_completion_time(baseline)
    spaced_time = _avg_completion_time(spaced)
    improvement = _ratio_improvement(baseline_time, spaced_time)
    if baseline and spaced and improvement is not None and improvement >= SPACING_IMPROVEMENT_RATIO:
        explanation.append("Additional spacing reduced average target-search time.")
        return _BOOSTED_SPACING_MULTIPLIER
    return _DEFAULT_SPACING_MULTIPLIER


def _apply_contrast_rule(trials: Sequence[CalibrationTrial], explanation: List[str]) -> bool:
    baseline = [t for t in trials if _is_baseline(t)]
    contrast = [t for t in trials if _condition_matches(t, "contrast")]
    baseline_errors = _avg_error_count(baseline)
    contrast_errors = _avg_error_count(contrast)
    improvement = _ratio_improvement(baseline_errors, contrast_errors)
    if baseline and contrast and improvement is not None and improvement >= CONTRAST_IMPROVEMENT_RATIO:
        explanation.append("Enhanced contrast improved accuracy.")
        return True
    return False


def _apply_reduced_motion_rule(
    trials: Sequence[CalibrationTrial],
    manual_reduce_motion: Optional[bool],
    explanation: List[str],
) -> bool:
    if manual_reduce_motion:
        explanation.append("Reduced motion selected based on manual preference.")
        return True

    baseline = [t for t in trials if _is_baseline(t)]
    animated = [t for t in trials if _condition_matches(t, "motion") or _condition_matches(t, "anim")]
    baseline_errors = _avg_error_count(baseline)
    animated_errors = _avg_error_count(animated)
    baseline_time = _avg_completion_time(baseline)
    animated_time = _avg_completion_time(animated)

    error_increased = (
        baseline_errors is not None and animated_errors is not None and animated_errors > baseline_errors
    )
    time_increased = (
        baseline_time is not None and animated_time is not None and animated_time > baseline_time
    )

    if baseline and animated and (error_increased or time_increased):
        explanation.append("Animation increased errors or completion time.")
        return True
    return False


def _apply_gaze_support(gaze: Optional[GazeSummary], max_visible_blocks: int, explanation: List[str]) -> None:
    """Gaze data only ever corroborates a rule that already fired above."""
    if not gaze or not gaze.enabled:
        return
    if (
        max_visible_blocks == _CLUTTER_MAX_VISIBLE_BLOCKS
        and gaze.distractor_gaze_ratio is not None
        and gaze.distractor_gaze_ratio > 0.2
    ):
        explanation.append(
            "Gaze tracking showed attention was frequently drawn to distracting elements, "
            "consistent with the reduced visible-block limit."
        )


def _avg_distractor_clicks(trials: Sequence[CalibrationTrial]) -> Optional[float]:
    return _avg([t.distractor_click_count for t in trials if t.distractor_click_count is not None])


def _apply_decoy_distraction_rule(
    trials: Sequence[CalibrationTrial],
    gaze: Optional[GazeSummary],
    max_visible_blocks: int,
    explanation: List[str],
) -> tuple[int, float]:
    """Decoy sidebar/ad clicks and gaze dwell, independent of the trial's own
    click-target performance. Unlike _apply_gaze_support, this rule can move
    the profile on its own - but only via the click gate, which is direct
    behavioral evidence. Gaze alone is a softer signal: it never changes
    max_visible_blocks, only adds a modest strength bonus.

    Returns (possibly updated) max_visible_blocks and a simplification_strength
    bonus to add on top of the usual calculation.
    """
    click_gate = (_avg_distractor_clicks(trials) or 0) >= _DECOY_CLICK_RATE_THRESHOLD
    gaze_gate = (
        gaze is not None
        and gaze.enabled
        and gaze.distractor_gaze_ratio is not None
        and gaze.distractor_gaze_ratio >= _DECOY_GAZE_RATIO_THRESHOLD
        and gaze.sample_count >= _DECOY_GAZE_MIN_SAMPLES
    )

    if click_gate and gaze_gate:
        explanation.append(
            "Both clicks and gaze tracking showed frequent attention to the decoy "
            "sidebar/ad during calibration, consistent with a reduced visible-block limit."
        )
        return _CLUTTER_MAX_VISIBLE_BLOCKS, _DECOY_BOTH_SIGNALS_BONUS

    if click_gate:
        explanation.append(
            "Clicks frequently landed on the decoy sidebar/ad during calibration."
        )
        return _CLUTTER_MAX_VISIBLE_BLOCKS, 0.0

    if gaze_gate:
        explanation.append(
            "Gaze tracking alone showed attention drawn to the decoy sidebar/ad - "
            "a softer signal, not confirmed by clicks."
        )
        return max_visible_blocks, _DECOY_GAZE_ONLY_BONUS

    return max_visible_blocks, 0.0


def generate_profile(request: CalibrationRequest) -> CalibrationProfileResult:
    explanation: List[str] = []
    trials = request.trials

    max_visible_blocks = _apply_clutter_rule(trials, explanation)
    spacing_multiplier = _apply_spacing_rule(trials, explanation)
    contrast_enabled = _apply_contrast_rule(trials, explanation)

    manual = request.manual_preferences
    reduce_motion = _apply_reduced_motion_rule(
        trials, manual.reduce_motion if manual else None, explanation
    )
    _apply_gaze_support(request.gaze_summary, max_visible_blocks, explanation)
    max_visible_blocks, decoy_strength_bonus = _apply_decoy_distraction_rule(
        trials, request.gaze_summary, max_visible_blocks, explanation
    )

    progressive_reveal = (
        manual.progressive_reveal
        if manual and manual.progressive_reveal is not None
        else max_visible_blocks <= _CLUTTER_MAX_VISIBLE_BLOCKS
    )

    simplification_strength = 0.4
    if max_visible_blocks <= _CLUTTER_MAX_VISIBLE_BLOCKS:
        simplification_strength += 0.15
    if reduce_motion:
        simplification_strength += 0.1
    if contrast_enabled:
        simplification_strength += 0.05
    # Decoy click-gate/both-gates paths above already moved max_visible_blocks,
    # which already triggered the +0.15 clutter bump on its own - this bonus is
    # a distinct addition (0 / gaze-only / both), never a second copy of it.
    simplification_strength += decoy_strength_bonus
    simplification_strength = min(1.0, round(simplification_strength, 2))

    profile = VisualProfile(
        profileId=str(uuid.uuid4()),
        maxVisibleBlocks=max_visible_blocks,
        spacingMultiplier=spacing_multiplier,
        textScale=1.15 if contrast_enabled else 1.0,
        preferredRegion=None,
        contrastMode="enhanced" if contrast_enabled else "standard",
        reduceMotion=reduce_motion,
        progressiveReveal=bool(progressive_reveal),
        simplificationStrength=simplification_strength,
        source="calibration",
    )

    if not explanation:
        explanation.append(
            "Insufficient calibration signal to adjust defaults; using conservative baseline settings."
        )

    return CalibrationProfileResult(profile=profile, explanation=explanation)
