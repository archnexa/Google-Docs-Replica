"""Server-side HTML sanitization (nh3 / ammonia).

The allowlist mirrors exactly what the Tiptap StarterKit editor can produce, so sanitizing
editor output is a no-op for legitimate content and formatting round-trips unchanged.
Every write path (editor saves, imports, seed data) goes through `sanitize`.
"""

import nh3

ALLOWED_TAGS = {
    "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
    "h1", "h2", "h3", "ul", "ol", "li", "hr", "a",
}
ALLOWED_ATTRIBUTES = {"a": {"href", "target"}, "ol": {"start"}}
ALLOWED_URL_SCHEMES = {"http", "https", "mailto"}


def sanitize(html: str) -> str:
    return nh3.clean(
        html or "",
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        url_schemes=ALLOWED_URL_SCHEMES,
        link_rel="noopener noreferrer nofollow",
        strip_comments=True,
    )
