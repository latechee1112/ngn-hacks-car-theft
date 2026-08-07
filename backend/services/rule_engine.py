"""Step 1 (rule-based classification) and Step 4 (LLM fallback).

Pure, deterministic functions - no network calls, no LLM. This is the
safety net: it always produces a valid result, so the API can degrade to
it whenever the LLM is unavailable or returns something invalid.
"""

from models.common import ActionType, ClassificationLabel, ElementType, PageBlock
from models.profile import VisualProfile

_ESSENTIAL_TYPES = {ElementType.ARTICLE}
_SUPPORTING_TYPES = {
    ElementType.HEADING,
    ElementType.PARAGRAPH,
    ElementType.SECTION,
    ElementType.FORM,
    ElementType.INPUT,
    ElementType.BUTTON,
}
_DISTRACTING_TYPES = {
    ElementType.NAV,
    ElementType.SIDEBAR,
    ElementType.AD,
    ElementType.POPUP,
    ElementType.STICKY,
    ElementType.LINK_GROUP,
}

_COLLAPSE_STRENGTH_THRESHOLD = 0.6

_PRIORITY_BY_CATEGORY = {
    ClassificationLabel.SAFETY_CRITICAL: 1,
    ClassificationLabel.ESSENTIAL: 2,
    ClassificationLabel.SUPPORTING: 5,
    ClassificationLabel.UNCERTAIN: 5,
    ClassificationLabel.DISTRACTING: 8,
}


def classify_block(block: PageBlock) -> ClassificationLabel:
    """Step 1: obvious rules, applied before any LLM call."""

    if block.is_safety_critical():
        return ClassificationLabel.SAFETY_CRITICAL

    if block.element_type in _ESSENTIAL_TYPES:
        return ClassificationLabel.ESSENTIAL

    if block.element_type in _DISTRACTING_TYPES:
        return ClassificationLabel.DISTRACTING

    if block.element_type in _SUPPORTING_TYPES:
        return ClassificationLabel.SUPPORTING

    # image, video, other - no strong structural signal either way
    return ClassificationLabel.UNCERTAIN


def action_for_category(
    category: ClassificationLabel, block: PageBlock, profile: VisualProfile
) -> ActionType:
    if category == ClassificationLabel.ESSENTIAL:
        return ActionType.EMPHASIZE

    if category in (
        ClassificationLabel.SAFETY_CRITICAL,
        ClassificationLabel.SUPPORTING,
        ClassificationLabel.UNCERTAIN,
    ):
        return ActionType.KEEP

    # Distracting
    if block.is_protected_from_collapse():
        return ActionType.DEEMPHASIZE
    if profile.simplification_strength >= _COLLAPSE_STRENGTH_THRESHOLD:
        return ActionType.COLLAPSE
    return ActionType.DEEMPHASIZE


def reason_for_category(category: ClassificationLabel) -> str:
    return {
        ClassificationLabel.SAFETY_CRITICAL: "Safety-critical content",
        ClassificationLabel.ESSENTIAL: "Primary page content",
        ClassificationLabel.SUPPORTING: "Supporting content",
        ClassificationLabel.UNCERTAIN: "Uncertain relevance, kept conservatively",
        ClassificationLabel.DISTRACTING: "Low-relevance or distracting content",
    }[category]


def fallback_action(block: PageBlock, profile: VisualProfile):
    """Step 4: full rule-only action for a single block."""
    from models.common import BlockAction

    category = classify_block(block)
    action = action_for_category(category, block, profile)
    priority = _PRIORITY_BY_CATEGORY[category]
    return BlockAction(
        blockId=block.id,
        action=action,
        priority=priority,
        reason=reason_for_category(category),
    )


def fallback_actions(blocks: list[PageBlock], profile: VisualProfile) -> list:
    return [fallback_action(block, profile) for block in blocks]
