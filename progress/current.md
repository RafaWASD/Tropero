# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## Sesión 2026-06-11/12 — backlog (items 2/3) + SPEC 10 (backend + frontend hasta UI-A)

> **ESTADO AL CIERRE PARCIAL (2026-06-12): 10 commits.** Items 2/3 del backlog (flake estado repro,
> ProfileContext, rodeos) + spec 10: **backend delta** (0084/0085/0086 aplicadas al remoto) +
> **frontend base no-UI** (Fase 2+3: candidatos/selección/idempotencia + bulk-operations + setCastrated)
> + **UI-A** (vista de grupo + Inicio rodeo-céntrico + AnimalRow compacta + íconos unificados rodeo=Boxes/
> lote=Layers + stepper hide-when-complete) — TODO gateado (reviewer + Gate 2) + commiteado. Design-review
> visual de UI-A PASS (capturas en `design/spec10-ui-a/`). **Pendiente spec 10**: UI-B (selección masiva +
> bottom-sheet, 🔴 manga-crítico), UI-C (vacunación + ficha castrado), UI-D (E2E). **Abierto**: el badge ⭐
> terracota (¿suavizar fuera de castración? — decisión de Raf, no bloquea). Sin pushear (Raf pushea).
>
> **MANDATO AUTÓNOMO (Raf, 2026-06-12):** completar TODO el resto de la UI de spec 10 SIN checkpoints —
> UI-B2 Vacunar (corriendo) → si reviewer+Gate2 OK, commit → **directo** UI-C ficha (T-UI.7/8: toggle
> Castrado Sí/No + ⭐ futuro torito + corrección individual) → **directo** UI-D E2E (T-UI.9/10/11) →
> recién con el TOTAL cerrado, presentar a Raf para aprobación/corrección final. El leader vetó cada
> chunk con design-review + reviewer + Gate 2 y commitea; solo pausa si algo queda genuinamente
> bloqueado o aparece una decisión real irresoluble. Estado UI: UI-A ✅ + UI-B (Castrar/Destetar) ✅.
>
> **✅ SPEC 10 UI COMPLETA (2026-06-12) — esperando aprobación/corrección final de Raf (Puerta 2).**
> 18 commits. Todos los chunks gateados (design-review + reviewer + Gate 2): UI-A ✅ + UI-B ✅ + UI-B2
> (vacunación, HIGH VIA-ENUM cerrado en fix-loop) ✅ + UI-C (ficha castrado/⭐/borrado eventos) ✅ + UI-D
> (E2E 9/9 --repeat-each=3) ✅. Decisiones menores de Raf abiertas (no bloquean, en backlog): badge ⭐
> terracota, a11y aria-checked del checkbox compacto, `$chipMin` 40 vs 44, "Producto" texto-libre.
> AL APROBAR RAF: marcar spec 10 acorde en feature_list (queda C5/PowerSync de spec 02 como lo único
> diferido del stack; spec 10 en sí no tiene backend pendiente). Sin pushear (Raf pushea).

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

## Ítems 2 y 3 — COMMITEADOS (4 commits, working tree limpio)

- `fc193e1` fix(eventos): estado reproductivo determinístico el mismo día
- `9c46f77` fix(perfil): ProfileContext re-evalúa tras first-sync + aterrizaje optimista del saludo
- `453dbc5` test(e2e): rodeos espera persistencia server-side del rodeo
- `78c1808` docs: reconcilia backlog y progress de la sesión
(Sin pushear todavía — Raf pushea.)

## Próximo: SPEC 10 (operaciones-rodeo) — casi lista para implementar

- **Gate 1 puntual del delta LIM-2: PASS** (2026-06-11, `progress/security_spec_10-lim2-rechequeo.md`,
  0 HIGH/0 MED/3 LOW al backlog). Era el último item leader-owned (el fold de LIM-2 cambió el trigger
  de propagación §4.2(4) tras el PASS original — re-chequeado: el pre-filtro espeja `rodeo_check` 0021
  fiel, no crece el poder de escritura, LOG sin leak cross-tenant, no-loop intacto).
- **DISCREPANCIA DE FUENTES detectada y pendiente de confirmar con Raf**: `design.md §9` + `current.md`
  dicen que Raf aprobó la **Puerta 1 de la v2 el 2026-06-11** (D8 normalización silenciosa future_bull,
  D9 exclusión-de-lista en destete, D12/LIM-1 observación automática al castrar, D13/LIM-2 propagación
  tolerar-y-saltear); `feature_list.json` quedó **stale** ("PENDIENTE PUERTA 1"). Evidencia fuerte a
  favor de "aprobada", pero al ser gate humano se confirma con Raf antes de implementar la DB de prod.
  → al confirmar: reconciliar el note de `feature_list.json` (id 10) + arrancar la implementación.
- **Puerta 1 v2 CONFIRMADA por Raf** (2026-06-11) → `feature_list.json` id 10 reconciliado.

### Chunk backend delta (Fase 1) — DONE + GATEADO, esperando Puerta 2 de Raf

3 migraciones **aplicadas al remoto** (vía `scripts/apply-migration.mjs` = Management API `database/query`,
como 0068-0083; el ledger de `apply_migration` no las registra — disco es la fuente de verdad):
- `0084_denormalize_is_castrated.sql` (§4.2): columna espejo + backfill + force-INSERT + write-through
  perfil→animals + propagación animals→perfiles con pre-filtro rodeo-vivo (espejo literal de
  `rodeo_check` 0021) + `RAISE LOG` del skip (LIM-2 tolerar-y-saltear) + revokes.
