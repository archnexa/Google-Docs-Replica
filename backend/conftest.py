# Environment defaults for tests live in config/test_settings.py (loaded before this file).
import pytest


@pytest.fixture(autouse=True)
def _clear_cache():
    """Throttle counters live in the cache; isolate tests from each other."""
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


def make_user(email: str, name: str = ""):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(
        username=email, email=email, password="pw-123456", first_name=name or email.split("@")[0]
    )


@pytest.fixture
def users(db):
    return {name: make_user(f"{name}@example.test", name.title()) for name in ("owner", "editor", "viewer", "stranger")}


def client_for(user=None):
    """APIClient authenticated with a real Bearer token issued through ApiToken."""
    from rest_framework.test import APIClient

    from accounts.models import ApiToken

    client = APIClient()
    if user is not None:
        _, raw = ApiToken.issue(user)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
    return client


@pytest.fixture
def clients(users):
    c = {name: client_for(u) for name, u in users.items()}
    c["anonymous"] = client_for(None)
    return c
