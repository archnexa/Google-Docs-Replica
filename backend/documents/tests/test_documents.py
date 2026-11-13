import pytest

from documents.models import Document, DocumentShare, Role
from documents.tests.helpers import make_shared_doc, save, url

pytestmark = pytest.mark.django_db

RICH = (
    "<h1>Title</h1><h2>Sub</h2><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s></p>"
    "<ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol>"
)


def test_create_edit_reopen_preserves_formatting(clients):
    c = clients["owner"]
    created = c.post("/api/documents/", {"title": "  Launch plan  "}, format="json")
    assert created.status_code == 201
    body = created.json()
    assert body["title"] == "Launch plan"  # trimmed
    assert body["role"] == "owner" and body["version"] == 1 and body["content"] == ""

    doc = Document.objects.get(pk=body["id"])
    saved = save(c, doc, RICH, 1)
    assert saved.status_code == 200 and saved.json()["version"] == 2

    reopened = c.get(url(doc)).json()
    assert reopened["content"] == RICH
    assert reopened["version"] == 2
    assert reopened["last_edited_by"]["name"] == "Owner"


def test_create_without_title_uses_default(clients):
    resp = clients["owner"].post("/api/documents/", {}, format="json")
    assert resp.json()["title"] == "Untitled document"
    resp = clients["owner"].post("/api/documents/", {"title": "   "}, format="json")
    assert resp.json()["title"] == "Untitled document"


def test_title_validation(users, clients):
    doc = make_shared_doc(users)
    c = clients["owner"]
    assert c.patch(url(doc), {"title": "   "}, format="json").json()["error"]["message"] == "Title can't be empty."
    too_long = c.patch(url(doc), {"title": "x" * 201}, format="json")
    assert too_long.status_code == 400 and "title" in too_long.json()["error"]["fields"]
    assert c.post("/api/documents/", {"title": "x" * 201}, format="json").status_code == 400


def test_patch_rejects_content_fields(users, clients):
    doc = make_shared_doc(users)
    resp = clients["owner"].patch(url(doc), {"title": "T", "content": "<p>x</p>"}, format="json")
    assert resp.status_code == 400
    assert "content" in resp.json()["error"]["fields"]
    assert Document.objects.get(pk=doc.pk).content == "<p>hello</p>"


def test_owned_vs_shared_lists(users, clients):
    mine = make_shared_doc(users, title="Owner doc")
    other = Document.objects.create(owner=users["editor"], title="Editor doc")
    DocumentShare.objects.create(document=other, user=users["owner"], role=Role.VIEWER)
    Document.objects.create(owner=users["stranger"], title="Private")

    owned = clients["owner"].get("/api/documents/?scope=owned").json()
    shared = clients["owner"].get("/api/documents/?scope=shared").json()
    assert [d["title"] for d in owned] == ["Owner doc"]
    assert owned[0]["role"] == "owner"
    assert [(d["title"], d["role"], d["owner"]["email"]) for d in shared] == [
        ("Editor doc", "viewer", "editor@example.test")
    ]
    # role is the *requesting* user's role
    editor_shared = clients["editor"].get("/api/documents/?scope=shared").json()
    viewer_shared = clients["viewer"].get("/api/documents/?scope=shared").json()
    assert [(d["id"], d["role"]) for d in editor_shared] == [(str(mine.pk), "editor")]
    assert [(d["id"], d["role"]) for d in viewer_shared] == [(str(mine.pk), "viewer")]
    assert "content" not in owned[0]  # list stays light
    assert clients["stranger"].get("/api/documents/?scope=shared").json() == []


def test_invalid_scope_is_400(clients):
    resp = clients["owner"].get("/api/documents/?scope=everything")
    assert resp.status_code == 400 and "scope" in resp.json()["error"]["fields"]


@pytest.mark.parametrize("scope", ["owned", "shared"])
def test_list_query_count_is_constant(users, clients, django_assert_max_num_queries, scope):
    for i in range(5):
        d = Document.objects.create(owner=users["editor" if scope == "shared" else "owner"], title=f"d{i}")
        if scope == "shared":
            DocumentShare.objects.create(document=d, user=users["owner"], role=Role.EDITOR)
    # 1 auth lookup (token+user) + 1 list query
    with django_assert_max_num_queries(2):
        resp = clients["owner"].get(f"/api/documents/?scope={scope}")
    assert len(resp.json()) == 5


def test_lists_sorted_by_last_update(users, clients):
    a = Document.objects.create(owner=users["owner"], title="A")
    Document.objects.create(owner=users["owner"], title="B")
    save(clients["owner"], a, "<p>newer</p>", 1)
    titles = [d["title"] for d in clients["owner"].get("/api/documents/?scope=owned").json()]
    assert titles == ["A", "B"]


def test_updated_at_changes_on_save_and_rename(users, clients):
    doc = make_shared_doc(users)
    t0 = Document.objects.get(pk=doc.pk).updated_at
    save(clients["owner"], doc, "<p>x</p>", 1)
    t1 = Document.objects.get(pk=doc.pk).updated_at
    clients["owner"].patch(url(doc), {"title": "New"}, format="json")
    t2 = Document.objects.get(pk=doc.pk).updated_at
    assert t0 < t1 < t2


def test_owner_delete_cascades_shares(users, clients):
    doc = make_shared_doc(users)
    assert clients["owner"].delete(url(doc)).status_code == 204
    assert not Document.objects.filter(pk=doc.pk).exists()
    assert not DocumentShare.objects.filter(document_id=doc.pk).exists()
    assert clients["editor"].get(url(doc)).status_code == 404


def test_content_too_large_is_413(users, clients):
    doc = make_shared_doc(users)
    big = "<p>" + "a" * (500 * 1024) + "</p>"
    resp = save(clients["owner"], doc, big, 1)
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "too_large"
    assert Document.objects.get(pk=doc.pk).version == 1


@pytest.mark.parametrize(
    "body",
    [{}, {"content": "<p>x</p>"}, {"content": "<p>x</p>", "version": 1}, {"content": "x", "version": 0, "save_id": "not-a-uuid"}],
)
def test_save_payload_validation(users, clients, body):
    doc = make_shared_doc(users)
    resp = clients["owner"].put(url(doc, "content/"), body, format="json")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation"
