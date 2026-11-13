"""Authorization matrix: every document endpoint × every kind of requester.

No access -> 404 (existence not revealed); insufficient role -> 403; no token -> 401.
Share endpoints are covered in test_sharing.py.
"""

import pytest

from documents.models import Document
from documents.tests.helpers import make_shared_doc, save, url

pytestmark = pytest.mark.django_db

REQUESTERS = ["owner", "editor", "viewer", "stranger", "anonymous"]


def do_read(c, doc):
    return c.get(url(doc))


def do_rename(c, doc):
    return c.patch(url(doc), {"title": "Renamed"}, format="json")


def do_save(c, doc):
    return save(c, doc, "<p>changed</p>", doc.version)


def do_delete(c, doc):
    return c.delete(url(doc))


EXPECTED = {
    #            owner editor viewer stranger anonymous
    do_read:    (200, 200, 200, 404, 401),
    do_rename:  (200, 200, 403, 404, 401),
    do_save:    (200, 200, 403, 404, 401),
    do_delete:  (204, 403, 403, 404, 401),
}

CASES = [(action, who, code) for action, codes in EXPECTED.items() for who, code in zip(REQUESTERS, codes)]


@pytest.mark.parametrize("action,who,expected", CASES, ids=[f"{a.__name__}-{w}" for a, w, _ in CASES])
def test_document_access_matrix(users, clients, action, who, expected):
    doc = make_shared_doc(users)
    before = Document.objects.values("title", "content", "version").get(pk=doc.pk)

    resp = action(clients[who], doc)

    assert resp.status_code == expected, resp.content
    if expected >= 400:
        assert "error" in resp.json()
        # A rejected request must not change anything.
        assert Document.objects.filter(pk=doc.pk).values("title", "content", "version").first() in (before,)


def test_404_body_does_not_distinguish_missing_from_forbidden(users, clients):
    doc = make_shared_doc(users)
    missing = clients["stranger"].get("/api/documents/00000000-0000-4000-8000-000000000000/")
    hidden = clients["stranger"].get(url(doc))
    assert missing.status_code == hidden.status_code == 404
    assert missing.json() == hidden.json()


def test_viewer_403_message_is_clear(users, clients):
    doc = make_shared_doc(users)
    resp = do_save(clients["viewer"], doc)
    assert resp.json()["error"] == {"code": "forbidden", "message": "You have view-only access to this document."}


@pytest.mark.parametrize("who", ["anonymous"])
def test_list_and_create_require_auth(clients, who):
    assert clients[who].get("/api/documents/?scope=owned").status_code == 401
    assert clients[who].post("/api/documents/", {}, format="json").status_code == 401
