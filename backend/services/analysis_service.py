"""Orchestrates the four-step analysis pipeline for POST /v1/analyze-page."""

import logging
import uuid
from typing import List, Tuple

from models.analysis import LayoutSettings
from models.common import BlockAction, PageBlock
from models.profile import VisualProfile
from config import Settings
from services import rule_engine
from services.llm_classifier import LLMClassificationError, classify_blocks
from services.validation import LLMValidationError, validate_and_build_actions

logger = logging.getLogger("focusfit.analysis")


def _summarize(actions: List[BlockAction], blocks_by_id: dict) -> str:
    emphasized = [a for a in actions if a.action.value == "emphasize"]
    if not emphasized:
        return "The page has been simplified based on your visual profile."
    top = sorted(emphasized, key=lambda a: a.priority)[0]
    reason = top.reason or "the most relevant content"
    return f"{reason} appears to be most relevant; less relevant content has been de-emphasized."


def analyze(
    blocks: List[PageBlock],
    profile: VisualProfile,
    task: str | None,
    settings: Settings,
    request_id: str = "",
    has_sensitive_forms: bool = False,
) -> Tuple[str, str, List[BlockAction], LayoutSettings, List[str]]:
    warnings: List[str] = []

    try:
        raw_classifications = classify_blocks(
            blocks, profile, task, settings, has_sensitive_forms=has_sensitive_forms
        )
        actions = validate_and_build_actions(raw_classifications, blocks, profile)
    except (LLMClassificationError, LLMValidationError) as exc:
        logger.warning("request_id=%s Falling back to rule engine: %s", request_id, exc)
        warnings.append("Used rule-based fallback classification (LLM unavailable or invalid).")
        actions = rule_engine.fallback_actions(blocks, profile)

    blocks_by_id = {b.id: b for b in blocks}
    summary = _summarize(actions, blocks_by_id)

    layout = LayoutSettings(
        maxVisibleBlocks=profile.max_visible_blocks,
        spacingMultiplier=profile.spacing_multiplier,
        textScale=profile.text_scale,
        reduceMotion=profile.reduce_motion,
        progressiveReveal=profile.progressive_reveal,
    )

    analysis_id = str(uuid.uuid4())
    return analysis_id, summary, actions, layout, warnings
