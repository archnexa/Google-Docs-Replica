"""Template for PythonAnywhere's WSGI file (Web tab -> "WSGI configuration file").

Copy this whole file into that file on PythonAnywhere and replace the <...> placeholders.
Secrets live only on PythonAnywhere; never commit the filled-in version.

PythonAnywhere free accounts cannot open outbound database connections, so production uses
SQLite on PythonAnywhere's persistent disk (DATABASE_URL is intentionally not set).
"""

import os
import sys

USERNAME = "<your-pythonanywhere-username>"
PROJECT = f"/home/{USERNAME}/Google-Docs-Replica/backend"
if PROJECT not in sys.path:
    sys.path.insert(0, PROJECT)

os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
os.environ["DEBUG"] = "0"
os.environ["SECRET_KEY"] = "<paste a long random secret>"
os.environ["ALLOWED_HOSTS"] = f"{USERNAME}.pythonanywhere.com"
os.environ["CORS_ALLOWED_ORIGINS"] = "https://<your-site>.netlify.app"
# HTTPS is enforced by PythonAnywhere's "Force HTTPS" switch on the Web tab.
os.environ["SECURE_SSL_REDIRECT"] = "0"

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()
