from typing import List, Optional

from pydantic import BaseModel, Field

from models.common import BlockAction, PageBlock
from models.profile import VisualProfile


class AnalyzePageRequest(BaseModel):
    model_config = {"populate_by_name": True}

    blocks: List[PageBlock]
    profile: VisualProfile
    task: Optional[str] = Field(default=None, max_length=300)


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
