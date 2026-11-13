# Submission — Ajaia Docs

## Links

| | |
|---|---|
| Live product | https://googledocsreplica.netlify.app/login |
| Walkthrough video | https://drive.google.com/file/d/1qKqYWsulrPki5lMxRoNnD6EUtsbwabiU/view?usp=sharing (also in `VIDEO_URL.txt`) |
| Source | https://github.com/archnexa/Google-Docs-Replica |

**Deployment status:** the frontend is live on Netlify. The API (PythonAnywhere) was **not
connected at submission time**, so signing in on the live URL shows "Could not reach the server".
The full product runs locally in about 2 minutes ([README.md](README.md#run-locally)), and the
walkthrough video shows it working. Connecting the live API takes the steps in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deployment).

## Demo credentials (demo only)

The password for all accounts is `demo1234`.
- `alice@ajaia.test`: owner
- `bob@ajaia.test`: editor on Alice's doc
- `carol@ajaia.test`: viewer on Alice's doc

## What's in this folder

| Path | Contents |
|---|---|
| `README.md` | Overview, local setup, tests, configuration |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Walkthrough video link |
| `docs/ARCHITECTURE.md` | Architecture note: priorities, data model, access rule, concurrency, autosave, security, deployment, cuts |
| `docs/AI_WORKFLOW.md` | AI workflow note |
| `docs/ai-log.md` | Detailed chronological AI work log (supporting evidence) |
| `backend/` | Django + DRF API: `accounts` (auth, tokens, demo seed) and `documents` (models, access, services, API, tests) |
| `frontend/` | React + TypeScript app: login, dashboard, Tiptap editor, autosave, tests |
| `deploy/pythonanywhere_wsgi.py` | WSGI template for the API host (no secrets) |
| `netlify.toml` | Frontend build, SPA routing, security headers |
| `scripts/smoke.sh` | End-to-end API smoke test |

Screenshots are not included: local setup needs no extra steps, and the video covers the flows.

## What is working

- **Accounts:** sign-in with seeded demo accounts, plus hashed Bearer tokens with expiry, per-session logout and login throttling.
- **Documents:** create, rename (inline title), edit in the browser, reopen, and delete (owner only, with confirmation).
- **Formatting:** bold, italic, underline, Heading 1–3, bulleted and numbered lists, and undo/redo, all preserved across save and reopen.
- **Autosave:**
  - debounced, with one request in flight at a time and follow-up saves;
  - honest status ("All changes saved" only after the server confirms) and ⌘/Ctrl+S;
  - retry with backoff on network errors, and a warning when closing the tab with unsaved changes.
- **Access:**
  - owner / editor / viewer roles are enforced by the server (404 / 403 / 401);
  - "My documents" and "Shared with me" are kept separate;
  - viewers get a read-only editor.
- **Conflict safety:** a stale save gets 409 with the current server state, and the draft is never overwritten silently.
- **Sanitization:** HTML is sanitized on every write.
- **Tests:** 87 backend tests (SQLite and PostgreSQL) and 23 frontend tests; lint and build are clean.

## What is incomplete

- **Granting access in the app (the sharing API and dialog):** the role model, access rule, server enforcement and the owned-vs-shared views are done and tested, but shares currently come only from seed data, so an owner can't yet add or remove a collaborator in the UI.
- **File upload / import:** not built. The planned scope is `.txt` and `.md` files up to 1 MB, imported as a new document.
- **Conflict-resolution UI:** a conflict is detected and the draft is kept, and the status shows "Not saved — conflict", but there is no banner yet offering *Load theirs / Copy mine / Overwrite*. The controller logic behind it is implemented and tested.
- **Access-revoked banner and the in-app navigation guard:** the state logic is implemented and tested, but the UI isn't wired up.
- **Live API:** see the deployment status above.

## What I'd build next with 2–4 more hours

1. **Sharing, about 40 min:** share endpoints that take the document row lock, plus a share dialog (add by email with a role, change role, revoke) and tests.
2. **Import, about 25 min:** `.txt` and `.md` import with validation of extension, size and UTF-8, sanitization, and no partially created document on failure, plus tests.
3. **Conflict and revoked UX, about 50 min:** the banner with confirmed overwrite, copying or downloading the draft, read-only mode on 403/404, and the `useBlocker` navigation guard.
4. **Deploy and verify, about 20 min:** connect PythonAnywhere to Netlify and run `scripts/smoke.sh` against the live API.
5. If there's time left, `.docx` import (mammoth) and a threaded Postgres race test.
