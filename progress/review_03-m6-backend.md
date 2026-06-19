# Review (Gate 2 estatico) — Spec 03 / chunk M6-BACKEND (Circunferencia escrotal, US-14)

Veredicto: CHANGES_REQUESTED — por un UNICO bloqueo de entorno, NO de codigo M6: node scripts/check.mjs
termina en rojo (exit 1) por un flake de terminales paralelas en una suite que M6 NO toca
(supabase/tests/animal/run.cjs, spec 02). El delta M6-BACKEND en si esta sano y completo:
trazabilidad R->test completa, fidelidad al diseno 12.3/12.4/12.5 + Gate 1, todo lo verificable
sin-apply en verde. Cambio requerido = 0 lineas de M6: re-correr check.mjs en aislamiento (sin la
otra terminal escribiendo en la DB remota compartida) para confirmar verde antes del apply.

Fecha: 2026-06-17 (sesion 27). Modo: revision ESTATICA (migraciones drafteadas, NO aplicadas; el
apply + deploy del YAML lo gatea el leader con Raf). Baseline impl: a03e593.

Alcance: 0098/0099/0100 sql, supabase/tests/scrotal/run.cjs, schema.ts (+schema.test.ts),
upload-rejections.ts (+test), sync-streams/rafaq.yaml, scripts/run-tests.mjs, impl_03-m6-backend.md.

## EL UNICO BLOQUEO — check.mjs rojo por flake exogeno (NO M6)

node scripts/check.mjs -> exit 1. run-tests.mjs usa execSync y aborta en la PRIMERA suite que falla
= Animal suite (spec 02) (run-tests.mjs:62). Error real:
  supabase/tests/animal/run.cjs:1881 (R2 INPUT-1 CHECK)
  actual code 23505 duplicate key value violates unique constraint animals_tag_unique

Por que NO es regresion de M6:
- El archivo que falla (supabase/tests/animal/run.cjs) NO esta modificado por este chunk (git status
  del chunk: solo scripts/run-tests.mjs aparece, por el hook M6 COMENTADO).
- La firma 23505 duplicate key animals_tag_unique es colision de fixtures contra la DB remota
  compartida (la otra terminal spec-08 escribe animales con tags que chocan). Flake documentado de
  terminales paralelas / shared-DB (memoria reference_check_red_rate_limit).
- M6-BACKEND NO agrega ninguna suite activa al runner: el hook scrotal queda COMENTADO
  (run-tests.mjs:74) hasta el apply. El runner murio en la suite 4, antes de llegar a algo de M6.

Accion de cierre (NO toca codigo M6): el leader re-corre node scripts/check.mjs aislado de la otra
terminal -> debe quedar verde. Recien ahi se levanta este CHANGES_REQUESTED. Es por la regla dura
nunca apruebo con check.mjs en rojo; el CONTENIDO de M6 esta aprobado.

Verde verificado del delta M6 (lo que NO depende del apply remoto):
- pnpm typecheck (cliente) -> exit 0.
- node --test schema.test.ts upload-rejections.test.ts -> 32/32 verdes (incl. guard 29 sincronizadas
  / 37 total + asserts del surfacing CE M6-SEC-01).
- node --check supabase/tests/scrotal/run.cjs -> sintaxis OK.

## Trazabilidad R<n> <-> test (todas con test REAL, no placeholder)

- R14.9 (audit forzado): run.cjs (b) spoofea recorded_by=userB/establishment_id=estB, asserta fila
  queda userA/estA (l.428-450).
- R14.9 (tabla typed): (c)(f)(i) INSERTs OK + schema.test.ts Table scrotal_measurements (l.52).
- R14.10 (CRUD-plano offline, session_id NULL): (i) sub-caso 4 session_id NULL -> OK (l.582-585).
- R14.11 (gating capa 2 fail-closed): (c) 5 sub-casos enabled OK / disabled 23514 / soft-deleted
  23514 / inexistente reject (l.343-386).
- R14.12 (gating indep. de UI / no-bypass): (c) disabled por PostgREST + service_role (l.354-370).
- R14.15 (RLS tenant): (a) userB sin rol -> 0 filas SELECT / reject INSERT (l.452-467).
- R14.16 (frontera WAL): (g) con rol ve sus CE, sin rol NO (predicado ev_scrotal_measurements)
  (l.525-547) + schema.test.ts Table local.
