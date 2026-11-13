from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle

from accounts.models import ApiToken
from config.errors import error_response

User = get_user_model()


def user_payload(user) -> dict:
    return {"id": user.id, "email": user.email, "name": user.first_name or user.email}


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class LoginThrottle(SimpleRateThrottle):
    """Per-client-IP login limit. Uses the default (per-process, in-memory) cache — a
    documented limitation that is acceptable for a demo with 1-2 gunicorn workers."""

    scope = "login"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


@api_view(["POST"])
@authentication_classes([])
@permission_classes([])
@throttle_classes([LoginThrottle])
def login(request):
    data = LoginSerializer(data=request.data)
    data.is_valid(raise_exception=True)
    email = data.validated_data["email"].strip().lower()
    user = authenticate(request, username=email, password=data.validated_data["password"])
    if user is None:
        return error_response(status.HTTP_400_BAD_REQUEST, "Invalid email or password.", code="invalid_credentials")
    token, raw = ApiToken.issue(user)
    return Response({"token": raw, "expires_at": token.expires_at, "user": user_payload(user)})


@api_view(["POST"])
def logout(request):
    if isinstance(request.auth, ApiToken):
        request.auth.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def me(request):
    return Response(user_payload(request.user))
