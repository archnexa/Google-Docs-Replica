# Ajaia Docs — Revised Implementation Plan (v2.1)

> v2.1 = v2 + reviewer's final corrections: save-idempotency scope (§3), atomic authorization + lock order (§3), strict navigation guard (§4), migration safety (§11), editor-first ordering (§13), single Bearer scheme (§7), targeted tests with honest Postgres claims (§12). No new libraries or services.


## Context

Take-home for Ajaia: a scoped Google-Docs-lite (create/rename/edit rich text, save/reopen, file import, owner→user sharing, persistence, deployed, tested, documented). Timebox ~4–6 h. The reviewer approved the architecture but required fixes to: autosave races, conflict UX, Tiptap lifecycle, title versioning, auth hardening, sanitization, import scope, revocation, DB/API consistency, deployment verification, tests, milestone order, deliverables, and no over-engineering. This v2 addresses each (section numbers in **[§n]** map to the review points).

Repo is currently empty except `PLAN.md`. Local toolchain verified: Python 3.13.5, Node 22.18, npm 10.9.

---

## 1. Final architecture

```
Browser (React SPA, Render Static Site)
   │  HTTPS, Authorization: Bearer <token>, JSON / multipart
   ▼
Django 5 + DRF API (Render Web Service, gunicorn)
   │  TLS (sslmode=require)
   ▼
Postgres (Neon)            Local dev/tests: SQLite
```

| Area | Decision |
|---|---|
| Backend | Django 5 + DRF, JSON renderer only, no admin/browsable API in prod |
| Frontend | React 18 + TS + Vite; `createBrowserRouter` (needed for `useBlocker`); no state library — a plain TS `SaveController` class + small hooks |
| Editor | Tiptap (pinned exact version at install; StarterKit + Underline + Placeholder) |
| Storage format | HTML string, sanitized server-side by `nh3` on every write path |
| Auth | Custom lightweight `ApiToken` (hashed, multi-token per user, 7-day expiry), Bearer header. No cookies → no CSRF, no cross-site-cookie issues across two Render domains |
| Concurrency | Content: optimistic compare-and-swap on `version` (409). Title: last-write-wins |
| Import | `.txt`, `.md` required; `.docx` optional stretch |
| Hosting | Render static site + Render free web service + Neon free Postgres (limits verified below; re-verify at signup) |

Not built: WebSockets, Yjs/CRDT, real-time presence, Redis/Celery, microservices, Docker/K8s, sign-up, password reset, comments, version history, attachments. **[§14]**

---

## 2. Data model **[§9]**

```
User                (django.contrib.auth; username = email, first_name for display)

accounts.ApiToken
  key_hash      CharField(64, unique)       sha256 of the raw token; raw token shown once at login
  user          FK User (cascade, indexed)
  created_at    DateTime
  expires_at    DateTime  (created + 7 days)

documents.Document
  id            UUID pk
  owner         FK User (cascade)
  title         CharField(200)  default "Untitled document"
  content       TextField       default ""   (sanitized HTML, ≤ 500 KB)
  version       PositiveIntegerField default 1      — content version only
  last_save_id  UUIDField null                      — idempotency for retried saves (see §4)
  last_edited_by FK User null (SET_NULL)            — fixes the undefined `updated_by` from v1
  created_at    auto_now_add
  updated_at    DateTime (set explicitly in every update path; .update() bypasses auto_now)
  Meta.indexes: (owner, -updated_at)

documents.DocumentShare
  id, document FK (cascade), user FK (cascade), role CharField choices viewer|editor
  created_at
  Meta.constraints: UniqueConstraint(document, user); CheckConstraint(role in {viewer, editor})
  Meta.indexes: (user, document)   — "shared with me" lookup
```

Owner is never a `DocumentShare` row (validated in serializer; owner role derives from `Document.owner`).

**Single access function** `documents/access.py`:
`get_doc_for(user, doc_id, need: "read"|"edit"|"owner") -> (doc, role)`
- no role → raise `NotFound` (404, never leaks existence)
- role but insufficient → raise `PermissionDenied` (403)
- Every document and share view calls it; nothing relies on React route guards. **[§5]**

