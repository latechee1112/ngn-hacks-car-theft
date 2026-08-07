"""Step 3: validate the LLM's classifications against the request's blocks.

Any violation here means the whole LLM response is untrustworthy, so the
caller should discard it entirely and fall back to the rule engine (Step 4)
rather than try to patch a partially-bad response.
"""

from typing import Dict, List

from models.common import BlockAction, ClassificationLabel, PageBlock
from models.profile import VisualProfile
from services.llm_classifier import RawClassification
from services.rule_engine import action_for_category, reason_for_category


class LLMValidationError(Exception):
    """Raised when the LLM's classification response is invalid or unsafe."""


def validate_and_build_actions(
    classifications: List[RawClassification],
    blocks: List[PageBlock],
    profile: VisualProfile,
) -> List[BlockAction]:
    blocks_by_id: Dict[str, PageBlock] = {b.id: b for b in blocks}

    if len(classifications) > len(blocks):
        raise LLMValidationError("LLM returned more classifications than blocks supplied")

    seen_ids: Dict[str, str] = {}
    for c in classifications:
        if c.blockId not in blocks_by_id:
            raise LLMValidationError(f"LLM invented unknown block ID: {c.blockId}")
        if c.blockId in seen_ids and seen_ids[c.blockId] != c.label:
            raise LLMValidationError(f"Duplicate contradictory classification for block: {c.blockId}")
        seen_ids[c.blockId] = c.label

    priority_by_label = {
        ClassificationLabel.SAFETY_CRITICAL: 1,
        ClassificationLabel.ESSENTIAL: 2,
        ClassificationLabel.SUPPORTING: 5,
        ClassificationLabel.UNCERTAIN: 5,
        ClassificationLabel.DISTRACTING: 8,
    }

    actions: List[BlockAction] = []
    classified_ids = set()

    for c in classifications:
        if c.blockId in classified_ids:
            continue  # already handled (identical duplicate) above
        classified_ids.add(c.blockId)

        block = blocks_by_id[c.blockId]
        label = ClassificationLabel(c.label)

        if label != ClassificationLabel.SAFETY_CRITICAL and block.is_safety_critical():
            # The rule engine's hard safety classification always wins.
            label = ClassificationLabel.SAFETY_CRITICAL

        # action_for_category never returns COLLAPSE for a protected block, so
        # safety-critical/form-control/form-instruction content can't be
        # collapsed here regardless of what label the LLM assigned.
        action = action_for_category(label, block, profile)

        actions.append(
            BlockAction(
                blockId=c.blockId,
                action=action,
                priority=priority_by_label[label],
                reason=(c.reason or reason_for_category(label))[:200],
            )
        )

    # Blocks the LLM didn't mention fall back to the rule engine individually.
    from services.rule_engine import fallback_action

    for block in blocks:
        if block.id not in classified_ids:
            actions.append(fallback_action(block, profile))

    return actions
