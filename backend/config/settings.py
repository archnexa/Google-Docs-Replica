"""Django settings for Ajaia Docs.

All environment-specific values come from environment variables so the same
code runs locally (SQLite, DEBUG on) and on Render (Postgres on Neon, DEBUG off).
See ../.env.example for the full list.
"""

import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent


def load_env_local(path: Path) -> None:
    """Opt-in: load KEY=VALUE pairs from the repo-root `.env.local` written by `neon deploy`.

    Only when DJANGO_USE_ENV_LOCAL=1. Local development defaults to SQLite: a new TLS
    connection to Neon (us-east-2) takes several seconds from here and the dev server opens
    one per request thread, and local experiments should not land in the data reviewers see.
    Real environment variables always win (Render sets DATABASE_URL in its dashboard), and the
    file is gitignored. Tests never load it (config/test_settings.py).
    """
    if os.environ.get("DJANGO_IGNORE_ENV_LOCAL") or not env_bool("DJANGO_USE_ENV_LOCAL") or not path.is_file():
        return
    explicit_db = "DATABASE_URL" in os.environ  # an exported DATABASE_URL must not be overridden
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        key = key.strip()
        if explicit_db and key in {"DATABASE_URL", "DATABASE_URL_UNPOOLED"}:
            continue
        os.environ.setdefault(key, value.strip().strip("'\""))



def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


load_env_local(REPO_ROOT / ".env.local")


DEBUG = env_bool("DEBUG", default=False)

SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-secret-key"  # never used when DEBUG is off
    else:
        raise ImproperlyConfigured("SECRET_KEY must be set when DEBUG is off.")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1" if DEBUG else "")
if os.environ.get("RENDER_EXTERNAL_HOSTNAME"):  # set automatically by Render
    ALLOWED_HOSTS.append(os.environ["RENDER_EXTERNAL_HOSTNAME"])

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "corsheaders",
    "rest_framework",
    "accounts",
    "documents",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

# --- Database ---------------------------------------------------------------
# Local tests: SQLite. Otherwise Neon Postgres. Prefer Neon's direct (unpooled) URL: Django
# keeps its own persistent connections, and PgBouncer transaction pooling breaks server-side
# cursors. On Render, set DATABASE_URL to the direct URL.
DATABASE_URL = os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL", "")
if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=60,
            conn_health_checks=True,  # Neon closes idle connections when it scales to zero
            ssl_require=env_bool("DATABASE_SSL_REQUIRE", default=not DEBUG),
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = []  # no sign-up flow; demo accounts are seeded

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

# --- Uploads ----------------------------------------------------------------
MAX_IMPORT_BYTES = 1 * 1024 * 1024        # 1 MB per imported file
MAX_CONTENT_BYTES = 500 * 1024           # 500 KB of sanitized HTML per document
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024

# --- DRF --------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["accounts.auth.BearerTokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "EXCEPTION_HANDLER": "config.errors.exception_handler",
    "DEFAULT_THROTTLE_RATES": {"login": os.environ.get("LOGIN_THROTTLE_RATE", "10/min")},
    "UNAUTHENTICATED_USER": None,
}

API_TOKEN_TTL_DAYS = 7

# --- CORS -------------------------------------------------------------------
# Exact frontend origin(s) only. Bearer tokens are sent in a header, not cookies,
# so credentials mode is not needed.
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173" if DEBUG else ""
)
CORS_ALLOW_CREDENTIALS = False

# --- Security (production) --------------------------------------------------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")  # Render terminates TLS
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", default=True)
    SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]  # platform health checks hit plain HTTP
    SECURE_HSTS_SECONDS = 3600
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"

SILENCED_SYSTEM_CHECKS = [
    # No cookie/session authentication exists (Bearer header only), so there is no CSRF surface.
    "security.W003",
    # HSTS includeSubDomains/preload are not ours to set on a shared *.onrender.com hostname.
    "security.W005",
    "security.W021",
]

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
