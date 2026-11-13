"""Document write operations. Each one authorizes and writes inside a single transaction,
holding the document row lock, so a concurrent revoke/downgrade cannot slip in between the
permission check and the write.

Lock order (all writers): Document row first, then its share rows.
"""

from dataclasses import dataclass
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from documents.access import get_doc_for
from documents.models import Document, Role
from documents.sanitize import sanitize


class ContentTooLarge(Exception):
    pass


@dataclass
class SaveOutcome:
    ok: bool
    doc: Document  # on conflict: the current server state


def save_content(user, doc_id, *, content: str, version: int, save_id: UUID) -> SaveOutcome:
    """Optimistic compare-and-swap on `version`.

    Idempotency (accepted limitation): `last_save_id` remembers only the latest successful
    save. A retry is acknowledged only when save_id, author and sanitized content all match
    that latest save, so it can never acknowledge someone else's write or a different payload.
    An older retry arriving after a newer save gets a (safe) 409.
    """
    clean = sanitize(content)
    if len(clean.encode()) > settings.MAX_CONTENT_BYTES:
        raise ContentTooLarge()

    with transaction.atomic():
        doc, _role = get_doc_for(user, doc_id, "edit", lock=True)
        if doc.version != version:
            is_own_retry = (
                doc.last_save_id == save_id and doc.last_edited_by_id == user.id and doc.content == clean
            )
            return SaveOutcome(ok=is_own_retry, doc=doc)

        now = timezone.now()
        Document.objects.filter(pk=doc.pk).update(
            content=clean, version=doc.version + 1, last_save_id=save_id, last_edited_by=user, updated_at=now
        )
        doc.content, doc.version, doc.last_save_id, doc.updated_at = clean, doc.version + 1, save_id, now
        doc.last_edited_by = user
        return SaveOutcome(ok=True, doc=doc)


def rename(user, doc_id, title: str) -> tuple[Document, Role]:
    """Last-write-wins. Does not touch `version`, so renames never cause content conflicts."""
    with transaction.atomic():
        doc, role = get_doc_for(user, doc_id, "edit", lock=True)
        now = timezone.now()
        Document.objects.filter(pk=doc.pk).update(title=title, updated_at=now)
        doc.title, doc.updated_at = title, now
        return doc, role


def delete(user, doc_id) -> None:
    with transaction.atomic():
        doc, _ = get_doc_for(user, doc_id, "owner", lock=True)
        doc.delete()
