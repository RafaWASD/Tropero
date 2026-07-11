baseline_commit: 42f76c5dcb1de7262aab439c31feed8fe137b39e

# Impl — E · TRATAMIENTOS EN LA FICHA (delta spec 02, ADR-028 Nivel B, CON BACKEND)

> Feature `in_progress` · Gate 1 PASS · Puerta 1 aprobada. Specs:
> `specs/active/02-modelo-animal/{context,requirements,design,tasks}-tratamientos.md` (RTR.1–10, T1–T23).
> NO se aplicó la migración (deploy gateado a Raf). NO se corrió check.mjs completo ni E2E ni git add/commit.

## Token de color sanitario (definido por el leader, contraste medido)
`treatmentText: '#106B7A'` (teal-cian) / `treatmentBg: '#DBEEF3'` (cian pálido). En `app/tamagui.config.ts`
(palette + tokens.color). Chip FILLED. Fijado en requirements RTR.4.5 + design §4.2.

## Estado
- [x] Fase A (T1–T6) · [x] Fase B (T7–T12) · [x] Fase C (T13–T19) · [x] Fase D (T20–T21)
- T22 (Gate 2.5) + T23 (fold al baseline) = leader.

## Archivos

### Fase A — Backend
- **CREAR** `supabase/migrations/0123_treatments.sql` — enum `treatment_kind` + tabla `treatments` (CHECKs
  120/1000 + not_empty) + 3 índices + `ALTER sanitary_events ADD treatment_id` + índice parcial + triggers
  (force establishment_id 0077 / created_by 0043 INSERT+UPDATE-aware, **`tg_treatments_immutable_columns`**
  BEFORE UPDATE SEC-TRT-01, **`tg_sanitary_events_treatment_check`** BEFORE INSERT OR UPDATE incondicional
  SEC-TRT-03) + RLS (SELECT/INSERT/UPDATE has_role_in, sin DELETE) + grants + `revoke execute` SEC-TRT-04 +
  **CREATE OR REPLACE `tg_sanitary_events_gating`** con short-circuit acotado LOW-1. `begin;`/`commit;` +
  banner NO aplicar. **Moldeado sobre el cuerpo VIGENTE de 0091** (verificado: 0054 nace → 0091 extiende, sin
  redefinición posterior; rama de maniobra EXACTA) + helpers 0077/0043 verificados.
- **MODIFICAR** `sync-streams/rafaq.yaml` — stream `ev_treatments` (JOIN-free, scope establishment,
  `deleted_at IS NULL`). NO deployada (la pega Raf tras aplicar 0123).
- **CREAR** `supabase/tests/treatments/run.cjs` — suite RLS (a) fail-closed (b) anti-spoof establishment_id
  INSERT+UPDATE (c) created_by forzado (d) anti-IDOR 23514/23503 INSERT+UPDATE-de-perfil (e) ciclo (f) peón
  finaliza (g) inmutabilidad + no des-finalizar (h) CHECKs 120/1000 + not_empty (i) exención gating acotada
  (aplicación pasa / suelta gateada / vaccination+treatment_id sigue gateada) (j) perfil inexistente 23503.
  **NO corrida** (necesita 0123 aplicada). Registrada COMENTADA en `scripts/run-tests.mjs`.

### Fase B — PowerSync plumbing
- **MODIFICAR** `app/src/services/powersync/schema.ts` — `Table treatments` + `treatment_id` en
  `sanitary_events` + registro en `AppSchema` (33 sincronizadas). `schema.test.ts` actualizado (33/42 + guard
  de columnas de treatments/treatment_id/next_dose_date/dose_ml).
- **MODIFICAR** `app/src/services/powersync/local-reads.ts` — builders CRUD-plano
  `buildStartTreatmentInsert`/`buildRegisterApplicationInsert`/`buildFinalizeTreatmentUpdate` (idempotente
  `ended_at IS NULL`) + lecturas `buildAnimalTreatmentsQuery`/`buildTreatmentApplicationsQuery` (en curso
  primero) + **inyección de `in_treatment` (EXISTS synced / 0 overlay) en `buildAnimalsListQuery` + ORDER BY
  `in_treatment DESC, ${orderBy} DESC`**. NO toqué `buildSessionEmptyFemalesQuery` (feature A). Tests puros +
  behavior sqlite (pin/finalize).
