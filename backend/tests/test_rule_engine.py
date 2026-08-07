from models.common import ClassificationLabel, PageBlock
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
    defaults = dict(id="b1", tag="div", elementType="other", textPreview="")
    defaults.update(kwargs)
    return PageBlock(**defaults)


def test_password_like_text_is_safety_critical():
    block = make_block(tag="input", elementType="input", textPreview="Password")
    assert rule_engine.classify_block(block) == ClassificationLabel.SAFETY_CRITICAL


def test_safety_critical_action_is_always_keep():
    block = make_block(tag="input", elementType="input", textPreview="Password")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value == "keep"
    assert action.priority == 1


def test_warning_like_text_never_collapsed_even_at_max_simplification():
    block = make_block(tag="div", elementType="paragraph", textPreview="This field is required")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value != "collapse"


def test_article_element_type_is_essential():
    block = make_block(tag="article", elementType="article")
    assert rule_engine.classify_block(block) == ClassificationLabel.ESSENTIAL


def test_nav_is_distracting_and_collapsed_at_high_simplification_strength():
    block = make_block(tag="nav", elementType="nav")
    profile = make_profile(simplification_strength=0.8)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value == "collapse"


def test_distracting_block_only_deemphasized_at_low_simplification_strength():
    block = make_block(tag="nav", elementType="nav")
    profile = make_profile(simplification_strength=0.2)
    action = rule_engine.fallback_action(block, profile)
    assert action.action.value == "deemphasize"


def test_input_never_collapsed_even_if_labeled_distracting():
    # The pure rule engine never classifies input/form/button as Distracting itself
    # (they're Supporting) - this exercises the protection an untrusted LLM label
    # would otherwise bypass.
    block = make_block(tag="input", elementType="input")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.action_for_category(ClassificationLabel.DISTRACTING, block, profile)
    assert action.value != "collapse"


def test_form_never_collapsed_even_if_labeled_distracting():
    block = make_block(tag="form", elementType="form")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.action_for_category(ClassificationLabel.DISTRACTING, block, profile)
    assert action.value != "collapse"


def test_button_never_collapsed_even_if_labeled_distracting():
    block = make_block(tag="button", elementType="button")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.action_for_category(ClassificationLabel.DISTRACTING, block, profile)
    assert action.value != "collapse"


def test_safety_critical_text_never_collapsed_even_if_labeled_distracting():
    block = make_block(tag="div", elementType="paragraph", textPreview="Enter your payment card number")
    profile = make_profile(simplification_strength=1.0)
    action = rule_engine.action_for_category(ClassificationLabel.DISTRACTING, block, profile)
    assert action.value != "collapse"


def test_rule_engine_fallback_produces_action_for_every_block():
    blocks = [make_block(id=f"b{i}", tag="div", elementType="paragraph") for i in range(5)]
    profile = make_profile()
    actions = rule_engine.fallback_actions(blocks, profile)
    assert len(actions) == 5
    assert {a.block_id for a in actions} == {b.id for b in blocks}
