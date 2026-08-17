# Requirements — 18-audit-log (EARS)

> Audit trail **forense server-side**, append-only, para reconstruir "qué pasó exactamente" cuando un
> tester levante un incidente en la beta. 100% backend, sin UI. Fuente de verdad: `context.md` (Gate 0
> aprobado por Raf, 2026-07-12). Cada "Decisión de Gate 0" (D1–D5) y cada edge case queda cubierto por
> ≥1 `R<n>` (trazabilidad al pie).
>
> Notación EARS estricta (`docs/specs.md`): Ubicuo / Evento (*Cuando*) / Estado (*Mientras*) / Opcional
> (*Donde*) / No deseado (*Si … entonces*). IDs estables — no reordenar tras aprobar.
>
> **Refinado tras Gate 1 (NEEDS_CLARIFICATION, 2026-07-13):** H1 resuelto con **Opción A (propagación
> de actor real desde las Edge Functions)** → grupo R2 ampliado (R2.6–R2.9); M1/M2/M3 foldeados
> (R1.10, R1.11, R3.7, R5.2/R5.4/R5.7). Ver "Historial de refinamiento" al pie.
>
> **Distinto del audit de DOMINIO** existente (`import_log`, `export_log`, `animal_category_history`,
> `animal_events`/timeline) — eso es producto y NO se toca (R8.1). Esto es forense raw para Raf +
> Sentry/PostHog (feature 17).

---

## Grupo 1 — Schema `audit` vendoreado, append-only (D1)

**R1.1** — El sistema deberá crear un schema `audit` con una tabla append-only `audit.record_version`
que registre una fila por cada versión de fila de las tablas trackeadas.

**R1.2** — `audit.record_version` deberá tener, como mínimo, las columnas `id` (PK), `record_id`,
`old_record_id`, `op`, `ts`, `auth_uid`, `table_oid`, `table_schema`, `table_name`, `record` (jsonb) y
`old_record` (jsonb).

**R1.3** — Cuando se inserta una fila en una tabla trackeada, el sistema deberá registrar una versión
con `op = 'INSERT'`, `record` = la fila nueva y `old_record` = NULL.

**R1.4** — Cuando se actualiza una fila en una tabla trackeada, el sistema deberá registrar una versión
con `op = 'UPDATE'`, `record` = la fila nueva y `old_record` = la fila anterior.

**R1.5** — Cuando se borra una fila de una tabla trackeada, el sistema deberá registrar una versión con
`op = 'DELETE'`, `old_record` = la fila borrada y `record` = NULL.

**R1.6** — El sistema deberá derivar un `record_id` **estable** a partir de la clave primaria de la
fila, idéntico entre todas las versiones (INSERT → UPDATE → DELETE) de una misma fila, para poder seguir
la historia de esa fila.

**R1.7** — Si una tabla trackeada no tuviera clave primaria, entonces el sistema deberá registrar la
versión igual (sin abortar el DML), aunque `record_id` no sea estable.

**R1.8** — El sistema no deberá exponer ningún camino de `UPDATE` ni de `DELETE` de
`audit.record_version` a ningún rol cliente (append-only; el único borrado permitido es la purga de
retención server-side de R6.x).

**R1.9** — El sistema deberá proveer las funciones `audit.enable_tracking(regclass, best_effort boolean)`
y `audit.disable_tracking(regclass)` para prender/apagar el tracking de una tabla sin cambiar el schema
(habilita el crecimiento incremental por el orden de valor de D3, y elige el modo de falla de R1.11).

**R1.10** — El sistema no deberá poner sobre `audit.record_version` ninguna FK ni CHECK que pueda fallar
en tiempo de escritura (en particular, `auth_uid` no deberá ser FK a `public.users`): la fila de audit
debe poder insertarse siempre, con tipos holgados, para no volverse un punto de falla del DML trackeado.

**R1.11** — Mientras se trackea una tabla del **camino caliente de campo** (`animals` y, en incrementos
futuros, las tablas de evento), el sistema deberá insertar la fila de audit en modo **best-effort**: si
la inserción de audit falla, el write del operario deberá proceder igual (regla dura miTropero: el flujo de
manga nunca se traba; se acepta perder esa fila de audit antes que bloquear la carga). Para `user_roles`
(admin, vía Edge Function, bajo volumen) el modo deberá ser **estricto** (los errores propagan → sin
huecos en el log de membresías).

---

## Grupo 2 — Actor real y semántica temporal (D2 + H1/Opción A)