- **CREAR** `app/src/services/treatments.ts` — service delgado (patrón events.ts): `startTreatment`/
  `registerApplication`/`finalizeTreatment`/`fetchTreatments`, `ServiceResult<T>`, id de cliente, `started_at`
  cliente, `event_type` derivado del `kind`.
- **CREAR** `app/src/utils/treatment-input.ts` (+ `.test.ts`) — `TREATMENT_PRODUCT_MAX_LENGTH=120`/
  `TREATMENT_NOTES_MAX_LENGTH=1000` (= CHECKs) + `TREATMENT_KIND_OPTIONS`/`TREATMENT_ROUTE_OPTIONS` +
  `treatmentEventType` + sanitizers + `validateTreatmentProduct`/`validateTreatmentNotes`/`validateDose`/
  `validateNextDose` (permite futuro).
- **MODIFICAR** `app/src/services/animals.ts` — `AnimalListItem.inTreatment` + `LocalListRow.in_treatment` +
  `toLocalListItem` (`in_treatment ?? 0`). Search no lo proyecta → false (criterio 6).

### Fase C — Frontend
- **MODIFICAR** `app/tamagui.config.ts` — par `treatmentText`/`treatmentBg` (palette + tokens.color).
- **MODIFICAR** `app/src/components/AnimalRow.tsx` — prop `inTreatment?` + `TreatmentChip` (filled teal, ícono
  Syringe, labelA11y, lineHeight matcheado). En vista normal PRIMERO en la fila-2 (flexShrink 0); en compacta
  inline.
- **MODIFICAR** `app/src/components/FormField.tsx` — prop `multiline?` ADITIVA (para el comentario).
- **CREAR** `app/src/components/TreatmentsSection.tsx` — sección + cards + finalize inline.
- **CREAR** `app/src/components/TreatmentStartSheet.tsx` + `TreatmentApplicationSheet.tsx` — sheets (anatomía
  header-fijo/body-scroll/footer-fijo, validación inline). Exportados en `components/index.ts`.
- **MODIFICAR** `app/app/animal/[id].tsx` — state `treatments`/`startSheetOpen`/`appSheetTreatment` +
  `fetchTreatments` en `load` (blando) + derivado `inTreatment` + callbacks (start/register/finalize con
  refresh silencioso) + `TreatmentFlag` en el hero + `TreatmentsSection` (entre Manejo y Lote) + sheets al root.
- **MODIFICAR** `app/app/(tabs)/animales.tsx` (RTR.5.1) + `app/app/rodeo/[id].tsx` (RTR.5.2) — pasar
  `inTreatment` a `AnimalRow` (el pin lo da el ORDER BY compartido). `lote/[id].tsx` NO tocado (feature A en
  curso + fuera de RTR.5).

### Fase D — E2E + captura
- **CREAR** `app/e2e/treatments.spec.ts` — iniciar→aplicar→finalizar + marca aparece/desaparece + pin lista
  general Y rodeo + caso offline. **NO corrida** (necesita deploy).
- **CREAR** `app/e2e/captures/tratamientos.capture.ts` — 13 capturas nombradas (lista sin/con marca, ficha,
  sheet iniciar + selector + validación + 1ª aplicación, en tratamiento, pin general + rodeo, sheet aplicación,
  varias aplicaciones, finalizar confirmación, finalizado). **NO ejecutada** (la renderiza el leader en Gate 2.5).

## Trazabilidad RTR → test

