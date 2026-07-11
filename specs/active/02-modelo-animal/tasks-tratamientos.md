# Spec 02 — Delta `tratamientos` · Tasks

> Checklist ejecutable del delta Nivel B (ADR-028). El implementer marca `[x]`; el reviewer rechaza un `[ ]` sin
> justificación. Trazabilidad: cada `T` cita los `RTR.x` que cubre; el mapa `RTR.x → archivo:test` va en
> `progress/impl_tratamientos.md`. **Gate 1 (schema) va entre la Fase A y Puerta 1.** El baseline `tasks.md`
> original NO se toca.

## Fase A — Schema + RLS + sync + tests backend (SCHEMA-SENSITIVE → Gate 1)

- [x] **T1** — Migración `supabase/migrations/0123_treatments.sql`: enum `treatment_kind` + tabla `treatments`
  (con `establishment_id`/`created_by` forzados, `ended_at` nullable, `deleted_at`, check `product_name` no
  vacío + **CHECKs de tope `product_name` ≤ 120 / `notes` ≤ 1000**, SEC-TRT-02) + 3 índices
  (`treatments_open_by_profile`, `treatments_by_profile`, `treatments_by_est`). Moldear los helpers sobre su
  cuerpo VIGENTE en el remoto. Cubre: RTR.1.2, RTR.1.3, RTR.1.4, RTR.1.9, RTR.1.10, RTR.4.1, RTR.7.6.
- [x] **T2** — En la misma `0123`: `ALTER sanitary_events ADD treatment_id uuid references treatments(id) on
  delete set null` + índice parcial `sanitary_events_by_treatment`. Cubre: RTR.2.2.
- [x] **T3** — En la misma `0123`: triggers `treatments_force_establishment_id` (0077) +
  `treatments_force_created_by` (0043) + **`tg_treatments_immutable_columns` (BEFORE UPDATE, solo `ended_at`
  NULL→ts mutable — SEC-TRT-01)** + función/trigger `tg_sanitary_events_treatment_check` en **`before insert or
  update` incondicional** (anti-IDOR, SEC-TRT-03) + `revoke execute` de las `security definer` nuevas
  (SEC-TRT-04). Cubre: RTR.7.2, RTR.7.3, RTR.7.5, RTR.7.7, RTR.7.8, RTR.2.6.
- [x] **T3b** — En la misma `0123`: **CREATE OR REPLACE de `tg_sanitary_events_gating`** (0091) con la exención
  acotada `treatment_id IS NOT NULL AND event_type <> 'vaccination' → return new` (RTR.2.7/RTR.2.8, hardening
  LOW-1) + `revoke execute` re-afirmado. Moldear sobre el cuerpo VIGENTE en el remoto; dejar EXACTA la rama de
  maniobra. Re-correr las suites que tocan el gating (spec 03) + sanitary. Cubre: RTR.2.7, RTR.2.8.
- [x] **T4** — En la misma `0123`: RLS de `treatments` (SELECT/INSERT `has_role_in`; UPDATE `has_role_in` USING +
  WITH CHECK; sin DELETE) + grants (`select,insert,update` a authenticated; `all` a service_role) + `notify
  pgrst`. Cubre: RTR.6.1, RTR.6.2, RTR.6.3, RTR.6.4, RTR.7.1.
- [x] **T5** — Stream `ev_treatments` en `sync-streams/rafaq.yaml` (JOIN-free, scope establishment,
  `deleted_at IS NULL`). Cubre: RTR.7.4.
- [x] **T6** — Tests RLS (runner Node `supabase/tests/rls/`): (a) usuario sin rol en el campo NO lee/escribe un
  treatment (fail-closed); (b) `establishment_id` se fuerza del perfil aunque el payload mande otro
  (anti-spoof), en INSERT y UPDATE; (c) `created_by` se fuerza a `auth.uid()`; (d) `treatment_id` cross-animal
  rebota 23514 y treatment inexistente 23503 (anti-IDOR), incluyendo un UPDATE de `animal_profile_id` de la
  aplicación; (e) ciclo iniciar→aplicar→finalizar; (f) cualquier rol (peón) finaliza; (g) **inmutabilidad
  SEC-TRT-01**: un UPDATE de `created_by`/`deleted_at`/`product_name`/`kind`/`notes`/`started_at` o un
  `ended_at=NULL` NO surte efecto (queda OLD); (h) **CHECKs SEC-TRT-02**: `product_name`>120 / `notes`>1000
  rebotan; (i) **exención de gating**: una aplicación de tratamiento (treatment/deworming/other) pasa en un rodeo
  SIN el data_key, una aplicación suelta (treatment_id NULL) sigue gateada, y **una vaccination con treatment_id
  del mismo animal SIGUE gateada** (LOW-1). Cubre: RTR.7.1, RTR.7.2, RTR.7.3, RTR.7.5, RTR.7.7, RTR.7.8, RTR.1.9,
  RTR.1.10, RTR.2.7, RTR.2.8, RTR.6.1–RTR.6.3, RTR.3.2.

> **⏸ Gate 1** (`security_analyzer` modo `spec`) sobre esta spec → luego **Puerta 1** (Raf aprueba) → recién
> entonces se aplica `0123` al remoto (deploy gateado) + se deploya la stream, y arranca la Fase B.

## Fase B — PowerSync plumbing (schema + builders + service)

- [x] **T7** — `schema.ts`: `Table treatments` + `treatment_id` en `sanitary_events` + registrar `treatments` en
  `AppSchema`. Cubre: RTR.8.1, RTR.8.2.
