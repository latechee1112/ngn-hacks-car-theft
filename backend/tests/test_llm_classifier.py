from unittest.mock import MagicMock, patch

import pytest

from config import Settings
from models.common import PageBlock
from models.profile import VisualProfile
from services.llm_classifier import (
    _TEXT_PREVIEW_MAX,
    LLMClassificationError,
    _project_for_llm,
    classify_blocks,
)


def make_settings(**overrides):
    data = dict(featherless_api_key="test-key", featherless_model="test-model")
    data.update(overrides)
    return Settings(**data)


def make_profile():
    return VisualProfile(
        profileId="p1",
        maxVisibleBlocks=6,
        spacingMultiplier=1.2,
        textScale=1.0,
        contrastMode="standard",
        reduceMotion=False,
        progressiveReveal=False,
        simplificationStrength=0.5,
        source="manual",
    )


def make_blocks():
    return [PageBlock(blockId="b1", tag="div", text="hello")]


def _mock_completion(content):
    message = MagicMock()
    message.content = content
    choice = MagicMock()
    choice.message = message
    completion = MagicMock()
    completion.choices = [choice]
    return completion


def test_missing_api_key_raises_immediately():
    settings = make_settings(featherless_api_key="")
    with pytest.raises(LLMClassificationError):
        classify_blocks(make_blocks(), make_profile(), None, settings)


@patch("services.llm_classifier.OpenAI")
def test_malformed_json_raises_llm_classification_error(mock_openai_cls):
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_completion("not json at all")
    mock_openai_cls.return_value = mock_client

    with pytest.raises(LLMClassificationError):
        classify_blocks(make_blocks(), make_profile(), None, make_settings())


@patch("services.llm_classifier.OpenAI")
def test_invalid_label_raises_llm_classification_error(mock_openai_cls):
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_completion(
        '{"classifications": [{"blockId": "b1", "label": "NotARealLabel"}]}'
    )
    mock_openai_cls.return_value = mock_client

    with pytest.raises(LLMClassificationError):
        classify_blocks(make_blocks(), make_profile(), None, make_settings())


@patch("services.llm_classifier.OpenAI")
def test_empty_content_raises_llm_classification_error(mock_openai_cls):
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_completion("")
    mock_openai_cls.return_value = mock_client

    with pytest.raises(LLMClassificationError):
        classify_blocks(make_blocks(), make_profile(), None, make_settings())


@patch("services.llm_classifier.OpenAI")
def test_valid_response_parses_correctly(mock_openai_cls):
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_completion(
        '{"classifications": [{"blockId": "b1", "label": "Essential", "reason": "main content"}]}'
    )
    mock_openai_cls.return_value = mock_client

    result = classify_blocks(make_blocks(), make_profile(), None, make_settings())
    assert len(result) == 1
    assert result[0].blockId == "b1"
    assert result[0].label == "Essential"


@patch("services.llm_classifier.OpenAI")
def test_unrequested_reason_field_is_ignored_not_rejected(mock_openai_cls):
    """A model that emits a reason anyway must not invalidate the response -
    that would dump the whole page onto the rule-engine fallback."""
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _mock_completion(
        '{"classifications": [{"blockId": "b1", "label": "Essential", "reason": "chatty"}]}'
    )
    mock_openai_cls.return_value = mock_client

    result = classify_blocks(make_blocks(), make_profile(), None, make_settings())
    assert result[0].label == "Essential"
    assert not hasattr(result[0], "reason")


def test_projection_drops_safety_flags_and_truncates_text():
    block = PageBlock(
        blockId="b1",
        tag="input",
        role="textbox",
        landmark="form",
        text="x" * 400,
        isInteractive=True,
        isPasswordField=True,
        isConsentControl=True,
        isAd=True,
        boundingBox={"x": 0.123456, "y": 0.654321, "width": 0.5, "height": 0.25},
    )

    projected = _project_for_llm(block)

    assert set(projected) == {
        "blockId",
        "tag",
        "role",
        "elementType",
        "isInteractive",
        "textPreview",
        "roughPosition",
    }
    assert len(projected["textPreview"]) == _TEXT_PREVIEW_MAX
    # Safety is decided server-side in validation, never by the LLM.
    assert "isSafetyCritical" not in projected
    assert "isPasswordField" not in projected
    # Coarse position only - no width/height, rounded to 2dp.
    assert projected["roughPosition"] == {"x": 0.12, "y": 0.65}


def test_projection_omits_position_when_block_has_no_bounding_box():
    projected = _project_for_llm(PageBlock(blockId="b1", tag="p", text="hi"))
    assert "roughPosition" not in projected
