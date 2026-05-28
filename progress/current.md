# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

_Sin sesión activa. Última cerrada: sesión 13 — auditoría de consistencia del harness (2026-05-28). Ver `history.md`._

## Estado del proyecto (al 2026-05-28)

- **Feature activa (`in_progress`):** `02-modelo-animal` — spec aprobada (R14 tentativo); backend (B.2 del plan) todavía `pending`, nadie lo arrancó. Frontend (Fase 3+) pausado hasta cerrar design system.
- **`deferred`:** `01-identity-multitenancy` (backend done + 41 tests; frontend Fases 3-8 esperando design system) · `09-buscar-animal` (spec aprobada, esperando turno tras spec 02).
- **Bloque A del plan:** A.1 (design system) `in_progress` con Raf; A.2 (bottom nav → ADR-018) `pending`; A.3–A.7 `done`.
- **Próximo paso sugerido:** B.2 (backend spec 02) o seguir cerrando A.1 (design system). Raf elige el orden.

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`.
- Edge Functions: secrets en Supabase con `supabase secrets set` además de `.env.local`.
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select (detalle en `progress/impl_01-identity-multitenancy.md`).
