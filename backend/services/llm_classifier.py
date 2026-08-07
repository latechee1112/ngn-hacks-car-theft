"""Step 2: LLM classification of page blocks (Featherless AI, OpenAI-compatible API).

The LLM only ever sees sanitized block metadata and only ever returns a
label per block ID - never HTML, never executable code, never a rewritten
page. Its raw output is untrusted until services.validation checks it.
"""

import json
import logging
from typing import List, Optional

from openai import APIError, APITimeoutError, OpenAI
from pydantic import BaseModel, ValidationError

from config import Settings
from models.common import ClassificationLabel, PageBlock
from models.profile import VisualProfile

logger = logging.getLogger("focusfit.llm_classifier")

_VALID_LABELS = {label.value for label in ClassificationLabel}

_SYSTEM_PROMPT = """You are a page-simplification classifier for an accessibility tool called \
FocusFit. You will be given a JSON list of sanitized webpage block descriptions (each with an \
elementType like heading/paragraph/article/section/nav/sidebar/ad/form/input/button/image/video/ \
popup/sticky/link-group/other) and must classify each block's relevance to the user's stated task.

Rules you MUST follow:
- Respond with JSON only: {"classifications": [{"blockId": "...", "label": "...", "reason": "..."}]}
- Use only block IDs that appear in the input. Never invent an ID.
- "label" must be exactly one of: Essential, Supporting, Distracting, Safety-critical, Uncertain.
- Never output HTML, JavaScript, CSS, or any executable code.
- Never rewrite or repeat webpage content beyond a short "reason" (<=15 words).
- textPreview is only ever a label/placeholder/heading snippet, never real user input - but if it \
reads like a password/payment/consent/warning/validation message, label that block Safety-critical.
- If pageHasSensitiveForms is true, be extra conservative with elementType "form"/"input"/"button" \
blocks - prefer Safety-critical or Supporting over Distracting for them.
- When unsure about a block's relevance, use Uncertain rather than guessing - this is an \
accessibility aid, not a diagnostic tool, so err conservative.
- Do not include more than one entry per block ID.
"""


class LLMClassificationError(Exception):
    """Raised whenever the LLM call fails or returns something unusable.

    Callers must catch this and fall back to the rule engine (Step 4) -
    it must never surface as a 500 to the client.
    """


class RawClassification(BaseModel):
    model_config = {"extra": "forbid"}

    blockId: str
    label: str
    reason: Optional[str] = ""


class RawClassificationResponse(BaseModel):
    model_config = {"extra": "forbid"}

    classifications: List[RawClassification]


def _build_user_payload(
    blocks: List[PageBlock],
    profile: VisualProfile,
    task: Optional[str],
    has_sensitive_forms: bool,
) -> str:
    sanitized = [
        {
            "blockId": b.id,
            "tag": b.tag,
            "role": b.role,
            "elementType": b.element_type.value,
            "textPreview": b.text_preview,
            "isInteractive": b.is_interactive,
            "isSafetyCritical": b.is_safety_critical(),
        }
        for b in blocks
    ]
    payload = {
        "task": task or "General browsing - reduce visual clutter.",
        "simplificationStrength": profile.simplification_strength,
        "pageHasSensitiveForms": has_sensitive_forms,
        "blocks": sanitized,
    }
    return json.dumps(payload)


def classify_blocks(
    blocks: List[PageBlock],
    profile: VisualProfile,
    task: Optional[str],
    settings: Settings,
    has_sensitive_forms: bool = False,
) -> List[RawClassification]:
    if not settings.featherless_api_key:
        raise LLMClassificationError("No LLM API key configured")

    client = OpenAI(
        api_key=settings.featherless_api_key,
        base_url=settings.featherless_base_url,
        timeout=settings.llm_timeout_seconds,
    )

    try:
        completion = client.chat.completions.create(
            model=settings.featherless_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": _build_user_payload(blocks, profile, task, has_sensitive_forms),
                },
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
    except (APIError, APITimeoutError) as exc:
        raise LLMClassificationError(f"LLM request failed: {exc}") from exc

    content = completion.choices[0].message.content if completion.choices else None
    if not content:
        raise LLMClassificationError("LLM returned empty content")

    try:
        raw = json.loads(content)
    except json.JSONDecodeError as exc:
        raise LLMClassificationError(f"LLM did not return valid JSON: {exc}") from exc

    try:
        parsed = RawClassificationResponse.model_validate(raw)
    except ValidationError as exc:
        raise LLMClassificationError(f"LLM JSON failed schema validation: {exc}") from exc

    invalid_labels = [c for c in parsed.classifications if c.label not in _VALID_LABELS]
    if invalid_labels:
        raise LLMClassificationError(
            f"LLM returned unsupported label(s): {[c.label for c in invalid_labels]}"
        )

    return parsed.classifications
