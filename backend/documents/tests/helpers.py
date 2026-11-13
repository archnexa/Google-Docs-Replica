import uuid

from documents.models import Document, DocumentShare, Role


def make_shared_doc(users, title="Plan", content="<p>hello</p>"):
    """Doc owned by `owner`, shared with `editor` (editor) and `viewer` (viewer)."""
    doc = Document.objects.create(owner=users["owner"], title=title, content=content)
    DocumentShare.objects.create(document=doc, user=users["editor"], role=Role.EDITOR)
    DocumentShare.objects.create(document=doc, user=users["viewer"], role=Role.VIEWER)
    return doc


def url(doc, suffix=""):
    return f"/api/documents/{doc.pk}/{suffix}"


def save(client, doc, content, version, save_id=None):
    return client.put(
        url(doc, "content/"),
        {"content": content, "version": version, "save_id": str(save_id or uuid.uuid4())},
        format="json",
    )
