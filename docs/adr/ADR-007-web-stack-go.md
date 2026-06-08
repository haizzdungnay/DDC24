# ADR-007: Web Backend in Go; Two-Language Toolchain

- Date: 2026-06-08
- Owner: Solution Architect
- Status: Accepted
- Related: ADR-005 (process topology), ADR-006 (form/JSON UI)
- Supersedes: backend stack in `SW_WEBIDE_DESIGN_MK-DDC-24_VI.md` (FastAPI/Python +
  Svelte) — **removed 2026-06-08** (see git history) — and the web parts of
  `docs/05_implementation/KX-DDC24-BE-DEVGUIDE-001_VI.md`

## Context

The existing WebIDE design implements the engineering backend in **Python/FastAPI**
with a **Svelte** frontend. The product definition (§6) lists web backend as
**Go/Rust/C++** (Python explicitly excluded for the project), and the owner has
chosen **Go** for the web backend.

Earlier drafts also introduced a separate **Rust validator service**, giving a
three-language toolchain (C++ core + Rust validator + Python web). For a small team
this is a maintenance tax with cross-language IPC at every seam.

## Decision

1. **`mkddc-web` backend is written in Go** (REST + SQLite + WebSocket monitor).
2. **The validator is a Go library** invoked inside `mkddc-web` at deploy time —
   **not** a separate service and **not** Rust (reverses the earlier Rust-validator
   plan).
3. **Two languages total** for the product:
   - **C++17** — `mkddc-core` and `mkddc-iobus` (deterministic, no GC, reuses
     bacnet-stack and libmodbus).
   - **Go** — `mkddc-web` and the validator library.
4. **Frontend** is React (per product definition "React/Vue"), replacing Svelte; the
   wiresheet (React Flow) is Rev B (ADR-006).
5. SQLite stays as the config/event/trend store (WAL mode).

## Rejected alternatives

1. **Keep Python/FastAPI + Svelte.** Rejected: Python is excluded for this project by
   the product definition, and it adds a third toolchain.
2. **Single language (C++ everywhere, incl. web).** Rejected: web/REST development in
   C++ is slower and costlier for the team with little benefit at the non-real-time tier.
3. **Rust validator as its own service.** Rejected: validation is a deploy-time step,
   best as an in-process library; a third language is not justified.

## Consequences

- `SW_WEBIDE_DESIGN` and `BE-DEVGUIDE` are rewritten for Go; `FE-DEVGUIDE` for React.
  Old files marked SUPERSEDED.
- Validator design folds into the web design / `SW_RUNTIME_EXECUTION_MODEL`, not a
  standalone service doc.
- Build/CI references to FastAPI/Svelte/Rust toolchains are removed in the Phase 3
  consistency sweep.

## Risks

- `R1` Existing Python/Svelte WebIDE code (if any was started) is discarded or ported;
  scope the carry-over before committing.
- `R2` Go ⇄ C++ boundary (web ↔ core) needs a stable REST/IPC contract — defined in
  `design/interfaces/REST_API_OPENAPI` and `GRAPH_SCHEMA`.

## Open questions

- Frontend React vs. Vue final pick (product definition allows either) — defer to
  `FE-DEVGUIDE` rewrite; does not affect backend or contracts.
