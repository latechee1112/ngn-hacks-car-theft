from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator

# Upper bounds on the free-text fields the frontend sends. Custom elements are the
# reason `tag` is not as small as a plain HTML tag name suggests: YouTube ships
# things like "yt-thumbnail-bottom-overlay-view-model" (38 chars), and web
# components in general have no length convention at all.
_TAG_MAX = 64
_ROLE_MAX = 64
_LANDMARK_MAX = 32
_BLOCK_ID_MAX = 64
_TEXT_MAX = 2000


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

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)


class PageBlock(BaseModel):
    """Sanitized metadata describing one visible block on the page.

    This is the shared contract with the extension frontend - field names
    here must stay in sync with whatever the frontend's DOM extractor emits.
    Unrecognized extra fields are ignored rather than rejected, since the
    frontend schema may still be evolving.
    """

    model_config = {"extra": "ignore"}

    block_id: str = Field(alias="blockId", min_length=1, max_length=_BLOCK_ID_MAX)
    tag: str = Field(max_length=_TAG_MAX)
    landmark: Optional[str] = Field(
        default=None,
        max_length=_LANDMARK_MAX,
        description="Detected semantic landmark: main, article, nav, aside, header, footer, form, dialog, other",
    )
    role: Optional[str] = Field(default=None, max_length=_ROLE_MAX)
    text: str = Field(default="", max_length=_TEXT_MAX)

    # Over-length descriptive text is truncated, never rejected. These bounds exist
    # to cap payload size, and a page is not unanalyzable because one element has a
    # long custom tag name - but a max_length violation fails the *whole request*
    # with 422, losing every other block on the page with it. That actually happened
    # on YouTube: one 38-character web-component tag, no analysis for the page.
    # Truncating keeps the field's cap real while making the failure local and
    # harmless, which matters because the frontend's schema is still evolving.
    @field_validator("block_id", "tag", "landmark", "role", "text", mode="before")
    @classmethod
    def _truncate_over_length(cls, value, info):
        if not isinstance(value, str):
            return value
        limits = {
            "block_id": _BLOCK_ID_MAX,
            "tag": _TAG_MAX,
            "landmark": _LANDMARK_MAX,
            "role": _ROLE_MAX,
            "text": _TEXT_MAX,
        }
        return value[: limits[info.field_name]]

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