- `0085_future_bull.sql` (§4.1): columna + trigger normalize (no-macho/castrado→false, silencioso).
- `0086_castration_recompute_symmetric.sql` (§4.3): reemplazo del cuerpo de `tg_animals_apply_castration`
  con guard dirección-agnóstico → el revert `true→false` AHORA recompute (novillito→torito).
- **Orden invertido vs el §-orden del design** (0084 is_castrated ANTES de 0085 future_bull): el trigger
  normalize lee `new.is_castrated` → la columna tiene que existir primero (si no 42703). Reconciliado en
  design+tasks de spec 10.
- Suite `supabase/tests/operaciones_rodeo/run.cjs` (21 casos, contra el remoto) enganchada en
  `run-tests.mjs`. T-DB.4(e) skip rodeo muerto + T-DB.4(f) orden de triggers vs `pg_trigger` incluidos.
- Gates: **reviewer APPROVED** (`progress/review_10-backend-delta.md`) + **Gate 2 PASS 0 HIGH/0 MED**
  (`progress/security_code_10-backend-delta.md`; pre-filtro verificado literal vs 0021 en disco Y en el
  remoto, revokes efectivos en vivo). check.mjs exit 0.
- **D10 reconciliado (leader)**: spec 02 Tier 2 (RT2.2.6 en requirements/design/tasks) marcado
  SUPERSEDED por 0086 (revert ahora recompute). 1 aserción de `tests/animal/run.cjs` (T2.27→torito)
  ajustada por el implementer (cambio de comportamiento por diseño).
- LOW: comentario cosmético en `0086:48` (dónde se emitió el revoke) — al backlog si se toca.

### Próximo (al cerrar Puerta 2): frontend de spec 10
Fase 2 (utils puros) → Fase 3 (services + hooks PowerSync) → Fase 4 (UI: selección explícita checkbox,
ficha castrado/futuro-torito, vista de grupo rodeo-céntrica). Diseño pasa por el skill design-review.

### BASE NO-UI DE SPEC 10 (Fase 2 + Fase 3) — DONE + GATEADO (reviewer APPROVED + Gate 2 PASS 0 HIGH)
**Gates** (sobre Fase 2+3 combinadas): reviewer APPROVED (`progress/review_10-frontend-fase2-3.md`) + Gate 2
PASS 0 HIGH (`progress/security_code_10-frontend-fase2-3.md`; invariante author_id confirmada, 2 MED al
backlog: castración no-atómica MED-1/MED-2). check.mjs exit 0. **Esperando Puerta 2 + después Fase 4 (UI).**
La corrida combinada Fase 2+3 se cayó por socket tras T-CL.1/2 → se partió en Fase 2 (T-CL.3-7) + Fase 3
(T-CL.8-13), ambas cerradas. Detalle abajo:

Services + hooks PowerSync de spec 10 — **Fase 3** (T-CL.8…T-CL.13). NO toca Fase 4 (UI). baseline_commit:
95e3177. Progreso en `progress/impl_10-frontend-fase3.md`.
- T-CL.8/9/10: `bulk-operations.ts` (service, wrapper de I/O) + `bulk-operations-plan.ts` (NUEVO, núcleo
  PURO: plan* + drainBulkPlan). Castración = 2 CrudEntries/animal (UPDATE + observación). Idempotencia
  de evento (UUIDv5) + batches (~100, InteractionManager). Fallo a mitad ⇒ exitosas persisten + reporte
  por animal (sin rollback). No toca el connector (CRUD plano as-built).
- T-CL.11: `animals.setCastrated` (+future_bull=0 + observación simétrica) + `setFutureBull` (sin obs).
- T-CL.12: `is_castrated`/`future_bull` declaradas en `schema.ts` + proyectadas en lista/detalle/búsqueda
  → COMPLETA el cableado del espejo C6 de T-CL.7 (ahora con el is_castrated REAL, precedencia). GUARD ok.
- T-CL.13: observación automática simétrica, sin author_id, N obs + N updates, setFutureBull sin obs.
- `castration-copy.ts` (NUEVO): fuente única del copy R13.7. Invariantes de seguridad confirmadas
  (author_id NUNCA en payload; establishment del PERFIL; 2 CrudEntries). typecheck verde + check.mjs exit 0
  (192 client unit + Fase 1 22/22). Reconciliado design/tasks. NO marqué la feature done.

### HECHO (implementer, 2026-06-11): Fase 2 de spec 10 (utils puros)
Base NO-UI del frontend de spec 10 — **SOLO Fase 2** (utils puros). NO toca Fase 3 (services/hooks) ni
Fase 4 (UI). baseline_commit: 95e3177. La corrida previa (`impl_10-frontend-fase2-3.md`) se cayó por un
error de socket (infra) tras T-CL.1/T-CL.2 (bulk-candidates.ts + test, 13/13 verde — verificados por el
leader, working tree). Esta corrida retoma desde **T-CL.3** y cierra la Fase 2 (T-CL.3…T-CL.7). Progreso
en `progress/impl_10-frontend-fase2.md`.

> El fix de centrado robusto (ADR-027 + CenteredRow + crear-rodeo + skill design-review +
> design-system) YA fue commiteado por su terminal dueña: `877e484` (2026-06-11). Working tree limpio.
> Próximo recomendado: IMPLEMENTAR SPEC 10 (spec_ready, Puerta 1 aprobada, Gate 1 PASS, delta
> backend ≥0084). Paralelo colisión-safe: redactar spec 11.
> Follow-up menor: `CenteredRow` aún sin usar en pantallas → su 1er uso = migrar "Crear lote nuevo"
> de `animal/[id].tsx` (post-C6).
