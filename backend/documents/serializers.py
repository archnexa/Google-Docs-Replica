from rest_framework import serializers

from documents.models import Document

DEFAULT_TITLE = "Untitled document"


class UserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    email = serializers.EmailField()
    name = serializers.SerializerMethodField()

    def get_name(self, user) -> str:
        return user.first_name or user.email


class DocumentSummarySerializer(serializers.ModelSerializer):
    owner = UserSerializer()
    role = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = ["id", "title", "owner", "role", "updated_at"]

    def get_role(self, doc) -> str:
        # Set per-row by the list query (annotation) or by the view for a single document.
        return getattr(doc, "role", None) or self.context["role"]


class DocumentDetailSerializer(DocumentSummarySerializer):
    last_edited_by = UserSerializer(allow_null=True)

    class Meta(DocumentSummarySerializer.Meta):
        fields = DocumentSummarySerializer.Meta.fields + ["content", "version", "last_edited_by"]


# --- inputs -------------------------------------------------------------------


class TitleField(serializers.CharField):
    def __init__(self, **kwargs):
        super().__init__(max_length=200, trim_whitespace=True, **kwargs)


class CreateDocumentSerializer(serializers.Serializer):
    title = TitleField(required=False, allow_blank=True)

    def validate_title(self, value: str) -> str:
        return value or DEFAULT_TITLE


class RenameSerializer(serializers.Serializer):
    title = TitleField(allow_blank=False, error_messages={"blank": "Title can't be empty."})

    def validate(self, attrs):
        extra = set(self.initial_data) - {"title"}
        if extra:
            raise serializers.ValidationError(
                {f: ["Not allowed here. Content is saved via PUT /content/."] for f in sorted(extra)}
            )
        return attrs


class SaveContentSerializer(serializers.Serializer):
    content = serializers.CharField(allow_blank=True, trim_whitespace=False)
    version = serializers.IntegerField(min_value=1)
    save_id = serializers.UUIDField()