- R14.17 (correccion append-only): (h) owner/recorded_by corrige/soft-deletea, tercero NO (l.469-523).
- R14.18 (seed cria): (e) rodeo de cria nuevo -> CE enabled por default (l.317-328) + (d) binding.
- R14.5/R14.9 (caps de rango): (f) cm <20/>50 reject; age_months>600 reject; notes>500 reject;
  limites 20.0/50.0 OK (l.388-425).
- R5.11 (session_id tenant-check, M6-SEC-02): (i) cross-tenant / sesion cerrada / otro rodeo -> 23514;
  NULL -> OK; inexistente -> 23503; DISPARA EN INSERT (l.549-592).
- R10.8 (surfacing del rechazo, M6-SEC-01): upload-rejections.test.ts label es-AR Circunferencia
  escrotal (l.55-56, 91-97, 103-110) — VERDES.

Cada R14.x de backend tiene >=1 test concreto. Sin huecos.

Gate 1 — los 2 MEDIUM honrados:
- M6-SEC-02: caso (i) presente y REAL. Cubre (1) cross-tenant sessB->23514, (2) sesion closed->23514,
  (3) otro rodeo rodeoA2->23514, (4) NULL->OK, + inexistente->23503, + el OK con sessA que PRUEBA que
  el trigger dispara en INSERT (si no disparara, el cross-tenant pasaria sin validar — el bypass de
  0052 que 0056 cazo).
- M6-SEC-01: MANEUVER_TABLE_LABELS scrotal_measurements = Circunferencia escrotal
  (upload-rejections.ts:39) + isManeuverRejection la incluye + tests verdes.

## Fidelidad al diseno 12.3/12.4/12.5 + Gate 1 (sin re-decidir seguridad)

- Reuso de primitivos gateados (verificado contra el as-built):
  - tg_force_establishment_id_from_profile (0077:53-71): fuerza establishment_id desde el perfil
    real, ignora el payload, before insert OR update. 0098 lo reusa (l.77-79). OK.
  - tg_event_session_tenant_check (0052:27-77): lee SOLO new.session_id/new.animal_profile_id
    (ambas en scrotal_measurements); cross-tenant + sesion active + rodeo coincidente; NULL pasa.
    0098 lo reusa con forma before insert or update SIN OF session_id (l.91-93) -> dispara en INSERT
    (la forma combinada-con-OF era el bug que 0056 arreglo; esta NO recae en el). (i) lo garantiza. OK.
  - assert_data_keys_enabled (0054:33-65): fail-closed por construccion (rodeo no resoluble->23514
    sin early-return; data_key no-enabled->23514). 0100 lo invoca single-key (l.22). OK.
- SET NOT NULL sin ventana de NULL (0098:83): tabla nueva, sin backfill, despues del trigger force. OK.
- SECDEF + search_path + EXECUTE revocado en las 2 funciones nuevas: tg_scrotal_force_recorded_by
  (0098:63-69) y tg_scrotal_gating (0100:19-25). OK.
- RLS canonico (0098:95-104): SELECT/INSERT has_role_in; UPDATE is_owner_of OR recorded_by; SELECT
  filtra deleted_at IS NULL. OK.
- CHECKs: circumference_cm 20-50 (l.43), age_months 0-600 nullable (l.44), notes <=500 (l.51). OK.
- Seed cria sin romper M5 (0099): el guard 0093:87-88 deja pasar el seed por migracion (auth.uid NULL
  -> return new); cliente authenticated sigue bloqueado; satisface todos los CHECK de 0093 para filas
  globales; UNIQUE parcial field_definitions_data_key_global intacto (data_key nuevo, 0 hits previos). OK.
- category=reproductivo valido (lo usan las filas reproductivas de 0018). event_source existe (0025:4). OK.

## Offline-first / CRUD-plano / frontera WAL
- schema.ts: Table scrotal_measurements en AppSchema (l.405-417, 630), tipada (circumference_cm
  real, age_months integer). schema.test.ts guard 29 sincronizadas / 37 total (l.22, 187-189). OK.
- rafaq.yaml: ev_scrotal_measurements (l.195-200) paridad EXACTA con ev_* (org_scope denorm,
  JOIN-free, filtra deleted_at IS NULL). NO deployado (header l.194). OK.