| RTR | Cubierto por |
|---|---|
| RTR.1.1/1.2 (iniciar) | `treatments.spec.ts` (iniciar) · `local-reads.test.ts` buildStartTreatmentInsert · RLS (e) |
| RTR.1.3 (kind 3-cerrado) | `treatment-input.test.ts` (TREATMENT_KIND_OPTIONS) |
| RTR.1.4/1.9 (producto no vacío ≤120) | `treatment-input.test.ts` (validateTreatmentProduct/sanitize) · RLS (h) not_empty/len |
| RTR.1.5/1.10 (notes ≤1000) | `treatment-input.test.ts` (validateTreatmentNotes/sanitize) · RLS (h) |
| RTR.1.6 (1ª aplicación) | `treatments.ts` startTreatment.firstApplication · capture 06 |
| RTR.1.7 (solo ficha) | as-built (no hay entrada desde maniobra) |
| RTR.1.8 (solo activo) | `[id].tsx` canManageTreatments · `TreatmentsSection` canManage |
| RTR.2.2 (aplicación=sanitary linkeado, event_type derivado) | `treatment-input.test.ts` treatmentEventType · `local-reads.test.ts` buildRegisterApplicationInsert · RLS (e/i) |
| RTR.2.3 (dosis/vía/próxima) | `treatment-input.test.ts` validateDose/validateNextDose · buildRegisterApplicationInsert |
| RTR.2.5 (no aplicar sobre finalizado) | UI-only (showActions=inProgress); decisión de criterio §3 (aceptada Gate 1) |
| RTR.2.6/7.3 (anti-IDOR link) | RLS (d) 23514 cross-animal / 23503 inexistente / UPDATE-de-perfil |
| RTR.2.7/2.8 (exención gating acotada, LOW-1) | RLS (i) |
| RTR.3.2/3.4 (finalizar idempotente) | `local-reads.test.ts` buildFinalizeTreatmentUpdate (ended_at IS NULL) · RLS (e) · `treatments.spec.ts` |
| RTR.4.1/4.2 (derivado en curso) | `local-reads.test.ts` behavior pin (EXISTS ended_at IS NULL) |
| RTR.4.3 (marca hero) | `TreatmentFlag` · `treatments.spec.ts` (hero marker) · capture 07 |
| RTR.4.4 (marca fila) | `AnimalRow` TreatmentChip · `treatments.spec.ts` · capture 08 |
| RTR.4.5 (color propio) | `tamagui.config.ts` token · anti-hardcode 0 · veto Gate 2.5 |
| RTR.4.6 (desmarca al finalizar) | `local-reads.test.ts` behavior (finalize → in_treatment 0) · `treatments.spec.ts` |
| RTR.5.1/5.2/5.3 (pin general+rodeo, orden 2rio) | `local-reads.test.ts` (ORDER BY + behavior pin) · `treatments.spec.ts` |
| RTR.5.4 (des-pin al finalizar) | `local-reads.test.ts` behavior · `treatments.spec.ts` |
| RTR.6.1–6.3 (cualquier rol/peón) | RLS (e/f) peón inicia/aplica/finaliza |
| RTR.7.1 (RLS fail-closed) | RLS (a) |
| RTR.7.2 (anti-spoof establishment_id INSERT+UPDATE) | RLS (b) |
| RTR.7.5 (perfil inexistente 23503) | RLS (j) |
| RTR.7.7/7.8 (created_by forzado + inmutabilidad) | RLS (c)+(g) |
| RTR.8.1–8.4 (offline) | `treatments.spec.ts` offline (marca al instante) · CRUD-plano (runLocalWrite) |
| RTR.9.1/9.2/9.3 (sección + aplicaciones) | `local-reads.test.ts` buildAnimalTreatmentsQuery/buildTreatmentApplicationsQuery · `TreatmentsSection` · capture 07/11 |
| RTR.9.4 (aplicaciones en timeline) | sin cambio: las aplicaciones son sanitary_events → buildTimelineQuery las rinde |

## Autorrevisión adversarial (paso 8)
- **`in_treatment` correla a `ap.id`**: synced = `EXISTS(... WHERE t.animal_profile_id = ap.id ...)` inyectado
  ANTES del ` FROM animal_profiles ap` (marker robusto) → `ap` en scope; overlay = `0` constante. Verificado por
  el behavior test sqlite (pin sube el viejo tratado, finalize lo baja). Args de la query SIN cambio.
- **Derivado offline inmediato**: EXISTS sobre la tabla synced `treatments`; el INSERT CRUD-plano local prende
  la fila al instante → marca/pin offline. E2E offline lo cubre. La tabla local existe por AppSchema aunque la
  stream aún no esté deployada (in_treatment = 0, sin crash).
