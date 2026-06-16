# Review — Spec 03 MODO MANIOBRAS — chunk M1 COMPLETO (M1-SERVICIOS + M1-UI)

Reviewer: reviewer (Opus). Fecha: 2026-06-14.
Alcance: M1.1 (gating) + M1.2 (sessions) + M1.3 (presets) + M1.4 (wizard UI: inicio + 3 etapas + drag-reorder + preconfig sheet) — frontend puro + logica pura sobre el backend done (0050-0057). NO se reviso: backend (done/aprobado Puerta 2 s18), spike M2.0 (carga.tsx/paso.tsx, mock, fuera de scope), ni el drift de spec 08 en el working tree.

## Veredicto: APRUEBA

El chunk M1 esta completo, fiel a la spec, offline-first, multi-tenant, sin hardcode, con descendentes cuidados y con tests reales verdes. El unico hallazgo de M1-SERVICIOS (string stale tacto_vaca en design.md sec 2.1.1) ya fue reconciliado (design.md:232 ahora dice tacto). El fix de canSave del veto del leader esta aplicado (cero rastro de canSave en el codigo). Sin cambios requeridos.

node scripts/check.mjs -> RC=1 por FLAKE AJENO (ver abajo), NO regresion. Todos los gates del FRONTEND (typecheck, anti-hardcode, client unit incl. las 3 suites de maniobras) verdes.

---

## check.mjs — RC y distincion del flake

RC=1. La rotura NO esta en este chunk:
- 1ra corrida: supabase/tests/operaciones_rodeo/run.cjs -> TypeError: Cannot read properties of undefined (reading id) (cascada del setup before fallido). Re-corrida aislada de esa suite -> VERDE (setup OK, T-DB.9 OK, fail 0).
- 2da corrida: supabase/tests/rls/run.cjs -> Error: signIn(...): Request rate limit reached.

Ambos = el flake DOCUMENTADO de auth de Supabase por 2 terminales contra el remoto compartido (memoria reference_check_red_rate_limit.md). Son suites BACKEND (RLS/Edge/operaciones-rodeo); este chunk es frontend puro + logica pura -> toca CERO auth/backend/RLS. No es regresion de M1.

Gates del frontend (los que SI corresponden a este chunk), todos verdes:
- typecheck client (tsc --noEmit) -> exit 0 (compila TODO el chunk: servicios + UI).
- Anti-hardcode (ADR-023 sec 4) -> 0 violaciones en app/app + app/src/components.
- client unit (3 suites de maniobras + maneuver-reads + upload + schema) -> 104/104 en corrida aislada; maneuver-wizard.test.ts -> 26/26.

---

## Trazabilidad R<n> a test (chunk M1 completo)

### M1-SERVICIOS (re-confirmada; ya aprobada salvo el string stale, ahora fixeado)
| R<n> | Test concreto |
|---|---|
| R1.4 / R1.5 (gating UI capa 1) | maneuver-gating.test.ts -> filterApplicableManeuvers (habilitadas vs omitidas) |
| R1.9 / R1.10 / R1.11 (sesion persistida, id cliente, config snapshot) | maneuver-reads.test.ts -> buildCreateSessionInsert (status active, contadores 0, started_at cliente, created_by NULL) |
| R2.1 / R2.4 / R2.5 (preset scope est, id cliente) | maneuver-reads.test.ts -> buildCreateManeuverPresetInsert + buildManeuverPresetsQuery (excluye otros est) |
| R2.2 (presets al tope, lista ordenada) | maneuver-reads.test.ts -> buildManeuverPresetsQuery (orden por nombre, borrados excluidos) |
| R2.3 (preset filtra OFF + avisa) | maneuver-gating.test.ts -> maniobra OFF cae en omitted; loadPreset reusa filterApplicableManeuvers |
| R5.3 (rodeo real del perfil activo) | maneuver-reads.test.ts -> buildActiveProfileRodeoQuery (perfil soft-deleted -> 0 filas) |
| R5.4 (mapeo maniobra->data_keys) | maneuver-gating.test.ts -> MANEUVER_DATA_KEYS (10 maniobras + multi-key tacto) |
| R5.5 (omite si data_key OFF) | maneuver-gating.test.ts -> single/multi-key NO aplica |
| R5.6 (required vs opcional) | maneuver-gating.test.ts -> requiredDataKeys (enabled+required) |
| R9.4 (work_lot_label informativo) | maneuver-reads.test.ts -> buildSetWorkLotLabelUpdate (set/clear) |
| R10.3 (gating cacheado offline) | fetchRodeoGating lee SQLite local; builders en maneuver-reads.test.ts |
| R10.5/R10.6 (sesion activa unica, reanudacion) | maneuver-reads.test.ts -> buildActiveSessionQuery (started_at DESC) |
| R10.7 (cerrar sesion) | maneuver-reads.test.ts -> buildCloseSessionUpdate |
| R6.11 (soft-delete optimista) | maneuver-reads.test.ts overlay-hide; upload.test.ts -> mapIntentToRpc soft_delete |