- Surfacing R10.8: label CE en MANEUVER_TABLE_LABELS + isManeuverRejection. OK.
- Conflict resolution: append-only + correccion owner/recorded_by (last-write-wins del CRUD-plano). OK.

## Higiene de terminales paralelas
- Migraciones 0098/0099/0100 sin colision (ultimo as-built 0097; las 3 net-new en git status, ningun
  otro sql tocado). Nada aplicado/deployado (drafts; YAML no deployado; hook scrotal run-tests.mjs:74
  COMENTADO). NO se toco spec-08 ni feature_list.json. La suite scrotal roja-hasta-apply es esperada
  (42P01 hasta el apply). OK.

## Tasks completas: SI
M6-B.1..B.5 todas en [x] (tasks.md l.464-492). M6-C.0..C.2 en [ ] con justificacion (son M6-CLIENTE,
fuera del alcance de M6-BACKEND, van a Gate 2 por sub-chunk). Sin tasks de backend sin marcar.

## CHECKPOINTS
- C3 arquitectura: [x] — solo capas previstas; sin establishment_id hardcodeado; sin TODOs/logs sueltos.
- C4 verificacion real: [x] cobertura (>=1 test por R, fixtures reales, cross-tenant (a)(g)(i)).
  [ ] runner >0 verdes — bloqueado por flake exogeno; la suite scrotal corre POST-APPLY.
- C6 SDD: [x] — 3 archivos de spec; EARS estricto US-14; tasks de backend [x]; cada R con test.
- C7 multi-tenant: [x] — establishment_id FK + RLS + has_role_in/is_owner_of (sin SQL inline) + cross-tenant.
- C8 offline-first: [x] — CRUD-plano, bucket scoped por org_scope, conflict res. append-only.
- C1 check.mjs exit 0: [ ] — unico box rojo, flake exogeno (no M6).

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS) APLICA:
  - [x] enable row level security (0098:95).
  - [x] Policies SELECT/INSERT/UPDATE per ADR-004 / patron M5 (0098:96-102).
  - [x] has_role_in()/is_owner_of() usados (no SQL inline).
  - [x] Test cross-tenant ((a) RLS, (g) WAL, (i) session cross-tenant).
  - [x] deleted_at IS NULL en la policy SELECT (0098:97).
- B (offline-first carga de datos) APLICA:
  - [x] Funciona offline (CRUD-plano local; sin requests sincronos a Supabase desde pantalla).
  - [x] Sync bucket correcto (ev_scrotal_measurements, scope org_scope del establishment activo).
  - [x] Conflict resolution: append-only + correccion owner/recorded_by.
- C (BLE) N/A (la CE entra por rueda/UI, no por baston).
- D (UI de campo) N/A (M6-BACKEND no toca UI; la rueda es M6-C.0/C.1, Gate 2).
- E (Edge Functions) N/A (no crea Edge Functions; funciones nuevas = triggers SECDEF con EXECUTE revocado).

## Notas menores (NO bloquean)
- Spec 12.3 nota tenant-check sigue como DM6-divergencia confirmar reuso vs clon y cita (2.3, 0056).
  El as-built FIRMO reuso (Gate 1 Foco 4 + 0098). La nota NO contradice el codigo (presenta reuso como
  default y clon solo como fallback) -> no es spec vieja que mienta, pero conviene cerrar el confirmar
  a reuso confirmado y precisar que la FUNCION vive en 0052 (0056 solo splittea los triggers). Cosmetico.

## Reconciliacion de specs (codigo -> spec): OK
El design 12.3/12.4/12.5 describe lo que el SQL realmente hace. requirements US-14 no contradice el
as-built. El gotcha de soft-delete-por-cliente del caso (h) NO es divergencia del schema M6 (vive igual
en weight_events/custom_measurements) — documentado en el test. Sin specs viejas tras fix.

## Resumen
El delta M6-BACKEND es correcto y completo. Veredicto CHANGES_REQUESTED solo por la regla dura
(check.mjs en rojo). El UNICO cambio requerido NO toca codigo M6: re-correr node scripts/check.mjs
aislado de la otra terminal para descartar el flake de animals_tag_unique (23505) en la suite de spec
02 — debe quedar verde. Confirmado eso, este delta queda aprobado para aplicar 0098/0099/0100 +
deployar el YAML + descomentar el hook scrotal.
