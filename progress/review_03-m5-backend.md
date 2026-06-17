# Review (reviewer) -- Spec 03 / chunk M5-BACKEND (datos/maniobras CUSTOM)

Veredicto: CHANGES_REQUESTED. Un requirement de seguridad (R13.21, frontera WAL) queda SIN test
concreto, y el mapa R-n -> test del implementer (progress/impl_03-m5-backend.md l.74) declara un
caso (e) que NO existe en la suite -- inconsistencia doc<->codigo. Todo lo demas (fidelidad a
design 11, DM5-1/2/3, las 5 migraciones, los otros R13.x, schema/yaml, NO-aplicacion, enganche
comentado, reconciliacion de design/tasks) esta correcto. El fix es chico y acotado.

Fecha: 2026-06-17
Baseline (de impl): 7cfbea77705390f12205722b3849a304bff455f1 (coincide con git log HEAD).
Alcance: CORRECTITUD + fidelidad design 11 + cobertura de tests + reconciliacion. El barrido de
SEGURIDAD lo hizo el Gate 2 en paralelo (security_code_03-m5-backend.md = PASS); no lo dupliqué.

## Veredicto: CHANGES_REQUESTED

## Cambios requeridos (concretos)

### CR-1 (BLOQUEANTE) -- R13.21 (frontera WAL) sin test concreto + mapa R-n->test miente

- Donde: supabase/tests/custom/run.cjs (subtests reales a,b,c,d,f,g,h,i,j,k,l,m,n -- FALTA (e))
  vs impl_03-m5-backend.md:74 (mapea R13.21 -> caso (e) de modelo de la sync rule) + tasks.md
  M5-B.6 l.408-409 (R13.21 en Satisface + describe el caso (e)).
- Que pasa: el caso (e) que el impl declara (R13.21 <-> catalog query establishment_id IS NULL;
  custom IN org_scope) NO esta escrito en run.cjs. La numeracion salta de (d) a (f). Test fantasma.
- Por que el test (a) NO cubre R13.21: el (a) (run.cjs:395) valida la RLS de PostgREST (userC sin
  rol -> 0 filas) = R13.22, no R13.21. R13.21 es la frontera del SYNC STREAM (WAL), capa distinta:
  rafaq.yaml l.4-5 y sync_streams/run.cjs l.6-9 lo dicen -- el WAL ignora RLS/views/RPC; el
  contenido de cada stream ES la frontera. Se prueba simulando el predicado del stream contra
  Postgres con el scope de cada actor (patron sync_streams/run.cjs). No existe para las 3 streams
  custom de M5.
- Regla dura violada: nunca aprobas si algun R-n queda sin test. R13.21 es seguridad.
- Fix minimo (sin re-aplicar nada):
  1. Agregar el subtest (e) a custom/run.cjs (preferido): simular el predicado de catalog_field_
     definitions (IS NULL -> custom de estA NO entra; globales si) y de las 3 streams custom
     (IN org_scope -> userC sin rol NO ve las custom de estA; userA si). Reusa admin service_role
     aplicando el predicado a mano (como syncSetIds). Tambien corre post-apply.
  2. O extender sync_streams/run.cjs con las 3 streams custom (su lugar natural, ya enganchada).
  - En ambos: corregir el mapa R-n->test del impl para que (e) apunte al test REAL. Si R13.21 se
    verifica SOLO en el dashboard, decirlo explicito en el mapa/tasks en vez de mapear un fantasma.

Nota: el Gate 2 audito la ESTRUCTURA del rafaq.yaml y dio PASS. CR-1 no contradice eso: es hueco
de cobertura de test + mapa mentiroso, no defecto de seguridad del YAML.

## Trazabilidad R-n <-> test (backend M5; R13.5-R13.9 = M5-CLIENTE, fuera de este chunk)

