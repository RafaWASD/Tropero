# Review — R2.1 "Guardar como rutina" (chunk guardar-rutina, spec 03 MODO MANIOBRAS)

Reviewer: reviewer (RAFAQ) - Fecha: 2026-06-16. Tipo: frontend puro + 1 hallazgo de seguridad.
Pantalla: amarilla (wizard etapa 3), testeada en pnpm web + Playwright tactil. Baseline edac670.

## Veredicto: CHANGES_REQUESTED

Motivo UNICO y acotado: las specs quedaron mintiendo respecto al as-built de la DB (regla dura de
reconciliacion codigo->spec, paso 6 / docs/specs.md). El codigo del chunk es CORRECTO y los tests
verdes; el bloqueo es de exactitud documental, no de implementacion. Reconciliar los punteros de spec
y re-emitir -> APPROVED (no requiere tocar codigo de la app ni migracion).

## 1. Hallazgo de seguridad — REEVALUACION (el reportado esta OBSOLETO)

El progress y las specs afirman que maneuver_presets.name NO tiene cap server-side y que corresponde un
Gate 1 puntual con CHECK char_length(name) <= N antes de exponer el input. ESO YA NO ES CIERTO.

El cap server-side YA EXISTE en produccion. La migracion 0070_check_text_length_caps.sql (spec 13,
INPUT-1, commit 1da96a4) lo agrego (lineas 269-270):
    alter table public.maneuver_presets add constraint maneuver_presets_name_len_chk
      check (char_length(name) <= 120) not valid;  + validate constraint.

Evidencia de que esta DEPLOYADA al remoto (no solo en el archivo):
- progress/history.md:499 — los 2 findings HIGH explotables (B3-1, INPUT-1) cerrados de punta a punta
  EN PRODUCCION y committeados.
- progress/current.md:80 — Gate 2 de M2.1-core: precargado con cap server-side CHECK<=64 0070.
- supabase/tests/animal/run.cjs:1881 — el test R2: INPUT-1 CHECK corre contra el remoto asumiendo 0070
  aplicada (solo falla por el flake UNIQUE 23505, no por ausencia del CHECK 23514).
- tasks.md:317 y design.md:762 — otros componentes del equipo ya referencian maxLength=64 (cap 0070).
- docs/backlog.md (2026-06-14) es justamente el item que 0070 cerro.

No pude probar el INSERT de 121 chars contra el remoto: la escritura a la DB compartida esta
correctamente gateada por el clasificador (project_supabase_mcp_write). Verificacion documental + por
la suite que corre contra ese remoto. PostgREST no expone pg_constraint para chequeo de catalogo.

Severidad (independiente): el riesgo (storage-abuse INTRA-tenant por write directo a PostgREST/sync que
saltea el maxLength=60 del cliente) es real en su CLASE pero YA mitigado server-side por
maneuver_presets_name_len_chk (<=120). El cliente 60 es UX; el CHECK 120 es la barrera autoritativa. La
RLS has_role_in sigue gateando el tenant (NO es IDOR ni cross-tenant). Clase: storage-abuse intra-tenant.

BLOQUEANTE PARA COMMIT POR SEGURIDAD? NO. No hace falta migracion nueva ni Gate 1: el cap ya existe. Lo
que SI bloquea es que las specs digan lo contrario (seccion 6). Backlog 2026-06-14 = RESUELTO por 0070.

## 2. Correctitud — OK
- config del preset = MISMO shape que createSession: buildCurrentConfig() (jornada.tsx:241-247, memo) es
  la UNICA fuente, reusada por onArrancar->createSession (l.260) y onSavePreset->createPreset (l.282). No
  se re-deriva. buildJornadaConfig produce {maniobras:[orden], preconfig} (R1.13).
- establishmentId del contexto (useEstablishment, jornada.tsx:84/279), NUNCA hardcodeado (R2.4).
- nombre no-vacio trim: triple defensa — canSave (SavePresetSheet.tsx:101) + createPreset re-trim
  (maneuver-presets.ts:80-83) + CHECK maneuver_presets_name_not_empty (0051:16).
- fail-closed en ok:false: el sheet NO se cierra ni pierde lo tipeado (SavePresetSheet.tsx:109-114); el
  caller solo cierra+toast en el OK (jornada.tsx:289-291). Doble-submit cubierto (saving deshabilita).

## 3. Offline-first — OK
- createPreset = CRUD-plano local (buildCreateManeuverPresetInsert -> runLocalWrite -> upload queue); id
  de cliente (R2.5); created_by forzado por trigger al subir; el preset aparece en el landing en focus.

## 4. Amarilla / web tactil — OK
- guard anti tap-through del scrim (readyToDismissRef doble-rAF, SavePresetSheet.tsx:65-90) PRESENTE y
  VERIFICADO con test tactil fiel (hasTouch + touchscreen.tap) en maniobra-config-sheet-race.spec.ts
  test 2 (R2.1): abre y queda vivo +500ms + escribible; backdrop deliberado SI cierra.
- tokens: 0 violaciones de anti-hardcode; todos existen en tamagui.config.ts.
- targets: input/Button >=56 (token canonico, amarilla no roja). es-AR voseo OK. Descenders OK en
  capturas 360/412 (Revisa la jornada/Guardar como rutina/Tacto de prenez), lineHeight matching.

