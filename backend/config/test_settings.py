"""Settings for pytest.

pytest-django imports settings *before* conftest.py runs, so environment defaults must be
applied here. Tests use SQLite and never read .env.local (the Neon connection). To run the
suite against PostgreSQL, export DATABASE_URL explicitly, e.g.
    DATABASE_URL=postgres://localhost/ajaia_docs pytest
"""

import os

os.environ.setdefault("DEBUG", "1")
os.environ["DJANGO_IGNORE_ENV_LOCAL"] = "1"

from config.settings import *  # noqa: E402,F401,F403

# Fast hashing: tests create several users each; production keeps Django's default PBKDF2.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
