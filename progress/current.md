# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

_Sin sesión activa. Última cerrada: sesión 14 — refundición consolidada de spec 02 (lote + plantilla de datos) (2026-05-28). Ver `history.md`._

## Estado del proyecto (al 2026-05-28)

- **Feature activa (`in_progress`):** `02-modelo-animal` — spec **refundida** (sesión 14) incorporando ADR-020 (lote `management_groups`) + ADR-021 (plantilla de datos: catálogo global `field_definitions` + `system_default_fields` + `rodeo_data_config` + gating). R14 y seed de cría (26 fields) TENTATIVOS. Backend (B.2 del plan) todavía `pending`, nadie lo arrancó. Frontend (Fase 3+) pausado hasta cerrar design system.
- **`deferred`:** `01-identity-multitenancy` (backend done + 41 tests; frontend Fases 3-8 esperando design system) · `09-buscar-animal` (spec aprobada + alineada/re-aprobada en sesión 14; esperando turno tras spec 02).
- **ADRs nuevos (sesión 14):** ADR-020 (lote como agrupación de manejo, complementa ADR-016) + ADR-021 (plantilla de datos, catálogo global + gating). Ambos `Accepted` y en el índice.
- **Bloque A del plan:** A.1 (design system) `in_progress` con Raf; A.2 (bottom nav → ADR-018) `pending`; A.3–A.7 `done`.
- **Próximo paso sugerido:** B.2 (backend spec 02, ahora migrations `0012..0037` incluyendo plantilla en 0016 + lote en 0036) o seguir cerrando A.1 (design system). Raf elige el orden. Pendiente: validar el seed de cría de `field_definitions` con Facundo.

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`.
- Edge Functions: secrets en Supabase con `supabase secrets set` además de `.env.local`.
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select (detalle en `progress/impl_01-identity-multitenancy.md`).
