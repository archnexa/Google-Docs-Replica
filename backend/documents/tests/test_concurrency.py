"""Optimistic concurrency on content + last-write-wins titles."""

import pytest

from documents.models import Document
from documents.tests.helpers import make_shared_doc, save, url

pytestmark = pytest.mark.django_db


def test_stale_version_gets_409_with_current_state_and_db_unchanged(users, clients):
    doc = make_shared_doc(users)
    assert save(clients["editor"], doc, "<p>editor wins</p>", 1).status_code == 200

    resp = save(clients["owner"], doc, "<p>owner stale</p>", 1)

    assert resp.status_code == 409
    body = resp.json()
    assert body["error"]["code"] == "conflict"
    assert body["current"]["version"] == 2
    assert body["current"]["content"] == "<p>editor wins</p>"
    assert body["current"]["last_edited_by"]["email"] == "editor@example.test"
    stored = Document.objects.get(pk=doc.pk)
    assert (stored.content, stored.version) == ("<p>editor wins</p>", 2)


def test_overwrite_with_fresh_version_succeeds(users, clients):
    doc = make_shared_doc(users)
    save(clients["editor"], doc, "<p>editor</p>", 1)
    conflict = save(clients["owner"], doc, "<p>mine</p>", 1).json()

    resp = save(clients["owner"], doc, "<p>mine</p>", conflict["current"]["version"])

    assert resp.status_code == 200 and resp.json()["version"] == 3
    assert Document.objects.get(pk=doc.pk).content == "<p>mine</p>"


def test_overwrite_racing_another_save_conflicts_again(users, clients):
    doc = make_shared_doc(users)
    save(clients["editor"], doc, "<p>e1</p>", 1)
    remote_version = save(clients["owner"], doc, "<p>mine</p>", 1).json()["current"]["version"]  # 2
    save(clients["editor"], doc, "<p>e2</p>", remote_version)  # lands first -> v3

    resp = save(clients["owner"], doc, "<p>mine</p>", remote_version)

    assert resp.status_code == 409
    assert resp.json()["current"]["version"] == 3
    assert Document.objects.get(pk=doc.pk).content == "<p>e2</p>"


def test_future_version_is_also_a_conflict(users, clients):
    doc = make_shared_doc(users)
    assert save(clients["owner"], doc, "<p>x</p>", 99).status_code == 409


# --- title: last-write-wins, independent of content version -------------------


def test_rename_needs_no_version_and_does_not_bump_it(users, clients):
    doc = make_shared_doc(users)
    resp = clients["editor"].patch(url(doc), {"title": "Editor title"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["version"] == 1
    assert Document.objects.get(pk=doc.pk).version == 1


def test_content_save_after_concurrent_rename_does_not_conflict(users, clients):
    doc = make_shared_doc(users)
    # owner opened the doc at version 1; meanwhile the editor renames it
    clients["editor"].patch(url(doc), {"title": "Renamed by editor"}, format="json")
    assert save(clients["owner"], doc, "<p>owner text</p>", 1).status_code == 200
    stored = Document.objects.get(pk=doc.pk)
    assert (stored.title, stored.content) == ("Renamed by editor", "<p>owner text</p>")


def test_concurrent_renames_last_write_wins(users, clients):
    doc = make_shared_doc(users)
    clients["owner"].patch(url(doc), {"title": "First"}, format="json")
    clients["editor"].patch(url(doc), {"title": "Second"}, format="json")
    assert Document.objects.get(pk=doc.pk).title == "Second"
