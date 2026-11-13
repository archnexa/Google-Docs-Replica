"""Create the DEMO-ONLY accounts and starter documents.

Idempotent and safe to run on every deploy:
- users are created if missing (password reset to the published demo password),
- each starter document is created only if its owner has no document with that title,
- user-created documents and shares are never modified or deleted.

The credentials are intentionally public (README / login page). Do not reuse this pattern
for real accounts.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from documents.models import Document, DocumentShare, Role
from documents.sanitize import sanitize

DEMO_PASSWORD = "demo1234"
DEMO_USERS = [
    ("alice@ajaia.test", "Alice"),
    ("bob@ajaia.test", "Bob"),
    ("carol@ajaia.test", "Carol"),
]

WELCOME_HTML = """
<h1>Welcome to Ajaia Docs</h1>
<p>This is a <strong>demo document</strong> owned by Alice. Try the toolbar: <strong>bold</strong>,
<em>italic</em>, <u>underline</u>, headings and lists.</p>
<h2>Sharing in this demo</h2>
<ul>
  <li>Bob can <strong>edit</strong> this document.</li>
  <li>Carol can only <strong>view</strong> it.</li>
</ul>
<ol>
  <li>Sign in as Bob in another browser and edit at the same time to see conflict handling.</li>
  <li>Sign in as Carol to see the read-only experience.</li>
</ol>
"""

BOB_HTML = """
<h1>Q3 planning notes</h1>
<p>Owned by Bob and shared with Alice as an <em>editor</em>.</p>
<ul><li>Ship the editor MVP</li><li>Collect feedback from the ops team</li></ul>
"""

STARTER_DOCS = [
    # (owner email, title, html, [(share email, role)])
    ("alice@ajaia.test", "Welcome to Ajaia Docs", WELCOME_HTML,
     [("bob@ajaia.test", Role.EDITOR), ("carol@ajaia.test", Role.VIEWER)]),
    ("bob@ajaia.test", "Q3 planning notes", BOB_HTML, [("alice@ajaia.test", Role.EDITOR)]),
]


class Command(BaseCommand):
    help = "Create demo-only users and starter documents (idempotent)."

    @transaction.atomic
    def handle(self, *args, **options):
        User = get_user_model()
        users = {}
        for email, name in DEMO_USERS:
            user, created = User.objects.get_or_create(
                username=email, defaults={"email": email, "first_name": name}
            )
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=["password"])
            users[email] = user
            self.stdout.write(f"{'created' if created else 'exists '} user {email}")

        for owner_email, title, html, shares in STARTER_DOCS:
            owner = users[owner_email]
            if Document.objects.filter(owner=owner, title=title).exists():
                self.stdout.write(f"exists  doc '{title}'")
                continue
            doc = Document.objects.create(owner=owner, title=title, content=sanitize(html.strip()))
            for share_email, role in shares:
                DocumentShare.objects.create(document=doc, user=users[share_email], role=role)
            self.stdout.write(f"created doc '{title}'")
