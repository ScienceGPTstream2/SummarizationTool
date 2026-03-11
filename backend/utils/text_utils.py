"""
utils/text_utils.py

Shared text-sanitization helpers used both when parsing LLM responses
(to prevent json.loads failures on control characters) and before writing
to PostgreSQL (which rejects the null byte \\u0000 in text columns).
"""

import re
from typing import Optional


def sanitize_text(value: Optional[str]) -> Optional[str]:
    """Remove null bytes and other control characters that:
    - cause json.loads to raise ``Invalid control character`` errors, and
    - are rejected by PostgreSQL text columns with ``\\u0000 cannot be converted to text``.

    We preserve the whitespace control characters that are valid inside JSON
    strings: tab (0x09), newline (0x0A), and carriage-return (0x0D).
    """
    if value is None:
        return None
    # Remove null byte first (most common offender from LLM responses)
    value = value.replace("\x00", "")
    # Remove other non-printable ASCII control characters (keep \t \n \r)
    value = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", "", value)
    return value