| R | Requirement (resumen) | Test en custom/run.cjs | OK |
|---|---|---|---|
| R13.1 | dato custom = fila field_definitions | (b) creacion con establishment_id | OK |
| R13.2 | creacion owner-only | (b) non-owner -> 42501 | OK |
| R13.3 | establishment_id forzado al owner | (b) + (f) anti-spoof | OK |
| R13.4 | no alta global de cliente | (b) NULL -> 42501 | OK |
| R13.10 | habilitacion por rodeo | (c) enable + reject disabled | OK |
| R13.11 | custom_measurements append-only | (c)/(d)/(a) insertMeasurement | OK |
| R13.12 | custom_attributes upsert | (a)/(f) upsertAttribute | OK |
| R13.13 | captura = cualquier rol operativo | (a)/(c) captura por owner | PARCIAL (Obs-1) |
| R13.14 | gating fail-closed enabled | (c) disabled/soft-del -> 23514 | OK |
| R13.15 | gating independiente de la UI | (c) INSERT directo sin enable -> 23514 | OK |
| R13.16 | validacion de value por ui_component | (d) numeric/enum/boolean/date | OK |
| R13.17 | caps creacion + options + enum_multi | (k)/(l) | OK |
| R13.19 | soft-delete preserva measurements | (i) soft-delete = UPDATE OK | PARCIAL (Obs-2) |
| R13.20 | sync scope establishment | rafaq.yaml + schema.ts | sin test de stream (CR-1) |
| R13.21 | frontera WAL (stream scope + catalog IS NULL) | (e) -- NO EXISTE | FALLA (CR-1) |
| R13.22 | RLS canonico tenant | (a) userC -> 0 filas | OK |
| R13.23 | audit forzado recorded_by/updated_by | (f) | OK |
| R13.24 | SECURITY DEFINER no expuestas como RPC | (n) + 0097 smoke check | OK |
| R13.25 | fail-closed ui_component + CHECK dominio | (g)/(h) | OK |
| R13.26 | inmutabilidad est/data_type/data_key/ui | (i) incl. owner-A+B -> 42501 | OK |
| R13.27 | caps/sets INPUT-1 | (j)/(k) | OK |

R13.18 (no benchmarking cross-tenant) = analytics spec 07, N/A. R13.5-R13.9 = M5-CLIENTE.

## Tasks completas: si (correctamente en [~], NO [x])

- M5-B.1..B.6 en [~] (ESCRITA, pendiente apply+tests remoto) -- correcto: no aplicadas, suite no
  corrio contra remoto. No deben pasar a [x] hasta apply + run verde.
- M5-C.1..C.3 en [ ] -- chunk M5-CLIENTE, fuera de este chunk. Justificado.
- No hay ninguna [ ] de M5-BACKEND sin justificar.

## CHECKPOINTS

- C3 (arquitectura): [x] -- capas correctas; migraciones/suite/schema en su lugar; cero hardcode.
- C4 (verificacion real): [ ] -- suite real (fixtures/JWTs/no-bypass) PERO R13.21 sin test (CR-1);
  la suite no pudo correr (pendiente apply, gateado por leader -- esperado, no es el motivo).
- C6 (SDD): [ ] -- Cada R-n con >=1 test NO se cumple para R13.21 (CR-1).
- C7 (multi-tenant): [x] -- establishment_id FK + RLS + has_role_in/is_owner_of + cross-tenant (a).
- C8 (offline-first): [x] -- CRUD-plano feat 15; 3 streams scope est; 2 Tables + columnas; LWW.

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id (RLS) -- APLICA
- [x] enable row level security en custom_measurements (0094 l.56) y custom_attributes (0095 l.46).
- [x] Policies select/insert/update por tabla (ADR-004/US-11). field_definitions reabierta (SELECT
  global-a-todos / custom-con-rol; INSERT/UPDATE owner-only no-global).
- [x] Helpers has_role_in()/is_owner_of() usados (no SQL inline).
- [x] Test cross-tenant: (a) userC sin rol -> 0 filas; (f) anti-spoof; (i) owner-A+B no muda A->B.
  PERO la frontera del SYNC STREAM (no la RLS) queda sin test -> CR-1.
- [x] deleted_at IS NULL en SELECT de custom_measurements (0094 l.58) + stream est_custom_measurements.
  custom_attributes no tiene deleted_at (current-value, by design).

### B. Carga/edicion de datos en campo (offline-first) -- APLICA
- [x] CRUD-plano feature 15 (offline) -- 2 Tables en AppSchema, no requests sincronos.
- [x] Sync bucket correcto: 3 streams scope establishment_id IN org_scope (rafaq.yaml l.229-249).
- [x] Conflict resolution: LWW heredado del CRUD-plano.
- [x] No requests sincronos desde pantalla (chunk backend; cliente = M5-CLIENTE).

### C. BLE -- N/A.   ### D. UI de campo -- N/A (backend).   ### E. Edge Functions -- N/A.

## Fidelidad a design 11 + decisiones confirmadas -- OK

- DM5-1 (data_key unico por est): OK -- 0093 l.37-41 (UNIQUE parcial doble global/per-est).
- DM5-2 (EDIT propiedad = cualquier rol): OK -- 0095 l.51-52 has_role_in (confirmado por Raf, l.10-11).
- DM5-3 (correccion = append-only spec 02): OK -- 0094 append-only + soft-delete por UPDATE.
- Numeracion 0090->0093 (unica desviacion): OK -- 0090/0091=sanitary, 0092 libre (spec-08), M5
  0093-0097. Sin colision. design 11 l.990 nota AS-BUILT reconciliada.
- Inmutabilidad/fail-closed/caps (M5-SEC-01..05): OK -- el SQL transcribe 11 literal (guard l.104-144,
  else raise 23514 l.75-81, caps INPUT-1 l.65-72, options l.126-143, cap notes 0094 l.33). = RE-GATE PASS.
