from models.common import PageBlock
from models.common import ClassificationLabel
from models.profile import VisualProfile
from services import rule_engine


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


def make_block(**kwargs):
    defaults = dict(blockId="b1", tag="div", text="")
    defaults.update(kwargs)
    return PageBlock(**defaults)


def test_password_field_is_safety_critical():
    block = make_block(tag="input", isPasswordField=True, isFormControl=True)
    assert rule_engine.classify_block(block) == ClassificationLabel.SAFETY_CRITICAL


def test_safety_critical_action_is_always_keep():
    block = make_block(tag="input", isPasswordField=True, isFormControl=True)
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value == "keep"
    assert action.priority == 1


def test_warning_block_never_collapsed_even_at_max_simplification():
    block = make_block(tag="div", isWarning=True)
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value != "collapse"


def test_main_landmark_is_essential():
    block = make_block(tag="div", landmark="main")
    assert rule_engine.classify_block(block) == ClassificationLabel.ESSENTIAL


def test_nav_is_distracting_and_collapsed_at_high_simplification_strength():
    block = make_block(tag="nav", landmark="nav")
    profile = make_profile(simplification_strength=0.8)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value == "collapse"


def test_distracting_block_only_deemphasized_at_low_simplification_strength():
    block = make_block(tag="nav", landmark="nav")
    profile = make_profile(simplification_strength=0.2)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value == "deemphasize"


def test_visible_form_control_never_collapsed_even_if_in_nav():
    block = make_block(tag="button", isInteractive=True, isFormControl=True, landmark="nav")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value != "collapse"


def test_form_instruction_never_collapsed():
    block = make_block(tag="div", isFormInstruction=True, landmark="nav")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value != "collapse"


def test_rule_engine_fallback_produces_action_for_every_block():
    blocks = [make_block(blockId=f"b{i}", tag="div") for i in range(5)]
    profile = make_profile()
    actions = rule_engine.fallback_actions(blocks, profile)
    assert len(actions) == 5
    assert {a.block_id for a in actions} == {b.block_id for b in blocks}
