# Review — spec 03 — M5-C.3 — render generico del paso desde `ui_component` + propiedad custom en alta/ficha

**Reviewer**: reviewer (Opus 4.8) · **Fecha**: 2026-06-17 · **Baseline**: `11ab1de` (HEAD M5-C.2; M5-C.3 sin commitear, working tree).

## Veredicto: APPROVED

Chunk frontend puro, ADITIVO, cero-regresion sobre las 12 maniobras de fabrica y sobre el alta/ficha existentes. Trazabilidad completa, tests verdes (unit + e2e con oraculos server reales), specs reconciliadas con el as-built (incl. el fix del UPSERT-sobre-vista y el veto del enum_single). El unico rojo de `check.mjs` es el flake documentado `animals_tag_unique` (23505) de la suite BACKEND `animal` por terminales paralelas (spec 08 activa) — NO una regresion de este chunk.

## Trazabilidad R<n> ↔ test

- **R13.8** (7 tipos de input por ui_component + render generico) ↔
  - `app/src/utils/custom-render.test.ts`: `captureKindFor`/`parseCustomOptions`/`parseCustomValueJson`/`describeCustomValue`/`isCustomValueComplete` por los 7 ui_component.
  - `app/src/utils/maneuver-sequence.test.ts`: `buildSequence` con custom (orden combinado, contador, dedup, SOLO custom) + **buildSequence SIN custom = IDENTICO**; `summaryRows`/`isSequenceComplete`/`firstUncapturedIndex` con `CustomCaptureMap`.
  - `app/src/utils/maneuver-wizard.test.ts`: `toggleCustomManiobra`; `buildJornadaConfig` customManiobras paralelo + round-trip + **SIN custom = byte-identico**.
  - `app/src/utils/maneuver-config.test.ts`: `extractCustomManiobras` (orden/dedup).
  - e2e `app/e2e/maniobra-custom-render.spec.ts`: enum_single->bloques->custom_measurements (oraculo server waitForServerCustomMeasurement + session_id); numeric->keypad->numero jsonb nativo (7, no "7"). PASS de primera mano.
- **R13.10** (maniobra custom en lista + propiedad custom en alta/ficha) ↔
  - `app/src/services/powersync/maneuver-reads.test.ts`: `buildEnabledCustomFieldsQuery(maniobra|propiedad)` overlay-aware, `buildCustomAttributesQuery`.
  - e2e PARTE B: propiedad en alta (paso 4)->custom_attributes + ficha ver/editar in-place (LWW). PASS.
- **R13.11** (custom_measurements append-only con session_id) ↔ `maneuver-reads.test.ts` (`buildAddCustomMeasurementInsert` plain INSERT + `buildUpdateCustomMeasurement` correccion por id) + e2e oraculo con session_id.
- **R13.12** (custom_attributes current-value editable anytime) ↔ `maneuver-reads.test.ts` (`buildInsertCustomAttribute`/`buildUpdateCustomAttribute` por id sintetico) + e2e edicion in-place (LWW Pinto->Manchado).
- **R13.13** (capturar = cualquier rol) ↔ server-side (RLS has_role_in, suite backend 0095/0096) + verificado que el write-path cliente NO gatea por rol (custom-measurements.ts/custom-attributes.ts sin isOwner/role).
- **R13.16** (value tipado por ui_component) ↔ `custom-value.test.ts` + `custom-render.test.ts` + e2e (numero jsonb nativo).

## Tasks completas: si

- M5-C.3 (T1-T10 del impl_03-m5-c3.md) TODAS [x]. El chunk bajo revision esta cerrado.
- 3 tasks [ ] en tasks.md (T2.12, M3.2c, M4.3) NO son de M5-C.3: pertenecen a M2/M3/M4 y estan documentadas como DIFERIDAS/PENDIENTES con justificacion. La feature 03 sigue in_progress (no se cierra aca). No bloquean este chunk.

## CHECKPOINTS

- C1 [x] harness completo. C2 [x] una sola feature in_progress (03).
- C3 [x] capas respetadas (CustomManeuverStep/CustomFieldInput presentacionales; los services viven en app/src/services). Anti-hardcode 0 violaciones (check). Sin TODOs sueltos. **establishment_id nunca hardcodeado** (verificado: ningun write custom lo manda; lo fuerza el trigger).
- C4 [x] tests por modulo con logica; fixtures reales (e2e con oraculos server, no mocks de I/O); runner > 0 verde.
- C6 [x] specs presentes; R13.8/R13.10 con >=1 test cada uno.
- C7 [x] multi-tenant: RLS suite verde (cross-tenant); tablas custom (0095/0096) son backend ya gateado en M5-BACKEND (no se toco schema aca).
- C8 [x] offline-first: writes CRUD-plano local (INSERT/UPDATE) sin red; gating capa 2 + audit re-validan al subir; LWW explicito documentado.

## Checklist RAFAQ-especifico

