from django.db.models import F
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from config.errors import error_response
from documents import services
from documents.access import get_doc_for
from documents.models import Document, Role
from documents.serializers import (
    CreateDocumentSerializer,
    DocumentDetailSerializer,
    DocumentSummarySerializer,
    RenameSerializer,
    SaveContentSerializer,
    UserSerializer,
)


def detail_response(doc, role, status_code=status.HTTP_200_OK):
    return Response(DocumentDetailSerializer(doc, context={"role": role.value}).data, status=status_code)


class DocumentListView(APIView):
    """GET ?scope=owned|shared  — one query each, owner joined, role annotated (no N+1)."""

    def get(self, request):
        scope = request.query_params.get("scope", "owned")
        if scope == "owned":
            docs = Document.objects.filter(owner=request.user).select_related("owner")
            context = {"role": Role.OWNER.value}
        elif scope == "shared":
            # filter() and annotate() on the same multi-valued relation reuse one join, so
            # `role` is the requesting user's share role.
            docs = (
                Document.objects.filter(shares__user=request.user)
                .annotate(role=F("shares__role"))
                .select_related("owner")
            )
            context = {}
        else:
            raise ValidationError({"scope": ["Must be 'owned' or 'shared'."]})
        docs = docs.order_by("-updated_at")
        return Response(DocumentSummarySerializer(docs, many=True, context=context).data)

    def post(self, request):
        data = CreateDocumentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        doc = Document.objects.create(
            owner=request.user, title=data.validated_data.get("title") or "Untitled document"
        )
        return detail_response(doc, Role.OWNER, status.HTTP_201_CREATED)


class DocumentDetailView(APIView):
    def get(self, request, doc_id):
        doc, role = get_doc_for(request.user, doc_id, "read")
        return detail_response(doc, role)

    def patch(self, request, doc_id):
        data = RenameSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        doc, role = services.rename(request.user, doc_id, data.validated_data["title"])
        return detail_response(doc, role)

    def delete(self, request, doc_id):
        services.delete(request.user, doc_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentContentView(APIView):
    def put(self, request, doc_id):
        data = SaveContentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            outcome = services.save_content(request.user, doc_id, **data.validated_data)
        except services.ContentTooLarge:
            return error_response(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "This document is too large to save (limit 500 KB)."
            )
        doc = outcome.doc
        if not outcome.ok:
            editor = doc.last_edited_by
            return error_response(
                status.HTTP_409_CONFLICT,
                "This document was changed by someone else since you opened it.",
                current={
                    "version": doc.version,
                    "content": doc.content,
                    "last_edited_by": UserSerializer(editor).data if editor else None,
                    "updated_at": doc.updated_at,
                },
            )
        return Response({"version": doc.version, "updated_at": doc.updated_at})
