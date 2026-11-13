from rest_framework import authentication, exceptions

from accounts.models import ApiToken, hash_token


class BearerTokenAuthentication(authentication.BaseAuthentication):
    """`Authorization: Bearer <token>` — the only scheme the API accepts.

    The same scheme is used by frontend/src/api/client.ts and scripts/smoke.sh.
    """

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("latin-1")
        if not header:
            return None  # -> NotAuthenticated (401) on protected views
        parts = header.split()
        if len(parts) != 2 or parts[0] != self.keyword:
            raise exceptions.AuthenticationFailed("Use 'Authorization: Bearer <token>'.")

        token = ApiToken.objects.select_related("user").filter(key_hash=hash_token(parts[1])).first()
        if token is None or not token.user.is_active:
            raise exceptions.AuthenticationFailed("Invalid or expired session. Please sign in again.")
        if token.is_expired:
            token.delete()
            raise exceptions.AuthenticationFailed("Invalid or expired session. Please sign in again.")
        return token.user, token

    def authenticate_header(self, request):
        return self.keyword  # makes DRF answer 401 (not 403) with WWW-Authenticate
