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
FocusFit. You will be given a JSON list of sanitized webpage block descriptions and must \
classify each block's relevance to the user's stated task.

Rules you MUST follow:
- Respond with JSON only: {"classifications": [{"blockId": "...", "label": "...", "reason": "..."}]}
- Use only block IDs that appear in the input. Never invent an ID.
- "label" must be exactly one of: Essential, Supporting, Distracting, Safety-critical, Uncertain.
- Never output HTML, JavaScript, CSS, or any executable code.
- Never rewrite or repeat webpage content beyond a short "reason" (<=15 words).
- If a block is a password field, payment field, consent control, or warning/validation \
message, you MUST label it Safety-critical.
- If a block is a required form instruction, prefer Supporting or Safety-critical, never Distracting.
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


def _build_user_payload(blocks: List[PageBlock], profile: VisualProfile, task: Optional[str]) -> str:
    sanitized = [
        {
            "blockId": b.block_id,
            "tag": b.tag,
            "landmark": b.landmark,
            "role": b.role,
            "text": b.text,
            "isInteractive": b.is_interactive,
            "isFormControl": b.is_form_control,
            "isFormInstruction": b.is_form_instruction,
            "isSafetyCritical": b.is_safety_critical(),
        }
        for b in blocks
    ]
    payload = {
        "task": task or "General browsing - reduce visual clutter.",
        "simplificationStrength": profile.simplification_strength,
        "blocks": sanitized,
    }
    return json.dumps(payload)


def classify_blocks(
    blocks: List[PageBlock],
    profile: VisualProfile,
    task: Optional[str],
    settings: Settings,
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
                {"role": "user", "content": _build_user_payload(blocks, profile, task)},
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