---

## 3. API contract **[§4, §9]**

Consistent error envelope via custom DRF exception handler:
`{"error": {"code": "not_found|forbidden|validation|conflict|unauthenticated|throttled|bad_file", "message": "…", "fields": {…}?}}` (409 adds `"current": {...}`).

| Method | Path | Access | Behaviour |
|---|---|---|---|
| GET | `/api/health/` | public | `{ok:true}` + DB ping; used for cold-start wake + smoke tests |
| POST | `/api/auth/login/` | public, throttled 10/min/IP | `{email,password}` → `{token, user, expires_at}`; 400 generic "Invalid email or password" |
| POST | `/api/auth/logout/` | authed | deletes **this** token only |
| GET | `/api/auth/me/` | authed | `{id, email, name}` |
| GET | `/api/documents/?scope=owned\|shared` | authed | `[{id,title,owner:{id,email,name},role,updated_at}]`; `select_related('owner')`, role via annotation — 1 query, no N+1 |
| POST | `/api/documents/` | authed | `{title?}` → 201 detail |
| GET | `/api/documents/{id}/` | read | `{id,title,content,version,role,owner,last_edited_by,updated_at}` |
| PATCH | `/api/documents/{id}/` | edit | **title only** `{title}`; last-write-wins; does not touch `version` |
| PUT | `/api/documents/{id}/content/` | edit | `{content, version, save_id}` → 200 `{version, updated_at}`; stale → 409 |
| DELETE | `/api/documents/{id}/` | owner | 204 |
| POST | `/api/documents/import/` | authed | multipart `file` → 201 detail |
| GET/POST | `/api/documents/{id}/shares/` | owner | list / `{email, role}` add |
| PATCH/DELETE | `/api/documents/{id}/shares/{share_id}/` | owner | change role / revoke; share looked up with `document=doc` → other doc's share id = 404 |

**Content save (authorization + CAS in one transaction)** — `documents/services.py::save_content` **[v2.1 §2]**:
```python
clean = sanitize(content)                                   # size check first → 400
with transaction.atomic():
    doc = Document.objects.select_for_update().get(pk=doc_id)   # lock 1: document row
    role = role_for(user, doc)                                  # fresh query, inside the lock
    if role is None:            raise NotFound                  # revoked → 404
    if role not in (OWNER, EDITOR): raise PermissionDenied      # downgraded → 403
    if doc.version != version:
        if (doc.last_save_id == save_id and doc.last_edited_by_id == user.id
                and doc.content == clean):                      # our own retried request
            return 200 {version: doc.version}
        return 409 {error:{code:"conflict"}, current:{version, content, last_edited_by, updated_at}}
    Document.objects.filter(pk=doc.pk).update(content=clean, version=doc.version + 1,
        last_save_id=save_id, last_edited_by=user, updated_at=now())
```
- **Lock order (all writers):** `Document` row first (`select_for_update`), then share rows. Share add/role-change/revoke and document delete also take the document row lock first, so a revoke and a save on the same doc serialize: either the save commits before the revoke, or it runs after and sees no access. No path locks shares before the document → no lock-order deadlock.
- On SQLite `select_for_update` is a no-op but SQLite serializes writers database-wide, so behaviour is still correct locally; the locking itself is only meaningfully exercised on Postgres (see §12).
- **Idempotency scope / accepted limitation [v2.1 §1]:** `last_save_id` remembers only the latest successful save. A retry is acknowledged only if save_id **and** user **and** sanitized content all match the stored latest save, so it can never acknowledge another user's save or a different payload. If an older retry arrives after a newer save has landed, it gets a (safe) 409 and the user sees the conflict UI — no data is lost. Documented in ARCHITECTURE.md; no idempotency table.

**Title decision [§4]:** title is last-write-wins via separate PATCH, independent of `version`. Rationale: rename conflicts are rare and low-cost (visible, one field, trivially redone), and coupling title to the content version would cause false content conflicts whenever someone renames while another edits. Tests: (a) rename with no version succeeds, (b) rename does not bump `version`, (c) content save after a concurrent rename does not 409.