### M1-UI (wizard, task M1.4)
| R<n> | Test concreto |
|---|---|
| R1.2 (wizard 3 etapas, una decision/pantalla) | e2e: inicio->etapa1->etapa2->etapa3 + Paso N de 3 |
| R1.3 (etapa 1: rodeos activos) | e2e: fila Elegir rodeo del rodeo sembrado (fetchRodeos filtra active+deleted_at) |
| R1.4/R1.5 (etapa 2: maniobras gateadas) | e2e: ofrece tacto/vacunacion; inseminacion NO (data_key OFF en cria -> reject real del gating) |
| R1.7 (preconfig de tanda) | e2e: sheet de vacunacion -> guardar -> inline + resumen; buildJornadaConfig tests |
| R1.8 (autocompletar usadas antes) | e2e: presets sembrados -> Brucelosis/Aftosa en Usadas antes; filterAutocomplete + split/joinMultiPreconfig (round-trip) |
| R1.9 (etapa 3 resumen + persiste) | e2e: Brucelosis bajo Vacunacion + Arrancar crea sesion; maneuverDetail tests |
| R1.12 (drag-reorder con handles) | e2e: drag-handle-0/2 visibles; badge=quitar / cuerpo=sheet; moveManeuver/toggleManeuver tests |
| R1.13 (orden persistido en config.maniobras) | buildJornadaConfig + R1.13 round-trip (serialize->extractManeuvers preserva orden) |
| R2.2 (presets al tope del inicio) | e2e: Tus rutinas + PresetRow; fetchPresets |
| R2.3 (preset: omitidas avisadas) | UI presetOmitted InfoNote; loadPreset (maneuver-config/reads tests) |

Tests REALES, no humo: maneuver-reads.test.ts EJECUTA el SQL de los builders contra node:sqlite; el gating puro testea accept Y reject (multi-key parcial, rodeo vacio); el e2e ejerce el path REAL (login + seed + gating real -> inseminacion ausente, no mock). El drag fisico no se simula en web pero el RESULTADO (orden en config) esta cubierto por moveManeuver + round-trip. El clear-multi del fix de canSave ejerce el reject->accept real (chip -> quitar -> Guardar vacio -> key borrada -> hint).

---

## Tasks completas: SI (para M1)
M1.1 / M1.2 / M1.3 / M1.4 -> [x] en tasks.md con archivos+tests as-built (incl. v2/v3/v4 + fix de canSave). M2/M3/M4 quedan [ ] — JUSTIFICADO: chunks posteriores del pipeline por-chunk de spec 03 (M2 design spike ya aprobado; M3 incluye M3.0-BACKEND con Gate 1; M4 sync/resume). T2.12 (cross-spec find-or-create) sigue [ ] — JUSTIFICADO en la propia task: no implementable hasta integrar spec 09; es item de Gate 2 de M2. No hay [ ] sin justificar dentro de M1.

---

## CHECKPOINTS
- C1 [x] harness completo; check.mjs RC=1 SOLO por flake de rate-limit ajeno (frontend gates verdes).
- C2 [x] estado coherente; spec 03 sigue su pipeline por chunks; no se marca done en feature_list.json.
- C3 [x] capas respetadas (screens en app/app, logica pura en utils, hook orquesta service, service = I/O, builders en powersync/); cero console/TODO/FIXME reales; cero hardcode establishment_id/rodeo_id; anti-hardcode 0 viol.
- C4 [x] al menos 1 test por modulo con logica; fixtures reales (node:sqlite, seed real en e2e); 104 unit + e2e smoke.
- C6 [x] requirements.md EARS; cada R<n> de M1 con test. Exactitud (paso 6): design sec 2.1.1 ya NO miente (tacto_vaca->tacto); design sec 6.bis.1 v2/v3/v4 + fix de canSave reflejan el as-built real. requirements.md EARS NO contradice el as-built (R1.7/R1.8/R1.9/R1.12/R1.13 son location-agnosticos). Sin reconciliacion pendiente.
- C7 [x] (cliente) cero hardcode; audit cols NUNCA en payload (las fuerza el trigger 0050/0051); RLS has_role_in es la barrera (validada por la suite backend Fase 2, done).
- C8 [x] offline-first: CRUD-plano (runLocalWrite->CrudEntry->uploadData) para sessions/presets/contadores; soft-delete de preset por outbox->RPC 0057; sessions + maneuver_presets en AppSchema (schema.ts) Y en sync rules (est_sessions/est_maneuver_presets, scoped por establishment_id + deleted_at IS NULL); LWW explicito en contadores absolutos (D5).

