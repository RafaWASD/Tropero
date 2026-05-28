# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

_Sin sesión activa. Última cerrada: sesión 15 — gate de refinamiento de contexto (ADR-022) + reorden del roadmap por olas (2026-05-28). Ver `history.md`._

## Estado del proyecto (al 2026-05-28)

- **Backend cerrado y verificado:** `02-modelo-animal` backend (Fase 1+2) **DONE** el 2026-05-28 (sesión 15): migrations 0013-0042 + suite animal 19/19 + reviewer APPROVED + Gate 2 PASS (SEC-HIGH-01 cerrado). No hay ninguna feature `in_progress` ahora — slot libre.
- **`deferred`:** `01-identity-multitenancy` (backend done + 41 tests; frontend esperando design system) · `02-modelo-animal` (backend done; frontend Fase 3+ pausado) · `09-buscar-animal` (spec aprobada; esperando turno). R14 y el seed de cría (26 fields) de spec 02 siguen TENTATIVOS.
- **`context_ready`:** `03-modo-maniobras` — contexto refinado y aprobado (sesión 15, primer uso del Gate 0). Spec diferida JIT (buffer=1, 09 on-deck).
- **ADRs:** ADR-020 (lote) + ADR-021 (plantilla de datos) de sesión 14 + **ADR-022 (gate de refinamiento de contexto)** de sesión 15. Todos `Accepted` y en el índice.
- **Proceso (sesión 15):** el flujo SDD ahora tiene **Gate 0 de refinamiento de contexto** antes de la spec — estado nuevo `context_ready` + artefacto `context.md` (corto, conducido por el leader en charla con Raf). Tres puertas humanas: contexto → spec → código. Política de pipeline: impl WIP=1, spec buffer=1, refinamiento buffer=2–3. Detalle en ADR-022 + `docs/specs.md`. Aplica hacia adelante (01/02/09 grandfathered).
- **Roadmap (sesión 15):** ordenado por **olas** en `plan.md` (rush MVP), arranque paralelo en Ola 0.
- **Bloque A del plan:** A.1 (design system) `in_progress` con Raf; A.2 (bottom nav → ADR-018) `pending`; A.3–A.7 `done`.
- **Próximo paso:** Ola 0/1 restantes — Raf cierra **design system** (A.1, destraba todo el frontend) + **research SIGSA** (08, long-lead) + **día de campo** (04/05 BLE). Sin design system no hay nuevo critical path implementable; opción: pre-refinar contexto de 04 (parte no-hardware). Pendiente: validar seed de cría con Facundo.

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`.
- Edge Functions: secrets en Supabase con `supabase secrets set` además de `.env.local`.
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select (detalle en `progress/impl_01-identity-multitenancy.md`).
