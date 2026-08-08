from models.calibration import (
    CalibrationRequest,
    CalibrationTrial,
    GazeSummary,
    ManualPreferences,
)
from services.profile_rules import generate_profile


def test_high_clutter_reduces_max_visible_blocks():
    trials = [
        CalibrationTrial(objectCount=4, errorCount=0),
        CalibrationTrial(objectCount=5, errorCount=0),
        CalibrationTrial(objectCount=9, errorCount=4),
        CalibrationTrial(objectCount=10, errorCount=5),
    ]
    result = generate_profile(CalibrationRequest(trials=trials))
    assert result.profile.max_visible_blocks == 6
    assert any("more than 6 objects" in e for e in result.explanation)
#

def test_low_clutter_keeps_default_max_visible_blocks():
    trials = [
        CalibrationTrial(objectCount=4, errorCount=0),
        CalibrationTrial(objectCount=9, errorCount=0),
        CalibrationTrial(objectCount=10, errorCount=0),
    ]
    result = generate_profile(CalibrationRequest(trials=trials))
    assert result.profile.max_visible_blocks == 10


def test_spacing_rule_increases_spacing_multiplier():
    trials = [
        CalibrationTrial(condition="baseline", completionTimeMs=1000),
        CalibrationTrial(condition="baseline", completionTimeMs=1000),
        CalibrationTrial(condition="increasedSpacing", completionTimeMs=800),
        CalibrationTrial(condition="increasedSpacing", completionTimeMs=800),
    ]
    result = generate_profile(CalibrationRequest(trials=trials))
    assert result.profile.spacing_multiplier == 1.4


def test_spacing_rule_does_not_fire_below_15_percent_improvement():
    trials = [
        CalibrationTrial(condition="baseline", completionTimeMs=1000),
        CalibrationTrial(condition="increasedSpacing", completionTimeMs=950),
    ]
    result = generate_profile(CalibrationRequest(trials=trials))
    assert result.profile.spacing_multiplier == 1.15


def test_contrast_rule_enables_enhanced_contrast():
    trials = [
        CalibrationTrial(condition="baseline", errorCount=4),
        CalibrationTrial(condition="baseline", errorCount=4),
        CalibrationTrial(condition="enhancedContrast", errorCount=1),
        CalibrationTrial(condition="enhancedContrast", errorCount=1),
    ]
    result = generate_profile(CalibrationRequest(trials=trials))
    assert result.profile.contrast_mode == "enhanced"
    assert result.profile.text_scale == 1.15


def test_reduced_motion_selected_when_animation_increases_errors_and_time():
    trials = [
        CalibrationTrial(condition="baseline", errorCount=1, completionTimeMs=900),
        CalibrationTrial(condition="baseline", errorCount=1, completionTimeMs=900),
        CalibrationTrial(condition="animated", errorCount=4, completionTimeMs=1500),
        CalibrationTrial(condition="animated", errorCount=4, completionTimeMs=1500),
    ]
    result = generate_profile(CalibrationRequest(trials=trials))
    assert result.profile.reduce_motion is True


def test_reduced_motion_not_selected_without_evidence():
    trials = [
        CalibrationTrial(condition="baseline", errorCount=1, completionTimeMs=900),
        CalibrationTrial(condition="animated", errorCount=1, completionTimeMs=900),
    ]
    result = generate_profile(CalibrationRequest(trials=trials))
    assert result.profile.reduce_motion is False


def test_manual_preference_forces_reduced_motion_even_without_trial_evidence():
    request = CalibrationRequest(trials=[], manualPreferences=ManualPreferences(reduceMotion=True))
    result = generate_profile(request)
    assert result.profile.reduce_motion is True


def test_gaze_data_only_corroborates_and_never_triggers_a_rule_alone():
    request = CalibrationRequest(
        trials=[],
        gazeSummary=GazeSummary(enabled=True, sampleCount=500, distractorGazeRatio=0.9),
    )
    result = generate_profile(request)
    assert result.profile.max_visible_blocks == 10
    assert not any("Gaze" in e for e in result.explanation)


def test_profile_generation_is_deterministic_across_calls():
    trials = [CalibrationTrial(objectCount=9, errorCount=4)]
    request = CalibrationRequest(trials=trials)
    result_a = generate_profile(request)
    result_b = generate_profile(request)
    assert result_a.profile.max_visible_blocks == result_b.profile.max_visible_blocks
    assert result_a.profile.spacing_multiplier == result_b.profile.spacing_multiplier
    assert result_a.profile.simplification_strength == result_b.profile.simplification_strength


def test_never_claims_a_diagnosis():
    result = generate_profile(CalibrationRequest(trials=[]))
    joined = " ".join(result.explanation).lower()
    for banned_word in ("diagnos", "disorder", "disability", "adhd", "autis"):
        assert banned_word not in joined
