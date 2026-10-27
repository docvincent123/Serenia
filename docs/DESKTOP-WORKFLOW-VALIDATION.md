# SOLVIA desktop workflow validation — 2026-10-27

This update continues PR #24 (`ux/solvia-helsi-like-desktop`). It is a development update, not a production installation.

## Resulting behavior

- The existing compact home and four primary navigation items remain the daily workspace for admin/reception.
- The patient directory requests 25 registration records at a time through `GET /api/patient-directory`, with total, page and page_size. Status filters: current (non-archived), active, completed, archived.
- Server search covers name, patient number, phone, category, psychologist and family. Phone searches normalize spaces, parentheses and punctuation. `%` and `_` are literal characters. Parameters are bound through libpq; page sizes and offsets are bounded.
- Psychologists can only retrieve their assigned patients. The response is an explicit registration projection without clinical text or admin notes. The legacy `/api/patients` API remains unchanged for Android and other existing consumers.
- Slow responses cannot replace newer results in either directory or global search. Failed searches hide stale actionable cards and show an error. Directory search supports retry and resets to the first page after changing filters.
- Home refreshes also ignore stale responses. An unavailable server is shown as an error, rather than an empty appointment list.
- Home totals now use the actual schema: patients `active`, waiting-list entries `waiting`/`offered`.

## Validation in this environment

- React/Vite production build passed.
- The existing browser regression passed using the actual production bundle and synthetic API responses: four roles, navigation, booking/arrival, waiting list, device recovery, printing paths, responsive navigation, offline drafts and retry after a lost consultation response.
- Added browser checks passed for directory pagination, network failure, first-page reset and out-of-order directory/global-search responses. Layout screenshots were inspected at 1280 px.
- The existing non-browser JavaScript checks passed (auth, connection, drafts, booking, navigation, backup status, updates, shift workspace, TV and workflow events).
- C++ server and license-test executable compiled with GCC 13; eight cryptographic/access-policy license checks passed.
- The real HTTP/PostgreSQL 16 integration suite completed with exit code 0 after fixing the dashboard test's DELETE request to supply its required JSON body. Added integration coverage checks pagination, literal search, phone normalization, role boundaries, invalid parameters, archived filtering and actual dashboard totals.
- Existing concurrent-write scenario: 40 separate synthetic staff accounts, 360 requests, zero HTTP errors and zero duplicated consultations; p95 0.328 s, maximum 0.364 s in this local test environment. These figures are not a benchmark for the center's hardware or network.

The local PostgreSQL tests used an isolated disposable database and a test-only UID adapter because this execution environment maps only root. No UID adapter, QA dependency or database is part of the application changes.

## Installation limits

Update the server and desktop UI together: the new directory UI requires `/api/patient-directory`. PR #24 still depends on the existing PR stack. This change does not merge that stack or alter the center's production database. Windows WebView2/installer, production Android signing and physical Android/TV/printer/LAN acceptance remain separate checks; no new physical-device results are claimed here.
