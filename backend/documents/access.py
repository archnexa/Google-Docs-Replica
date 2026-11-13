"""Single source of truth for document access.

Every document and share endpoint goes through `get_doc_for`; nothing relies on the
frontend's route guards.
- no access at all      -> 404 (do not reveal that the document exists)
- access, wrong role    -> 403
"""

from typing import Literal

from rest_framework.exceptions import NotFound, PermissionDenied

from documents.models import Document, DocumentShare, Role

Need = Literal["read", "edit", "owner"]

ALLOWED = {
    "read": {Role.OWNER, Role.EDITOR, Role.VIEWER},
    "edit": {Role.OWNER, Role.EDITOR},
    "owner": {Role.OWNER},
}
FORBIDDEN_MESSAGE = {
    "edit": "You have view-only access to this document.",
    "owner": "Only the document owner can do that.",
}


def role_for(user, doc: Document) -> Role | None:
    """Fresh lookup every call (never cached), so revocations apply on the next request."""
    if doc.owner_id == user.id:
        return Role.OWNER
    role = DocumentShare.objects.filter(document=doc, user=user).values_list("role", flat=True).first()
    return Role(role) if role else None


def check(role: Role | None, need: Need) -> None:
    if role is None:
        raise NotFound("Document not found.")
    if role not in ALLOWED[need]:
        raise PermissionDenied(FORBIDDEN_MESSAGE[need])


def get_doc_for(user, doc_id, need: Need, *, lock: bool = False) -> tuple[Document, Role]:
    """Load a document the user may access with at least `need`.

    With lock=True the document row is locked (SELECT ... FOR UPDATE) and the role is
    evaluated *inside* that lock; callers must already be in transaction.atomic().
    All writers lock the document row before touching its shares (consistent lock order).
    """
    qs = Document.objects.select_related("owner", "last_edited_by")
    if lock:
        qs = qs.select_for_update(of=("self",))
    try:
        doc = qs.get(pk=doc_id)
    except (Document.DoesNotExist, ValueError):
        raise NotFound("Document not found.")
    role = role_for(user, doc)
    check(role, need)
    return doc, role
