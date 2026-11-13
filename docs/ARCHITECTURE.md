# Architecture note

## What I prioritized and why

The core loop, *write → format → save → reopen*, has to be trustworthy before anything else
matters. A document editor that silently loses or overwrites text fails, however many features it
has. So the depth went into four areas:

1. **Server-side authorization.** Every request is checked on the server, and the checks are tested.
2. **Conflict-safe saving.** No save silently overwrites another user's newer changes.
3. **An honest autosave state machine.** The editor never claims "saved" when it isn't.
4. **HTML sanitization.** Stored HTML is sanitized on every write path.

Breadth was cut deliberately; see [What was cut](#what-was-cut).

```
Browser: React SPA (Netlify)
   │  HTTPS · Authorization: Bearer <token> · JSON
   ▼
Django REST API (PythonAnywhere) ──► SQLite (persistent disk)  ·  Postgres optional via DATABASE_URL
```

## Data model

```
User           Django auth user; username = email
ApiToken       key_hash (sha256, unique), user, created_at, expires_at (7 days)
Document       id (UUID), owner, title, content (sanitized HTML), version,
               last_save_id, last_edited_by, created_at, updated_at   index (owner, -updated_at)
DocumentShare  document, user, role ∈ {editor, viewer}
               UniqueConstraint(document, user) · CheckConstraint(role) · index (user, document)
```

The owner is never stored as a share row; the owner role comes from `Document.owner`.

## Access rule

[`documents/access.py`](../backend/documents/access.py) is the only place access is decided.

| Role | Read | Edit content / title | Delete, manage sharing |
|---|---|---|---|
| owner | ✓ | ✓ | ✓ |
| editor | ✓ | ✓ | – |
| viewer | ✓ | – | – |

- **No access gives 404**, so the response doesn't reveal that the document exists.
- **The wrong role gives 403.**
- **No token gives 401.**
- **React route guards are UX only.** Security is enforced entirely by Django.

## Saving and concurrency

- **Content uses optimistic concurrency.** `PUT /api/documents/{id}/content/` sends `{content, version, save_id}`. In a single transaction, the server:
  1. locks the document row with `SELECT … FOR UPDATE`;
  2. re-checks the caller's role inside the lock;
  3. compares the version;
  4. writes and increments the version.

  A stale version gets **409** with the server's current content and version. Because the role is checked under the same lock, a concurrent revoke can't slip in between the permission check and the write.
- **Retries are idempotent.** If a response is lost and the client retries the identical attempt (same `save_id`, same user, same sanitized content), the server returns 200 instead of a false conflict.
  - *Accepted limitation:* only the latest save is remembered, so an older retry arriving after a newer save gets a safe 409. No data is lost.
- **Title uses last-write-wins.** `PATCH` changes the title without touching `version`. Renames are rare, cheap and visible, and coupling them to the content version would cause false content conflicts.
- **`updated_at` is set explicitly in every write**, because `QuerySet.update()` bypasses `auto_now`.

## Autosave (frontend)

[`SaveController.ts`](../frontend/src/editor/SaveController.ts) is a framework-free state machine:
`idle → dirty → saving → saved`, plus `retrying`, `offline`, `conflict` and `blocked`.

- **Saving cadence:** a save goes out 1 s after the user stops typing, and at least every 8 s while they keep typing.
- **Single flight:** at most **one request is in flight**. Edits made during a save go out as a follow-up immediately after it finishes.
- **Honest status:** `localRev` and `savedRev` track edits, so the status shows "All changes saved" only when the server has confirmed the latest edit. Responses never write content back into the editor, so a stale response can't replace newer text.
- **Network errors and 5xx:** the client retries the **identical** attempt after 2, 4, 8, 16 and 30 s (with jitter), then shows `offline` with a manual retry. The browser's `online` event also triggers a retry.
- **409, 401, 403, 404, 400 and 413:** no automatic retry, and the local draft is kept.
- **Editor lifecycle:** the editor is created *after* the document loads, with that content as its initial state, so loading never triggers a save. Each document mounts its own `<EditorPage key={id}>`, and its controller is disposed on unmount, so late responses from a previous document are ignored.
- **Leaving the page:** a `beforeunload` warning appears while anything is unsaved. A navigation-guard state (`canLeave`, `beginLeave`) is implemented and unit-tested; the guard UI is not wired up yet.

## Security

- **Tokens:** random 32-byte Bearer tokens, stored as a sha256 hash. Each user can have several, so reviewers sharing a demo account don't log each other out. Tokens expire after 7 days, and logout deletes only the current token.
- **Why tokens rather than cookies:** the frontend and API live on different domains, where cross-site cookies are unreliable. Bearer tokens also mean there is no CSRF surface.
- **Token storage:** the frontend keeps the token in `localStorage`. That risks theft through XSS, mitigated by:
  - sanitizing every write with nh3;
  - React escaping, and no `dangerouslySetInnerHTML` anywhere (enforced by lint);
  - a strict CSP header on the static site.
- **nh3 allowlist:** it mirrors exactly what the Tiptap schema can produce: `p, br, strong, em, u, s, code, pre, blockquote, h1–h3, ul, ol, li, hr, a`, allowing only `http`, `https` and `mailto` links.
- **Login throttling:** 10 attempts per minute per IP. *Limitation:* the counter lives in an in-process cache, which is fine with one web worker.
- **Production settings:** `DEBUG=False`, and the app refuses to start without `SECRET_KEY`. `ALLOWED_HOSTS` and CORS are restricted to exact values, plus HSTS, nosniff and `X-Frame-Options: DENY`. HTTPS is enforced by the host.

## Deployment

**API on PythonAnywhere (free):**
1. `git clone` the repo, create a virtualenv, and run `pip install -r backend/requirements.txt`.
2. Run `DEBUG=1 python manage.py migrate && DEBUG=1 python manage.py seed_demo`.
3. Create a Manual-configuration web app, paste [deploy/pythonanywhere_wsgi.py](../deploy/pythonanywhere_wsgi.py) into its WSGI file with your secret filled in, turn on Force HTTPS, and click Reload.

PythonAnywhere's free plan blocks outbound database connections, so production uses SQLite on its persistent disk.

**Frontend on Netlify (free):** import the repo; [netlify.toml](../netlify.toml) sets the build, SPA rewrites and CSP. Set `VITE_API_URL` to the API origin.

**Migrations:** they are additive only and run before reloading the app, so an old process keeps working against the new schema.

**Hosting choices:**
- *Render:* rejected, because its free tier asked for a card.
- *Neon Postgres:* works (the suite was verified against it), but it can't be reached from PythonAnywhere's free plan.

## What was cut

- Real-time co-editing, cursors and presence. The optimistic-concurrency check prevents silent overwrites without it.
- Comments, version history, sign-up and password reset, attachments, export, and images and tables.
- **Not finished within the timebox:** the sharing UI and API (sharing exists only as seeded data), file import, and the conflict-resolution and access-revoked banners. See [SUBMISSION.md](../SUBMISSION.md).