**R2.1** — Cuando el trigger de auditoría registra una versión, el sistema deberá guardar en `auth_uid`
el **actor real** de la mutación: `auth.uid()` cuando el write llega con el JWT del usuario (RPC /
PowerSync), o el actor propagado por la Edge Function cuando el write lo hace el `service_role`
(R2.6–R2.7).

**R2.2** — Si no hay actor resoluble (operación sin JWT y sin actor propagado: un job de sistema, la
purga, una carga por service_role sin propagación), entonces el sistema deberá registrar la versión con
`auth_uid` NULL sin abortar el DML (NULL honesto — nunca atribuye a otro).

**R2.3** — El sistema deberá capturar el actor correcto aun cuando la función de trigger corra como
`SECURITY DEFINER` (el privilegio del definer no altera las GUCs de sesión que el trigger lee:
`request.jwt.claims`, `request.headers`).

**R2.4** — El sistema deberá guardar en `ts` la hora del disparo del trigger, que es la **hora del
SYNC** (cuándo la mutación llegó al servidor), no la hora en que el operario ejecutó la acción en campo.

**R2.5** — El header de la migración deberá documentar la distinción de R2.4: `ts` = hora de sync; el
"cuándo pasó" real vive en las columnas fechadas por el device que las tablas de evento ya llevan
(`event_date`, `weight_date`, `started_at`, …), y no debe confundirse con `ts`.

**R2.6** — Cuando una Edge Function con `service_role` muta una tabla trackeada, el sistema deberá
propagar el actor por el header de request `X-Rafaq-Actor`; el trigger deberá leerlo con
`current_setting('request.headers')` y usarlo como `auth_uid` **únicamente si** el rol de la sesión es
`service_role`.

**R2.7** — El actor propagado (R2.6) deberá ser el `user.id` del **JWT validado del llamante** de la
Edge Function (el que devuelve `requireUser`), y no deberá tomarse del body/payload del request (sería
spoofeable).

**R2.8** — Si un cliente `authenticated` setea el header `X-Rafaq-Actor` en su propio write a una tabla
trackeada, entonces el sistema deberá ignorarlo y usar `auth.uid()` (el header solo se confía cuando el
rol es `service_role` → un usuario no puede falsear el autor de su propio write).

**R2.9** — Las Edge Functions que mutan `user_roles` con `service_role` — `accept_invitation`,
`change_member_role`, `remove_member`, `delete_account` — deberán propagar el actor (R2.6/R2.7).
(`invite_user` no muta `user_roles` — solo `invitations`, no trackeada en este incremento — por lo que
no requiere cambio.)

---

## Grupo 3 — Fail-closed: acceso solo server-side (D1)

**R3.1** — El sistema deberá revocar todo privilegio (`USAGE` de schema y privilegios de tabla) sobre el
schema `audit` y sobre `audit.record_version` de los roles `public`, `anon` y `authenticated`.

**R3.2** — Si `anon` o `authenticated` intentan leer `audit.record_version`, entonces el sistema deberá
rechazar la lectura (fail-closed: no devuelve filas ni el esquema).

**R3.3** — El sistema no deberá exponer el schema `audit` por PostgREST (no se agrega a los schemas
expuestos → un cliente que pida `Accept-Profile: audit` recibe un error, no datos).

**R3.4** — El sistema deberá permitir la lectura de `audit.record_version` únicamente por accesos
server-side (`service_role` / conexión `postgres` directa: SQL editor, MCP, Management API).

**R3.5** — El sistema deberá revocar `EXECUTE` de `audit.enable_tracking`, `audit.disable_tracking`, la
función de trigger de auditoría y la función de retención (R6.1) de los roles `public`, `anon` y
`authenticated`.

**R3.6** — Si alguna de las funciones de R3.5 quedara `EXECUTE`-able por un rol cliente, entonces la
migración deberá abortar (smoke-check fail-closed en la propia migración, patrón 0066/0055).

**R3.7** — Si el muro de LECTURA quedara abierto (`anon` o `authenticated` con `USAGE` sobre el schema
`audit`, o con `SELECT` sobre `audit.record_version`), entonces la migración deberá abortar (smoke-check
in-migration del muro de lectura, paridad con R3.6 — no solo verificado post-deploy por la suite).

---

## Grupo 4 — Frontera con el WAL de PowerSync (D5)

**R4.1** — Antes de aplicar la migración, el sistema deberá verificar en dev que la publication de
PowerSync es `FOR TABLE` explícita (`puballtables = false`), verificación **no destructiva** (solo
lectura de catálogo).

**R4.2** — El sistema no deberá agregar `audit.record_version` a ninguna publication de replicación
lógica (no entra al WAL que PowerSync replica → sin leak ni costo de sync).

