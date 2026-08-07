import re
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ClassificationLabel(str, Enum):
    ESSENTIAL = "Essential"
    SUPPORTING = "Supporting"
    DISTRACTING = "Distracting"
    SAFETY_CRITICAL = "Safety-critical"
    UNCERTAIN = "Uncertain"


class ActionType(str, Enum):
    EMPHASIZE = "emphasize"
    KEEP = "keep"
    DEEMPHASIZE = "deemphasize"
    COLLAPSE = "collapse"


class ElementType(str, Enum):
    """Mirrors frontend/src/types/page.ts::ElementType exactly."""

    HEADING = "heading"
    PARAGRAPH = "paragraph"
    ARTICLE = "article"
    SECTION = "section"
    NAV = "nav"
    SIDEBAR = "sidebar"
    AD = "ad"
    FORM = "form"
    INPUT = "input"
    BUTTON = "button"
    IMAGE = "image"
    VIDEO = "video"
    POPUP = "popup"
    STICKY = "sticky"
    LINK_GROUP = "link-group"
    OTHER = "other"


class PageBlockPosition(BaseModel):
    """Absolute page-pixel coordinates, as produced by getBoundingClientRect()
    plus scroll offset - not normalized fractions."""

    x: float
    y: float
    width: float = Field(ge=0)
    height: float = Field(ge=0)


# Frontend never extracts a structured "is this a password/payment/consent
# field" flag - only a page-level hasSensitiveForms boolean and each block's
# label/placeholder text (never its value). This regex is the server-side
# safety net for per-block protection; the LLM's own contextual reading of
# textPreview is the primary signal, this just backstops the rule-engine
# fallback path where there's no LLM to lean on.
_SENSITIVE_TEXT_RE = re.compile(
    r"password|passcode|card\s*number|cvv|cvc|expir|payment|billing|"
    r"consent|agree to|terms|required|invalid|error|must be|must contain",
    re.IGNORECASE,
)


class SafetyFlags(BaseModel):
    """Load-bearing classification/safety signals from the frontend's DOM
    heuristics (e.g. is_consent_control caught the consent-banner-hiding
    bug) - a first-class field on PageBlock, not part of the extra:"ignore"
    catch-all."""

    model_config = {"populate_by_name": True}

    is_form_control: bool = Field(default=False, alias="isFormControl")
    is_form_instruction: bool = Field(default=False, alias="isFormInstruction")
    is_password_field: bool = Field(default=False, alias="isPasswordField")
    is_payment_field: bool = Field(default=False, alias="isPaymentField")
    is_consent_control: bool = Field(default=False, alias="isConsentControl")
    is_warning: bool = Field(default=False, alias="isWarning")
    is_ad: bool = Field(default=False, alias="isAd")
    is_repeated_link: bool = Field(default=False, alias="isRepeatedLink")


class PageBlock(BaseModel):
    """Sanitized metadata describing one visible block on the page.

    Mirrors frontend/src/types/page.ts::PageBlock exactly - this is the
    real DOM-extraction contract, not a speculative one.
    """

    model_config = {"populate_by_name": True, "extra": "ignore"}

    id: str = Field(min_length=1, max_length=64)
    tag: str = Field(max_length=32)
    role: str = Field(default="", max_length=64)
    text_preview: str = Field(default="", alias="textPreview", max_length=2000)
    element_type: ElementType = Field(alias="elementType")
    position: Optional[PageBlockPosition] = None
    is_interactive: bool = Field(default=False, alias="isInteractive")
    is_fixed: bool = Field(default=False, alias="isFixed")
    has_animation: bool = Field(default=False, alias="hasAnimation")
    link_count: int = Field(default=0, alias="linkCount", ge=0)
    safety_flags: SafetyFlags = Field(default_factory=SafetyFlags, alias="safetyFlags")

    def is_safety_critical(self) -> bool:
        return bool(self.text_preview) and bool(_SENSITIVE_TEXT_RE.search(self.text_preview))

    def is_protected_from_collapse(self) -> bool:
        """Blocks that must never be collapsed/hidden, per spec: visible
        form controls are never auto-hidden, and anything that reads as
        safety-critical text is never collapsed either."""
        if self.element_type in (ElementType.INPUT, ElementType.FORM, ElementType.BUTTON):
            return True
        return self.is_safety_critical()


class BlockAction(BaseModel):
    block_id: str = Field(alias="blockId")
    action: ActionType
    priority: int = Field(ge=1, le=99)
    reason: str = Field(max_length=200)

    model_config = {"populate_by_name": True}
