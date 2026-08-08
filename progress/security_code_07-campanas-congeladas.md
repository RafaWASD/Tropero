# Gate 2 (ADR-019) — modo `code` — delta `campanas-congeladas` (feature 07-reportes-basicos)

> **VEREDICTO VIGENTE: PASS** (re-auditoría del fix-loop, al final del archivo). La primera pasada dio **FAIL**
> por H-C1 y se conserva íntegra debajo: es el registro de qué se encontró, y de **un error mío que se propagó a dos
> migraciones y al backlog** (ver M-C4).

- **Fecha**: 2026-08-07 · **Auditor**: `security_analyzer` (modo `code`)
- **Baseline**: `19dd826e95db4992059df925ffd3cd5e1eac4a83` (de `progress/impl_campanas-congeladas.md:3`). El delta está
  **entero sin commitear** — `git diff --name-only 19dd826..HEAD` da vacío; el alcance sale de `git status --porcelain`.
- **Contrato medido**: cabecera `supabase/migrations/0106_reports_rpcs.sql` §5.1–§5.10 · `design-campanas-congeladas.md` §5
  · `progress/security_spec_07-campanas-congeladas.md` (Gate 1 + re-auditoría)
- **Skill**: `sentry-skills:security-review` (metodología: trazar data-flow + verificar explotabilidad antes de reportar).
- **Alcance**: solo lectura. No se editó código, tests, migraciones ni specs. **No se aplicó ninguna migración**: todo el
  SQL contra el remoto fue `SELECT` por el transporte de `scripts/apply-migration-mgmt.mjs`, con un guard que aborta si
  la query no es de solo lectura.

## Veredicto de la primera pasada

**FAIL** — 1 finding HIGH (RAFAQ-SPECIFIC), 3 MEDIUM.

Lo bloqueante es **estrecho y barato**: 6 líneas de `revoke` en `0127`/`0128` y una aserción en TR.14e, **antes** del
apply. No hay que rediseñar nada, y los tres puntos calientes que el leader señaló (orden guard→cota→cortocircuito,
smoke-check de dos loops, `is_owner_or_vet_of`) están **bien resueltos y verificados**.

Se marca FAIL y no PASS-con-MEDIUM por un motivo concreto: el delta **afirma** un invariante en un `comment on column`
—"no existe grant de escritura a authenticated"— lo usa como la justificación del desvío declarado de ADR-026 (DP-19), y
**nombra a TR.14e como su guard**. Ese invariante es falso al momento del apply, y TR.14e es estructuralmente incapaz de
verlo. Es la clase de defecto que este repo ya se comió cuatro veces (guard escrito sobre el observable equivocado), en
el único momento en que arreglarlo es gratis.

---

## Corrección de método (antes de los findings)

En la re-auditoría de Gate 1 escribí que el descubrimiento de TR.21 desde `pg_proc` era *"genuino"* y que *"verifiqué el
predicado contra el catálogo y da exactamente 9"*. **Era falso y lo doy por retirado.** Ejecutado ahora contra el remoto:

```
SPEC_ORIGINAL_identity_arguments_count  -> 0
TR21_discovery_count_oidvec             -> 8
TR21_discovery_oidvectortypes           -> rodeo_calving_by_stage, rodeo_calving_kpi, rodeo_ccl_distribution,
                                           rodeo_pregnancy_kpi, rodeo_repro_denominator, rodeo_service_campaign,
                                           rodeo_serviced_females, rodeo_weaning_kpi
```

`pg_get_function_identity_arguments` devuelve `"p_rodeo_id uuid, p_year integer"` (**con** los nombres), así que el
predicado de la spec daba **0** y ninguno de los dos oráculos de H-1 corría. Lo cazó el implementer, no yo. El repo ya
lo sabía: `supabase/migrations/0097_check_grants.sql:47` compara contra
`'p_animal_profile_id uuid, p_field_definition_id uuid'` — con nombres. La evidencia estaba a un grep de distancia.

**Regla aplicada en esta pasada**: toda afirmación de "verifiqué" lleva la query y su salida. Lo que no ejecuté va
rotulado **"leído, no ejecutado"**. Hay exactamente un ítem en esa categoría (A-4, más abajo) y está declarado.
*(Actualización: A-4 se cerró en la re-auditoría — el implementer lo ejecutó y yo validé el método y el estado.)*

---

## Findings HIGH

### H-C1 · Las 3 tablas nuevas nacen con `TRUNCATE` concedido a `anon` y `authenticated`; la RLS no puede restringirlo; las migraciones nunca revocan; y TR.14e —el guard declarado del invariante de DP-19— no puede verlo

> **ESTADO: CERRADO** en el fix-loop (ver re-auditoría). Se conserva el análisis original.

**Dónde**:
- `supabase/migrations/0127_rodeo_membership_history.sql:96-99` (grants de `rodeo_membership_history`)
- `supabase/migrations/0128_campaign_snapshots.sql:284-287` (grants de las 2 tablas de snapshot)
- `supabase/migrations/0128_campaign_snapshots.sql:196-203` (el `comment on column` que afirma el invariante)
- `supabase/tests/reports/run.cjs:1700-1757` (TR.14e, el guard declarado)

**La afirmación del delta** (`0128:199-201`, literal):

> …y eso es legítimo SOLO mientras valga el invariante: **no existe grant de escritura a authenticated** ni policy
> distinta de SELECT. Guard del invariante: TR.14e.

**Por qué es falsa.** Las migraciones corren como `postgres`, y este proyecto tiene un `pg_default_acl` para tablas del
schema `public` creadas por `postgres`. Ejecutado:

```
current_user_del_transporte -> postgres
DEFAULT_ACL (obj=r ns=public, creador postgres):
  postgres=arwdDxtm/postgres | anon=Dxtm/postgres | authenticated=Dxtm/postgres
  | service_role=Dxtm/postgres | powersync_role=r/postgres
```

`D` = TRUNCATE, `x` = REFERENCES, `t` = TRIGGER, `m` = MAINTAIN (PG 17.6, verificado). O sea: **toda tabla que estas
migraciones creen nace con TRUNCATE para `anon` y para `authenticated`**, y ninguna de las cuatro migraciones emite un
solo `revoke` sobre tabla — `0127:98` y `0128:284-287` son `grant select` puros, aditivos.

Que ya pasa hoy, en las tablas equivalentes (ejecutado):

