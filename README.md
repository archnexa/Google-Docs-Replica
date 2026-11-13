# Ajaia Docs

A lightweight collaborative document editor inspired by Google Docs: rich-text editing with
autosave, owner / editor / viewer access, and conflict-safe saving.

- **Live app:** https://googledocsreplica.netlify.app/login (see the deployment status in [SUBMISSION.md](SUBMISSION.md))
- **Walkthrough video:** [VIDEO_URL.txt](VIDEO_URL.txt)
- **Architecture note:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **AI workflow note:** [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md)

## Demo accounts (demo only)

All accounts use the password `demo1234`. They are created by `python manage.py seed_demo`.

| Account | Starting state |
|---|---|
| `alice@ajaia.test` | Owns *Welcome to Ajaia Docs*; has edit access to Bob's *Q3 planning notes* |
| `bob@ajaia.test` | Owns *Q3 planning notes*; **editor** on *Welcome* |
| `carol@ajaia.test` | **Viewer** on *Welcome* (read-only) |

## Stack

- **Backend:** Django 5.2 and Django REST Framework, with SQLite by default (Postgres optional via `DATABASE_URL`), nh3 for HTML sanitization, and Bearer-token auth.
- **Frontend:** React 19, TypeScript and Vite, with the Tiptap 3 editor and React Router 7.
- **Tests:** pytest with pytest-django, and Vitest with jsdom.

## Run locally

Requirements: Python 3.12+ and Node 22+.

**1. Backend** (http://127.0.0.1:8000):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DEBUG=1
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 8000
```

**2. Frontend** (http://localhost:5173), in a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173 and sign in with a demo account. In development, Vite forwards
`/api` requests to Django, so no extra configuration is needed.

## Tests

```bash
cd backend && source .venv/bin/activate && pytest              # 87 tests, SQLite
DATABASE_URL=postgres://localhost/<db> pytest                     # same suite on PostgreSQL
cd frontend && npm test && npm run lint && npm run build          # 23 tests, lint, type-check, build
scripts/smoke.sh http://localhost:8000                            # end-to-end API smoke test (15 checks)
```

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `DEBUG` | backend | `1` locally. When `0`, `SECRET_KEY` and `ALLOWED_HOSTS` are required. |
| `SECRET_KEY` | backend | Required in production. |
| `ALLOWED_HOSTS` | backend | Comma-separated, e.g. `user.pythonanywhere.com` |
| `CORS_ALLOWED_ORIGINS` | backend | The exact frontend origin, e.g. `https://googledocsreplica.netlify.app` |
| `DATABASE_URL` | backend | Optional Postgres connection. When unset, SQLite is used. |
| `VITE_API_URL` | frontend (build time) | API origin in production. Leave empty locally. |

Secrets are never committed: `.env` and `.env.local` are gitignored. See [backend/.env.example](backend/.env.example).

## Deployment

- **Frontend:** Netlify, configured by [netlify.toml](netlify.toml). It provides SPA rewrites and a CSP header.
- **API:** PythonAnywhere free plan, using [deploy/pythonanywhere_wsgi.py](deploy/pythonanywhere_wsgi.py) as the WSGI template. Setup steps are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deployment).

Both hosts are free and need no card. Render was the first choice, but its free tier asked for a card.

## Supported content

- Formatting: bold, italic, underline, Heading 1–3, bulleted and numbered lists, and undo/redo. Keyboard shortcuts also work.
- Size limit: each document can hold up to 500 KB of HTML.
- **File import:** not implemented yet; see [SUBMISSION.md](SUBMISSION.md). The planned scope is `.txt` and `.md` files up to 1 MB.