- 0097=check_grants (vs 11 que lo llamaba 0094): patron 0055; smoke check por firma. Justificado.

## Migraciones bien formadas -- OK

- Headers en espanol + ref a design 11.x + NO aplicar al remoto. notify pgrst en las 5. begin/commit
  explicito (5 transaccionables, sin ALTER TYPE).
- Orden 0093->0097 correcto (field_definitions -> tablas FK -> gating -> grants/smoke).
- Orden triggers BEFORE INSERT (alfabetico): force_audit < gating -> audit primero (correcto).
- grant all to service_role en 0094/0095/0097: no en design 11.2/11.3 pero ES patron del repo
  (0055 l.9-10) -- housekeeping estandar, no desviacion.
- schema.ts: 28 sync (incl. 2 custom) + columnas en field_definitions. schema.test.ts guard 28/36 +
  custom_attributes en grupo PK-compuesta sin id. Los client unit tests corrieron VERDE.

## NO se aplico nada -- confirmado

- git status: las 5 migraciones son untracked (no aplicadas). schema.ts/rafaq.yaml/run-tests.mjs/
  design.md/tasks.md modificados (coherente). Sin deploy del YAML.
- run-tests.mjs l.68: enganche de la suite custom COMENTADO. No intenta correr contra DB sin tablas.
  La suite custom tampoco esta en los client unit tests (l.53). Correcto.

## Verificacion sin DB

- node scripts/check.mjs: typecheck OK + client unit tests OK (incl. schema.test.ts 28/36 -- paso;
  si fallara abortaria ANTES de la Animal suite) + RLS/Edge OK. Rojo SOLO por el flake conocido
  animals_tag_unique (Animal suite spec 02, run.cjs:1924): UPDATE tag_electronic = nueve x64 ->
  23505 duplicate key (otra terminal sembro el mismo tag). Flake documentado (memoria Check rojo =
  rate-limit). NO es regresion de M5 (su diff no toca animals). NO es el motivo del rechazo.

## Reconciliacion de specs -- OK (salvo el mapa de impl, parte de CR-1)

- design 11 l.990: nota AS-BUILT con numeracion real + ubicacion del sync delta. Al dia.
- tasks.md M5-B.1..B.6 en [~] con numeros reales + Satisface extendido a R13.25/26/27.
- requirements.md R13.1-R13.27 sin contradiccion con el codigo as-built. Salvo el mapa R-n->test del
  impl (l.74) que afirma un caso (e) inexistente -> parte de CR-1.

## Observaciones NO bloqueantes (no exigen fix para aprobar tras CR-1)

- Obs-1 (R13.13): los tests capturan siempre como clientA (owner). R13.13 = cualquier rol operativo
  activo (owner/field_operator/veterinarian). Falta un subtest con un rol no-owner capturando OK. La
  RLS has_role_in lo permite (verificado) + cobertura indirecta US-11. Sugerencia: sumar un actor
  field_operator en (a)/(c) cuando se toque CR-1.
- Obs-2 (R13.19): (i) prueba que el soft-delete (UPDATE deleted_at) es OK, pero no que las
  custom_measurements ya cargadas SOBREVIVEN (la FK sin ON DELETE = RESTRICT lo garantiza, sin
  assert). No bloqueante (soft-delete, no hard-delete).
- Obs-3 (errcode de date invalida): 0096 l.73 castea p_value a date y compara is null -- un cast de
  una string no-fecha tira 22007 (invalid input syntax) ANTES de evaluar is null, no el 23514
  prometido. El neto (rechazar) se cumple y el test (d) lo tolera por el alias /invalid/i. design y
  migracion son CONSISTENTES entre si (mismo SQL) -> no es desviacion codigo<->spec. Anotado por
  exactitud (R13.16 promete rechazo, no un errcode especifico).
- Obs-4 (higiene, fuera de M5): .claude.zip untracked en la raiz -- artefacto temporal ajeno; conviene
  limpiarlo/gitignorearlo antes de cerrar la sesion.

## Resumen para el leader

CHANGES_REQUESTED por un solo item (CR-1): R13.21 (frontera WAL) sin test concreto + el mapa
R-n->test del impl (l.74) declara un caso (e) que no existe. Fix chico: escribir el subtest (e)
(espejo de sync_streams/run.cjs, tambien post-apply) o extender la suite sync_streams, y corregir el
mapa. Todo lo demas correcto: fidelidad design 11, DM5-1/2/3, numeracion sin colision, 5 migraciones
bien formadas y NO aplicadas, enganche comentado, schema/yaml consistentes, reconciliacion al dia, y
los otros 20 R13.x de backend con test. El check rojo es el flake animals_tag_unique (spec 02, no
regresion). NO marco nada done.