```
animal_profiles  => postgres=arwdDxtm | anon=Dxtm | authenticated=arwDxtm | service_role=arwdDxtm | powersync_role=r
animal_category_history (el molde que cita 0127:7)
                 => postgres=arwdDxtm | anon=Dxtm | authenticated=rDxtm  | service_role=arwdDxtm | powersync_role=r
has_table_privilege('anon','public.animal_profiles','TRUNCATE')          -> true
has_table_privilege('authenticated','public.animal_profiles','TRUNCATE') -> true
has_table_privilege('anon','public.animal_category_history','TRUNCATE')  -> true
```

**Por qué la RLS no lo tapa.** `TRUNCATE` no es un comando sobre el que se pueda escribir una policy. Ejecutado contra
el catálogo de este proyecto:

```
cmds_posibles_en_pg_policies (schema public) -> DELETE, INSERT, SELECT, UPDATE
```

No hay —ni puede haber— una policy de TRUNCATE. Un `TRUNCATE public.rodeo_campaign_snapshots` borra las filas de
**todos los tenants** de una, con la RLS en verde y sin dejar rastro en la tabla (`0128:186-194` la presenta como
append-only y auditable a tres años; ADR-032 / catálogo I2 tamper-evidence). Es exactamente lo contrario de lo que la
tabla promete.

**Por qué el guard no lo ve.** TR.14e (`run.cjs:1725-1757`) prueba tres cosas: `insert`/`update`/`delete` **a través de
PostgREST**, el intento de spoof con el `establishment_id` del otro tenant, y `pg_policies.cmd = 'SELECT'`. Ninguna de
las tres puede observar un grant de TRUNCATE:

- PostgREST **no expone TRUNCATE** → probar por comportamiento nunca lo va a tocar.
- `pg_policies` no tiene fila de TRUNCATE porque no existe la categoría.

O sea: el oráculo resuelve el **comportamiento a través del cliente** donde el invariante está escrito sobre el **valor
del ACL en el catálogo**. Es la asimetría exacta que el mismo delta evita bien un nivel al lado: **TR.14b**
(`run.cjs:1924-1939`) sí resuelve los ACL de *función* con `has_function_privilege` sobre `pg_proc`. La higiene de
grants de función de este delta es excelente (dos loops, derivados del catálogo, fail-closed); la de grants de tabla es
un `grant select` sin `revoke` y un test que mira para otro lado.

**Explotabilidad, sin maquillaje.** **No es alcanzable hoy** desde la superficie expuesta: PostgREST no tiene verbo
TRUNCATE, y el delta no introduce SQL dinámico bajo `SECURITY INVOKER` (verificado: los únicos `format()` viven en
bloques `DO` de las migraciones, que corren como `postgres` en tiempo de apply). Es un defecto de **postura + guard**,
no un exploit vivo. Lo reporto HIGH igual, y digo por qué para que el leader pueda discrepar con la información
completa:

1. El blast radius si alguna vez se vuelve alcanzable es destrucción **cross-tenant** del artefacto que ADR-032 declara
   inmutable — no una fuga de lectura.
2. El delta **no lo hereda en silencio**: lo contradice por escrito y designa un guard que no puede verlo. Un invariante
   falso con un oráculo ciego es peor que no tener el invariante escrito.
3. El costo del arreglo es cero **ahora** y un migration nuevo **después** del apply de T73.

> ⛔ **PÁRRAFO CORREGIDO EN LA RE-AUDITORÍA — ver M-C4.** No lo borro porque el error se propagó a dos migraciones y al
> `docs/backlog.md`.
>
> **Lo que decía**: *"Precedente del propio repo, **que es el fix**: `0068_user_private_pii.sql:208` hace `revoke all on
> public.user_private from anon, public;` — y `user_private` es, ejecutado, la única tabla del schema sin entrada `anon`
> en su ACL."*
>
> **La segunda mitad es cierta; llamarlo "el fix" no.** `0068` revoca de `anon` y de `public`, **no de
> `authenticated`** — que es el rol que efectivamente tiene sesión. Medido en la re-auditoría:
> `has_table_privilege('authenticated','public.user_private','TRUNCATE')` → **`true`**. La única tabla del repo donde
> alguien endureció esto a propósito —y es la de **PII** de ADR-025— sigue siendo TRUNCATE-able por cualquier usuario
> logueado de cualquier tenant. `0068` es un precedente **parcial**: copiarlo produce un arreglo que no cierra el
> agujero. El `revoke … from public, anon, authenticated` que quedó en `0127`/`0128` es **estrictamente más fuerte** que
> el precedente que yo cité, y es ese el template correcto.

**Fix pedido (bloqueante, antes de T73)** — en `0127` justo antes de `:98`, y en `0128` justo antes de `:284`:

```sql
revoke all on public.rodeo_membership_history from public, anon, authenticated;
grant select on public.rodeo_membership_history to authenticated;
grant all    on public.rodeo_membership_history to service_role;
```
(ídem `rodeo_campaign_snapshots` y `rodeo_campaign_snapshot_animals`.)

Y en TR.14e, la mitad que falta — resolver el **valor**, no el comportamiento:

```sql
select c.relname,
       has_table_privilege('anon',          c.oid, 'TRUNCATE') as anon_trunc,
       has_table_privilege('authenticated', c.oid, 'TRUNCATE') as auth_trunc,
       has_table_privilege('authenticated', c.oid, 'INSERT')   as auth_ins,
       has_table_privilege('authenticated', c.oid, 'UPDATE')   as auth_upd,
       has_table_privilege('authenticated', c.oid, 'DELETE')   as auth_del,
       has_table_privilege('anon',          c.oid, 'SELECT')   as anon_sel
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname in
  ('rodeo_membership_history','rodeo_campaign_snapshots','rodeo_campaign_snapshot_animals');
-- las 6 columnas tienen que dar false en las 3 tablas.
```

Ese assert **sabe fallar**: hoy, sin el `revoke`, daría `anon_trunc = true` y `auth_trunc = true`.

> **Alcance, explícito**: el `pg_default_acl` es un default de plataforma que afecta a las ~70 tablas del schema. **Eso
> no es de este delta y no es lo que bloquea el gate** — va a `docs/backlog.md` como barrido de clase (y el molde
> `animal_category_history` está en la misma). Lo bloqueante son las **3 tablas nuevas**, cuya migración todavía no se
> aplicó, y el guard que el delta declaró para ellas.
> *(Re-auditoría: el conteo real es **35 tablas**, no ~70 — medido abajo.)*

---

## Findings MEDIUM

### M-C1 · La publicación `powersync` es `FOR ALL TABLES`: las 3 tablas entran solas al stream de replicación, y el oráculo de DL8 (TR.19) solo mira el YAML

> **ESTADO: CERRADO** en el fix-loop.

**Dónde**: `supabase/migrations/0127_rodeo_membership_history.sql:57-58` (el `comment on table`) · `run.cjs` TR.19 ·
`sync-streams/rafaq.yaml`.

Ejecutado:

```
publicaciones -> supabase_realtime allTables=false ins/upd/del/trunc=true/true/true/true
              /// powersync         allTables=true  ins/upd/del/trunc=true/true/true/true
