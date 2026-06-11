# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## Sesión 2026-06-11 (tarde) — backlog: fix flake `deriveCurrentState` + triage e2e rojos

Raf eligió los "cambios chicos" 2 y 3 del backlog (en vez de arrancar spec 10). Decisión del leader:
**secuencial 2 → 3** (colisionan: los rojos de events del triage son en parte el flake del item 2;
misma suite e2e + misma DB beta).

- [x] **Item 2 — DONE + GATEADO, esperando puerta de código de Raf (commit).** Fix del flake del
  estado reproductivo (`deriveCurrentState`/`isNewerRepro`). El one-liner del backlog era insuficiente
  (el desempate final de `parseTimeline` también era `eventId` random). Solución del implementer (DOS
  cambios, frontend puro, sin schema/RLS/migraciones): (1) `created_at` de CLIENTE en los INSERT
  CRUD-plano de `reproductive_events` (tacto/service/abortion) — server `default now()` SIN trigger de
  force (0026) → el valor de cliente persiste; (2) desempate por `seq` (orden de lectura de
  `buildTimelineQuery`, ahora `ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC`) en vez
  del UUID random. Gates: **reviewer APPROVED** (`progress/review_backlog-flake-repro.md`) + **Gate 2
  PASS 0 HIGH** (`progress/security_code_backlog-flake-repro.md`; created_at client-controlled = LOW
  data-quality propio-tenant, capacidad preexistente). Comment-drift del ORDER BY unificado (3 spots).
  e2e estado-repro determinístico (`--repeat-each`: parto-mellizos 10/10, los otros 15/15). check.mjs
  exit 0 en la corrida del reviewer (las suites supabase live flakean por rate-limit de la DB beta).
  Reconciliado: `specs/active/15-powersync/design.md` as-built + backlog ✅ RESUELTO.
  Diff sin commitear: events.ts, local-reads.ts, event-timeline.ts (+2 tests), backlog, spec15 design.
  - Backlog nuevo (MED pre-existente, fuera del diff): `created_by` spoofeable por INSERT directo a
    PostgREST (trigger condicional) → anotado para pasada de hardening.
- [x] **Item 3 — TRIAGE + FIXES DONE + GATEADOS, esperando puerta de código de Raf (commit).**
  Triage (`progress/triage_e2e_rojos.md`): de los "8 rojos" quedaban **5** (events 13/13 ya verde por
  C6 + fix-repro; el calf→madre que el reviewer marcaba ya pasa). 4 rojos = UN bug real
  (`ProfileContext` no re-evaluaba tras first-sync → "Más" mostraba "Reintentar" en vez de Perfil) +
  1 flake (`rodeos.spec.ts:138` sin poll del server). **Fixes** (`progress/impl_e2e-rojos-fix.md`):
  - **FIX 1 (app)**: `ProfileContext.tsx` re-lee al avanzar `lastSyncedAt` (patrón canónico
    animales/index, NO el statusChanged del triage — cubre además el sync-down post-edición) +
    aterrizaje optimista del perfil recién guardado (`applyOwnProfile`/`pendingOptimisticNameRef`,
    ciclo de vida espejo de `pendingCreatedRef`) + wiring en `mas.tsx`. Cierra account:151 +
    profile:54/75/110 + destapó/cerró profile:38/:62 (saludo post-edición).
  - **FIX 2 (test-only)**: `rodeos.spec.ts` `expect.poll` por persistencia server-side (offline-first;
    producto OK).
  - Gates: **reviewer APPROVED** (`progress/review_e2e-rojos-fix.md`) + **Gate 2 PASS 0 HIGH**
    (`progress/security_code_e2e-rojos-fix.md`; todo data del propio user, sin leak en re-login; 2 LOW
    al backlog). e2e determinístico `--repeat-each=3`: profile+account 18/18, rodeos 9/9. check.mjs
    exit 0. Backlog 2026-06-10 "ProfileContext queda en 'Sin conexión'" → ✅ RESUELTO.
  - Diff sin commitear (DISJUNTO del ítem 2): `ProfileContext.tsx`, `mas.tsx`, `rodeos.spec.ts` (+
    hunks no adyacentes en `backlog.md`).

## Pendiente: puerta de código de Raf

Ítem 2 + ítem 3 los dos done+gateados, working tree sin commitear. Commits propuestos (archivos disjuntos):
1. **fix(eventos): estado reproductivo determinístico el mismo día** — events.ts, local-reads.ts,
   event-timeline.ts (+2 tests), spec15 design, backlog (flake-repro ✅ + created_by MED).
2. **fix(perfil): ProfileContext re-evalúa tras first-sync + aterrizaje optimista del saludo** —
   ProfileContext.tsx, mas.tsx, backlog (ProfileContext ✅ + 2 LOW).
3. **test(e2e): rodeos espera persistencia server-side (offline-first)** — rodeos.spec.ts.
(backlog.md tiene hunks de los 3 → staging selectivo al commitear.)

> El fix de centrado robusto (ADR-027 + CenteredRow + crear-rodeo + skill design-review +
> design-system) YA fue commiteado por su terminal dueña: `877e484` (2026-06-11). Working tree limpio.
> Próximo recomendado: IMPLEMENTAR SPEC 10 (spec_ready, Puerta 1 aprobada, Gate 1 PASS, delta
> backend ≥0084). Paralelo colisión-safe: redactar spec 11.
> Follow-up menor: `CenteredRow` aún sin usar en pantallas → su 1er uso = migrar "Crear lote nuevo"
> de `animal/[id].tsx` (post-C6).
