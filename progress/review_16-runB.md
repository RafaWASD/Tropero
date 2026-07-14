# review 16 — Ambientes y release · Run B (scripts parametrizados + ledger + backup)

**Reviewer**: reviewer agent · **Fecha**: 2026-07-14
**Chunk**: SOLO Run B (tasks B1-B7). Run A cerrado (4f5f5aa); Runs C/D/E/F fuera de alcance.
**Baseline (Gate 2)**: 4f5f5aa7fa15f9093ca22746622f7de2c1a68535 (Run B es 100% working-tree, sin commitear).

## Veredicto: APPROVED

Run B cumple: default DEV byte-identico verificado con diff, guarda destino-aware (M5) sin bypass,
secrets por libpq env + sin logging de token/conn, ledger con REVOKE, migracion 0125 correcta y NO
deployada, check.mjs completo verde (14 suites de red + 28 unit nuevos), specs reconciliadas al as-built.
Ningun script se corrio contra una DB real.

---

## Trazabilidad R-n <-> test (Run B)

| R | Requerimiento | Cobertura concreta | Estado |
|---|---|---|---|
| R5.1 | sin --env => DEV | env-target.test.mjs B1(a) R5.1 sin --env => target dev; + posicional sin --env sigue dev; + diff byte-identico de apply-migration-mgmt.mjs / powersync-deploy.sh | OK |
| R5.2 | --env prod sin confirm => aborta | env-target.test.mjs B1(b) R5.2 --env prod SIN RAFAQ_CONFIRM_PROD=1 => ProdGuardError | OK |
| R5.3 | parametrizar apply-migration-mgmt.mjs, preservar dev | env-target.test.mjs B1(c) R5.3 --env prod + confirm => target/ref/token; wiring resolveTarget en apply-migration-mgmt.mjs + diff dev byte-identico | OK |
| R5.4 | replay ordenado + ledger | ledger-plan.test.mjs B3(a) R5.4 orden por prefijo numerico; + a igualdad por filename | OK |
| R5.5 | saltear ya-en-ledger | ledger-plan.test.mjs B3(b) R5.5 migracion ya en ledger se saltea; + todas ya aplicadas => toApply vacio | OK |
| R5.6 | bootstrap + --backfill registra sin ejecutar | ledger-plan.test.mjs B3(c) R5.6 --backfill execute=false; + BOOTSTRAP_SQL en apply-all-migrations.mjs (inspeccion) | OK |
| R5.7 | pg_dump pooler comprimido + timestamp | backup-cmd.test.mjs R5.7 rafaq-prod-ISO.sql.gz, stamp sin dos-puntos ni punto | OK |
| R5.8 | aborta sin conn string, sin archivo parcial | backup-cmd.test.mjs B4(a) R5.8 sin SUPABASE_DB_URL_PROD => throw; backup-db.mjs escribe a .partial + rmSync en cualquier error (inspeccion) | OK |
| R5.9 | powersync-deploy.sh --env dev/prod | verif operativa: bash -n OK + diff dev byte-identico (path prod gated a Run F/F5, sin unit posible en shell) | OK (operativa) |
| R5.10 | output gitignoreado + fuera del tree | backup-cmd.test.mjs B4(d) R5.10 default fuera del repo; + git check-ignore backups/x.sql.gz matchea (B7, verificado) | OK |
| R5.11 | conn string por env, no argv | backup-cmd.test.mjs B4(c) R5.11 conn string NO en pgDumpArgs, si en PGPASSWORD | OK |
| R5.12 | guarda destino-aware | env-target.test.mjs B1(e) R5.12 ref dev == ref PROD => exige confirm igual; + variante RAFAQ_KNOWN_PROD_REFS; + ref distinto sin falso positivo | OK |
| R5.13 | no filtrar token/Authorization | env-target.test.mjs R5.13 ProdGuardError sin token; backup-cmd.test.mjs B4(b) R5.13 safeSummary sin password/conn; mgmtQuery loguea solo body de respuesta (inspeccion) | OK |
| R6.1 | replay ordenado (no dump) | ledger-plan.test.mjs sortMigrations + apply-all-migrations.mjs readdir+plan (inspeccion); verif de red = Run F | OK (parcial, resto Run F) |
| R7.2 / R7.7 / R6.4 | 0125_health_status.sql: prefijo 4 dig (L1), REVOKE FROM PUBLIC + anon/authenticated, GRANT service_role, numero 0125 | artefacto Run C adelantado por B6 -- SQL verificado por inspeccion; su TEST (Edge suite anon-no-rpc) es C4 (Run C, no ejecutado aun) | OK artefacto / test en Run C |

