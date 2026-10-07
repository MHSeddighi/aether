"""Password hashing.

argon2id through `argon2-cffi`. Plaintext passwords never leave this module: the application service
depends on `PasswordHasher`/`verify` semantics, not on a storage format.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(plaintext: str) -> str:
    if not plaintext:
        raise ValueError("password must not be empty")
    return _hasher.hash(plaintext)


def verify_password(plaintext: str, password_hash: str) -> bool:
    """Constant-time verification; any malformed or mismatched hash is simply `False`."""
    try:
        return _hasher.verify(password_hash, plaintext)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
