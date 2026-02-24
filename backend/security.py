import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Tuple

PBKDF2_ITERATIONS = 390000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored_value: str) -> bool:
    if not stored_value:
        return False

    if not stored_value.startswith("pbkdf2_sha256$"):
        # Compatibilidade com dados legados em texto puro.
        return hmac.compare_digest(stored_value, password)

    try:
        _, iterations, salt, expected_hex = stored_value.split("$", 3)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iterations),
        )
        return hmac.compare_digest(digest.hex(), expected_hex)
    except (ValueError, TypeError):
        return False


def generate_session_token() -> str:
    return secrets.token_urlsafe(48)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_expiry(hours: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def name_from_email(email: str) -> Tuple[str, str]:
    local = (email.split("@", 1)[0] if "@" in email else email).strip()
    if not local:
        return "", ""
    parts = [item for item in local.replace(".", " ").replace("_", " ").split() if item]
    if not parts:
        return local.title(), ""
    if len(parts) == 1:
        return parts[0].title(), ""
    return parts[0].title(), " ".join(parts[1:]).title()
