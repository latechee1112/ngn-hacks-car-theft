from unittest.mock import MagicMock, patch

import pytest

from config import Settings
from models.common import PageBlock
from models.profile import VisualProfile
from services.llm_classifier import LLMClassificationError, classify_blocks


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
