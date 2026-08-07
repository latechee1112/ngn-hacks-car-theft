from typing import List, Optional

from pydantic import BaseModel, Field

from models.profile import VisualProfile


class CalibrationTrial(BaseModel):
    """One calibration trial's measured performance.

    Frontend field names aren't fully frozen yet, so unknown extra fields
    are ignored rather than rejected - only the fields the profile rules
    actually use are required.
    """

    model_config = {"populate_by_name": True, "extra": "ignore"}

    object_count: Optional[int] = Field(default=None, alias="objectCount", ge=0)
    completion_time_ms: Optional[float] = Field(
        default=None, alias="completionTimeMs", ge=0
    )
    error_count: Optional[int] = Field(default=None, alias="errorCount", ge=0)
    condition: Optional[str] = Field(
        default=None,
        description="baseline | increasedSpacing | enhancedContrast | reducedMotion | ...",
    )
    success: Optional[bool] = None


class GazeSummary(BaseModel):
    model_config = {"populate_by_name": True}

    enabled: bool = False
    sample_count: int = Field(default=0, alias="sampleCount", ge=0)
    average_dispersion: Optional[float] = Field(
        default=None, alias="averageDispersion", ge=0
    )
    average_target_acquisition_ms: Optional[float] = Field(
        default=None, alias="averageTargetAcquisitionMs", ge=0
    )
    distractor_gaze_ratio: Optional[float] = Field(
        default=None, alias="distractorGazeRatio", ge=0, le=1
    )


class ManualPreferences(BaseModel):
    model_config = {"populate_by_name": True, "extra": "ignore"}

    reduce_motion: Optional[bool] = Field(default=None, alias="reduceMotion")
    progressive_reveal: Optional[bool] = Field(
        default=None, alias="progressiveReveal"
    )


class CalibrationRequest(BaseModel):
    model_config = {"populate_by_name": True}

    trials: List[CalibrationTrial] = Field(default_factory=list, max_length=200)
    gaze_summary: Optional[GazeSummary] = Field(default=None, alias="gazeSummary")
    manual_preferences: Optional[ManualPreferences] = Field(
        default=None, alias="manualPreferences"
    )


class CalibrationProfileResponse(BaseModel):
    profile: VisualProfile
    explanation: List[str]
