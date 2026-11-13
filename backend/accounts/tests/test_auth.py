from datetime import timedelta

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import ApiToken, hash_token
from conftest import make_user

pytestmark = pytest.mark.django_db

LOGIN = "/api/auth/login/"
ME = "/api/auth/me/"
LOGOUT = "/api/auth/logout/"


def login(client, email="alice@example.test", password="pw-123456"):
    return client.post(LOGIN, {"email": email, "password": password}, format="json")


@pytest.fixture
def alice():
    return make_user("alice@example.test", "Alice")


def test_login_returns_bearer_token_usable_for_me(alice):
    client = APIClient()
    resp = login(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"] == {"id": alice.id, "email": "alice@example.test", "name": "Alice"}
    # Raw token is never stored; only its hash.
    assert not ApiToken.objects.filter(key_hash=body["token"]).exists()
    assert ApiToken.objects.filter(key_hash=hash_token(body["token"])).exists()

    client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['token']}")
    assert client.get(ME).json()["email"] == "alice@example.test"


def test_login_is_case_insensitive_on_email(alice):
    assert login(APIClient(), email="ALICE@example.test").status_code == 200


@pytest.mark.parametrize("email,password", [("alice@example.test", "wrong"), ("nobody@example.test", "pw-123456")])
def test_bad_credentials_get_generic_400(alice, email, password):
    resp = login(APIClient(), email, password)
    assert resp.status_code == 400
    assert resp.json()["error"] == {"code": "invalid_credentials", "message": "Invalid email or password."}


def test_login_validation_error_uses_envelope():
    resp = APIClient().post(LOGIN, {"email": "not-an-email"}, format="json")
    assert resp.status_code == 400
    err = resp.json()["error"]
    assert err["code"] == "validation"
    assert set(err["fields"]) == {"email", "password"}


@pytest.mark.parametrize(
    "header",
    [None, "Bearer", "Bearer not-a-real-token", "Token abc", "bearer abc", "Bearer a b"],
)
def test_missing_or_malformed_auth_is_401(alice, header):
    client = APIClient()
    if header is not None:
        client.credentials(HTTP_AUTHORIZATION=header)
    resp = client.get(ME)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthenticated"


def test_other_scheme_with_valid_token_value_is_rejected(alice):
    _, raw = ApiToken.issue(alice)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {raw}")
    assert client.get(ME).status_code == 401


def test_expired_token_is_401_and_deleted(alice):
    token, raw = ApiToken.issue(alice)
    ApiToken.objects.filter(pk=token.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    assert client.get(ME).status_code == 401
    assert not ApiToken.objects.filter(pk=token.pk).exists()


def test_logout_revokes_only_the_current_token(alice):
    _, raw1 = ApiToken.issue(alice)
    _, raw2 = ApiToken.issue(alice)  # e.g. a second reviewer using the same demo account
    c1, c2 = APIClient(), APIClient()
    c1.credentials(HTTP_AUTHORIZATION=f"Bearer {raw1}")
    c2.credentials(HTTP_AUTHORIZATION=f"Bearer {raw2}")

    assert c1.post(LOGOUT).status_code == 204
    assert c1.get(ME).status_code == 401
    assert c2.get(ME).status_code == 200


def test_inactive_user_token_rejected(alice):
    _, raw = ApiToken.issue(alice)
    alice.is_active = False
    alice.save()
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    assert client.get(ME).status_code == 401


def test_login_is_throttled(alice, monkeypatch):
    from accounts.views import LoginThrottle

    monkeypatch.setattr(LoginThrottle, "rate", "3/min", raising=False)
    client = APIClient()
    codes = [login(client, password="wrong").status_code for _ in range(4)]
    assert codes == [400, 400, 400, 429]
    assert login(client).json()["error"]["code"] == "throttled"


def test_health_is_public():
    resp = APIClient().get("/api/health/")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_seed_demo_is_idempotent_and_never_duplicates():
    call_command("seed_demo")
    call_command("seed_demo")
    from django.contrib.auth import get_user_model

    from documents.models import Document, DocumentShare

    assert get_user_model().objects.filter(username__endswith="@ajaia.test").count() == 3
    assert Document.objects.count() == 2
    assert DocumentShare.objects.count() == 3
    assert login(APIClient(), "carol@ajaia.test", "demo1234").status_code == 200
