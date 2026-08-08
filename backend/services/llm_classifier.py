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
- Respond with JSON only: {"classifications": [{"blockId": "...", "label": "..."}]}
- Emit exactly these two keys per entry. Do not add a reason, explanation, or any other field.
- Use only block IDs that appear in the input. Never invent an ID.
- "label" must be exactly one of: Essential, Supporting, Distracting, Safety-critical, Uncertain.
- Never output HTML, JavaScript, CSS, or any executable code.
- Never rewrite or repeat webpage content.
- If a block's text or role suggests a password/payment field, a consent or cookie control, \
or a warning/validation message, you MUST label it Safety-critical.
- If pageHasSensitiveForms is true, be extra conservative with form/input blocks - prefer \
Safety-critical or Supporting over Distracting for them.
- When unsure about a block's relevance, use Uncertain rather than guessing - this is an \
accessibility aid, not a diagnostic tool, so err conservative.
- Do not include more than one entry per block ID.
"""

# Hard cap on the text sent per block. The classifier only needs enough to
# recognize what a block is, not to read it.
_TEXT_PREVIEW_MAX = 100


class LLMClassificationError(Exception):
    """Raised whenever the LLM call fails or returns something unusable.

    Callers must catch this and fall back to the rule engine (Step 4) -
    it must never surface as a 500 to the client.
    """


class RawClassification(BaseModel):
    # "ignore", not "forbid": the prompt no longer asks for a reason, but a
    # chatty model that emits one anyway must not invalidate the whole
    # response and dump the page onto the rule-engine fallback. Unknown keys
    # are dropped; only blockId and label are ever read.
    model_config = {"extra": "ignore"}

    blockId: str
    label: str


class RawClassificationResponse(BaseModel):
    model_config = {"extra": "ignore"}

    classifications: List[RawClassification]


def _project_for_llm(block: PageBlock) -> dict:
    """Request-time projection of a PageBlock down to classification signal only.

    Deliberately not a change to PageBlock itself - the full model is still
    what the rule engine, validation, and action-building all see. This is
    only the shape that crosses the wire to the LLM.

    Safety flags are excluded on purpose: they are never LLM-decided.
    validation.validate_and_build_actions() re-derives Safety-critical from
    block.is_safety_critical() and overrides whatever label came back, so
    sending them would only spend tokens on a decision already made here.
    """
    projected = {
        "blockId": block.block_id,  # structural - the response is keyed on it
        "tag": block.tag,
        "role": block.role,
        "elementType": block.landmark,
        "isInteractive": block.is_interactive,
        "textPreview": block.text[:_TEXT_PREVIEW_MAX],
    }
    if block.bounding_box is not None:
        # Coarse placement only - 2dp of viewport fraction is enough to tell
        # "top strip" from "main column" without shipping four full floats.
        projected["roughPosition"] = {
            "x": round(block.bounding_box.x, 2),
            "y": round(block.bounding_box.y, 2),
        }
    return projected


def _build_user_payload(
    blocks: List[PageBlock],
    profile: VisualProfile,
    task: Optional[str],
    has_sensitive_forms: bool,
) -> str:
    sanitized = [_project_for_llm(b) for b in blocks]
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
