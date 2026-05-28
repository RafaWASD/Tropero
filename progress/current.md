# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## Estado del proyecto (al 2026-05-28)

- **Feature activa (`in_progress`):** `02-modelo-animal` — spec aprobada (R14 tentativo); backend (B.2 del plan) todavía `pending`, nadie lo arrancó. Frontend (Fase 3+) en pausa hasta cerrar design system.
- **`deferred`:**
  - `01-identity-multitenancy` — backend done + 41 tests verdes; frontend (Fases 3-8) esperando design system.
  - `09-buscar-animal` — spec aprobada, esperando turno tras spec 02 (respeta `one_feature_at_a_time`).
- **Bloque A del plan:** A.1 (design system) `in_progress` con Raf; A.2 (bottom nav → ADR-018) `pending`; A.3–A.7 `done`.
- **`node scripts/check.mjs`:** verde (typecheck + 15 RLS + 26 Edge tests reales contra DB remota).

## Sesión 2026-05-28 — auditoría de consistencia del harness

Auditoría completa del harness/flujo/agentes a pedido de Raf. Hallazgos y fixes aplicados (todo docs/config/JSON, cero código de app):

> **Estado de commit**: bitácoras consolidadas → commiteadas y pusheadas (commit `84cd2a8`). Fixes de consistencia de abajo → revisados con Raf y commiteados aparte. Decisiones: #9 (Stop hook corre suite remota en cada cierre) y #16 (`git push *` auto-allowed) se dejan COMO ESTÁN por decisión de Raf (peaje de segundos OK, peaje de atención no).

- **check.mjs**: ahora valida `security_analyzer.md` (5to agente) y `progress/plan.md`; enum `validStatus` suma `deferred`.
- **Estado `deferred`** agregado al enum (`feature_list.json` + `check.mjs` + `docs/specs.md`). Features 01 y 09 migradas de `blocked` → `deferred` (no había bloqueante externo; están postergadas por decisión propia). `CHECKPOINTS.md` C1 → "5 agentes".
- **Gate 2 (security modo `code`)**: ahora diffea desde `baseline_commit` que registra el implementer en `impl_<name>.md` (trabajamos sobre `main`, NO `main...HEAD`). Tocados `implementer.md`, `security_analyzer.md`, `leader.md`.
- **Skill namespaceada**: `security_analyzer.md` usa `sentry-skills:security-review` (antes `security-review` pelado, que fallaría).
- **Arranque alineado**: `CLAUDE.md` corre el check antes de leer estado e incluye `plan.md` (estaba desalineado con `AGENTS.md`).
- **leader.md**: fila "Trivial" del escalado incluye reviewer (Gate 2 depende de su aprobación).
- **spec_author.md**: nuevo modo "refinamiento" para specs ya `spec_ready` (lo usan Gate 1 FAIL y "pedí cambios").
- **verification.md**: comandos reales (`pnpm.cmd`, suites Node-nativas) + `testCommand` real.
- **plan.md**: división de autoridad explícita (feature_list manda estado; plan manda orden) + tabla marcada como snapshot.
- **Higiene**: bitácoras de sesiones 1–12 consolidadas y movidas a `history.md` (estaban acumuladas y fuera de orden acá).
- No tocado a propósito: ADR-019 (inmutable). Pendientes menores anotados: Stop hook corre suite remota en cada cierre (#9), skills locales fuera del mapa de AGENTS (#15), `git push *` auto-allowed en settings.local (#16).

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`.
- Edge Functions: secrets en Supabase con `supabase secrets set` además de `.env.local`.
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select (detalle en `progress/impl_01-identity-multitenancy.md`).
