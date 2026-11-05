# SOLVIA Rust API — compatibility migration sidecar

This is a **transitional, local-only** API service. It does **not** replace the production C++ server, TLS termination, backup jobs or Android API yet.

- Runs at 127.0.0.1:8766. Never publicly expose this port.
- Uses the existing PostgreSQL schema; no schema modifications or destructive migrations.
- Optional `SOLVIA_LEGACY_API=http://127.0.0.1:8765` delegates unported endpoints to the original C++ server (including its authorization and business rules).
- Optional `SOLVIA_RUST_NATIVE_READS=1` enables Rust-native read handlers for GET /api/workday/home (admin/reception only) and GET /api/rooms (admin only). No clinical free text is exposed.
- Native read handlers validate existing SHA-256 session hashes, expiry, active role, open shift and PostgreSQL state. Every other route remains the existing C++ implementation.
- `GET /__rust/health` is a local migration probe, **not** the standard /api/health contract (that contract is still delegated).
- Caddy, Android and user-facing clients should continue using the existing API during the migration.

## Development (synthetic database only)

```bash
export SOLVIA_DATABASE_URL='postgresql://solvia_test:***@127.0.0.1/solvia_test'
export SOLVIA_LEGACY_API='http://127.0.0.1:8765'
export SOLVIA_RUST_NATIVE_READS=1
cargo test --manifest-path rust-server/Cargo.toml
cargo run --manifest-path rust-server/Cargo.toml
```

Before promotion: run existing Python API integration suite against both gateways with an isolated test database, verify every route/role/method/error response, documents, PDF, TV, recovery, backup workflow, offline reconciliation, concurrency and complete Android device integration. Do not use the sidecar with real patient data.
