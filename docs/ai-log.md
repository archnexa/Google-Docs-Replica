# AI working log

Raw, chronological notes kept during the build. `AI_WORKFLOW.md` is distilled from this.
Tool: Claude Code (Claude Opus) in VS Code, driven by the candidate. Entries record what the
AI produced, what was changed or rejected (by the AI's own review or at the candidate's
direction), and which verification was **actually run**. Human review notes are added by the
candidate, not invented here.

---

## Planning (before code)

- AI drafted PLAN.md v1 (stack, data model, API, 11 steps).
- Candidate reviewed v1 and requested a revision covering 14 points (autosave races, conflict UX,
  Tiptap lifecycle, title versioning, auth hardening, sanitization, import scope, revocation,
  DB/API consistency, deployment verification, tests, ordering, deliverables, no over-engineering).
- AI produced v2. Notable corrections vs v1:
  - v1's 409 payload referenced `updated_by`, a field that did not exist → added `last_edited_by`.
  - v1 used DRF's built-in `Token` (one token per user): logging out in one browser would log out
    every reviewer sharing a demo account → replaced with a small hashed multi-token `ApiToken`.
  - v1's autosave was a bare debounce → explicit single-flight state machine (`SaveController`).
- AI's own review of v2 caught that its first retry rule ("new save_id if html changed") could
  cause a false 409 against its own lost-response write → retries now resend the identical attempt.
- Candidate reviewed v2 and required v2.1 fixes: idempotency scope (accept documented limitation),
  authorization/save race (→ `select_for_update` on the document row + consistent lock order),
  stricter navigation guard, migration safety, editor-first ordering, single Bearer scheme,
  honest Postgres test claims.
- Hosting limits checked by web search (Render: 15-min spin-down, ephemeral disk; Neon: scale to
  zero, ~0.5–1 GB). Sources partially conflicted; plan marks items to re-verify at signup.

## M1 — Scaffold

Generated: Django project + apps, env-driven `settings.py`, error envelope handler, health
endpoint (with pending-migration check), Vite React-TS app, router shell, configs.

Changed / rejected during review:
- First version of the login throttle subclassed `ScopedRateThrottle` and overrode internals
  (fragile, hard to read) → rewritten as a 4-line `SimpleRateThrottle` subclass.
- Vite template now ships oxlint instead of ESLint; plan said ESLint. Kept oxlint (it supports
  `react/no-danger`) rather than adding a second linter.
- Tiptap resolved to v3.33.1, whose StarterKit already includes Underline + Link → no separate
  Underline package (plan assumed v2 packaging).
- React resolved to 19 (plan said 18); no code impact so far.

Verified (commands actually run):
- `python manage.py check` → no issues; `migrate` OK on SQLite.
- `curl /api/health/` direct and via Vite proxy → `{"ok":true,...,"migrations_pending":false}`.
- `curl /api/auth/me/` without token → 401.
- `npm run build` OK, `npm run lint` clean, `pytest` runs (0 tests collected).

## M2 — DB, auth, deploy config (local part)

Generated: `Document` / `DocumentShare` / `ApiToken` models + migrations, Bearer auth class,
login/logout/me, login throttle, `seed_demo`, `test_auth.py` (18 tests), frontend API client,
auth context, login page with demo-account hints, wake-up banner, base stylesheet, `render.yaml`,
`scripts/smoke.sh`.

Changed / rejected during review:
- Throttle test first used `override_settings` + resetting DRF's class-level `THROTTLE_RATES`
  (leaks global state between tests) → replaced with `monkeypatch` of the throttle's `rate`.
- First test run failed (`monkeypatch.setattr` on a non-existent class attribute) → fixed with
  `raising=False`; reported here rather than hidden.
- Lint flagged `useAuth` exported from a component module (breaks fast refresh) → moved the
  context + hook to `auth/useAuth.ts`.
- `check --deploy` raised 4 warnings → added clickjacking middleware; silenced CSRF (no cookie
  auth exists) and HSTS subdomain/preload (not applicable to a shared *.onrender.com host), each
  with an inline justification.
- Hard-coding the Render hostname in `ALLOWED_HOSTS` rejected → read Render's automatic
  `RENDER_EXTERNAL_HOSTNAME`.

Verified (commands actually run):
- `pytest` → 18 passed on SQLite; `DATABASE_URL=postgres://localhost/ajaia_docs pytest` → 18 passed
  on local PostgreSQL 18.
- curl via Vite proxy: login → me → logout → me = 401; CORS preflight allowed for
  `http://localhost:5173`, no allow-origin header for an unknown origin.
- `scripts/smoke.sh http://localhost:8000` (auth subset) → 6/6 ok.
- `DEBUG=0 manage.py check --deploy` → no issues.
- Not yet done: real Render/Neon deploy (needs accounts).

## Neon connection (candidate-requested setup)

- Candidate asked to wire Neon via the Neon CLI (`neon init` → `neon deploy` → `.env.local`).
  AI checked the npm package provenance first (`neondatabase/neon-pkgs`, same release as
  `neonctl`). Global install failed (EACCES) → used `npx` instead of `sudo`.
