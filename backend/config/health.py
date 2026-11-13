from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response


@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
def health(request):
    """Liveness + DB check. Also reports unapplied migrations so deploys can be verified."""
    try:
        executor = MigrationExecutor(connection)
        pending = bool(executor.migration_plan(executor.loader.graph.leaf_nodes()))
    except Exception:  # DB unreachable
        return Response({"ok": False, "database": "unreachable"}, status=503)
    return Response({"ok": True, "database": "ok", "migrations_pending": pending})