**R4.3** — Si `audit.record_version` apareciera en `pg_publication_tables`, entonces la verificación
deberá fallar (no debe haber ninguna publication que la incluya).

> **Reconciliación as-built (2026-07-13, implementer — regla dura de reconciliación).** La verificación
> read-only de R4.1 en dev arrojó que la publication `powersync` es **`FOR ALL TABLES`**
> (`puballtables = true`), NO `FOR TABLE` explícita como asumía esta spec. **El frontier de sincronización
> real de este proyecto no es la publication sino las SYNC STREAMS** (`sync-streams/rafaq.yaml`): el WAL
> replica toda la base al servicio de PowerSync y cada stream scopea explícitamente qué llega a cada device
> (ADR-025/026; header de `rafaq.yaml`; así se mantiene fuera a `animals`/`users`/`import_log` hoy). En
> consecuencia:
> - **R4.1** (verificar `puballtables = false`) queda **no aplicable como STOP**: la realidad del proyecto
>   es `FOR ALL TABLES`. La verificación equivalente que SÍ importa es que `audit` no aparezca en las sync
>   streams (no hay stream catch-all).
> - **R4.2** se cumple por intención: la migración no agrega `audit` a `rafaq.yaml` (nunca sincroniza a un
>   device). No se puede excluir de un `FOR ALL TABLES`; el residual es costo de WAL menor (INSERT-only,
>   acotado por retención 90d).
> - **R4.3** literal (audit ausente de `pg_publication_tables`) **no se puede satisfacer** bajo `FOR ALL
>   TABLES` (la incluye). El invariante equivalente verificado por la suite (TA.11) es **"audit no
>   referenciada en `sync-streams/rafaq.yaml`, sin catch-all"**. El objetivo de seguridad de **D5 (el audit
>   forense no fuga a devices) SE CUMPLE** por el frontier de streams.
>
> Esta reconciliación **requiere ratificación de Raf en Puerta 2** (cambia el mecanismo del frontier de D5:
> de "publication" a "sync-streams"). Recomendación del implementer: ACEPTAR el frontier de streams (bajo
> riesgo, mismo mecanismo que el resto del proyecto), NO convertir la publication a `FOR TABLE` (enumerar
> ~31 tablas es un cambio de infra riesgoso que excede spec 18). Ver `progress/impl_18-audit-log.md`
> § "T1 / R4.1 discrepancia".

---

## Grupo 5 — Alcance de tablas por valor, incremental (D3)

**R5.1** — El sistema deberá habilitar el tracking sobre `public.user_roles` (tabla #1 por valor: quién
tiene acceso a qué — lo más sensible), en modo **estricto** (R1.11), con atribución de actor real vía
Opción A (R2.6–R2.9) — `user_roles` **se mantiene** en el incremento 1 (no se difiere).

