"""Identifier helpers.

Ids are opaque strings to the frontend (`bot-general`, `msg-1`, ...), so the backend keeps the
`prefix_<ulid>` shape: sortable, collision-free, and stable enough to be used as idempotency keys.
"""

from __future__ import annotations

import os
import time
import secrets

_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32, no I/L/O/U

_ID_LENGTH = 26


def _encode(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_B32[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def new_id(prefix: str) -> str:
    """Return a lexicographically sortable id such as `run_01J9Z...`.

    The first 48 bits are a millisecond timestamp, the remaining 80 bits are random. This is a ULID
    layout, generated here rather than pulled as a dependency because it is 15 lines.
    """
    timestamp = int(time.time() * 1000)
    randomness = int.from_bytes(os.urandom(10), "big")
    return f"{prefix}_{_encode((timestamp << 80) | randomness, _ID_LENGTH)}"


def new_secret(length: int = 32) -> str:
    return secrets.token_urlsafe(length)
