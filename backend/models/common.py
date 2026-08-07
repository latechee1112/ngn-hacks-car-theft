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


class BoundingBox(BaseModel):
    """Viewport-relative fractions (0-1), not raw pixel/DOM data."""

<<<<<<< HEAD
=======
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


class BoundingBox(BaseModel):
    """Viewport-relative fractions (0-1) of an element's getBoundingClientRect(),
    matching the frontend's BoundingBox contract (frontend/src/types/page.ts) -
    not raw pixels, and not scroll-adjusted since it's viewport-relative."""

>>>>>>> 2ffc2e741f057f663e148ae78953aa543f5593cb
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)
<<<<<<< HEAD
=======


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
>>>>>>> 2ffc2e741f057f663e148ae78953aa543f5593cb


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

    This is the shared contract with the extension frontend - field names
    here must stay in sync with whatever the frontend's DOM extractor emits.
    Unrecognized extra fields are ignored rather than rejected, since the
    frontend schema may still be evolving.
    """

    model_config = {"extra": "ignore"}

    block_id: str = Field(alias="blockId", min_length=1, max_length=64)
    tag: str = Field(max_length=32)
<<<<<<< HEAD
    landmark: Optional[str] = Field(
        default=None,
        description="Detected semantic landmark: main, article, nav, aside, header, footer, form, dialog, other",
    )
    role: Optional[str] = Field(default=None, max_length=64)
    text: str = Field(default="", max_length=2000)

    is_interactive: bool = Field(default=False, alias="isInteractive")
    is_form_control: bool = Field(default=False, alias="isFormControl")
    is_form_instruction: bool = Field(default=False, alias="isFormInstruction")
    is_password_field: bool = Field(default=False, alias="isPasswordField")
    is_payment_field: bool = Field(default=False, alias="isPaymentField")
    is_consent_control: bool = Field(default=False, alias="isConsentControl")
    is_warning: bool = Field(default=False, alias="isWarning")
    is_ad: bool = Field(default=False, alias="isAd")
    is_sticky_promo: bool = Field(default=False, alias="isStickyPromo")
    is_autoplay_media: bool = Field(default=False, alias="isAutoplayMedia")
    is_repeated_link: bool = Field(default=False, alias="isRepeatedLink")
    visible: bool = Field(default=True)

    bounding_box: Optional[BoundingBox] = Field(default=None, alias="boundingBox")

    def is_safety_critical(self) -> bool:
        return (
            self.is_password_field
            or self.is_payment_field
            or self.is_consent_control
            or self.is_warning
        )
=======
    role: str = Field(default="", max_length=64)
    text_preview: str = Field(default="", alias="textPreview", max_length=2000)
    element_type: ElementType = Field(alias="elementType")
    bounding_box: Optional[BoundingBox] = Field(default=None, alias="boundingBox")
    is_interactive: bool = Field(default=False, alias="isInteractive")
    is_fixed: bool = Field(default=False, alias="isFixed")
    has_animation: bool = Field(default=False, alias="hasAnimation")
    link_count: int = Field(default=0, alias="linkCount", ge=0)
    safety_flags: SafetyFlags = Field(default_factory=SafetyFlags, alias="safetyFlags")

    def is_safety_critical(self) -> bool:
        if (
            self.safety_flags.is_consent_control
            or self.safety_flags.is_password_field
            or self.safety_flags.is_payment_field
            or self.safety_flags.is_warning
        ):
            return True
        return bool(self.text_preview) and bool(_SENSITIVE_TEXT_RE.search(self.text_preview))
>>>>>>> 2ffc2e741f057f663e148ae78953aa543f5593cb

    def is_protected_from_collapse(self) -> bool:
        """Blocks that must never be collapsed/hidden, per spec."""
        return (
            self.is_safety_critical()
            or self.is_form_instruction
            or (self.is_form_control and self.visible)
        )


class BlockAction(BaseModel):
    block_id: str = Field(alias="blockId")
    action: ActionType
    priority: int = Field(ge=1, le=99)
    reason: str = Field(max_length=200)

    model_config = {"populate_by_name": True}