- **Ningún caller manda establishment_id/created_by**: builders los OMITEN (tests lo asertan); el service no los
  pasa. Los fuerza el trigger.
- **`event_type` del kind correcto**: treatmentEventType (test) — nunca 'vaccination' → exención sin auto-exención.
- **Inmutabilidad + tenant-check EXACTOS**: migración copiada de design §2, verificada contra 0091/0077/0043
  vigentes. Orden de disparo entre gating y treatment_check es irrelevante (ambos deben pasar). establishment_id
  pinneado a OLD junto con animal_profile_id (independiente del orden de disparo del force).
- **Sin recorte**: TreatmentChip $2/$2, TreatmentFlag $4/$4, StatusBadge $2/$2, título sección $6/$6, sheets
  $8/$8, producto card $5/$5 — todo lineHeight matcheado.
- **Consumidores de `buildAnimalsListQuery`**: el nuevo ORDER BY reordena (in-treatment primero) en TODOS los
  consumidores; NINGUNO toma `.value[0]` como "más nuevo" (todos procesan la lista completa o filtran). La
  búsqueda usa `buildSearchUnion` (NO tocada) → sin in_treatment → inTreatment false. Se cableó la marca en
  general (RTR.5.1) + rodeo (RTR.5.2). lote/seleccion-masiva/asignar-caravanas reciben el pin cosmético del
  ORDER BY compartido SIN marca (fuera de RTR.5; `lote/[id].tsx` = feature A en curso → NO lo toco, disjunción
  de archivos — decisión consciente, benigno).
- **RTR.2.5** (no aplicar sobre finalizado): UI-only (la sección no ofrece el CTA en finalizados) — decisión de
  criterio §3 ya aceptada en Gate 1 (within-tenant, sin CHECK server-side por diseño).

## Verificación (lo que corrí)
- `pnpm -C app exec tsc --noEmit` → **exit 0** (2 pasadas: tras Fase C y tras el fix de lote).
- Unit puros (treatment-input + local-reads + schema): **173/173 pass**.
- `node scripts/check-hardcode.mjs` → **0 violaciones**.
- E2E files (spec + capture): NO typecheckean con el tsconfig del app (`e2e` excluido) — modelados byte-a-byte
  sobre `cut-ficha.spec.ts` / `cria-al-pie-alta.capture.ts` (helpers + selectores existentes).

## Qué corre AHORA vs qué espera el deploy
- **Corre ahora** (pre-deploy): tsc, unit puros (treatment-input/local-reads/schema), anti-hardcode.
- **Espera el deploy de 0123 + stream** (post-deploy, lo hace el leader tras OK de Raf): la suite RLS
  `supabase/tests/treatments/run.cjs` (descomentar en run-tests.mjs), el E2E `treatments.spec.ts`, y el capture
  `tratamientos.capture.ts` (Gate 2.5). También re-correr las suites que tocan el gating (spec 03 maneuvers +
  animal/sanitary) tras el CREATE OR REPLACE de `tg_sanitary_events_gating`.

## Para reviewer / Gate 2 / deploy / Gate 2.5
- **reviewer**: completitud del wiring (memoria de agente muerto N/A — no morí, pero el reviewer es el oráculo).
- **Gate 2** (security_analyzer code, diff desde baseline `42f76c5`): la migración + los builders CRUD-plano +
  la RLS/triggers. Focos = los 10 del design.
- **deploy gateado a Raf**: aplicar `0123` (Management API, BEGIN/COMMIT) → pegar `ev_treatments` en el dashboard
  → `notify pgrst`. Luego descomentar la suite RLS + correrla + el E2E.
- **Gate 2.5**: el leader corre el capture (13 shots) + veta el token teal antes de la Puerta 2.

## Reconciliación de specs (paso 9)
- RTR.4.5: token FIJADO (nota de reconciliación, sin reescribir el EARS).
- design §4.2 + nueva sección "Reconciliación as-built": token filled, TreatmentFlag hero, sección, sheets,
  route selector, validateNextDose, FormField.multiline, suite RLS comentada.
- `tasks-tratamientos.md`: T1–T21 en `[x]`. T22/T23 = leader.
</content>
