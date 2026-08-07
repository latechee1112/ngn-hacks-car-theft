import pytest

from models.common import PageBlock
from models.profile import VisualProfile
from services.llm_classifier import RawClassification
from services.validation import LLMValidationError, validate_and_build_actions


def make_profile(simplification_strength=0.7):
    return VisualProfile(
        profileId="p1",
        maxVisibleBlocks=6,
        spacingMultiplier=1.2,
        textScale=1.0,
        contrastMode="standard",
        reduceMotion=False,
        progressiveReveal=False,
        simplificationStrength=simplification_strength,
        source="manual",
    )


def make_blocks():
    return [
        PageBlock(blockId="b1", tag="div", landmark="main", text="Main content"),
        PageBlock(blockId="b2", tag="input", isPasswordField=True, isFormControl=True, text="Password"),
        PageBlock(blockId="b3", tag="nav", landmark="nav", text="Nav"),
    ]


def test_rejects_unknown_block_id():
    blocks = make_blocks()
    classifications = [RawClassification(blockId="unknown-id", label="Essential")]
    with pytest.raises(LLMValidationError):
        validate_and_build_actions(classifications, blocks, make_profile())


def test_rejects_more_classifications_than_blocks():
    blocks = make_blocks()
    classifications = [RawClassification(blockId=b.block_id, label="Essential") for b in blocks] + [
        RawClassification(blockId="b1", label="Distracting")
    ]
    with pytest.raises(LLMValidationError):
        validate_and_build_actions(classifications, blocks, make_profile())


def test_rejects_duplicate_contradictory_actions():
    blocks = make_blocks()
    classifications = [
        RawClassification(blockId="b1", label="Essential"),
        RawClassification(blockId="b1", label="Distracting"),
    ]
    with pytest.raises(LLMValidationError):
        validate_and_build_actions(classifications, blocks, make_profile())


def test_safety_critical_block_forced_to_keep_even_if_llm_says_distracting():
    blocks = make_blocks()
    classifications = [RawClassification(blockId="b2", label="Distracting")]
    profile = make_profile(simplification_strength=1.0)
    actions = validate_and_build_actions(classifications, blocks, profile)
    b2_action = next(a for a in actions if a.block_id == "b2")
    assert b2_action.action.value == "keep"


def test_unmentioned_blocks_get_rule_engine_fallback_action():
    blocks = make_blocks()
    classifications = [RawClassification(blockId="b1", label="Essential")]
    actions = validate_and_build_actions(classifications, blocks, make_profile())
    assert {a.block_id for a in actions} == {"b1", "b2", "b3"}
