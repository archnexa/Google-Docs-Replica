"""Idempotent retries of a content save whose response was lost.

`last_save_id` remembers only the latest successful save (documented limitation).
"""

import uuid

import pytest

from documents.models import Document
from documents.tests.helpers import make_shared_doc, save

pytestmark = pytest.mark.django_db


def test_retry_of_applied_save_is_acknowledged_not_conflicted(users, clients):
    doc = make_shared_doc(users)
    sid = uuid.uuid4()
    first = save(clients["owner"], doc, "<p>draft</p>", 1, sid)
    retry = save(clients["owner"], doc, "<p>draft</p>", 1, sid)  # same attempt, response was "lost"

    assert first.status_code == retry.status_code == 200
    assert retry.json()["version"] == first.json()["version"] == 2
    assert Document.objects.get(pk=doc.pk).version == 2  # applied once


def test_same_save_id_with_different_content_is_conflict(users, clients):
    doc = make_shared_doc(users)
    sid = uuid.uuid4()
    save(clients["owner"], doc, "<p>draft</p>", 1, sid)
    assert save(clients["owner"], doc, "<p>DIFFERENT</p>", 1, sid).status_code == 409


def test_same_save_id_from_another_user_never_acknowledges_their_write(users, clients):
    doc = make_shared_doc(users)
    sid = uuid.uuid4()
    save(clients["owner"], doc, "<p>draft</p>", 1, sid)
    # editor replays owner's save_id + identical content: must not be told "saved"
    resp = save(clients["editor"], doc, "<p>draft</p>", 1, sid)
    assert resp.status_code == 409


def test_older_retry_after_newer_save_is_safe_conflict(users, clients):
    doc = make_shared_doc(users)
    sid1 = uuid.uuid4()
    save(clients["owner"], doc, "<p>v2</p>", 1, sid1)
    save(clients["owner"], doc, "<p>v3</p>", 2, uuid.uuid4())

    late_retry = save(clients["owner"], doc, "<p>v2</p>", 1, sid1)

    assert late_retry.status_code == 409  # accepted limitation: no data lost, user sees conflict UI
    assert Document.objects.get(pk=doc.pk).content == "<p>v3</p>"


def test_retry_matches_on_sanitized_content(users, clients):
    doc = make_shared_doc(users)
    sid = uuid.uuid4()
    dirty = '<p onclick="x()">draft</p>'
    save(clients["owner"], doc, dirty, 1, sid)
    assert save(clients["owner"], doc, dirty, 1, sid).status_code == 200
