# SOLVIA / Serenia — Rust + Tauri 2 desktop migration (phase 1)

Base: `feature/serenia-reception-polish-20261105` (React/Vite + C++20 PostgreSQL server + Kotlin Android). This is a separate desktop option and **does not** replace the live server or the legacy Windows/WebView2 installer.

## Implemented in this branch

- `frontend/src-tauri/`: native desktop shell (Tauri 2 / Rust), reuses the **existing** React reception/admin UI without rewriting patient workflows.
- `request.mjs`: automatically chooses the Rust command for JSON REST API requests when running in Tauri; retains browser transport for WebView2 and tests.
- Native HTTP: HTTPS required for remote servers; plain HTTP permitted only on loopback, native certificate trust without `danger_accept_invalid_certs`, no redirects or environment proxies, API-only paths, bounded request/response sizes. Existing server RBAC remains authoritative.
- A Tauri window does not default to `tauri://localhost` as an API server: users configure the actual SOLVIA HTTPS address.
- Legacy PC update notification is disabled in the Tauri shell so WebView2 installers cannot be applied to this native build.
- Native Rust validation tests, Node transport tests and GitHub Actions smoke job.

## Linux Mint / Ubuntu developer setup

1. Install the stable Rust toolchain using https://rustup.rs.
2. Install Tauri's WebKit/system requirements, e.g. on Ubuntu 24.04:

   `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev`

3. Install the Rust Tauri CLI: `cargo install tauri-cli --version "^2.0.0" --locked`.
4. `npm ci --prefix frontend`.
5. `cd frontend && npm run desktop:dev` (uses `cargo tauri dev`).
6. For local package build: `cd frontend && npm run desktop:build`. The OS-specific config selects Linux DEB/AppImage or Windows NSIS; do not apply WebView2 installers to Tauri.

Windows builds require Rust/MSVC, WebView2 and the Tauri Windows requirements. Builds on the target platform are recommended. First run asks for the SOLVIA server HTTPS URL; its private CA **must** be installed as trusted on client PCs, without TLS bypass.

## Boundaries / release blockers

- **Not production-ready yet.** Cargo lockfile and full Tauri bundling/installer smoke tests are pending; automated checks are added but not yet verified here.
- Desktop update download/install workflow requires a new, independently signed Tauri package feed; the old WebView2 package is incompatible.
- Browser printing, webcam, document OCR workers, and scanning import must be tested on real Linux Mint and Windows WebViews.
- Current `pc-session.mjs` stores session token in browser storage, as in the existing client. Move sensitive tokens into an OS-backed encrypted store, with migration/logout policy, prior to rollout.
- API and Linux server remain C++20/PostgreSQL; moving the *server* to Rust would be another, separate migration with exhaustive endpoint-level contract tests and safe DB migrations.
- Android remains Kotlin. No changes to server's TLS, PostgreSQL, roles, backups, or production services.
- Test only with synthetic patient records until role restrictions, offline recovery, printing, document scans and update signing pass acceptance tests.

Run quick tests: `node tests/tauri-transport.mjs`, `cargo test --manifest-path frontend/src-tauri/Cargo.toml --lib`, then `npm run desktop:build` from frontend.
