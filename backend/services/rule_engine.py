"""Step 1 (rule-based classification) and Step 4 (LLM fallback).

Pure, deterministic functions - no network calls, no LLM. This is the
safety net: it always produces a valid result, so the API can degrade to
it whenever the LLM is unavailable or returns something invalid.
"""

from zlib import crc32

from models.common import ActionType, ClassificationLabel, PageBlock
from models.profile import VisualProfile

_MAIN_LANDMARKS = {"main", "article"}
_LOW_RELEVANCE_LANDMARKS = {"nav", "aside", "footer"}
_LOW_RELEVANCE_TAGS = {"nav", "aside", "footer"}

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

    if block.is_form_instruction:
        return ClassificationLabel.SUPPORTING

    landmark = (block.landmark or "").lower()
    tag = (block.tag or "").lower()

    if landmark in _MAIN_LANDMARKS:
        return ClassificationLabel.ESSENTIAL

    if tag.startswith("h") and tag[1:].isdigit() and landmark in _MAIN_LANDMARKS | {""}:
        return ClassificationLabel.SUPPORTING

    if block.is_ad or block.is_sticky_promo or block.is_autoplay_media or block.is_repeated_link:
        return ClassificationLabel.DISTRACTING

    if landmark in _LOW_RELEVANCE_LANDMARKS or tag in _LOW_RELEVANCE_TAGS:
        return ClassificationLabel.DISTRACTING

    if block.is_interactive or block.is_form_control:
        return ClassificationLabel.SUPPORTING

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


_REASONS_BY_CATEGORY = {
    ClassificationLabel.SAFETY_CRITICAL: (
        "Safety-critical content",
        "Protected: security or consent content",
        "Kept intact - safety-relevant",
    ),
    ClassificationLabel.ESSENTIAL: (
        "Primary page content",
        "Core content for this page",
        "Main reading content",
    ),
    ClassificationLabel.SUPPORTING: (
        "Supporting content",
        "Secondary content, kept visible",
        "Supports the main content",
    ),
    ClassificationLabel.UNCERTAIN: (
        "Uncertain relevance, kept conservatively",
        "Relevance unclear - left untouched",
        "Ambiguous content, kept to be safe",
    ),
    ClassificationLabel.DISTRACTING: (
        "Low-relevance or distracting content",
        "Peripheral content, de-emphasized",
        "Not relevant to the main content",
    ),
}


def reason_for_category(category: ClassificationLabel, seed: str = "") -> str:
    """Explainability text for a classified block.

    The LLM no longer generates per-block reasons - asking for a free-text
    reason on every block dominated decode time, and decode is sequential.
    These are canned instead. `seed` (pass the block ID) picks between
    phrasings so a page full of one category doesn't read as copy-paste;
    it is hashed with crc32 rather than hash() because str hashing is
    salted per process and would make the same page produce different
    text on every run.
    """
    variants = _REASONS_BY_CATEGORY[category]
    if not seed:
        return variants[0]
    return variants[crc32(seed.encode("utf-8")) % len(variants)]


def fallback_action(block: PageBlock, profile: VisualProfile):
    """Step 4: full rule-only action for a single block."""
    from models.common import BlockAction

    category = classify_block(block)
    action = action_for_category(category, block, profile)
    priority = _PRIORITY_BY_CATEGORY[category]
    return BlockAction(
        blockId=block.block_id,
        action=action,
        priority=priority,
        reason=reason_for_category(category, block.block_id),
    )


def fallback_actions(blocks: list[PageBlock], profile: VisualProfile) -> list:
    return [fallback_action(block, profile) for block in blocks]