- `neon init` could not install Neon agent skills (requires Node ≥ 22.20, machine has 22.18), so
  the "follow the Neon skills" step relied on Neon's documented guidance instead. `init` also added
  a root `package.json`, `neon.ts`, `node_modules` (CLI config only; the app does not import them).
- Browser sign-in timed out twice (CLI waits 60 s); third attempt completed by the candidate.
- Wiring: settings load repo-root `.env.local` with a 15-line loader (no new dependency); real env
  vars win; `DATABASE_URL_UNPOOLED` (direct) preferred over the pooled URL. AI's own review caught
  that this would override an explicitly exported `DATABASE_URL` → fixed.
- **Mistake caught:** the first test run after wiring hung. Root cause: pytest-django imports
  settings *before* `conftest.py`, so the conftest env defaults never applied — tests were running
  against the Neon production branch and had created `test_neondb` there. (It also meant earlier
  "tests run with DEBUG from conftest" only worked because DEBUG was exported in the shell.)
  Run stopped, `test_neondb` dropped (main DB untouched, 0 tables at the time), and env defaults
  moved to `config/test_settings.py`, which pytest now uses.

Verified (commands actually run):
- Django connects to Neon: postgresql engine, non-pooler host, `sslmode=require`, PostgreSQL 18.7.
- `env -u DEBUG -u DATABASE_URL pytest` → 18 passed on SQLite (no Neon access).
- `migrate --plan` / `migrate` / `seed_demo` on Neon production branch → OK; 2 demo docs.
- `/api/health/` via local server on Neon → ok, `migrations_pending: false`; smoke auth subset 6/6.
- Connection strings were never printed (all CLI output passed through a redaction filter).

## M3 — Document API, permissions, dashboard

Generated: `access.py` (single access rule, 404 vs 403), `services.py` (authorize + write in one
transaction under `select_for_update`; content CAS; rename LWW; owner delete), serializers,
views, dashboard (tabs, create, delete-with-confirm, empty/loading/error), modal/confirm dialog,
tests: access matrix (20 cases), documents, concurrency, save-retry idempotency, sanitization.

Changed / rejected during review:
- Sanitizer round-trip test failed: nh3 re-orders link attributes (`rel` after `href`). The
  fixture had been written from memory → replaced with HTML captured from the real installed
  Tiptap 3.33.1 (`editor.getHTML()` in jsdom); test now compares tags/attribute-sets/text, plus a
  byte-identical check for everything except links.
- Suite took 38 s (PBKDF2 for every test user) → MD5 hasher in test settings only (0.4 s).
- Lint caught `setState` synchronously inside the list effect → loading state is now derived
  from a request key.
- Removed an unused `visible_documents_q` helper the first draft included.

Verified (actually run): `pytest` 87 passed on SQLite and on local PostgreSQL 18; manual API run
(create → save → stale save 409 with current version → reopen sanitized → stranger 404 → rename
keeps version → delete) via the Vite proxy.

Incident while verifying against Neon (reported, not hidden):
- Requests intermittently hung. Root causes found by measurement: a new TLS connection to Neon
  (us-east-2) takes 2–7 s from this machine and Django's threaded dev server opens one per request;
  a ~90-min-old Vite process had also stopped proxying. While restarting, an over-broad
  `kill $(lsof -ti tcp:8000)` also killed Vite (it matched Vite's client socket) → now only
  LISTEN sockets are targeted.
- Decision: local dev defaults to SQLite; Neon is opt-in (`DJANGO_USE_ENV_LOCAL=1`). Render API
  pinned to `region: ohio` (same AWS region as Neon). A leftover "M3 check" doc created on Neon by
  the interrupted run was deleted.

## M4a — Minimum working editor

Generated: `SaveController` (full state machine: debounce + max-wait, single flight + follow-up,
local/saved revisions, CAS version tracking, identical-attempt retries with capped backoff,
conflict / blocked states, navigation-leave states, dispose), `useDocumentAutosave`, toolbar,
honest save-status pill, title field (LWW), editor page (load-then-create), viewer read-only,
Cmd/Ctrl+S, beforeunload guard. Tests: 20 SaveController unit tests (fake timers), 3 component
tests mounting the real Tiptap editor (no save on load; one save per edit at loaded version;
viewer read-only).

Changed / rejected during review:
- Mutation check: deliberately removed the follow-up save, then the identical-attempt retry —
  tests failed (2 and 1 respectively), confirming they guard those behaviours; code restored.
- Component test first used `editor.chain().focus()` → crashed in jsdom (no layout APIs);
  switched to inserting at a position (test-environment issue, not an app bug).
- Bundle was 740 KB → editor route lazy-loaded (initial 327 KB, editor chunk 415 KB).
- `useDocumentAutosave` keeps a lint suppression for `setState` in an effect, with a written
  reason: the controller must be created per mount so StrictMode never reuses a disposed one.

Verified (actually run): `npm test` 23 passed, `npm run lint` clean, `npm run build` OK.
Not yet verified in a real browser by the AI (no browser tool in this session) — left for the
candidate's manual check.