---

## Checklist RAFAQ-especifico
- A (multi-tenancy / RLS): N/A — el chunk NO crea tablas ni policies (backend done). El cliente NUNCA re-filtra tenant ni manda audit cols. establishmentId SIEMPRE del EstablishmentContext (jornada.tsx:82, maniobra.tsx:34); cero UUID/establishment_id hardcodeado.
- B (offline-first / carga en campo):
  - [x] Funciona offline: CRUD-plano local + lecturas locales; IDs de cliente (crypto.randomUUID).
  - [x] Sync bucket scoped por establishment: est_sessions/est_maneuver_presets scoped por establishment_id IN org_scope AND deleted_at IS NULL; establishment_id del caller, nunca hardcode.
  - [x] Conflictos: LWW explicito (contadores absolutos, D5); append-only para eventos (un dispositivo = una sesion).
  - [x] Cero supabase.from() de escritura desde pantalla — TODO por service; unico RPC-bound = softDeletePreset (outbox/RPC 0057).
- C (BLE): N/A — M1 no toca BLE (la identificacion dual es M2.1). El haptico del drag usa Vibration de RN (web-safe).
- D (UI de campo): aplica parcial (wizard = setup, momento calmo; los botones gigantes son M2/M3). Pisos cumplidos:
  - [x] Targets >= 60dp/touchMin: filas seleccionadas 72, pool 56, input sheet 56, boton + 56x56, CTAs 56/64.
  - [x] Fuente legible (labels 5/6, IDV 9); la lectura a distancia es M2/M3.
  - [x] Una decision por pantalla (R1.2); el preconfig sale a un bottom sheet enfocado.
  - [x] Loading visible: InfoNote Cargando; submitting -> Arrancando en el CTA.
  - [x] Recorte de descendentes: heading >=6 y Text con numberOfLines con lineHeight matching — verificado en los 5 archivos UI (g/j/p de Vacunacion/Inseminacion/Raspado/Arrancar jornada/rodeo).
- E (Edge Functions): N/A — M1 no toca Edge Functions.

---

## Foco especifico del brief — verificacion
1. Offline-first: OK CRUD-plano para sessions/presets; soft-delete por outbox->RPC 0057; IDs de cliente; config jsonb pass-through (CHECK 16 KiB server-side). Cero supabase.from() de escritura desde pantalla. Tablas en AppSchema + sync rules scoped por tenant.
2. Gating cliente fiel al backend: OK resuelve por rodeo real (animal_profiles.rodeo_id del perfil activo, NO current_animal_rodeo; SEC-SPEC-03-02); loadPreset filtra OFF + lista omitidas. El cliente es UX (fail-safe: rodeo null -> no ofrece); la verdad la pone el trigger capa 2 (0054, done).
3. Cero hardcode (ADR-023 sec 4): OK 0 violaciones; tokens; lucide/reanimated via getTokenValue/shadows. Unico disable justificado: left/right:0 del absolute-fill (geometria estructural).
4. Recorte de descendentes: OK lineHeight matching en todo heading >=6 y Text con numberOfLines.
5. Tests: OK 104 unit + 26 wizard; e2e ejerce el flujo real (gating, pool->selected, drag handles, badge/cuerpo, autocompletar, clear-multi, scroll 8, resumen, createSession). Round-trips de orden y limpiar-preconfig-multi cubiertos.
6. Multi-tenant: OK establishmentId siempre del contexto; cero hardcode; tablas scopean por establishment_id (RLS + sync rules).

## Otras verificaciones (autorrevision del reviewer)
- String stale tacto_vaca (unico hallazgo de M1-SERVICIOS) -> reconciliado en design.md:232 (tacto). Grep: cero tacto_vaca como token de maniobra en specs + codigo.
- Fix de canSave (veto del leader) -> aplicado: cero canSave en app/app/maniobra/; Guardar siempre habilitado; clear-multi con cobertura e2e que cazaba el bug.
- Navegacion jornada -> /maniobra/carga (spike M2.0): la ruta existe y esta registrada (_layout.tsx:398); estado transicional documentado (M2.2 cablea la real). No rota.
- RodeoIcon=Boxes via registro central theme/icons en etapa 1 + resumen; Layers reservado a LoteIcon (no usado como rodeo) — consistente.