**28/28 unit nuevos verdes** (env-target 15 + ledger-plan 6 + backup-cmd 7), registrados en run-tests.mjs
(corren siempre, sin keys). Re-corridos sueltos: tests 28 / pass 28 / fail 0.

---

## Foco de la revision (verificado)

- Default DEV byte-identico -- CONFIRMADO con git show 4f5f5aa vs working tree:
  - apply-migration-mgmt.mjs: sin --env, mismo endpoint projects/devRef/database/query, mismo body
    (Buffer JSON.stringify de query), mismos headers (Authorization/Content-Type). Unico cambio de
    comportamiento: reordeno validaciones (falta-archivo antes de falta-ref) -- ambos exit 2; happy-path
    identico. Log agrega [dev] (cosmetico). Con SUPABASE_PROJECT_REF_PROD ausente (realidad dev-only),
    knownProdRefs vacio => cero falso positivo destino-aware.
  - powersync-deploy.sh: sin --env, flujo identico (cp rafaq.yaml => validate => deploy); bloque prod
    entero saltado en dev; solo agrega (dev) a los echos. Arg desconocido ahora sale 2 (antes se
    ignoraba) -- mas estricto, no regresion del uso documentado.
- Guarda destino-aware (M5) -- resolveTarget: --env prod SIEMPRE exige RAFAQ_CONFIRM_PROD=1;
  default-dev con ref en refs conocidos de PROD tambien. Guarda ANTES de la validacion de completitud
  (fail-closed). ProdGuardError lleva solo ref, NUNCA el token (test asserta err.token undefined y que el
  mensaje no incluye el token). Sin bypass.
- Secrets:
  - conn string a pg_dump por libpq env vars (PGHOST/.../PGPASSWORD); pgDumpArgs sin -d/--dbname ni
    conn/password (test B4c). backup-db.mjs pasa env con process.env + plan.pgEnv.
  - ningun script loguea token/service_role/conn: apply-migration-mgmt / apply-all-migrations solo ref +
    body de respuesta; backup-db solo safeSummary (host/db/out).
  - output fuera del tree (~/.rafaq-backups, test B4d) + backups/ gitignoreado (B7 verificado) +
    powersync/cli.yaml.tmp matchea el patron .tmp (verificado).
- Backup CIFRA gpg AES256? (M3) -- El cifrado NO vive en Run B: es artefacto de Run D (task D1,
  .github/workflows/backup-prod.yml, aun inexistente -- verificado). Por diseno (design seccion 7),
  backup-db.mjs produce .sql.gz en texto plano en el runner (dir temporal) y el step gpg --symmetric
  AES256 de la Action lo cifra ANTES de upload-artifact. backup-db.mjs es coherente con ese contrato
  (output .sql.gz, no .gpg). NO es un gap de Run B; M3 aterriza en Run D. Senalado para que el cierre de
  Run D lo verifique con la Action committeada.
- Ledger ops.applied_migrations -- BOOTSTRAP_SQL con REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon,
  authenticated + REVOKE ALL ON ALL TABLES IN SCHEMA ops. Replay ordenado por prefijo numerico
  (sortMigrations), diff correcto vs ledger (planMigrations saltea las aplicadas). INSERT con ON CONFLICT
  DO NOTHING. Apply+insert en 2 llamadas (no atomico) documentado como tradeoff aceptado.
- 0125_health_status.sql -- REVOKE FROM PUBLIC OK + FROM anon, authenticated OK + GRANT service_role OK
  (M1). SECURITY DEFINER SET search_path vacio, ops.applied_migrations fully-qualified, EXCEPTION
  undefined_table/invalid_schema_name => unknown sin romper ok:true. substring de prefijo de 4 digitos
  (L1). Numero 0125 correcto: 0124 = 0124_audit_log.sql (spec 18 DONE); 0125 es el siguiente libre y es
  el maximo en supabase/migrations/. NO deployado: supabase/functions/health no existe (Run C), C3 sin
  marcar, sin evidencia de deploy en el working tree.
- check.mjs completo VERDE -- node scripts/check.mjs exit 0: typecheck cliente + 28 unit Run B + client
  units + 14 suites de red (RLS/Edge/Animal/Maneuvers/Puesta-servicio/Reports/Custom/Scrotal/
  user_private/Import/Sync-streams/Operaciones-rodeo/SIGSA/Treatments/Audit) => All tests passed +
  Entorno listo. Default DEV, sin cambio de comportamiento.