- [x] **T8** — `local-reads.ts`: builders CRUD-plano `buildStartTreatmentInsert` / `buildRegisterApplicationInsert`
  / `buildFinalizeTreatmentUpdate` (idempotente `ended_at IS NULL`). Cubre: RTR.1.2, RTR.2.2, RTR.3.2, RTR.3.4.
- [x] **T9** — `local-reads.ts`: lecturas `buildAnimalTreatmentsQuery` + `buildTreatmentApplicationsQuery` (en
  curso primero; aplicaciones por fecha). Cubre: RTR.9.1, RTR.9.2, RTR.9.3.
- [x] **T10** — `local-reads.ts`: inyección de `in_treatment` (EXISTS synced / `0` overlay) en
  `buildAnimalsListQuery` + ORDER BY `in_treatment DESC, ${orderBy} DESC`. Tests puros (node:test) del SQL/ORDER.
  Cubre: RTR.5.1, RTR.5.2, RTR.5.3.
- [x] **T11** — `services/treatments.ts`: `startTreatment` / `registerApplication` (mapeo `kind→event_type`,
  `product_name` default del header) / `finalizeTreatment` / `fetchTreatments`, `ServiceResult<T>`, id de cliente,
  `started_at` cliente. Cubre: RTR.1.5, RTR.1.6, RTR.2.3, RTR.2.4, RTR.8.5.
- [x] **T11b** — `utils/treatment-input.ts`: constantes `TREATMENT_PRODUCT_MAX_LENGTH=120` /
  `TREATMENT_NOTES_MAX_LENGTH=1000` + sanitizer/validación (mismas que los CHECKs de T1) → el form corta antes de
  encolar. Tests puros. Cubre: RTR.1.9, RTR.1.10.
- [x] **T12** — `animals.ts` (`toLocalListItem` + `AnimalListItem`): exponer `inTreatment` (lee `in_treatment` del
  row). Cubre: RTR.4.4.

## Fase C — Frontend (ficha + marca + pin)

- [x] **T13** — `AnimalRow.tsx`: prop `inTreatment?` + marca sanitaria (chip/punto, color TBD Gate 2.5; NO reusar
  terracota/amber/CUT/verde; `labelA11y` + `lineHeight`). Cubre: RTR.4.4, RTR.4.5.
- [x] **T14** — `(tabs)/animales.tsx`: pasar `inTreatment` a `AnimalRow` (el pin ya lo da el ORDER BY). Verificar
  que la lista del **rodeo** (con `rodeoId`) también pinnea/marca. Cubre: RTR.4.4, RTR.5.1, RTR.5.2.
- [x] **T15** — `animal/[id].tsx`: sección "Tratamientos" (listar tratamientos + aplicaciones) + marca "en
  tratamiento" en el hero (derivada de los tratamientos cargados) + gating a animal activo. Cubre: RTR.4.1,
  RTR.4.3, RTR.9.1, RTR.9.2, RTR.9.3, RTR.1.8.
- [x] **T16** — Sheet "Iniciar tratamiento" (selector `kind` cerrado + `product_name` requerido, validado con el
  sanitizer de T11b + comentario + 1ª aplicación opcional) → `startTreatment` (+ opcional `registerApplication`),
  optimismo en sitio + refresh silencioso. Cubre: RTR.1.1, RTR.1.2, RTR.1.3, RTR.1.4, RTR.1.9, RTR.1.10, RTR.1.5,
  RTR.1.6, RTR.1.7.
- [x] **T17** — Sheet "Registrar aplicación" (fecha default hoy + dosis/vía/próxima dosis opcionales) →
  `registerApplication`, solo en tratamiento en curso. Cubre: RTR.2.1, RTR.2.3, RTR.2.4, RTR.2.5, RTR.9.5.
- [x] **T18** — CTA "Finalizar tratamiento" (confirmación inline) → `finalizeTreatment`; la marca/pin se quitan
  (refresh silencioso). Cubre: RTR.3.1, RTR.3.2, RTR.3.3, RTR.4.6, RTR.5.4.
- [x] **T19** — Verificar que las aplicaciones siguen en el timeline (sanitary_events) sin regresión; *(opcional)*
  proyectar `treatment_id` en el payload del timeline para anotar el nodo. Cubre: RTR.9.4.

## Fase D — Offline + E2E + Gate 2.5

- [x] **T20** — E2E (`app/e2e/`, fixtures de `./helpers/fixtures`): flujo iniciar → aplicar → finalizar en la
  ficha; la marca aparece/desaparece; el animal pinnea arriba en la lista general y en la del rodeo. Cubre:
  RTR.4.6, RTR.5.1, RTR.5.2, RTR.5.4, RTR.9.1.
- [x] **T21** — E2E/manual offline: iniciar/aplicar/finalizar sin conexión → la fila local aparece/actualiza al
  instante; al reconectar sincroniza. Cubre: RTR.8.1, RTR.8.2, RTR.8.3, RTR.8.4.
- [ ] **T22** — Gate 2.5 (ADR-029): capturas de la ficha (marca "en tratamiento" + iniciar/aplicar/finalizar +
  sección con aplicaciones) + lista con pin/marca; **veto visual del leader** define el token de color sanitario
  (D-1) antes de mostrar a Raf. Revertir los `design/**/*.png` re-renderizados por el e2e antes de commitear
  (memoria). Cubre: RTR.4.3, RTR.4.5.

## Reconciliación de cierre (Puerta 2)

- [ ] **T23** — Reconciliar al as-built: foldear al baseline `design.md` (índice "Deltas posteriores" + puntero
  bajo R6/R10/R14) — **lo hace el leader**. Reflejar en este set cualquier fix de Gate 1/Gate 2/autorrevisión
  (regla dura de reconciliación). Fijar el token de color definitivo en `requirements`/`design` (RTR.4.5).