## 5. Tests — VERDES (el rojo de check.mjs es el flake conocido, NO regresion)
- node scripts/check.mjs -> ROJO por UNA falla: animal/run.cjs:1881 animals.tag_electronic borde 64 ->
  duplicate key animals_tag_unique, codigo 23505 (UNIQUE, no 23514) = flake de colision de seed entre
  terminales paralelas en la DB compartida (memoria reference_check_red_rate_limit). Suite spec 02, no del chunk.
- Maneuvers backend suite (spec 03): 14/14 (incl. T2.8 RLS presets, T2.4/T2.4c gating). VERDE.
- Unit maniobra (maneuver-wizard.test + maneuver-config.test): 54/54. VERDE.
- e2e maniobra-wizard.spec.ts: 1/1 — oraculo server REAL waitForServerPreset confirma la fila con
  config.maniobras = [pesaje,tacto,vacunacion] en orden + nombre vacio/whitespace -> Guardar deshabilitado.
- e2e maniobra-config-sheet-race.spec.ts: 2/2 (incl. tap-through del SavePresetSheet). VERDE.
- (El Assertion failed uv async.c tras N passed = crash de cleanup de libuv en Win11 post-salida; irrelevante.)

## 6. Reconciliacion de specs — FALLA (motivo del CHANGES_REQUESTED)
Las superficies de spec describen el as-built como si maneuver_presets.name NO tuviera cap server-side y
dejan el hardening pendiente; contradicen el codigo real (0070, ya en produccion):
- design.md 6.bis.10 (l.880, l.883) — el DB no tiene cap sobre name / Hardening pendiente: cap server-side
  Gate 1 puntual. FALSO: 0070 ya puso char_length(name) <= 120.
- design.md seccion 7 (tabla de seguridad) — no lista el cap de maneuver_presets.name como mitigado.
- requirements.md R2.1 nota as-built (l.63) — Hardening pendiente: cap server-side de name (Gate 1).
- tasks.md M1.4 as-built v3 (l.184) — Hardening pendiente (NO bloqueante): cap server-side de name.
- SavePresetSheet.tsx (l.17, l.42) — el DB no tiene cap de longitud sobre name ... el tope es de cliente.

## 7. Trazabilidad R<->test (R2.1 / R2.4 — los del chunk) — COMPLETA
- R2.1 crear preset (config=jornada, orden): maniobra-wizard.spec.ts oraculo waitForServerPreset asierta
  config.maniobras=[pesaje,tacto,vacunacion] en orden. OK
- R2.1 nombre no-vacio/whitespace (CHECK 0051): maniobra-wizard.spec.ts l.271-274 saveBtn toBeDisabled. OK
- R2.1 config = misma de createSession: maneuver-wizard.test.ts R1.13 round-trip + buildCurrentConfig unica fuente. OK
- R2.4 establishment del contexto: onSavePreset usa useEstablishment; e2e crea bajo el establishment sembrado. OK
- R2.1 independiente de arrancar: tras Guardar, Revisa la jornada sigue visible (no navego). OK
- R2.1 fail-closed / tap-through web: maniobra-config-sheet-race.spec.ts test 2 (hasTouch+touchscreen.tap). OK
Todos los R del chunk tienen >=1 test concreto.

## 8. Tasks completas: SI
M1.3 y M1.4 ya en [x] (DONE), reconciliadas con as-built v3. No quedan [ ] del chunk sin justificar.

## 9. CHECKPOINTS (aplicables al chunk frontend-puro)
- C3 (arquitectura): [x] screen+component, sin fetch en componente, sin hardcode de establishment_id, sin TODOs/logs.
- C4 (verificacion real): [x] unit + e2e + oraculo server real (no mock de I/O).
- C6 (SDD): [ ] trazabilidad OK PERO design/requirements/tasks contradicen el as-built (seccion 6). BLOQUEA.
- C7 (multi-tenant): [x] RLS has_role_in (0051) + establishment del contexto + cap server (0070); cross-tenant via T2.8.
- C8 (offline-first): [x] CRUD-plano local + upload queue + id cliente; LWW default.

## 10. Checklist RAFAQ-especifico
- A (multi-tenancy/RLS tabla nueva): N/A (no crea tabla; maneuver_presets/RLS/0051 ya existian). Lo aplicable OK.
- B (offline-first campo): [x] offline (CRUD-plano) [x] bucket scoped por establishment [x] LWW default
  [x] el screen NO hace request sincrono a Supabase (usa el service que toca SQLite local via runLocalWrite).
- C (BLE): N/A. - D (UI campo): [x] una decision por pantalla [x] loading visible (Guardando...) targets >=56 (amarilla).
- E (Edge Functions): N/A.

## 11. Cambios requeridos (concretos)
1. design.md 6.bis.10 (l.880, l.883) — retirar el DB no tiene cap sobre name / Hardening pendiente Gate 1;
   reflejar maneuver_presets_name_len_chk <= 120 (0070).
2. design.md seccion 7 (tabla de seguridad) — agregar fila: cap de maneuver_presets.name <=120 mitigado por 0070/INPUT-1.
3. requirements.md R2.1 nota as-built (l.63) — cambiar Hardening pendiente por cubierto por 0070.
4. tasks.md M1.4 as-built v3 (l.184) — idem.
5. SavePresetSheet.tsx comentarios (l.17, l.42) — el DB SI tiene cap <=120 (0070); el cliente sigue siendo UX.
6. docs/backlog.md 2026-06-14 — marcar RESUELTO por 0070 (maneuver_presets.name; sessions.work_lot_label tambien
   quedo cubierto, 0070:263 lo capea <=120).

Ninguno toca codigo de la app ni tests. Reconciliar -> re-review -> APPROVED.