---

## 4. Autosave design **[§1]**

Logic lives in a framework-free class `frontend/src/editor/SaveController.ts` (unit-testable with fake timers and an injected `send` function); `useDocumentAutosave(docId)` wraps it.

### State
```
docId              fixed per instance (one controller per opened document)
localRev           ++ on every user edit
savedRev           highest localRev confirmed by server
serverVersion      last version the server acknowledged
latestHtml         current editor HTML
inFlight           { rev, saveId, html } | null      — at most ONE request
retry              { attempt, timer } | null
status             idle | dirty | saving | saved | retrying | offline | conflict | blocked | disposed
blockedReason      revoked | forbidden | unauthenticated | invalid
conflict           { remoteHtml, remoteVersion, editedBy } | null
```
`isDirty = localRev > savedRev || inFlight != null`. "All changes saved" is shown **only** when `status==="saved" && !isDirty`.

### Transitions
| Event | Action |
|---|---|
| `edit(html)` | `localRev++`, `latestHtml=html`; if status ∈ {conflict, blocked}: keep draft, no save; else status=`dirty`, (re)start debounce 1000 ms, with max-wait 8 s during continuous typing |
| debounce fires / `flushNow()` | if `inFlight` → do nothing (follow-up handled on completion). If conflict/blocked/disposed → no-op. Else send `{content: latestHtml, version: serverVersion, save_id: new uuid}`; `inFlight={rev: localRev,…}`; status=`saving` |
| 200 | ignore UI if disposed. `serverVersion=resp.version`; `savedRev=inFlight.rev`; `inFlight=null`; reset retry. If `localRev > savedRev` → immediately send follow-up; else status=`saved`. **Never** writes response content into the editor (so a stale response can't clobber newer text) |
| 409 | status=`conflict`, store remote; stop timers. Draft stays in editor |
| 401 | status=`blocked/unauthenticated` (session expired) — keep draft, offer Copy draft + Sign in again (opens login, draft also kept in `sessionStorage` keyed by docId) |
| 403 | status=`blocked/forbidden` ("Your access is now view-only") |
| 404 | status=`blocked/revoked` ("You no longer have access to this document") |
| 400/413 | status=`blocked/invalid` with server message (e.g., too large); no retry |
| network error / 5xx / 429 / timeout | status=`retrying`; backoff 2,4,8,16,30 s (+jitter); retry re-sends the **same attempt** (same html, `version`, `save_id`) so a lost-response retry is idempotent; edits made meanwhile only bump `localRev` and go out as the normal follow-up after the retry succeeds. After 5 failures → `offline` with manual "Retry now"; `window.online` event also triggers a retry |
| `dispose()` | status=`disposed`, clear timers; in-flight request is allowed to finish server-side but its result is ignored |

Retries are safe because every save is a CAS; the `save_id` check prevents a lost-response retry from producing a false conflict against our own write (common with Render cold starts/timeouts).

### Navigation & lifecycle
- **Tab close / reload:** `beforeunload` → `preventDefault()` when `isDirty` or status ∈ {conflict, blocked}, plus best-effort `flushNow()`.
- **In-app navigation (back to dashboard, other doc)** **[v2.1 §3]:** `useBlocker(() => !controller.canLeave())`, where `canLeave() = savedRev === localRev && inFlight === null && status ∉ {conflict, blocked, retrying, offline}`. On block: record `navRev = localRev`, `flushNow()`, show "Saving before leaving…" modal. Auto-proceed **only** when `canLeave()` becomes true **and** `localRev === navRev`. If `localRev` changes while pending (user kept typing), auto-navigation is cancelled (`blocker.reset()`) and the user must navigate again. If the save ends in conflict/blocked/offline, the modal offers **Stay** / **Copy draft & leave** / **Leave without saving** — leaving with unsaved changes is always an explicit choice.
- **Switching documents:** route `/d/:id` renders `<EditorPage key={id} />` → full remount, new controller; old controller disposed, so late responses from the previous doc can't touch the new one.
- **StrictMode double-mount:** controller is created inside `useEffect` and disposed in cleanup; a disposed instance ignores everything, so dev double-mount can't double-save.

---

## 5. Conflict UX **[§2]**

On 409 a non-dismissable banner above the editor: *"Bob saved a newer version while you were editing. Your changes are not saved yet."*

- **Load their version** → confirm ("Your unsaved changes will be replaced — copy them first?" with Copy button inside) → `editor.commands.setContent(remote, {emitUpdate:false})` → `controller.adopt(remoteVersion)` (sets `savedRev=localRev`, `serverVersion=remoteVersion`, status `saved`).
- **Copy my draft** → clipboard (HTML + plain text via `ClipboardItem`, fallback textarea select) and **Download draft (.html)** via Blob. Never discards.
- **Overwrite with mine** → confirm dialog ("This replaces Bob's changes for everyone") → `controller.overwrite()` sends draft with `version = remoteVersion` (still conditional). If another save landed meanwhile → new 409 → banner refreshes with the newer remote; user decides again.
- Optional nicety (only if time): a read-only "Their version" preview pane rendered by a second, non-editable Tiptap instance (never `dangerouslySetInnerHTML`).

---

## 6. Tiptap lifecycle **[§3]**

1. `EditorPage` fetches the doc (AbortController; result discarded if `docId` changed/unmounted).
2. Editor is created **only after** load: `useEditor({ extensions, content: doc.content, editable: role !== "viewer", onUpdate })` inside `<DocEditor key={docId} …/>`. Initial `content` doesn't emit `onUpdate` → no initial autosave.
3. `onUpdate` → `controller.edit(editor.getHTML())`. Guard ref `applyingRemote` is set around every programmatic `setContent` (which also uses `emitUpdate:false`), so remote loads can't trigger saves.
4. Role changes (403) → `editor.setEditable(false)`; toolbar disabled.
5. Exact Tiptap API (v2 vs v3 `setContent` signature, `immediatelyRender`, whether Underline is in StarterKit) is verified against the installed version in M4, not assumed.
6. Formatting round-trip guaranteed by matching the nh3 allowlist to the Tiptap schema (test feeds real Tiptap-produced HTML through `sanitize` and asserts equality).

---

## 7. Auth & security **[§5]**

- **One scheme everywhere [v2.1 §6]:** `Authorization: Bearer <token>` — used by `accounts.auth.BearerTokenAuthentication` (`keyword = "Bearer"`), `frontend/src/api/client.ts`, and `scripts/smoke.sh`. Tests assert Bearer works and missing/malformed/other-scheme headers → 401.
- DRF `DEFAULT_AUTHENTICATION_CLASSES = [accounts.auth.BearerTokenAuthentication]` only (no SessionAuthentication → no CSRF surface). `DEFAULT_PERMISSION_CLASSES = [IsAuthenticated]`.
- Token: 32-byte random, stored hashed, 7-day expiry (expired → deleted + 401). Multi-token per user so several reviewers sharing `alice@…` don't log each other out. Logout deletes only the current token.
- **Token storage tradeoff:** `localStorage` (survives refresh, simple). Risk = XSS token theft; mitigated by server-side sanitization, no `dangerouslySetInnerHTML` anywhere (eslint `react/no-danger` = error), React escaping, and a strict CSP on the static site (`default-src 'self'; connect-src <api origin>`) via Render headers. Documented in ARCHITECTURE.md.
- Login throttle: DRF `ScopedRateThrottle` 10/min. Limitation documented: LocMem cache is per-process and resets on restart (fine at this scale, 1–2 gunicorn workers).
- Prod settings: `DEBUG=False`; app refuses to start without `SECRET_KEY`; `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS` from env (exact frontend origin, no wildcards); `SECURE_PROXY_SSL_HEADER`, `SECURE_SSL_REDIRECT`, HSTS (short max-age), `SECURE_CONTENT_TYPE_NOSNIFF`. Render serves HTTPS on both services.
- Demo accounts: `alice@ajaia.test`, `bob@ajaia.test`, `carol@ajaia.test` / `demo1234`. Created only by `seed_demo` (idempotent, never overwrites user-created docs); README + login page label them **demo-only**. No superuser seeded; admin not mounted in prod.
- No secrets committed: `.env` gitignored, `.env.example` with placeholders; Render generates `SECRET_KEY`; Neon URL entered in Render dashboard (`sync: false` in `render.yaml`).

---

## 8. Sanitization **[§6]** — `documents/sanitize.py`

```python
nh3.clean(html,
  tags={"p","br","strong","em","u","s","code","pre","blockquote","h1","h2","h3","ul","ol","li","hr","a"},
  attributes={"a": {"href"}, "ol": {"start"}},
  url_schemes={"http","https","mailto"},
  link_rel="noopener noreferrer nofollow",
  strip_comments=True)
```
- `script/style/iframe/object` contents dropped; all `on*` and `style` attrs dropped; `javascript:`/`data:` hrefs dropped.
- Applied on: content save, import (all formats), seed content. Max 500 KB after sanitize → 413/400.
- Frontend never renders HTML except via Tiptap (schema-parsed). Titles rendered as text.

---

## 9. File import **[§7]**

- Required: `.txt`, `.md`. Optional (M6b): `.docx` via `mammoth` → sanitize.
- Validation order (all before any DB write): file present → extension allowlist (case-insensitive) → size ≤ 1 MB (also `DATA_UPLOAD_MAX_MEMORY_SIZE`) → non-empty → decode UTF-8 (`utf-8-sig`, strict; reject NUL bytes) → convert → sanitize → then `Document.objects.create` inside `transaction.atomic()`. Any failure → 400 `bad_file` with specific message ("Only .txt and .md files are supported", "File is larger than 1 MB", "File must be UTF-8 text", "File is empty"). No partial document possible.
- `.txt`: escape, blank-line → `<p>`, newline → `<br>`. `.md`: Python-Markdown (`extra`, `sane_lists`), raw HTML neutralised by sanitize.
- Title = filename stem, trimmed to 200, fallback "Imported document".
- UI: Import button shows "Supported: .txt, .md (max 1 MB)" next to it; same text in README.

---

## 10. Revocation **[§8]**

- Server: every request re-evaluates access (no cached role) → save after revoke = 404; after downgrade to viewer = 403.
- Client: 403/404 → `blocked` (no retry; distinct from network errors), editor read-only, banner with **Copy draft** / **Download draft**, draft persisted to `sessionStorage` for the tab session.
- Tests: backend (share → revoke → content PUT = 404, GET = 404; downgrade → PUT = 403); frontend `SaveController` (404 → `blocked/revoked`, no further `send` calls after timers advance).

---

## 11. Deployment **[§10]** — verified Nov 2026, re-check at signup

Findings (web search of Render/Neon docs + third-party summaries):
- **Render free web service:** spins down after 15 min idle; wake ≈ up to ~1 min; ephemeral filesystem (fine: we store nothing on disk, uploads parsed in memory); 750 free instance-hours/month. Free Render Postgres expires (30 days) → not used.
- **Render static sites:** free; spin-down behaviour for static sites not confirmed in official docs → verify at deploy.
- **Render pre-deploy command:** I believe it is paid-only → plan runs `migrate` in the build command; verify in dashboard.
- **Neon free:** scale-to-zero after 5 min (fast resume), ~0.5–1 GB storage, 100 CU-h/month — ample.
- Card requirements: unverified; check at signup. If either needs a card, fallback options discussed then (not pre-built).

Plan:
- `render.yaml` blueprint with both services.
  - **api**: build `pip install -r requirements.txt && python manage.py migrate --noinput && python manage.py seed_demo`; start `gunicorn config.wsgi --workers 2 --timeout 60`; health check `/api/health/`. Env: `DJANGO_SETTINGS_MODULE`, `SECRET_KEY` (generateValue), `DATABASE_URL` (sync:false), `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `DEBUG=0`, `PYTHON_VERSION=3.13.x`.
  - **web**: build `npm ci && npm run build`, publish `dist`, `VITE_API_URL`, route rewrite `/* → /index.html`, CSP header.
- DB: Neon **direct** (unpooled) URL with `sslmode=require`; `dj_database_url.parse(conn_max_age=60, conn_health_checks=True, ssl_require=True)` — health checks cover Neon suspending idle connections; direct URL avoids PgBouncer transaction-mode gotchas.
- Migrations **[v2.1 §4]:** run only in the build step (`migrate --plan` printed to the build log, then `migrate`). Documented caveat: the build-step migration hits the **live** Neon DB **before** the new code is serving, so the currently running old code must keep working against the new schema → migrations are **additive/backward-compatible only** (add nullable/defaulted columns, new tables/indexes; no drops/renames/type changes during the review period). A failed migration fails the build and the old version keeps serving. Verification: `/api/health/` reports `migrations_pending: false` (checked via Django's `MigrationExecutor`), and the smoke script asserts it. Migrations are committed; never `makemigrations` in prod.
- Cold start UX: FE pings `/api/health/` on app load; if pending > 3 s shows "Waking up the server (free hosting, can take up to a minute)…"; API client timeout 75 s.
- **Deploy early:** first deploy at end of M2 (health + login working live), redeploy after each milestone.
- Smoke test script `scripts/smoke.sh <api-url>` (curl): health → login alice → create doc → save → reload → share to carol → login carol → read ok / save 403 → cleanup. Run after each deploy; plus manual browser pass.
- Persistence check: create doc, trigger manual redeploy, confirm doc still there.

---

## 12. Tests **[§11]**

Backend (pytest + pytest-django, SQLite) — must-have:
- `test_auth.py`: login ok/bad, token expiry → 401, logout invalidates only that token, unauthenticated → 401 on every doc endpoint, throttle returns 429.
- `test_access.py`: parametrized matrix {owner, editor, viewer, stranger, anonymous} × {list, get, rename, save content, delete, list/add/patch/delete share} → expected {200/201/204, 403, 404, 401}.
- `test_documents.py`: create → save → reopen returns identical sanitized HTML; scope=owned vs shared; query count for list ≤ 2 (`django_assert_num_queries`).
- `test_concurrency.py`: stale version → 409 with current content/version, DB unchanged; overwrite with fresh version → 200; overwrite racing another save → 409 again; title rename LWW tests (§3).
- `test_save_retry.py` **[v2.1 §1, §7]:** retry with same save_id/user/content after success → 200 same version; same save_id but different content → 409; same save_id from a different user → 409 (never acknowledges another's save); older retry after a newer save → 409 (documented limitation).
- `test_authz_save.py` **[v2.1 §2]:** revoke then save → 404; downgrade then save → 403; share mutations take the doc lock (asserted via sequential behaviour on SQLite).
- `test_pg_race.py` — `@pytest.mark.postgres`, **skipped unless `DATABASE_URL` is Postgres**: two threads (revoke vs save; two concurrent saves at same version) → exactly one consistent outcome. Run against a Neon dev branch / local Postgres if available. SUBMISSION.md will say whether it was actually executed and the real result — not claimed otherwise.
- `test_sharing.py`: add by email, unknown email 400, self/owner 400, duplicate 400, invalid role 400, share id from another doc → 404, revoke → subsequent GET/PUT 404, downgrade → PUT 403.
- `test_sanitize.py`: malicious payloads (script, img onerror, `javascript:` href, iframe, style attr, svg) stripped; Tiptap formatting round-trip preserved; idempotent.
- `test_import.py`: txt/md success + formatting; wrong ext, >1 MB, empty, non-UTF-8 → 400 and `Document.objects.count()` unchanged.

Frontend (Vitest) — must-have for the core cases: `SaveController.test.ts` with fake timers and a mocked `send`: debounce, single in-flight + follow-up, stale-response doesn't mark saved, 409 → conflict & no more sends, overwrite → second 409 re-enters conflict, 404/403 → blocked & no retry, network error → retry reuses same save_id → backoff → offline, dispose ignores late response, **navigation**: `canLeave()` false while dirty/in-flight/conflict/blocked; pending-nav cancelled when `localRev` changes (the `useBlocker` wiring itself is verified manually).

Production: smoke script + manual run on Neon (verifies CAS and constraints on Postgres, not just SQLite). Results recorded honestly in SUBMISSION.md — only what was actually run.

---

## 13. Milestones (each independently verifiable) **[§12]**

| # | Milestone | Est. | Verify by |
|---|---|---|---|
| **M1** | Scaffold: Django project (`config`, `accounts`, `documents`), env-driven settings, DRF + CORS, Vite React-TS, router, eslint, `.gitignore`, `.env.example`, `git init`, `docs/ai-log.md` started. **You: create GitHub/Render/Neon accounts in parallel** | 25m | both dev servers run; `pytest` runs (0 tests) |
| **M2** | DB + auth + first deploy: models (all), migrations, `ApiToken` + auth class, login/logout/me, throttle, health, `seed_demo`, FE login page + `AuthContext` + API client (401 handling, cold-start banner), `render.yaml`, push, deploy | 60m | `test_auth.py` green; live: log in as Alice on prod URL; smoke health/login |
| **M3** | Document API + permissions: `access.py`, list/create/get/rename/delete, content PUT CAS + `save_id`, sanitize, error envelope; dashboard (Owned / Shared tabs, New, Delete w/ confirm, empty/loading/error states) | 60m | `test_access`, `test_documents`, `test_concurrency`, `test_sanitize` green; dashboard works live |
| **M4a** | Minimum working editor **[v2.1 §5]:** `DocEditor` (toolbar B/I/U/H1–H3/Normal/bullets/numbers), load-then-create lifecycle, title rename, basic `SaveController` (debounce, single in-flight + follow-up, version tracking, honest status), viewer read-only | 45m | manual: format → refresh → intact; basic SaveController tests green; deployed |
| **M5** | Sharing: share endpoints (with doc-row lock), ShareDialog (add by email + role, change role, revoke, inline errors), owner/role badges | 35m | `test_sharing`, `test_authz_save` green; live: Alice→Carol viewer → read-only |
| **M6a** | Import `.txt` / `.md` + UI copy | 25m | `test_import` green; live import works |
| **M4b** | Autosave hardening: retry/backoff + same-save_id retry, 409 conflict banner (load / copy / confirmed overwrite), 401/403/404 blocked states + revocation banner, navigation blocker + beforeunload | 50m | full `SaveController.test.ts` + `test_save_retry` green; manual: two browsers → conflict; devtools offline → retrying → recovers; revoke while Carol's editor open → blocked, draft kept |
| M6b | *(optional)* `.docx` via mammoth + fixture test | 20m | — |
| **M7** | Polish & prod verification: error states, 404 page, responsive "paper" layout, smoke script on prod, redeploy persistence check, Postgres behaviour check | 30m | smoke script passes on prod; data survives redeploy |
| **M8** | Docs & submission: README, ARCHITECTURE.md, AI_WORKFLOW.md, SUBMISSION.md, VIDEO_URL.txt, video script, screenshots | 35m | reviewer-checklist below fully ticked |
| | **Total (must-haves)** | **~6h** | M6b and extras excluded |

**Critical path:** M1 → M2 (live deploy) → M3 → M4a → M5 → M6a → M4b → M7 → M8. Every required feature exists and is deployed after M6a; M4b hardens it. If time runs short, M4b is trimmed in this order: Download-draft button → "Their version" preview → backoff tuning — while keeping single-flight, 409 handling with confirmed overwrite, blocked-state handling and the navigation guard. M7/M8 time is protected.

Each milestone ends with: tests run (real output noted), redeploy, smoke script, and an `ai-log.md` entry. Failures are reported, not hidden.

---

## 14. Must-have vs optional

**Must-have (assessment requirements + review points):** login w/ seeded demo users; create/rename/edit/save/reopen; B/I/U/headings/lists; autosave with single-flight, follow-up, backoff, honest status; 409 conflict with keep/copy/confirmed overwrite; viewer read-only; share/revoke with owned vs shared lists; revocation handling; `.txt`/`.md` import with validation; server-side authz + sanitize; backend tests listed above; live deploy; all deliverables.

**Optional, in cut order (first cut first):**
1. `.docx` import (M6b)
2. "Their version" preview pane in conflict banner
3. Share role-change PATCH (fallback: revoke + re-add)
4. Download-draft button (Copy draft stays)
5. Undo/redo toolbar buttons (keyboard shortcuts still work)
6. Frontend `SaveController` tests (keep if at all possible — it proves §1)
7. Screenshots / GIF
8. CSP header

---

## 15. Additional implementation risks

| Risk | Mitigation |
|---|---|
| Lost response on retry → false 409 against own write | `last_save_id` idempotency check |
| `.update()` bypasses `auto_now` → stale `updated_at` | set `updated_at=now()` explicitly; test asserts it changes |
| Sanitizer/schema drift silently alters content | allowlist mirrors Tiptap schema; round-trip test with real Tiptap HTML |
| Tiptap v2/v3 API differences | pin exact version; confirm `setContent` options & Underline at install |
| Multiple reviewers share demo accounts concurrently | multi-token auth; conflict guard; `seed_demo` re-creates welcome docs only if missing |
| Reviewer deletes demo docs | `seed_demo` re-seeds missing welcome docs on every deploy; README notes it |
| Render cold start looks like an outage | health ping + "waking up" banner + README/SUBMISSION note + long client timeout |
| Neon idle connection drops | `conn_health_checks=True`, direct URL |
| Throttle per-process | documented limitation |
| `useBlocker` requires data router | use `createBrowserRouter` from M1 |
| `localStorage` token + XSS | sanitize, no raw HTML rendering, CSP, 7-day expiry; documented |
| Timebox overrun (6h is upper bound) | cut list above; M4 time-boxed at 90m |
| Hosting terms change / card required | verify at signup in M1; decide fallback then |

---

## 16. Deliverables & Drive checklist **[§13]**

| Item | Owner | Notes |
|---|---|---|
| Source code | me | Drive: zip of repo without `node_modules`, `.venv`, `.env`, `db.sqlite3` (I'll provide `scripts/package.sh`) + GitHub link |
| `README.md` | me | live URL, demo creds, local setup (backend/frontend), tests, env vars, supported file types/limits, cold-start note |
| `docs/ARCHITECTURE.md` | me | diagram, data model, access rule, autosave state machine, conflict strategy, title LWW, auth/token tradeoffs, cuts & why |
| `docs/AI_WORKFLOW.md` | me + **you** | built from `docs/ai-log.md`: tools used (Claude Code), what AI generated, what was changed/rejected, verification actually run. **Human review section is left for you to fill — I won't invent your review actions or results** |
| `SUBMISSION.md` | me | exact inventory, links, credentials, working / incomplete, next 2–4 h, test results actually observed |
| Live product URL | me + you (accounts) | in README + SUBMISSION |
| `VIDEO_URL.txt` | **you** record | I write a 3–5 min walkthrough script |
| Demo credentials | me | README, SUBMISSION, login page |
| Screenshots/GIF | optional | `docs/screenshots/` |

`docs/ai-log.md` is appended at the end of each milestone with: what was generated, what I changed/rejected and why, commands run and their real output summary.

---

## Verification (end-to-end)

1. `cd backend && pytest` — all backend suites green.
2. `cd frontend && npm run lint && npm test && npm run build`.
3. `scripts/smoke.sh https://<api>.onrender.com` against production.
4. Manual on prod: Alice creates/formats doc → refresh → intact; shares with Bob (editor) & Carol (viewer); Bob & Alice edit concurrently → conflict banner → overwrite w/ confirm; Carol read-only; Alice revokes Carol while open → blocked banner, draft copyable; import `.txt`/`.md`; bad file → clear error; redeploy → data persists.
