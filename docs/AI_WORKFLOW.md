# AI workflow note

The detailed, chronological log, with every command and its result, is in [ai-log.md](ai-log.md).

## Tools used

- **Claude Code** (Claude Opus, in VS Code): planning, backend, frontend logic, tests, deploy config and docs.
- **Codex:** the visual UI refresh (icons, theme switcher, brand, login artwork), done by the candidate.
- Neon CLI, and web search to check hosting limits.

## Where AI materially sped things up

- **Planning:** it turned an open brief into a scoped plan with a data model, API contract, autosave state machine, test list and cut lines. The plan went through two review rounds before any code was written.
- **Backend:** models, access rule, transactional save, error envelope, and an access-matrix test suite covering 5 roles across every endpoint.
- **Autosave:** the `SaveController` state machine plus 20 unit tests with fake timers. Writing this by hand is slow and easy to get subtly wrong.
- **Ops:** deploy configs, the smoke-test script, and diagnosing hosting and latency issues.

## What was changed or rejected

**At the candidate's request, during plan review:**
- A plain debounced autosave was replaced by the single-flight state machine.
- The conflict UX was redesigned: keep the draft, copy it, or overwrite only after confirming.
- Authorization moved inside the save transaction, with a consistent lock order.
- The scope of retry idempotency was settled: accept a documented limitation rather than add an idempotency table.
- Development was reordered so a minimal editor came before the advanced UX.

**Caught in AI self-review or by tests:**
- The first plan referenced an `updated_by` field that didn't exist; it became `last_edited_by`.
- DRF's built-in token allows one token per user, so one reviewer logging out would log out everyone on that demo account. It was replaced with a hashed multi-token model.
- A retry rule that would have produced false conflicts was replaced by resending the identical attempt.
- The sanitizer test fixture had been written from memory and failed. It was replaced with HTML captured from the real installed Tiptap version, and the test now compares structure, since nh3 reorders attributes.
- An overly clever throttle subclass was rewritten; the test suite was made 100× faster with a test-only password hasher; lint-flagged React effects were fixed.

**Mistakes the AI made, and what was done about each:**
- The test environment defaults lived in `conftest.py`, which loads *after* Django settings. As a result, one test run hit the Neon production database and created `test_neondb` there. It was caught when the run hung; the database was dropped and the defaults moved to `config/test_settings.py`.
- An over-broad `kill $(lsof -ti tcp:8000)` also killed the Vite dev server. Kills now target only listening sockets.
- Hosting assumptions were wrong. Render's free tier asked for a card, and local development against Neon was too slow (2–7 s per new connection). Deployment moved to PythonAnywhere + Netlify, and local development defaults to SQLite.

## How correctness was verified

All of the following were actually run, and results are recorded in [ai-log.md](ai-log.md).

- **Backend:** 87 pytest tests pass on SQLite and on local PostgreSQL 18. They cover the access matrix (owner, editor, viewer, stranger, anonymous), concurrency and 409s, retry idempotency, sanitization against malicious payloads, validation, query counts and auth.
- **Frontend:** 23 Vitest tests pass. 20 cover the save state machine (single flight, follow-ups, stale responses, backoff, blocked states, conflicts, navigation, dispose). 3 mount the real Tiptap editor (no save on load, one save per edit, viewer read-only).
- **Mutation check:** I deliberately broke the follow-up save and the identical-attempt retry, and the tests failed in both cases, showing that they guard that behaviour.
- **Integration and deploy checks:**
  - `scripts/smoke.sh` passes 15/15 against the local API.
  - `manage.py check --deploy` was run against production settings.
  - Build, lint and type-check are clean.
- **Not verified by the AI:** the UI in a real browser (no browser tool in this session) and the race tests on a live Postgres host. Browser checking was left to the candidate.

## Candidate's own review notes

_To be completed by the candidate: what you reviewed by hand, and anything you changed yourself._
