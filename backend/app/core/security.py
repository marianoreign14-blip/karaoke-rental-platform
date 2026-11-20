from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"
DUMMY_PASSWORD_HASH = password_hash.hash("karaoke-dummy-password-for-timing-mitigation")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def password_fingerprint(hashed_password: str) -> str:
    return hashlib.sha256(hashed_password.encode("utf-8")).hexdigest()[:16]


def verify_password_fingerprint(token_version: object, hashed_password: str) -> bool:
    if not isinstance(token_version, str):
        return False
    return hmac.compare_digest(token_version, password_fingerprint(hashed_password))


def create_access_token(subject: str, password_version: str | None = None) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.access_token_minutes)
    claims: dict[str, Any] = {"sub": subject, "iat": now, "exp": expires_at, "type": "access"}
    if password_version is not None:
        claims["pv"] = password_version
    return jwt.encode(
        claims,
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.secret_key,
        algorithms=[ALGORITHM],
        options={"require": ["exp", "sub"]},
    )
    token_type = payload.get("type")
    if token_type is not None and token_type != "access":
        raise jwt.InvalidTokenError("Invalid token type")
    return payload