- **A. Multi-tenancy/RLS**: N/A directo (frontend puro; no crea tablas). Verificado que el cliente NO debilita el modelo: no manda establishment_id, no gatea por rol. RLS suite verde.
- **B. Offline-first**: [x] writes CRUD-plano local sin red. [x] streams est_custom_* scope establishment (e2e sincroniza DOWN). [x] conflict resolution LWW explicito (custom_attributes UPDATE-luego-INSERT; custom_measurements append-only + UPDATE por id estable para correccion R5.9). [x] pantallas usan runLocalQuery/runLocalWrite (SQLite local), no requests sincronos a Supabase.
- **C. BLE**: N/A — no toca el adaptador BLE.
- **D. UI de campo (manga + form)**: [x] targets XL ($touchMin/$searchBarLg, keypad/stepper/bloques flex). [x] fuentes grandes ($9/$10/$11 manga; $5 form). [x] una decision por pantalla. [x] loading visible (CustomPropertiesFicha spinner; banner de error de persistencia en manga). [x] descenders: lineHeight matching en todo Text con numberOfLines. [x] es-AR (coma decimal) en numericos; date formato de maquina AAAA-MM-DD. [x] veto enum_single aplicado (bloques neutros DientesStep, sin check enganoso en reposo).
- **E. Edge Functions**: N/A — no toca Edge Functions.

## Verificacion de los focos criticos del encargo

1. **Las 12 de fabrica IDENTICAS** — config/sequence/dispatcher de carga.tsx extendidos ADITIVAMENTE; con customManiobras=[]/customEnabled=[] el config es byte-identico y la secuencia identica (unit explicitos + e2e maniobra-carga 3/3, elegir 2/2, wizard 1/1 PASS de primera mano).
2. **Fix UPSERT-sobre-vista** — buildSetCustomAttributeUpsert (ON CONFLICT) REEMPLAZADO por buildInsertCustomAttribute+buildUpdateCustomAttribute (plain); setCustomAttribute = UPDATE-luego-INSERT (runLocalWriteCount). custom_measurements = plain INSERT + UPDATE por id. **El connector (connector.ts/upload-classify.ts) NO cambio** (diff vacio): COMPOSITE_PK.custom_attributes (PK natural) + JSONB_TEXT_COLUMNS siguen correctos; INSERT/UPDATE local se trackea como PUT/PATCH igual -> upload por PK natural intacto. custom_measurements NO esta en COMPOSITE_PK (usa id real, correcto). SIN referencia muerta a buildSetCustomAttributeUpsert. Sin camino muerto que rompa otras tablas.
3. **Alta/ficha NO se rompen** — integracion aditiva soft-fail (post-create como condicion/preniez); CustomPropertiesForm retorna null sin propiedades; ficha archivada = solo lectura (editable=status active). value jsonb bien tipado (serializeCustomValue/toCustomValue). e2e alta+ficha PASS.
4. **Integracion manga** — renderer por ui_component captura el value correcto por tipo (e2e enum_single Afuera + numeric 7 jsonb); correccion desde el resumen reusa id estable (UPDATE, no duplica); contador N de M combinado correcto (e2e "1 de 1").

## Tests / check

- node scripts/check.mjs: typecheck client OK · client unit OK · RLS OK · Edge OK · **Animal suite FAIL = flake animals_tag_unique (23505)** terminales paralelas (DB compartida, spec 08 activa) — documentado en MEMORY/AS-BUILT, NO regresion de M5-C.3 (frontend puro, no toca la suite animal).
- Unit M5-C.3 en aislamiento: **227/227 PASS** (custom-render/value/field, sequence/config/wizard, maneuver-reads/upload-classify/schema).
- e2e (build OK + corrida propia): **11/11 PASS** — maniobra-custom-render 3/3 (oraculos server), maniobra-carga 3/3 (incl. offline), maniobra-elegir 2/2, maniobra-wizard 1/1, maniobra-custom 2/2. (Ruido libuv UV_HANDLE_CLOSING post-suite en Windows, inocuo.)

## Reconciliacion de specs (codigo -> spec)

- tasks.md M5-C.3 [x] + bloque AS-BUILT (Parte A/B + gotcha view + tests/regresion).
- design.md 11.6 AS-BUILT M5-C.3: shape aditivo customManiobras + SequenceItem discriminado; renderer por ui_component con idioms lockeados; alta/ficha CustomFieldInput/CustomPropertiesSection; **gotcha cannot UPSERT a view -> UPDATE-luego-INSERT, supersede el banner de C.1**; **RECONCILIACION del veto enum_single** (TactoVaquillona->DientesStep). 11.7 sin cambios. Coincide con el codigo as-built.
- requirements.md nota AS-BUILT bajo R13.10 (R13.8/R13.10 construidos; desviacion tecnica R13.12 UPDATE-luego-INSERT, mismo current-value). El que no cambio.
- No quedan specs contradiciendo el codigo.

## Observaciones no-bloqueantes (no requieren cambio para aprobar)

1. app/src/services/powersync/upload-classify.ts:80-85 — el comentario del header todavia describe el write local de custom_attributes como INSERT ... ON CONFLICT(id) DO UPDATE. Tras M5-C.3 el write local es UPDATE-luego-INSERT plano. **El comportamiento del connector es correcto** (INSERT/UPDATE plano se trackean como PUT/PATCH igual; el special-case por PK natural aplica identico) y los e2e lo confirman; es solo un comentario stale en un archivo que NO cambio en este chunk. Sugerencia: refrescar en un pase futuro (no bloquea).
2. CustomManeuverStep.EnumSingleBlocks no precarga initialValue al corregir desde el resumen (los otros idioms si). Aceptable: un-toque-elige-avanza, re-tocar corrige; no es dato perdido.

**NO marco la feature done** (sigue in_progress/deferred: quedan M2/M3/M4 abiertos + chunks post-MVP). Pendiente: Gate 2 (security code) + Puerta de codigo humana.
