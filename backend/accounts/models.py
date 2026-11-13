import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class ApiToken(models.Model):
    """Bearer token. Only the SHA-256 hash is stored; the raw value is returned once at login.

    A user may hold several tokens (several browsers / several reviewers sharing a demo
    account), and logout deletes only the token that made the request.
    """

    key_hash = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_tokens")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    @classmethod
    def issue(cls, user) -> tuple["ApiToken", str]:
        raw = secrets.token_urlsafe(32)
        token = cls.objects.create(
            user=user,
            key_hash=hash_token(raw),
            expires_at=timezone.now() + timedelta(days=settings.API_TOKEN_TTL_DAYS),
        )
        return token, raw

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def __str__(self) -> str:
        return f"ApiToken(user={self.user_id}, expires={self.expires_at:%Y-%m-%d})"