- NO se corrio ningun script contra una DB real -- evidencia estructural: sin artefactos de backup en el
  tree; 0125 solo como archivo (funcion health + Edge suite = Run C, sin construir); guards fail-closed
  salen antes de todo fetch/spawn; C3-F sin marcar. (No consulte la DB -- verify read-only, sin tocar
  ambiente real.)

---

## Tasks completas

- Run B: SI -- B1-B7 todas [x]. Cada una con artefacto real en el working tree y mapeo R-n => test.
- Runs C/D/E/F [ ] -- fuera del alcance de esta revision (chunk Run B); feature 16 sigue in_progress
  multi-run. No es blocker.

---

## CHECKPOINTS

- C1 El harness esta completo -- [x] check.mjs exit 0; archivos base presentes.
- C2 El estado es coherente -- [x] una sola feature in_progress (16); current.md describe la sesion.
- C3 El codigo respeta la arquitectura -- [x] todo en scripts/ (+ scripts/lib/), sin deps nuevas, sin
  logs de debug sueltos, sin establishment_id hardcodeado (lint anti-hardcode verde).
- C4 La verificacion es real -- [x] 28 unit nuevos (1 test por modulo de logica pura) + 14 suites; runner
  con mas de 0 tests, todos verdes. Fixtures reales (conn string de ejemplo, argv real). RLS cross-tenant
  N/A (no hay tablas de tenant nuevas).
- C5 La sesion se cerro bien -- parcial (chunk mid-feature): [x] sin artefactos temp sin trackear
  (.gitignore cubre backups/ y el patron .tmp); entrada en history.md + estado final = tarea de cierre
  del leader, no del chunk.
- C6 Spec Driven Development -- [x] specs/active/16 con los 3 archivos; EARS estricto; cada R-n de Run B
  con al menos 1 verificacion. (Tasks [x] totales aplica a done; 16 es in_progress.)
- C7 Multi-tenant -- N/A: no crea tablas de negocio con establishment_id. ops.applied_migrations es
  metadata de ops (REVOKE anon/authenticated, no expuesta por PostgREST).
- C8 Offline-first -- N/A: infra/ops, sin carga de datos de campo.
- C9 E2E + visual -- N/A: backend/infra, sin UI (documentado).

---

## Checklist RAFAQ-especifico

- A. Tablas con establishment_id / RLS -- N/A. La feature no crea tablas de negocio.
  ops.applied_migrations = metadata tool-owned con REVOKE FROM PUBLIC, anon, authenticated (no RLS porque
  no se expone por PostgREST ni tiene datos de tenant). public.health_status() es SECURITY DEFINER, no
  lee tablas de tenant, REVOKE FROM PUBLIC + GRANT solo service_role.
- B. Datos en campo (offline-first) -- N/A. Scripts de ops (server-side), no tocan la pantalla ni SQLite
  local.
- C. BLE -- N/A.
- D. UI de campo -- N/A (sin UI).
- E. Edge Functions -- N/A para Run B. La Edge Function health (validacion service_role, input-free, deno
  test) es Run C (C1/C2/C4), no construida aun. En Run B solo se autoro la migracion 0125 que la respalda
  (REVOKE/GRANT verificados arriba).

---

## Reconciliacion de specs (codigo => spec) -- sin contradiccion

- design.md seccion 4/5: notas as-built (3 modulos scripts/lib, hardening backup-db guarda-siempre,
  apply+insert no atomico, powersync-deploy.sh swap cli.prod.yaml+trap+token prod, numero 0125) coinciden
  con el codigo.
- requirements.md Historial de refinamiento (2026-07-14): 0124=>0125 (R7.2/R6.4), hardening backup-db
  (R5.2/R5.12), mecanismo prod powersync (R5.9) coinciden.
- tasks.md B1-B7 [x] con notas as-built; C3 actualizada a 0125 (pointer no roto). Sin EARS reescritos.
  Design no quedo mintiendo.

---

## Cambios requeridos

Ninguno. APPROVED.

### Nota para el leader (no bloqueante)
- M3 (cifrado gpg del artifact) aterriza en Run D (task D1, workflow aun inexistente). Verificar al
  cerrar Run D que .github/workflows/backup-prod.yml cifra con gpg --symmetric AES256 ANTES de
  upload-artifact y que el repo RafaWASD/Tropero es privado (R8.6/R8.7).
- R7.2/R7.7/R6.4: el artefacto 0125 esta correcto; su TEST (Edge suite anon-no-rpc, C4) se ejecuta en Run
  C tras aplicar 0125 a DEV (C3, deploy gated).