DEFAULT_ACL (obj=r ns=public) incluye -> powersync_role=r/postgres
```

`RCC.1.10` / `RCC.4.9` / DL8 exigen que las 3 tablas queden **fuera de PowerSync**, y el `comment on table` de `0127`
lo afirma así: *"NO sincroniza a los devices (DL8): no está en sync-streams/rafaq.yaml y no debe agregarse"*.

Sobre **devices** la afirmación es correcta y el guard es el adecuado — verificado: las 3 tablas están ausentes del YAML
(`grep -niE "rodeo_membership_history|rodeo_campaign_snapshot" sync-streams/rafaq.yaml` → 0 hits, sobre 34 streams
declarados), y sin sync rule que las nombre nada baja al SQLite local (catálogo C1/C3).

Lo que nadie escribió es que la publicación de Postgres es `FOR ALL TABLES` y que el default ACL le da `SELECT` a
`powersync_role`: las filas —incluido el **detalle por animal de todos los tenants**— **sí** cruzan al slot de
replicación del servicio administrado de PowerSync, sin que nadie las haya nombrado. No es fuga cross-tenant (ningún
stream las selecciona), es superficie hacia un tercero que la spec da por inexistente.

**Fix**: (a) declarar en el design que el invariante de DL8 se sostiene en la capa de **sync rules** y no en la
publicación, con el `powersync_role=r` anotado; o (b) excluirlas de la publicación. (a) alcanza; lo que no puede quedar
es la afirmación tal como está.

### M-C2 · El smoke-check whitelist-ea por NOMBRE, no por firma: una sobrecarga futura de un nombre público se auto-concede a `authenticated` y queda fuera del barrido de internas

> **ESTADO: CERRADO** en el fix-loop.

**Dónde**: `0128:333-340` (loop 0) y `0128:344-356` (loop 1); idénticos en `0129:634-655` y `0130:441-462`.

El loop (0) hace `grant execute … to authenticated` para **toda** función cuyo `proname = any (v_public)`, y el loop (1)
la excluye del barrido con `not (p.proname = any (v_public))`. Los dos operan sobre el nombre, no sobre la firma. Una
interna futura que se llame igual que una pública (una sobrecarga `rodeo_serviced_females(uuid,int,uuid)`, por ejemplo)
**se concede sola** a `authenticated` y **no la ve** el barrido.

Explotabilidad hoy: nula. Ejecutado — `OVERLOADS_en_lista_blanca -> (ninguno)`: ninguno de los 14 nombres de la lista
blanca tiene más de una firma en el catálogo.

**Fix (barato)**: que el loop (1) excluya por `oid` en vez de por `proname` — recolectar los oid en el loop (0) y
compararlos ahí. La lista blanca sigue siendo una sola enumeración; el barrido pasa a hablar de funciones y no de
nombres.

### M-C3 · Tres migraciones declaran una premisa sobre esta DB que es falsa: las funciones nuevas **no** nacen `EXECUTE`-ables por `PUBLIC`

> **ESTADO: CERRADO** en el fix-loop.

**Dónde**: `0128:302-304`, `0128:360-361`, `0130:437-440`.

Es el default **de Postgres**, sí, pero no el de **este proyecto**. Hay un `pg_default_acl` para funciones del schema
`public` creadas por `postgres` (`postgres obj=f ns=public => postgres=X/postgres`), que **reemplaza** el built-in.
Ejecutado sobre las funciones más recientes que ninguna migración concedió ni revocó:

```
oid 28708 tg_sanitary_events_treatment_check  acl=postgres=X/postgres        pub_x=false
oid 28700 tg_treatments_immutable_columns     acl=postgres=X/postgres        pub_x=false
oid 27895 tg_derive_breed_id_from_breed       acl=postgres=X/postgres        pub_x=false
--- corte histórico ---
oid 27773 tg_force_generated_by_auth_uid      acl=(NULL = built-in: PUBLIC)  pub_x=true
oid 27741 tg_force_declared_by_auth_uid       acl=(NULL = built-in: PUBLIC)  pub_x=true
```

No cambia el resultado (los `revoke` explícitos son no-ops correctos y el loop (2) verifica el estado final igual), pero
sí cambia qué sostiene la seguridad. Que quede escrito, para que nadie saque el loop (2) razonando desde la premisa
equivocada — ni lo mantenga creyendo que es la única red.

**Respuesta directa a la pregunta 2 del leader**: sí, `close_campaign` y `reopen_campaign` **quedan efectivamente
revocadas de `anon`/`public`**, por dos mecanismos independientes — el `pg_default_acl` de funciones (verificado arriba)
y el `revoke … from public, anon` del loop (0) de `0130:446`— y si ninguno de los dos hubiera valido, el loop (2)
(`0130:464-475`) aborta la migración. La cobertura es correcta y redundante.

---

## Lo que auditué y está BIEN (con la evidencia de haberlo ejecutado)

| # | Verificado | Cómo |
|---|---|---|
| **A-1** | **Orden `P0002 → guard → cota → cortocircuito` en las 13 funciones** (las 7 de campaña + las 3 internas + las 3 RPC nuevas). Es el HIGH-1 de Gate 1 y está cerrado en el código. | **Ejecutado**: chequeo posicional sobre `0129`/`0130` (offset del `if not public.has_role_in/is_owner_or_vet_of` vs. `errcode='22023'` vs. `from public.rodeo_campaign_snapshots`) → **13/13 OK**, ninguna fuera de orden. Las 3 internas sin cortocircuito, como declara `0129:35-36`. |
| **A-2** | **El fix de la lista blanca (R1) es real y NO abre el agujero inverso.** | **Ejecutado**, los tres predicados del smoke-check contra el catálogo actual: loop (1) con la lista de **14** → `(vacio)` (la migración no aborta); loop (1) con la lista **vieja de 11** → `rodeo_sessions_list(uuid) @authenticated \| rodeo_weight_by_category(uuid,uuid) @authenticated` (**confirma que abortaba**); loop (2) → `(vacio)`. Las dos agregadas son públicas legítimas y preexistentes (`auth_x=true, anon_x=false, public_x=false`), así que sumarlas a `v_public` (a) no cambia sus grants, (b) las saca correctamente del barrido de internas y (c) las **suma** al check de anon/public, que antes no las cubría. Cobertura neta mayor, no menor. |
| **A-3** | `has_function_privilege(…, 'public', …)` **funciona** (no explota con el pseudo-rol). Patrón de `0105:237-252`. | **Ejecutado**: `has_function_privilege('public','public.has_role_in(uuid)'::regprocedure,'EXECUTE') -> false`. |
| **A-4** | Los `revoke`/`grant` derivados del catálogo con `format('… public.%I(%s)', proname, identity_arguments)` — `identity_arguments` trae los **nombres** de parámetro, y la gramática de `GRANT … ON FUNCTION f([argmode] [argname] argtype)` los acepta. | ⚠ **Leído, no ejecutado** en la primera pasada. **Cerrado en la re-auditoría** — ver el punto 2 de abajo. |
| **A-5** | `is_owner_or_vet_of` (`0128:30-43`) conserva `ur.active = true`, el `join public.establishments e` con `e.deleted_at is null`, y es `security definer stable set search_path = public`. Único cambio vs. `is_owner_of`: `ur.role in ('owner','veterinarian')`. | Lectura del `.sql` + oráculos: TR.14f(a) es conductual y sabe fallar; TR.14g asserta las 4 cláusulas sobre `pg_get_functiondef`. **Ejecutado** el supuesto que hace vacuo a TR.14f(b): el trigger `establishment_soft_delete_deactivates_roles` **existe** en `public.establishments` → el estado "owner activo de campo borrado" es inalcanzable. |
| **A-6** | La FK compuesta `(snapshot_id, establishment_id) → rodeo_campaign_snapshots(id, establishment_id)` con el destino `unique (id, establishment_id)` y **las dos columnas `not null`** — con MATCH SIMPLE un NULL desactivaría el chequeo en silencio. Las FK se enforcen para todos los roles, incluido `service_role`. | Lectura del `.sql` + TR.14h lo prueba por comportamiento (`23503`) **con `service_role`**, y verifica el `not null` por `information_schema`. TR.14h-bis cubre el eslabón de arriba (cabecera↔rodeo) por invariante sobre **toda** fila. |
| **A-7** | El trigger `tg_animal_profiles_record_rodeo_change` es `SECURITY DEFINER set search_path = public`, toma `establishment_id` **siempre** de `new.establishment_id` (fila padre) y nunca de un valor del cliente, y todas sus referencias a tablas están calificadas con `public.`. | Lectura + **ejecutado** el control que hace inalcanzable el par cruzado (perfil de A con rodeo de B): `animal_profiles_rodeo_check[BEFORE]` **existe** y su cuerpo exige `r.establishment_id = new.establishment_id and r.active = true and r.deleted_at is null`, con `errcode='23514'`. Es `BEFORE` y el del delta es `AFTER` → el rechazo ocurre primero. |
| **A-8** | El backfill de `0127` no puede romperse por un `rodeo_id` nulo (la columna destino es `not null`). | **Ejecutado**: `animal_profiles.rodeo_id` es `null=NO`, y `count(*) where rodeo_id is null` → **0** sobre 6.362 perfiles. |
| **A-9** | **Information disclosure**: ningún `err.message` crudo llega al cliente. `mapRpcError` usa `rawMsg` **solo** dentro de un regex y devuelve siempre literales fijos. | Lectura de las 3 rutas + `grep` de `console.*` en los 6 archivos de frontend del delta → **0 hits**. |
| **A-10** | **Mass assignment**: ninguna de las 3 RPC recibe `establishment_id` del cliente; los 21 KPI los computa el server y el `establishment_id` sale de `v_est` (la fila de `rodeos`). El detalle usa el mismo `v_est`, no `animal_profiles.establishment_id`. Ningún `.insert(body)`/`.update(body)` con spread en el frontend. | Lectura de `0130` + `grep` sobre los servicios del delta. |
| **A-11** | **G2 y `can_close` alineados** (era N-3 de Gate 1). | Lectura de `0130` + `campaignStateView`. |
| **A-12** | **El reconocimiento del cierre masivo no se desborda**: la segunda pasada targetea **solo** `bulkResult.incomplete`. | `app/app/(tabs)/reportes.tsx:182-186`. |
| **A-13** | **`p_acknowledge_incomplete` no sirve para nada más que reconocer**. | Lectura + `grep` de `true` literal en los call sites. |
| **A-14** | **`close_campaign` no es `STABLE`** y lleva `set search_path = public, pg_temp` con `pg_temp` último y explícito. Lo verifican **dos** guards. Sin SQL dinámico. | Lectura de `0130`. |
| **A-15** | **Fail-closed bajo `service_role`**: los fixtures **no pueden** cerrar campañas con la service-role key. | **Ejecutado**: `has_function_privilege('service_role','public.rodeo_pregnancy_kpi(uuid,integer)','EXECUTE') -> false`. |
| **A-16** | **El oráculo de TR.21 sabe fallar si el error desaparece**: `pgcode(null)` devuelve `"null null"`. | Lectura + traza del helper. |
| **A-17** | **Sin secretos, sin ids hardcodeados**. `reportes-spike.tsx` no toca `supabase` ni ninguna RPC. | Ejecutado (grep). |
| **A-18** | **PII (ADR-025)**: ninguna tabla nueva guarda email ni teléfono. `closed_by_name` sale de `user_roles.member_name` de ese establecimiento. | Lectura + **ejecutado**: `user_roles.member_name` existe. |

### Estado de los findings abiertos de Gate 1 (en el código)

| Gate 1 | Qué pedía | En el código |
|---|---|---|
| **H-1** | Orden guard→cota→cortocircuito con oráculo | ✅ A-1 (13/13, ejecutado) + TR.21 con el descubrimiento **corregido** a `oidvectortypes` |
| **H-2** | Procedencia del `establishment_id` + no-escritura del cliente | ⚠️ procedencia ✅; la no-escritura era H-C1 → **cerrada en el fix-loop** |
| **H-3** | `ur.active` / `deleted_at` con oráculo | ✅ A-5 |
| **N-2** | Recuperar la mitad `anon`/`public` del smoke-check | ✅ verificados vacíos contra el catálogo (A-2) |
| **N-3** | `can_close` con `serviced > 0` | ✅ A-11 |
| **N-4** | Re-etiquetar TR.14f(b) + assert textual justificado | ✅ premisa (`0076`) ejecutada en A-5 |
| **N-5** | La cota sobre el conjunto **descubierto** | ✅ TR.21(b) itera `for (const fn of fns)` |
| **N-6** | Invariante cabecera↔rodeo por test | ✅ TR.14h-bis, sobre toda fila de la tabla |
| **M-3** | `pg_temp` + doble cierre en una transacción | ✅ A-14 · **+ TR.14i(b) en el fix-loop** (oráculo conductual) |
| **M-5** | `member_name` en vez de `users.name` | ✅ A-18 |
| **N-1** | `set local role authenticated` acotado al paso que lo necesita | 🔸 runbook del §9 / T74, del leader |

---

## False positives descartados (para trazabilidad)

| Candidato | Por qué NO aplica |
|---|---|
| **Inyección SQL en `format('… %s', identity_arguments)`** | El `%s` interpola una lista de tipos que sale de **`pg_catalog`**, no de input de usuario. Para envenenarla haría falta DDL. El `proname` sí va con `%I`. |
| **`pg_temp` en el `search_path` de un `SECURITY DEFINER`** | `pg_temp` va **último y explícito**; `public` gana. `authenticated` no hace DDL por PostgREST. Teórico. |
| **`is_owner_or_vet_of` concedida a `authenticated`** | Mismo estatus que `is_owner_of` y `has_role_in`, **ejecutado**. Solo revela el rol **del propio caller**. |
| **`animal_category_at` sin guard de tenant** | No es alcanzable: revocada de los 3 roles y cubierta explícitamente por el barrido y por TR.14b. |
| **`entry_date` del cliente alimenta `from_date` de la membresía** | Escritura **same-tenant** sobre un dato que el usuario ya posee. Integridad de dominio, no seguridad. |
| **`close_campaign` puede devolver `NULL` en una carrera** | UX, no seguridad: no escribe una segunda foto (índice único parcial). *(El fix-loop agregó TR.14i(a) que lo cubre.)* |
| **El cierre masivo como fan-out** | N llamadas HTTP **del cliente**, cada una re-guardada server-side (DP-11). Sin amplificación de una request. |

---

## Tabla de inputs (campos que cruzan cliente → servidor)

El delta **no agrega ningún campo de texto libre, buscador ni prompt**: la UI nueva es una barra de estado con botones y
una hoja de confirmación sin inputs (verificado, cero `TextInput`).

| Campo / parámetro | Origen | Límite | Validación | ¿OK? |
|---|---|---|---|---|
| `p_rodeo_id` (uuid) | selector de rodeo, no tipeado | tipo `uuid` de PostgREST | **server**: `select … from rodeos … deleted_at is null` → `P0002`; luego guard de tenant | ✅ |
| `p_year` (int) | `YearStepper`, no tipeado | `1900 .. current+1` | **server**: `22023` **tras** el guard, en las 13 funciones (A-1) | ✅ |
| `p_acknowledge_incomplete` (boolean) | segundo toque de la hoja | booleano | **server**: `coalesce(…, false)`; no sortea G1/G2; no setea el flag persistido | ✅ |
| `acknowledgeIncomplete` (wrapper TS) | call sites de `closeCampaign` | — | **sin default** a propósito | ✅ |
| fan-out del cierre masivo | `RodeoContext` del usuario | N = rodeos del establecimiento | N llamadas del cliente, re-guardadas server-side | ✅ |
| `missing_at_close` / mensaje del `23514` | **generado en el server** sobre ints | — | sin input de usuario; el cliente **no** parsea el texto | ✅ |

Ningún campo llega a un `.or()`, `.filter()`, `ilike` ni a un prompt. Sin SQL dinámico en las RPC (§5.10 preservado).

## Tabla de rate limits (acciones abusables que toca el diff)

| Acción | ¿Rate limit? | Keyeo | ¿Fail-closed? | Nota |
|---|---|---|---|---|
| `close_campaign` | **No** (ninguna RPC de PostgREST lo tiene) | — | El **guard** sí (`42501`); el **costo** no | G2 le saca el multiplicador de Gate 1 M-4. Falta la medición de wall-time de T74. |
| `reopen_campaign` | **No** | — | Guard sí | Un `update`. No amplifica. |
| `rodeo_campaign_status` | **No** | — | Guard sí (`has_role_in`) | Recomputa 2 KPI en el camino abierto y se llama en cada `useFocusEffect`. |
| Las 7 RPC de lectura | **No** (as-built) | — | Guard sí | El delta les sube el costo en abierto y se lo baja en cerrado. |
| Cierre masivo por campo | **No** server-side | N = rodeos del usuario, 2 pasadas | El guard corre en cada una | Correcto que sea N llamadas del cliente (DP-11). |
| Auth (`[auth.rate_limit]`) | **n.a.** | — | — | El diff **no toca** `supabase/config.toml`. |
| Email / SMS / API externa | **n.a.** | — | — | El delta no manda nada ni pega a ningún tercero. |

---

## Archivos analizados

**Backend**: `supabase/migrations/0127`–`0130` (nuevos, no aplicados) · `supabase/tests/reports/run.cjs`.
**Frontend**: `app/src/services/reports.ts` · `app/src/utils/reports-format.ts` · `app/src/hooks/use-reports.ts` ·
`app/src/components/reports/{CampaignStateBar,CampaignCloseSheet}.tsx` · `app/app/(tabs)/reportes.tsx` ·
`app/app/reportes-spike.tsx`.

**Contexto leído (no auditado)**: `0005`, `0021`, `0030`, `0068`, `0076`, `0097`, `0105`, `0106`, `0124`,
`sync-streams/rafaq.yaml`, `progress/impl_campanas-congeladas.md`, `progress/security_spec_07-campanas-congeladas.md`,
`docs/backlog.md`.

**Excluido por instrucción del leader** (otras terminales): `feature_list.json`, `progress/current.md`,
`progress/qa_maniobras-device.md`, `docs/marketing/**`, `app/src/features/ble-stick/**`,
`specs/active/04-bluetooth-baston/**`. **Excluido por alcance**: todo el delta `ficha-categoria-tacto` (spec 02) que
convive sin commitear. No se corrió `adb`.

## Dominios del catálogo revisados

| Dominio | Aplica | Resultado |
|---|---|---|
| **A1** service-role / definer bypassa RLS | Sí | Scoping manual verificado en las 13 (A-1). Sin Edge Functions. |
| **A2** mass assignment | Sí | A-10 |
| **A3** IDOR por FK | Sí | Guard + FK compuesta (A-6) |
| **A4** function-level authz (BFLA) | Sí | Escritura = `is_owner_or_vet_of`; lectura = `has_role_in` |
| **B1** `err.message` crudo al cliente | Sí | A-9 — limpio |
| **B2** PII en logs | Sí | A-17, A-18 |
| **B3** over-fetching column-level | Sí | Sin columnas nuevas que un rol activo no vea ya |
| **C1** PowerSync sync rules | Sí | ✅ ausentes del YAML · **M-C1** por la publicación |
| **C2** Realtime | No | `supabase_realtime allTables=false`, sin suscripciones |
| **C3** data-at-rest local | Sí | Nada nuevo baja al SQLite local |
| **C4** stale-auth en replay | Parcial | Cierre online-only, re-autorizado server-side |
| **D1/D3** secretos | Sí | A-17 |
| **D2** imports Deno | No | Sin Edge Functions |
| **E1/E2** queries sin tope / denial-of-wallet | Sí | Gate 1 M-4 + G2 (A-11) |
| **E4** enumeration | Sí | `P0002` pre-existente; el cliente mapea `42501` y `P0002` al MISMO `forbidden` |
| **F1** PostgREST filter injection | Sí | Sin input de usuario en filtros; sin SQL dinámico |
| **F2/F3/F4** ingesta / SSRF / XSS en email | No | Sin `fetch`, upload ni emails |
| **G** BLE | No | Fuera de alcance |
| **H1** invalidación de sesión | Sí | A-5 |
| **I1** retención / borrado | Sí | L-2 de Gate 1 cerrado (`on delete set null` en las 3 columnas de actor) |
| **I2** audit tamper-evidence | Sí | Append-only de hecho · **H-C1** era el agujero de esta propiedad |
| **I3** mobile hardening | No | Sin nada nuevo sensible en pantalla |

## Cobertura indirecta / no cubierto

- **`sentry-skills:security-review` no cubre PL/pgSQL, RLS, ni ACL de Postgres.** Toda la superficie de `0127`–`0130`
  la revisé **manualmente** con la metodología de la skill y contra el catálogo del remoto. Los findings de backend van
  rotulados `RAFAQ-SPECIFIC`; la skill no aportó ninguno.
- **PowerSync**: no cubierto por ninguna herramienta. Revisado a mano vía `pg_publication` + el YAML.
- **React Native**: el frontend salió limpio.
- **Lo que este gate NO puede afirmar**: las migraciones **no están aplicadas**, así que ningún oráculo de la suite se
  ejecutó de verdad. Todo lo que digo sobre los tests es sobre **lo que el test observa**, no sobre que haya pasado.

---
---

# RE-AUDITORÍA — Gate 2 sobre el fix-loop

- **Fecha**: 2026-08-07 · **Input**: `0127`–`0130` + `run.cjs` + `docs/backlog.md` tal como quedaron tras el fix-loop
  (mtimes 20:24–20:37; el informe de arriba es de las 19:57). El análisis original **no se toca**, salvo el párrafo del
  precedente `0068`, que va tachado en su lugar porque el error se propagó.
- **Método**: leí el **SQL final**, no el resumen del fix (instrucción del leader, y con motivo: el propio fix-loop
  metió un edit que no matcheaba y habría abortado el apply). Re-ejecuté todos los chequeos mecánicos.

## Veredicto: **PASS**

H-C1 cerrado con un arreglo **más fuerte** que el que pedí. Los tres MEDIUM cerrados. Aparece **un MEDIUM nuevo (M-C4),
que es culpa mía**: el precedente que cité en el informe anterior no hace lo que dije, y esa cita ya está copiada en dos
migraciones y en el backlog. No es un hueco de seguridad —el código del delta es estrictamente mejor que el precedente—
pero hay que corregirlo antes de que alguien generalice el arreglo copiando el molde equivocado.

## 1 · H-C1 — CERRADO, y el mutante por sustitución me corrigió a mí

### El `revoke` está, en el orden correcto

`0127:118` y `0128:299-300`, **antes** de los `grant`:

```sql
revoke all on public.rodeo_membership_history from public, anon, authenticated;   -- 0127:118
grant select on public.rodeo_membership_history to authenticated;                 -- 0127:120
grant all    on public.rodeo_membership_history to service_role;                  -- 0127:121

revoke all on public.rodeo_campaign_snapshots        from public, anon, authenticated;  -- 0128:299
revoke all on public.rodeo_campaign_snapshot_animals from public, anon, authenticated;  -- 0128:300
grant select on public.rodeo_campaign_snapshots        to authenticated;                -- 0128:302
grant select on public.rodeo_campaign_snapshot_animals to authenticated;                -- 0128:303
grant all    on public.rodeo_campaign_snapshots        to service_role;                 -- 0128:304
grant all    on public.rodeo_campaign_snapshot_animals to service_role;                 -- 0128:305
```

Revisado por si el `revoke all` rompía algo: **`service_role` no está en la lista de revocados** y además recibe
`grant all` después → el `admin` de la suite (`snapshotOf`, `snapshotDetail`, los seeds de TR.21/TR.14h) sigue
funcionando. **`powersync_role` tampoco se toca**, con el motivo escrito en `0128` (*"su `SELECT` es lo que lee la
replicación lógica … revocárselo rompería el slot, no la frontera"*) — correcto: la frontera de devices es el YAML, no
el ACL. Y la FK compuesta no necesita `REFERENCES` del rol cliente (se enforce internamente), así que revocar `x` no la
afecta.

### TR.14e ahora resuelve el ACL crudo, y sabe fallar

`run.cjs:1905-1930`: 8 privilegios × 3 tablas, con `auth_sel = true` como **control de no-vacuidad** (si el `revoke`
se pasara de rosca y la tabla quedara ilegible, el test también se pone rojo — no solo si se pasa de laxo). Cubre lo que
pedí y suma `anon_ins` y `anon_sel`.

**Que sabe fallar no lo asumo — lo medí sobre tablas comparables**, que son el estado exacto en que nacerían las 3 sin
el `revoke`:

```
animal_category_history  anon_trunc=true   auth_trunc=true   anon_sel=false  auth_sel=true
push_tokens              anon_trunc=true   auth_trunc=true   anon_sel=false  auth_sel=true
user_private             anon_trunc=false  auth_trunc=TRUE   anon_sel=false  auth_sel=true
```

Sin los `revoke`, `anon_trunc` y `auth_trunc` darían `true` en las 3 tablas del delta y el assert se pondría rojo.

### El `comment on column` quedó escrito con la verdad medida

`0127:105-117` y el bloque equivalente de `0128`: nombran el `pg_default_acl` con su valor, dicen que `D` es TRUNCATE,
que la RLS no lo puede restringir porque `pg_policies.cmd` solo toma DELETE/INSERT/SELECT/UPDATE, que **no es una
condición que introduzca este delta** (35 tablas), y que el barrido general está en `docs/backlog.md`. Es la
distinción correcta: se revoca acá **porque sobre estas tablas está escrito el invariante**, no porque el delta sea el
culpable.

### El mutante por sustitución: el precedente `0068` no hace lo que yo dije

El leader corrió mi propio assert contra `user_private` y dio TRUNCATE `true` para `authenticated`. **Confirmado**:

```
user_private => postgres=arwdDxtm | authenticated=rwDxtm | service_role=arwdDxtm | powersync_role=r
  anon_trunc = false      <- esto sí lo cerró 0068:208
  auth_trunc = TRUE       <- esto NO
```

`0068:208` es `revoke all on public.user_private from anon, public;` — **`authenticated` no está en la lista**, así que
conservó la `D` del default ACL. Y medido sobre todo el schema:

```
total_tablas_public                          -> 35
auth_TRUNCATE = true                         -> 35   (cero excepciones)
anon_TRUNCATE = true                         -> 34
excepciones_anon (tablas SIN el privilegio)  -> user_private
```

O sea: **`user_private` es la única excepción del schema, y lo es solo para `anon`.** Para `authenticated` —el rol que
efectivamente tiene sesión— no hay ni una excepción en las 35.

**Sí, cambia el encuadre del ítem de backlog, y hacia arriba.** Hoy `docs/backlog.md:40-41` dice: *"Precedente en el
repo: `0068:208` ya hizo un `revoke` explícito sobre `user_private`, así que el patrón existe y está entendido;
simplemente no se generalizó."* Eso hay que reescribirlo, por tres razones:

1. **El patrón NO está entendido**: la única aplicación deliberada del repo cierra `anon` y deja `authenticated`.
   Generalizar *ese* patrón a las 35 tablas dejaría el agujero abierto en las 35.
2. **La tabla del precedente es la peor para tenerlo abierto**: `user_private` es la de **PII** (ADR-025 / spec 14).
   Cualquier usuario logueado de cualquier tenant puede vaciar el email y el teléfono de todos los usuarios. Y ya hay
   una entrada previa (`docs/backlog.md:556-562`) sobre grants demasiado anchos **en esa misma tabla** — son dos
   findings independientes de la misma clase sobre el mismo objeto, lo que es señal de que ahí hay que mirar primero.
3. **El template correcto ya existe y es de este delta**: `revoke all … from public, anon, authenticated` de
   `0127:118` / `0128:299-300`. El backlog debería apuntar ahí, no a `0068`.

El conteo del backlog ("35 de 35 … cero excepciones") **está bien** — lo medí y coincide. Lo que está mal es la frase
del precedente.

## 2 · A-4 — el "leído, no ejecutado" se levanta; el método es válido

**Lo que había que probar**: que el parser de Postgres acepta `f(p_x uuid, p_y integer)` como target de
`GRANT`/`REVOKE ON FUNCTION`, o sea que el `format()` del loop (0) no muere con `42601` (sintaxis) ni `42883` (función
no encontrada).

**¿Alcanza un grant ya vigente?** Sí, y es la elección **más segura** de las dos:

- El parseo y la resolución de nombre ocurren **antes** de aplicar el privilegio. Si la sentencia se ejecutó sin error,
  entonces (a) la gramática aceptó `[argname] argtype` y (b) el lookup resolvió la función desde la firma con nombres.
  Esas son exactamente las dos cosas en duda.
- Que el ACL cambie o no **no aporta nada** a la pregunta: nadie dudaba de que un GRANT muta el ACL. Un grant *nuevo*
  probaría de más y encima dejaría estado que hay que revertir.
- Al ser idempotente, el `rollback` deja de ser load-bearing: si por lo que fuera se hubiera commiteado, el efecto es
  cero. Es la propiedad que hace al método seguro sobre una DB compartida entre tres terminales.

**Lo verifiqué por mi lado hasta donde un SELECT permite** — re-tomé el ACL de las 12 funciones del namespace y de
`has_role_in`/`is_owner_of` y lo comparé contra el snapshot que había tomado *antes* del fix-loop: **idéntico**
(`postgres=X/postgres | authenticated=X/postgres`, `anon_x=false`, `pub_x=false` en todas). No quedó rastro.

**Declaración honesta de quién ejecutó qué**: el `begin/rollback` lo corrió el **implementer**, no yo (mi transporte
solo emite SELECT). Yo validé (a) que el método prueba lo que hace falta, (b) que el estado del catálogo no se movió.
**Residual declarado**: se ejercitó la forma `GRANT`; el loop también emite `REVOKE`. Las dos comparten la misma
producción gramatical (`privilege_target → FUNCTION function_with_argtypes_list`), así que una firma que parsea para una
parsea para la otra — eso es **gramática documentada, no ejecutado**. Si me equivocara, la migración aborta en T73:
fail-closed, sin agujero. Con eso, **saco el rótulo de A-4**.

Bonus: el fix-loop además **codificó el método como test** — `TR.14i(b)` (`run.cjs:1820-1832`) corre dos
`close_campaign` en una transacción con `set local role authenticated` + claims + `rollback`, que es el oráculo
conductual que a M-3(b) de Gate 1 le faltaba, y de paso demuestra el patrón de impersonación acotada de N-1.

## 3 · Los tres MEDIUM — cerrados, verificados mecánicamente

### M-C1 — cerrado, y me corrijo la novedad

`0127:59-67` reescribió el `comment on table` distinguiendo las dos capas: la publicación es `FOR ALL TABLES` (no se
puede excluir), las filas **sí** cruzan al slot, y lo que las mantiene fuera de los **devices** es que ninguna sync
stream las nombra. Declara el residual (WAL + superficie hacia el servicio administrado). TR.19 (`run.cjs:2322-2326`)
suma un tripwire sobre `puballtables = true`, honestamente rotulado como *"si algún día dejara de serlo, la frontera
cambia de capa y este comentario hay que reescribirlo"* — no es un guard de DL8 y el comentario lo dice.

**Verifiqué los dos hechos que el comentario nuevo invoca**:

```
0124_audit_log.sql:7-14  -> ya declaraba (2026-07-13, read-only pg_publication) que la publicación es FOR ALL TABLES
                            y que "el FRONTIER de sincronización NO es la publication sino las sync rules"
YAML: animals -> ausente | users -> ausente | import_log -> ausente
```

**Me corrijo**: presenté M-C1 como si el hecho fuera desconocido. No lo era — `0124` lo documentó hace tres semanas. Lo
que estaba mal era el `comment on table` de `0127` restándolo. El finding sigue siendo válido (una migración nueva
afirmaba algo que otra migración del mismo repo ya había desmentido), pero es **menos novedoso** de lo que lo escribí.

### M-C2 — cerrado por `oid`, y con un loop (3) que yo no había pedido

Los tres bloques recolectan `v_oids` en el loop (0) y barren con `not (p.oid = any (v_oids))` / `p.oid = any (v_oids)`
(`0128:363,378` · `0129:653,671` · `0130:490,508`). **Simulado contra el catálogo actual**:

```
LOOP0_resuelve_N_funciones            -> 10
LOOP1_por_OID_internas_abiertas       -> (vacio)
LOOP2_por_OID_publicas_en_anon_public -> (vacio)
```

No aborta. Y el borde fail-closed está bien: con `v_oids` vacío, `p.oid = any('{}')` es `false`, así que `not (…)` es
`true` → el barrido de internas se lleva **todo** el namespace. Falla cerrado.

**El loop (3) nuevo (`0130:522-541`, del reviewer H-5) está en el lugar exacto, y ese lugar importa.** Exige que cada
uno de los 14 nombres de la lista blanca resuelva a ≥1 función. Medido:

```
LOOP3_nombres_sin_resolver_HOY -> close_campaign, is_owner_or_vet_of, reopen_campaign, rodeo_campaign_status
```

Son exactamente las 4 que el delta crea (`is_owner_or_vet_of` en `0128`, las otras 3 en `0130`). **Si ese loop hubiera
quedado también en `0128` o en `0129`, habría abortado el apply** — es la clase de edit que el leader me advirtió. Está
solo en `0130`, donde las 14 ya existen, y el comentario explica precisamente eso.

Su premisa —*"como las tres listas son idénticas, verificar acá cubre el typo de las tres"*— **la verifiqué en vez de
creerla**: md5 de los nombres ordenados de `v_public` en las tres migraciones → `c70daf5ddc92` en las tres. Idénticas.

### M-C3 — cerrado

`0128:320-325` reescribe la premisa con la medición y agrega la frase que importa: *"Estos `revoke` son no-ops
correctos y defensa en profundidad —**no la única red**—, y el barrido de abajo VERIFICA el estado final en vez de
confiar en cualquiera de los dos defaults."* Es exactamente el encuadre que pedí.

## 4 · Re-verificación mecánica de lo que el fix-loop tocó

| Chequeo | Resultado |
|---|---|
| Orden `P0002 → guard → cota → cortocircuito` en las 13, **re-ejecutado** sobre el SQL editado | **13/13 OK**. Único movimiento: `close_campaign` corrió 1 línea (comentario insertado). |
| Las 3 listas `v_public` idénticas | md5 `c70daf5ddc92` en `0128`/`0129`/`0130` |
| Loops (1) y (2) por `oid` contra el catálogo | ambos `(vacio)` → `0128`/`0129`/`0130` no abortan |
| Loop (3) sólo en `0130` | correcto: hoy 4 de los 14 nombres no resuelven |
| ACL de funciones antes vs. después del fix-loop | **idéntico** (sin rastro del `begin/rollback` del implementer) |
| Frontend: `mapRpcError` | sin cambios de sustancia; `rawMsg` solo en el regex (`reports.ts:162,176`) |
| Frontend: clasificación reconocible/no-reconocible | por estado (`canClose && !cycleComplete`), nunca por texto (`use-reports.ts:358-376`) |
| Frontend: segunda pasada del masivo | scopeada a `bulkResult.incomplete` (`reportes.tsx:182-186`) |
| Frontend: `console.*` / secretos | 0 hits en los 6 archivos |

## 5 · Findings de la re-auditoría

### M-C4 · MEDIUM — la cita del precedente `0068:208` induce a sub-arreglar, y está en tres lugares

**Origen: mío.** Lo escribí en el informe de Gate 2 sin medir `authenticated` sobre `user_private`, y de ahí pasó a
`0127:116`, al bloque equivalente de `0128` y a `docs/backlog.md:40-41`.

Las citas en las migraciones son textualmente correctas (transcriben `from anon, public`), pero están rotuladas
*"Precedente del repo"* junto a un `revoke` que incluye `authenticated` — un lector rápido concluye que son la misma
operación. La del backlog es peor porque además **afirma** que *"el patrón existe y está entendido; simplemente no se
generalizó"*, y es la que va a guiar la migración de barrido.

**Fix (3 líneas, ninguna de código ejecutable)**:
- `0127` y `0128`: cambiar *"Precedente: `0068:208`"* por *"Precedente **parcial**: `0068:208` revoca de `anon`/`public`
  pero **no** de `authenticated` (medido: `user_private` sigue TRUNCATE-able por `authenticated`) — acá se cierran los
  tres roles."*
- `docs/backlog.md`: reemplazar el párrafo del precedente por el hecho medido (35/35 para `authenticated`; la única
  excepción del schema es `user_private` **y solo para `anon`**), apuntar el template a `0127:118`/`0128:299-300`, y
  subir la prioridad de `user_private` por ser la tabla de PII de ADR-025 y por acumular ya dos findings de la misma
  clase (la otra en `docs/backlog.md:556-562`).

No bloquea: el código del delta ya es más fuerte que el precedente.

### L-C4 · LOW — el assert de ACL no fija `REFERENCES`/`TRIGGER`/`MAINTAIN`

TR.14e chequea TRUNCATE/INSERT/UPDATE/DELETE/SELECT. El `revoke all` de hoy también saca `x`/`t`/`m`, así que el estado
final es correcto; pero si mañana alguien reemplaza el `revoke all` por una lista explícita, esos tres vuelven por el
default ACL y el guard no los ve. Los tres son inertes vía PostgREST (crear un trigger o una FK exige DDL, y `MAINTAIN`
es VACUUM/ANALYZE/REINDEX). Una línea: sumar `'REFERENCES'`, `'TRIGGER'` y `'MAINTAIN'` al mismo assert. Anexo, no
pedido bloqueante.

## 6 · Qué queda para el leader

**Antes del apply (T73)** — nada bloqueante. Si `0128` muriera con `42601`, es A-4 (el `format()` con
`identity_arguments`), que es lo único que no ejecuté yo.

**Con el resto del fix-loop, cuando se toque**: M-C4 (3 comentarios) y L-C4 (una línea en TR.14e).

**Post-apply (T73), obligatorio**: la suite tiene que dar **35/35** más los tests nuevos. Ningún oráculo del delta se
ejecutó todavía: todo lo que este informe afirma sobre los tests es sobre **lo que el test observa**, no sobre que haya
pasado. En esta unidad ya hubo cuatro oráculos que daban verde con el bug puesto — si alguno del delta se pone verde
sin que su condición se cumpla, es un falso verde y hay que volver acá.

**Sigue abierto y fuera de este gate**: N-1 de Gate 1 (el `set local role authenticated` del runbook del §9 / T74) y el
barrido de las 35 tablas (`docs/backlog.md`, con el encuadre corregido por M-C4).
