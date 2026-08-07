"""Request-size limits and defense-in-depth text sanitization.

The frontend is expected to already sanitize/truncate, but the server
never trusts that - it enforces the same limits again here.
"""

import re
from typing import List

from fastapi import HTTPException

from config import Settings
from models.common import PageBlock

_SCRIPT_OR_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def sanitize_text(text: str, max_length: int) -> str:
    if not text:
        return ""
    cleaned = _SCRIPT_OR_STYLE_RE.sub("", text)
    cleaned = _TAG_RE.sub("", cleaned)
    cleaned = _CONTROL_CHARS_RE.sub("", cleaned)
    return cleaned[:max_length]


def sanitize_blocks(blocks: List[PageBlock], settings: Settings) -> List[PageBlock]:
    for block in blocks:
        block.text_preview = sanitize_text(block.text_preview, settings.max_block_text_length)
    return blocks


def enforce_block_count(blocks: List[PageBlock], settings: Settings) -> None:
    if len(blocks) > settings.max_blocks_per_request:
        raise HTTPException(
            status_code=413,
            detail=f"Too many blocks: max {settings.max_blocks_per_request} per request",
        )


def enforce_request_size(raw_body: bytes, settings: Settings) -> None:
    if len(raw_body) > settings.max_request_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Request body too large: max {settings.max_request_bytes} bytes",
        )