**R5.2** — El sistema deberá habilitar el tracking sobre `public.animals` (tabla #2 por valor) en modo
**best-effort** (R1.11), **únicamente si** la medición de volumen de R5.4 pasa el gate; si no pasa,
`animals` deberá diferirse (como las tablas de R5.6).

**R5.3** — Si una tabla es escrita en bloque por el import masivo (`import_rodeo_bulk`: `animals`,
`animal_profiles`), entonces el sistema no deberá habilitar su tracking sin medir antes en dev el
volumen que genera en `audit.record_version` contra el presupuesto de 500 MB del free tier.

**R5.4** — Antes de habilitar el tracking sobre `public.animals`, el sistema deberá medir en dev el
volumen de filas de auditoría que produce un import representativo y confirmar (gate **duro**) que la
proyección cabe en el presupuesto de 500 MB **con margen**, considerando que `audit.record_version` es
**cross-tenant compartida** y que la retención de 90 días (R6.x) es lo que la acota.

**R5.5** — El sistema no deberá habilitar el tracking sobre tablas de PII de contacto/identidad fuerte
(`user_private`: email/phone, ADR-025): el audit log no debe volverse un sumidero de esa PII.

**R5.6** — El sistema no deberá habilitar en este incremento el tracking sobre las tablas de menor
prioridad del orden de D3 (`treatments`, `weight_events`, `sanitary_events`, `reproductive_events`,
`rodeos`, `establishments`): quedan para incrementos posteriores vía `audit.enable_tracking()`, cada uno
tras su propia medición (R5.3/R5.4) y con el modo de falla que corresponda (R1.11).

**R5.7** — El sistema deberá documentar que `user_roles.member_name` (nombre de persona, denormalizado
por 0080) aterriza en `audit.record`/`old_record`: no es fuga (audit cerrado a todo cliente, R3.x) pero
es PII con retención de 90 días; la retención de R6.x deberá ser la mitigación del derecho de supresión
(Ley 25.326) — un nombre no persiste en el audit más de 90 días tras un `delete_account`.

---

## Grupo 6 — Retención (D4)

**R6.1** — El sistema deberá programar un job `pg_cron` **mensual** que ejecute una función de purga de
`audit.record_version`.

**R6.2** — Cuando corre el job de retención, el sistema deberá borrar únicamente las filas con
`ts < now() - interval '90 days'` (no borrar filas más nuevas).

**R6.3** — El sistema deberá programar el job de retención de forma idempotente (un `unschedule`
defensivo antes del `schedule`, patrón 0066), de modo que re-aplicar la migración no duplique el job.

---

## Grupo 7 — Verificación (edge cases del context)

**R7.1** — El sistema deberá incluir una suite backend nueva `supabase/tests/audit/run.cjs`, enganchada
en `scripts/run-tests.mjs`, que verifique el `auth_uid` correcto en INSERT/UPDATE/DELETE de una tabla
trackeada (`animals`) con un usuario de test.

**R7.2** — La suite deberá verificar que `anon` y `authenticated` no pueden leer `audit.record_version`
(fail-closed, R3.2/R3.3).

**R7.3** — Aplicada a dev primero, la migración no deberá romper las 14 suites backend existentes de
`check.mjs` (sin regresión); con la suite nueva, `check.mjs` deberá quedar verde con 15 suites.

**R7.4** — La suite deberá verificar la atribución de actor de Opción A por el **camino de producción**
(no un falso verde, cf. Gate 1): (a) write de `service_role` con header `X-Rafaq-Actor` → `auth_uid` =
el actor; (b) write de `service_role` **sin** header → `auth_uid` NULL; (c) write de `authenticated`
con header `X-Rafaq-Actor` forjado a una tabla trackeada → `auth_uid` = su `auth.uid()` real, **no** el
header (spoof-safety de R2.8).

---

## Grupo 8 — Guardas de alcance (no romper lo existente)

**R8.1** — El sistema no deberá modificar, duplicar ni reemplazar el audit de DOMINIO existente
(`animal_category_history`, `import_log`, `export_log`, `animal_events`/timeline, `upload-rejections`):
son producto y quedan tal cual.

**R8.2** — El sistema no deberá exponer el audit log forense en la app (backend-only; fuera de scope,
`context.md` §"Fuera de scope").

**R8.3** — El sistema no deberá cambiar el contrato externo (input/output HTTP) ni la semántica
funcional de las Edge Functions tocadas (`accept_invitation`, `change_member_role`, `remove_member`,
`delete_account`): el único cambio permitido es propagar el actor (R2.9) — mismos requests, mismas
respuestas, mismas validaciones de autorización.

---

## Trazabilidad — cada decisión/edge de `context.md` cubierto por ≥1 R

| Fuente en `context.md` (+ Gate 1) | Cubre |
|---|---|
| D1 — supa_audit vendoreado (schema/tabla append-only, record_id estable) | R1.1–R1.9 |
| D1 — REVOKE anon/authenticated, no PostgREST, lectura solo service_role | R3.1–R3.7 |
| D2 — actor real (`auth.uid()` / propagación) | R2.1, R2.3, R2.6–R2.9 |
| D2 — `ts` = hora de sync + documentar en header | R2.4, R2.5 |
| D3 — orden por valor (user_roles → animals → …) incremental | R5.1, R5.2, R5.6, R1.9 |
| D3 — no prender sobre tablas del import masivo sin medir volumen | R5.3, R5.4 |
| D4 — retención pg_cron mensual >90d | R6.1–R6.3 |
| D5 — publication `FOR TABLE` explícita / no entra al WAL | R4.1–R4.3 |
| Edge — actor NULL sin romper el DML | R2.2 |
| Edge — suite nueva: uid correcto + fail-closed de lectura | R7.1, R7.2, R7.4 |
| Edge — aplicar a dev + 14 suites verdes | R7.3 |
| Relación con audit de dominio (no se toca) | R8.1 |
| Fuera de scope — no exponer en la app | R8.2 |
| **Gate 1 H1** — actor real para `user_roles` (Opción A) | R2.6–R2.9, R5.1, R7.4, R8.3 |
| **Gate 1 M1** — smoke-check del muro de LECTURA | R3.7 |
| **Gate 1 M2** — modo de falla del hot path + robustez + gate de volumen | R1.10, R1.11, R5.2, R5.4 |
| **Gate 1 M3** — PII (member_name) + retención como supresión | R5.5, R5.7 |

### Mapa acceptance (`feature_list.json` #18) → R

1. Registra INSERT/UPDATE/DELETE con actor real, append-only → R1.3–R1.5, R1.8, R2.1, R2.6–R2.9
2. anon/authenticated NO leen; schema no expuesto; solo service_role → R3.1–R3.4, R3.7
3. Retención pg_cron purga >90d → R6.1, R6.2
4. Dev primero: 14 suites verdes; suite nueva verifica uid + fail-closed → R7.1–R7.4
5. Publication PowerSync `FOR TABLE` explícita → R4.1–R4.3

---

## Historial de refinamiento

**2026-07-13 — Reconciliación post-Gate 1 (NEEDS_CLARIFICATION → decisión de Raf).** Ver
`progress/security_spec_18-audit-log.md`.

- **H1 (HIGH) — actor de `user_roles` sería NULL** (se muta por Edge Functions con `service_role`).
  Raf eligió **Opción A (propagación de actor real)**. Reconciliado:
  - R2.1 reformulada (actor real = `auth.uid()` **o** actor propagado por EF); **agregadas R2.6–R2.9**
    (propagación por header `X-Rafaq-Actor` guardada por rol `service_role`; actor del JWT del llamante,
    no del body; spoof-safety; enumeración de las 4 EFs). **R7.4 agregada** (test del camino de prod).
    **R8.3 agregada** (no cambiar el contrato de las EFs).
  - **Corrección al alcance de Gate 1:** de las 5 EFs señaladas, `invite_user` **no** muta `user_roles`
    (solo `invitations`, no trackeada) → quedan **4** EFs a tocar (R2.9). `delete_account` ya muta vía
    la RPC `delete_account_tx` (SECURITY DEFINER) → la propagación entra natural allí.
  - **Divergencia de mecanismo (flag para Gate 1 re-run / Puerta 1):** el `set_config('rafaq.actor_id',
    …, true)` literal del reporte **no** funciona con supabase-js, porque cada llamada (`.from().update()`
    / `.rpc()`) es una **transacción distinta** bajo el pooler → una GUC `set_config(local=true)` puesta
    en una llamada no está en la transacción del DML de la siguiente. La Opción A se realiza con el
    header `X-Rafaq-Actor` (único canal per-request y **misma-transacción** que tiene supabase-js), que
    PostgREST expone como `request.headers`. Es spoof-safe por el guard de rol `service_role` (R2.8). La
    alternativa "RPC único que set_config+DML" queda documentada en `design.md` (§ Alternativas).
- **M1 (MEDIUM) — smoke-check del muro de lectura:** **R3.7 agregada** (abort in-migration si
  `USAGE`/`SELECT` de audit quedó abierto a clientes).
- **M2 (MEDIUM) — modo de falla del hot path:** **R1.10** (sin FK/CHECK, tipos holgados) + **R1.11**
  (best-effort en `animals`/eventos, estricto en `user_roles`) + **R5.2/R5.4** (T10 como gate **duro**
  del volumen antes de prender `animals`; cap 500 MB cross-tenant acotado por la retención 90d).
- **M3 (MEDIUM) — PII:** **R5.5** acotada a PII fuerte (`user_private`); **R5.7 agregada**
  (`user_roles.member_name` entra al audit; retención 90d = mitigación de supresión).
- **L1 (LOW) — TRUNCATE:** documentado en `design.md` (trigger row-level no captura TRUNCATE; no
  explotable — clientes no pueden TRUNCATE `user_roles`/`animals`). Sin cambio de requirement.
- **L2 (LOW) — sin `notify pgrst`:** confirmado no-issue (audit no se expone por PostgREST); nota en
  `design.md`. Sin cambio de requirement.

---

## Historial de aprobación

- **2026-07-12** — Gate 0 (Puerta 0, contexto) APROBADO por Raf; corte 17→18 ratificado. `context.md`
  → `context_ready` (`feature_list.json` #18).
- **2026-07-13** — `spec_author` redacta `requirements.md` / `design.md` / `tasks.md` → `spec_ready`.
- **2026-07-13** — Gate 1 (`security_analyzer` modo `spec`): **NEEDS_CLARIFICATION** (H1 + M1/M2/M3).
  Raf decide **Opción A**. `spec_author` reconcilia los 3 docs (esta versión); estado sigue `spec_ready`.
- **Pendiente** — Gate 1 **re-run** sobre la spec reconciliada + el diff de las 4 Edge Functions (schema
  nuevo, actor propagado, REVOKE/fail-closed, retención, frontera WAL) → `progress/security_spec_18-audit-log.md`.
- **Pendiente** — Puerta 1 (humano aprueba la spec) antes de `in_progress`.
