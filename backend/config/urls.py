from django.urls import include, path

from config.health import health

urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/auth/", include("accounts.urls")),
    path("api/documents/", include("documents.urls")),
]
