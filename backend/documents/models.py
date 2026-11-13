import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    OWNER = "owner", "Owner"  # derived from Document.owner, never stored on a share
    EDITOR = "editor", "Editor"
    VIEWER = "viewer", "Viewer"


SHARE_ROLES = (Role.EDITOR, Role.VIEWER)


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="documents")
    title = models.CharField(max_length=200, default="Untitled document")
    content = models.TextField(default="", blank=True)  # sanitized HTML
    # Content version for optimistic concurrency. Title changes do NOT bump it.
    version = models.PositiveIntegerField(default=1)
    # Idempotency for a retried content save: remembers only the latest successful save.
    last_save_id = models.UUIDField(null=True, blank=True)
    last_edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Set explicitly in every write path (QuerySet.update() bypasses auto_now).
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [models.Index(fields=["owner", "-updated_at"], name="doc_owner_updated_idx")]

    def __str__(self) -> str:
        return self.title


class DocumentShare(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="shares")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="document_shares")
    role = models.CharField(max_length=10, choices=[(r.value, r.label) for r in SHARE_ROLES])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["document", "user"], name="uniq_share_document_user"),
            models.CheckConstraint(
                condition=models.Q(role__in=[r.value for r in SHARE_ROLES]), name="share_role_valid"
            ),
        ]
        indexes = [models.Index(fields=["user", "document"], name="share_user_doc_idx")]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.document_id} ({self.role})"
