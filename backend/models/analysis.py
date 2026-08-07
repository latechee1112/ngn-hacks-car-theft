from typing import List, Optional

from pydantic import BaseModel, Field

from models.common import BlockAction, PageBlock
from models.profile import VisualProfile


class AnalyzePageRequest(BaseModel):
    """Accepts the frontend's ExtractionResult fields directly, plus the
    stored profile and an optional task - i.e. the frontend can send
    {...extractionResult, profile, task} as-is."""

    model_config = {"populate_by_name": True}

    blocks: List[PageBlock]
    profile: VisualProfile
    task: Optional[str] = Field(default=None, max_length=300)
    url: Optional[str] = Field(default=None, max_length=2000)
    extracted_at: Optional[int] = Field(default=None, alias="extractedAt")
    has_sensitive_forms: bool = Field(default=False, alias="hasSensitiveForms")


class LayoutSettings(BaseModel):
    model_config = {"populate_by_name": True}

    max_visible_blocks: int = Field(alias="maxVisibleBlocks")
    spacing_multiplier: float = Field(alias="spacingMultiplier")
    text_scale: float = Field(alias="textScale")
    reduce_motion: bool = Field(alias="reduceMotion")
    progressive_reveal: bool = Field(alias="progressiveReveal")


class AnalyzePageResponse(BaseModel):
    model_config = {"populate_by_name": True}

    analysis_id: str = Field(alias="analysisId")
    summary: str
    actions: List[BlockAction]
    layout: LayoutSettings
    warnings: List[str] = Field(default_factory=list)
