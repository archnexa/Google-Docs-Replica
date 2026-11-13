from html.parser import HTMLParser

import pytest

from documents.models import Document
from documents.sanitize import sanitize
from documents.tests.helpers import make_shared_doc, save, url

# Captured from the real editor: Tiptap 3.33.1 StarterKit `editor.getHTML()` (jsdom).
TIPTAP_HTML = (
    "<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3>"
    "<p><strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <code>code</code></p>"
    "<ul><li><p>bullet</p></li><li><p>bullet 2</p></li></ul>"
    "<ol><li><p>first</p></li></ol>"
    '<ol start="3"><li><p>third</p></li></ol>'
    "<blockquote><p>quote</p></blockquote>"
    "<pre><code>x = 1</code></pre>"
    "<hr>"
    '<p>a<br>b <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">link</a></p>'
    "<p></p>"
)


class _Structure(HTMLParser):
    """Tag/attribute/text sequence with attributes as a set (nh3 does not keep attribute order)."""

    def __init__(self):
        super().__init__()
        self.items = []

    def handle_starttag(self, tag, attrs):
        self.items.append(("start", tag, frozenset(attrs)))

    def handle_endtag(self, tag):
        self.items.append(("end", tag))

    def handle_data(self, data):
        self.items.append(("text", data))


def structure(html: str):
    parser = _Structure()
    parser.feed(html)
    return parser.items


def test_tiptap_formatting_round_trips_unchanged():
    # Identical elements, attributes and text; only attribute *order* may differ (links).
    assert structure(sanitize(TIPTAP_HTML)) == structure(TIPTAP_HTML)


def test_tiptap_html_without_links_is_byte_identical():
    no_links = TIPTAP_HTML.split("<p>a<br>")[0]
    assert sanitize(no_links) == no_links


@pytest.mark.parametrize(
    "payload,forbidden",
    [
        ("<script>alert(1)</script><p>ok</p>", ["<script", "alert(1)"]),
        ('<img src=x onerror="alert(1)">', ["<img", "onerror"]),
        ('<p onclick="steal()">hi</p>', ["onclick", "steal"]),
        ('<a href="javascript:alert(1)">x</a>', ["javascript:"]),
        ('<a href="JaVaScRiPt:alert(1)">x</a>', ["javascript", "JaVaScRiPt"]),
        ('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', ["data:"]),
        ('<iframe src="https://evil.example"></iframe>', ["<iframe", "evil"]),
        ('<p style="background:url(javascript:alert(1))">x</p>', ["style", "javascript"]),
        ('<svg><script>alert(1)</script></svg>', ["<svg", "<script", "alert"]),
        ("<style>body{display:none}</style><p>x</p>", ["<style", "display:none"]),
        ("<object data=x></object><embed src=x>", ["<object", "<embed"]),
        ('<form action="https://evil"><input name=p></form>', ["<form", "<input"]),
        ("<!-- secret --><p>x</p>", ["secret"]),
    ],
)
def test_malicious_html_is_neutralised(payload, forbidden):
    clean = sanitize(payload)
    for needle in forbidden:
        assert needle.lower() not in clean.lower(), clean


def test_links_get_safe_rel():
    assert 'rel="noopener noreferrer nofollow"' in sanitize('<a href="https://x.test" rel="opener">x</a>')


def test_sanitize_is_idempotent():
    once = sanitize('<p onclick="x">a<script>b</script></p>' + TIPTAP_HTML)
    assert sanitize(once) == once


@pytest.mark.django_db
def test_editor_save_endpoint_sanitizes_before_storing(users, clients):
    doc = make_shared_doc(users)
    resp = save(clients["owner"], doc, '<p onclick="x()">safe</p><script>alert(1)</script>', 1)
    assert resp.status_code == 200
    stored = Document.objects.get(pk=doc.pk).content
    assert stored == "<p>safe</p>"
    assert clients["owner"].get(url(doc)).json()["content"] == "<p>safe</p>"
