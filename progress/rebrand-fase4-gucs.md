# Rebrand fase 4 — GUCs de Postgres `rafaq.is_*` → `mitropero.is_*`

**2026-08-17** · Baseline `e7b1dca`. Deploy a DEV autorizado por Raf en sesión. **PROD no se toca.**

Plan: `docs/rebrand-mitropero-plan.md` §4.C + preparación en `progress/rebrand-fases-4-5-preparacion.md`.

---

## 1. Reconocimiento — la superficie real (medida, no leída)

### 1.1 El cliente no toca ninguna GUC (confirma la preparación, corrige el plan)

```
$ git grep -nE "set_config|current_setting" -- app supabase/functions
(exit 1 — cero resultados)
```

El §4.C del plan dice que hay que cambiar los `set_config`/`current_setting` *"en el cliente y en RPCs, en
sync"*. **Es falso.** Las dos GUCs viven enteramente dentro de Postgres. No hay skew cliente/servidor
posible → **una sola migración atómica**, sin deploy coordinado.

### 1.2 Barrido del REMOTO por objeto, no por migración

No me confié del grep sobre `supabase/migrations/` (una migración posterior puede haber redefinido una
función y movido/borrado la referencia). Barrí el catálogo de DEV:

```sql
-- funciones
select ... from pg_proc p where p.prosrc like '%rafaq.%';
-- y ADEMÁS: db/role settings, views, constraints, policies, triggers (WHEN), column defaults, índices
select ... from pg_db_role_setting / pg_views / pg_constraint / pg_policies / pg_trigger /
              information_schema.columns / pg_indexes  where <def> like '%rafaq.%';
```

**Resultado del barrido no-función: `[]` (vacío).** No hay `ALTER DATABASE/ROLE ... SET`, ni vista, ni
CHECK, ni policy, ni `WHEN` de trigger, ni default de columna, ni índice que nombre una GUC `rafaq.*`.
Toda la superficie son **6 funciones**:

| # | Función (remoto) | secdef | GUC | rol |
|---|---|---|---|---|
| 1 | `public.apply_auto_transition(profile_id uuid, target_category_id uuid)` | sí | `is_auto_transition` | **SETEA** |
| 2 | `public.tg_animal_profiles_set_override_on_manual()` | no | `is_auto_transition` | LEE |
| 3 | `public.tg_animal_profiles_record_category_change()` | sí | `is_auto_transition` | LEE |
| 4 | `public.transfer_animal(uuid, uuid, uuid, uuid, uuid)` | sí | `is_transfer` | **SETEA** |
| 5 | `public.tg_animal_events_enforce_edit_window()` | no | `is_transfer` | LEE |
| 6 | `public.tg_animal_profiles_record_rodeo_change()` | sí | `is_transfer` | LEE |

Coincide exactamente con el mapa de la preparación (`0031` setea / `0021`+`0030`+`0040` leen ·
`0087`→`0122` setea / `0088`+`0127` leen), sin sorpresas. `0040` es la que dejó vigente a
`tg_animal_profiles_set_override_on_manual` (por eso el cuerpo remoto tiene la rama de *revert explícito*
que `0021` no tenía) — otra razón para moldear sobre el remoto.

### 1.3 Lo que contiene "rafaq" pero NO es esta fase

```
prosrc like '%rafaq%' and prosrc not like '%rafaq.%'
→ audit.resolve_actor · audit.resolve_request_id
```

Son los **headers** `x-rafaq-actor` / `x-rafaq-request-id` (`0124` / `0131`). **Fase 5. No se tocan acá.**

### 1.4 COMMENTs de la DB que nombran las GUCs

`obj_description like '%rafaq%'` devuelve **2** (y sólo 2):

- `public.tg_animal_events_enforce_edit_window` → *"…GUC local rafaq.is_transfer='on'… Patrón rafaq.is_auto_transition (0031)."*
- `public.tg_animal_profiles_record_rodeo_change` → *"…vía la GUC local rafaq.is_transfer (0088)…"*

El COMMENT de `transfer_animal` dice *"animal_events vía GUC 0088"* (sin nombrarla) → no requiere cambio.
`apply_auto_transition` y los otros dos triggers **no tienen COMMENT** (NULL).

### 1.5 ACLs vigentes (a preservar)

| Función | `proacl` |
|---|---|
| `apply_auto_transition` | `postgres=X/postgres` → revocada de public/authenticated/anon (`0042`, re-afirmada `0065`) |
| `transfer_animal` | `postgres=X/postgres \| authenticated=X/postgres` (`0087`/`0122`) |
| las 4 trigger functions | default (NULL) |

⚠️ **Por eso la migración usa `CREATE OR REPLACE` y NUNCA `DROP`+`CREATE`**: `CREATE OR REPLACE` conserva
owner, ACL, COMMENT y el binding de los triggers. Un `DROP` de una trigger function además tiraría los
triggers en cascada. Igual re-emito los `revoke`/`grant` de las dos funciones invocables (idempotente,
molde `0065`) y verifico los ACLs después de aplicar.

### 1.6 Triggers ligados (no se tocan — sobreviven al `CREATE OR REPLACE`)

```
animal_profiles.animal_profiles_set_override                 BEFORE UPDATE OF category_id
animal_profiles.animal_profiles_record_category_change_ins   AFTER  INSERT
animal_profiles.animal_profiles_record_category_change_upd   AFTER  UPDATE OF category_id
animal_profiles.animal_profiles_record_rodeo_change_ins      AFTER  INSERT
animal_profiles.animal_profiles_record_rodeo_change_upd      AFTER  UPDATE OF rodeo_id, status, deleted_at
animal_events.animal_events_enforce_edit_window              BEFORE UPDATE
```

---

## 2. Cuerpo VIGENTE traído del remoto (`pg_get_functiondef`, DEV `xrhlxxdnfzvdnztacofj`)

Es la base literal de la migración. Sólo cambia el literal de la GUC.

```sql
CREATE OR REPLACE FUNCTION public.apply_auto_transition(profile_id uuid, target_category_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  perform set_config('rafaq.is_auto_transition', 'on', true);
  update public.animal_profiles set category_id = target_category_id where id = profile_id;
  perform set_config('rafaq.is_auto_transition', 'off', true);
end; $function$
```

```sql
CREATE OR REPLACE FUNCTION public.tg_animal_profiles_set_override_on_manual()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
begin
  if new.category_id is distinct from old.category_id then
    -- Revert explícito (R4.10): el usuario clarea el override en el mismo update.
    if old.category_override = true and new.category_override = false then
      return new;  -- respetar el revert; no re-marcar override.
    end if;
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') <> 'on' then
      new.category_override := true;
    end if;
  end if;
  return new;
end; $function$
```

```sql
CREATE OR REPLACE FUNCTION public.tg_animal_profiles_record_category_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_reason public.category_change_reason;
begin
  if tg_op = 'INSERT' then
    v_reason := 'initial';
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, null, new.category_id, auth.uid(), v_reason);
  elsif tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') = 'on' then
      v_reason := 'auto_transition';
    elsif old.category_override = true and new.category_override = false then
      v_reason := 'revert_to_auto';
    else
      v_reason := 'manual_override';
    end if;
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, old.category_id, new.category_id, auth.uid(), v_reason);
  end if;
  return new;
end; $function$
```

`tg_animal_events_enforce_edit_window`, `tg_animal_profiles_record_rodeo_change` y `transfer_animal`:
cuerpo completo en la migración `0132` (son largos; se copiaron verbatim del `pg_get_functiondef`).
Los puntos que importan:

- `tg_animal_events_enforce_edit_window`: `if coalesce(current_setting('rafaq.is_transfer', true), 'off') = 'on' then return new; end if;` como **primera** sentencia (el early-return de `0088`), y después la inmutabilidad íntegra de `0034`.
- `tg_animal_profiles_record_rodeo_change`: cuerpo de `0127` completo (5 ramas), con el `case … current_setting('rafaq.is_transfer'…) then 'transfer_in' else 'initial'` en la rama INSERT.
- `transfer_animal`: cuerpo de **`0122`** (sin `visual_id_alt`), no el de `0087`. Setea la GUC sólo alrededor del `update public.animal_events`.

### Diferencias remoto ↔ migración citada por el plan (la trampa, comprobada)

| Función | El plan cita | Vigente en el remoto |
|---|---|---|
| `transfer_animal` | `0087` | **`0122`** (quitó `visual_id_alt` del select y del insert) |
| `tg_animal_profiles_set_override_on_manual` | `0021` | **`0040`** (agregó la rama de *revert explícito*) |
| `tg_animal_profiles_record_rodeo_change` | (no existía en `0088`) | **`0127`** |

Copiar de `0087`/`0021` habría revertido `0122`/`0040` en silencio.

---

## 3. Baseline ANTES de aplicar (literal)

`TZ=America/Argentina/Buenos_Aires`, HEAD `e7b1dca`, DEV.

| Suite | Resultado |
|---|---|
| `node --test supabase/tests/animal/run.cjs` | `tests 139 / pass 139 / fail 0` (156.2 s) |
| `node --test supabase/tests/operaciones_rodeo/run.cjs` | `tests 22 / pass 22 / fail 0` (30.6 s) |
| `node --test supabase/tests/maneuvers/run.cjs` | `tests 14 / pass 14 / fail 0` (25.0 s) |
| `node --test supabase/tests/puesta-en-servicio/run.cjs` | `tests 11 / pass 11 / fail 0` (23.8 s) |

`puesta-en-servicio` la sumé yo: es la 4.ª suite que toca `category_override` (2 refs a `auto_transition`).
`import` (1 ref) y `reports` (1 ref) sólo setean `category_override` en un fixture, no asertan el
mecanismo — quedan cubiertas por el `check.mjs` final.

⚠️ `node scripts/check.mjs` NO llega a las suites backend hoy: `scripts/run-tests.mjs` usa `execSync` sin
`try`, y el stage de unit del cliente está rojo por el fallo conocido de `'X-Rafaq-Request-Id'` (fase 5).
Por eso el baseline de arriba se corrió **a mano**.

---

## 4. Qué tests ejercen cada mecanismo (mapa para la falsificación)

### `is_auto_transition` — `apply_auto_transition` (SET) vs los 2 triggers (READ)

| Test | Aserción | Trigger que ejerce |
|---|---|---|
| `animal/run.cjs:369` | `category_override === false` tras transición auto | `set_override_on_manual` (LEE) |
| `animal/run.cjs:433` | `animal_category_history.reason` incluye `auto_transition` | `record_category_change` (LEE) |
| `animal/run.cjs:1606` | castración → history `auto_transition` (RT2.10.4) | idem |
| `animal/run.cjs:1859` | cron → history `auto_transition` (RT2.8.4b) | idem |

Si SET y READ se desalinean: el trigger lee una GUC inexistente → `coalesce(...,'off') <> 'on'` → marca
`category_override = true` y registra `manual_override`. **Las 4 aserciones se caen.**

### `is_transfer` — `transfer_animal` (SET) vs `tg_animal_events_enforce_edit_window` (READ)

| Test | Aserción |
|---|---|
| `animal/run.cjs:3216-3221` (T2.1) | `animal_events` re-apuntado a Y — *"la GUC dejó cambiar las inmutables"* |
| `animal/run.cjs:3518-3533` (T2.12) | aislamiento de sync: ninguna hija con `establishment_id = X` |

Si se desalinean: el early-return no dispara → el `update animal_events` de `transfer_animal` levanta
`23514 immutable column changed` → **el RPC entero explota** y se caen los ~29 tests de transferencia.

### `is_transfer` — el read de `0127` (`transfer_in`) NO está cubierto, y además hoy es rama muerta

Ver §7 (hallazgo). No lo arregla esta fase.

---

## 5. La migración

`supabase/migrations/0132_rename_gucs_mitropero.sql` — `CREATE OR REPLACE` de las 6 funciones con el
cuerpo vigente del remoto y el literal de la GUC cambiado, + los 2 `COMMENT ON FUNCTION`, + re-emisión
idempotente de los `revoke`/`grant` de `apply_auto_transition` y `transfer_animal`, todo en un `begin;
… commit;`.

**Es atómico y sin ventana de skew**: dentro de la transacción, o se renombran las 6 o ninguna.

---

## 6. Aplicación y verificación

### 6.1 Aplicación

```
node scripts/apply-migration-mgmt.mjs supabase/migrations/0132_rename_gucs_mitropero.sql
→ Aplicando … (18964 chars) a project xrhlxxdnfzvdnztacofj [dev] vía Management API...
→ OK (HTTP 201). Respuesta: []
```

**PROD no se tocó.** El script resuelve `dev` por default y exige `RAFAQ_CONFIRM_PROD=1` para prod;
además `q.mjs` (el helper de consulta de esta sesión) asserta el ref de DEV antes de cada query.

### 6.2 El catálogo después

| Chequeo | Resultado |
|---|---|
| objetos con `rafaq.` (funciones + settings + vistas + constraints + policies + `WHEN` + defaults + índices) | **0** |
| funciones con `mitropero.is_*` | las **6** |
| ACL `apply_auto_transition` | `postgres=X/postgres` — **idéntica** a antes |
| ACL `transfer_animal` | `postgres=X/postgres \| authenticated=X/postgres` — **idéntica** a antes |
| ACL de las 4 trigger functions | default — idéntica |
| COMMENTs con `rafaq.is_` | **ninguno** |
| triggers ligados a las 4 trigger functions | **6** (los mismos) |
| `audit.resolve_actor` / `resolve_request_id` (headers, fase 5) | **intactos** |

### 6.3 La prueba fuerte: el diff de los cuerpos es EXACTAMENTE el rename

```
pg_get_functiondef(antes).replace('rafaq.is_','mitropero.is_')  ===  pg_get_functiondef(después)
→ true
```

Byte por byte, en las 6 funciones. No se coló ninguna otra diferencia (ni de whitespace, ni de
volatilidad, ni de `search_path`, ni una línea revertida de `0122`/`0040`/`0127`).

### 6.4 Suites — baseline al lado del resultado

| Suite | Antes | Después | |
|---|---|---|---|
| `animal` | 139 / 139 | **139 / 139** | = |
| `operaciones_rodeo` | 22 / 22 | **22 / 22** | = |
| `maneuvers` | 14 / 14 | **14 / 14** | = |
| `puesta-en-servicio` | 11 / 11 | **11 / 11** | = |
| `reports` | (sin baseline) | **36 / 36** | verde |
| `import` | (sin baseline) | **25 / 25** | verde |

`reports` e `import` se corrieron sólo después (son las otras dos que insertan `animal_profiles` en
volumen, o sea las que más ejercitan `tg_animal_profiles_record_rodeo_change`). Verdes, así que no hizo
falta atribuir nada.

| Otro | Resultado |
|---|---|
| `pnpm -C app typecheck` | **0 errores** |
| `node scripts/check.mjs` | **`tests 3116 / pass 3115 / fail 1`** — el único rojo es `A — ninguna pantalla de app/app + app/src muestra el nombre VIEJO de la marca` (`'X-Rafaq-Request-Id'` en `account.ts:127` / `members.ts:152` / `push-notifications.ts:88`). Es el fallo conocido de la fase 5. **Cero fallos nuevos.** |

---

## 7. Falsificación

Un guard de early-return roto **no hace ruido**: el `coalesce(current_setting(…, true), 'off')` devuelve
`'off'` ante una GUC inexistente en vez de tirar error. Así que no alcanza con que la suite quede verde:
hay que demostrar que se pone **roja** cuando el mecanismo se rompe.

### 7.1 El mutante

Con `0132` ya aplicada, se revirtieron **sólo los 4 LECTORES** al nombre viejo, dejando los **2 SETTERS**
en el nombre nuevo — el escenario de desalineación exacto:

```
apply_auto_transition                      mitropero (NUEVO)   SETEA
transfer_animal                            mitropero (NUEVO)   SETEA
tg_animal_events_enforce_edit_window       rafaq (VIEJO)       LEE
tg_animal_profiles_record_category_change  rafaq (VIEJO)       LEE
tg_animal_profiles_record_rodeo_change     rafaq (VIEJO)       LEE
tg_animal_profiles_set_override_on_manual  rafaq (VIEJO)       LEE
```

### 7.2 Resultado: `tests 139 / pass 122 / fail 17`

Dos clusters limpios (15 hojas + 2 nodos padre):

**`is_auto_transition` — 6 tests.** T2.4, T2.25, T2.26, T2.27, T2.29, T2.33.
Primera aserción caída, la del mecanismo:

```
AssertionError: transición auto no marca override
  actual:   true          ← el trigger leyó una GUC que ya no existe → marcó override
  expected: false
```

Y el efecto en cascada, que es el que muestra por qué esto importa: con el perfil marcado
`category_override = true`, el recálculo deja de avanzarlo →
`2º parto -> multipara: actual 'vaca_segundo_servicio', expected 'multipara'` ·
`aborto revierte preñez -> vaquillona: actual 'vaquillona_prenada'`. O sea, **el rename desalineado
apagaría la transición automática de categorías entera**, en silencio.

**`is_transfer` — 9 tests.** T2.1, T2.2, T2.7, T2.8, T2.9, T2.10, T2.11, T2.12, T2.14. Este falla
ruidoso:

```
code: '23514', message: 'immutable column changed on animal_event 6e10a943-…'
```

El early-return no dispara → el `update animal_events` de `transfer_animal` rebota contra la
inmutabilidad → el RPC entero explota.

### 7.3 Restauración

Se re-aplicó `0132` (segunda vez → confirma que la migración es **idempotente**), se verificó el catálogo
realineado, y la suite `animal` volvió a **139 / 139**. La ventana de DEV desalineada fue de ~4 minutos.

### 7.4 El guard de la propia migración también se falsificó

`0132` cierra con un `do $$ … $$` que aborta si queda **cualquier** función con una GUC `rafaq.*` (busca
sobre la ausencia: `prosrc like '%rafaq.%'` en todo `pg_proc`, no las 6 que ya conozco). Un guard que
nunca vio un caso positivo no es un guard, así que se le metió un mutante en una transacción abortada:

```sql
begin;
create or replace function public.__probe_guard_fase4() returns void language plpgsql
  as $p$ begin perform current_setting('rafaq.is_probe', true); end $p$;
<el bloque do $$ de 0132>
rollback;
```

```
HTTP 400: ERROR: 23514: fase 4 incompleta: todavía hay funciones con una GUC rafaq.*:
          public.__probe_guard_fase4
```

Y después: `select count(*) from pg_proc where proname='__probe_guard_fase4'` → **0** (la transacción
abortó, no quedó nada).

---

## 8. Reconciliación de specs y docs

Todo en el mismo commit que la migración.

| Archivo | Qué se hizo |
|---|---|
| `specs/active/02-modelo-animal/design.md` | 8 ocurrencias renombradas + **nota de reconciliación** (§ trigger de override) + nota en el bloque de `animal_events` |
| `specs/active/02-modelo-animal/design-tier2-categorias.md` | 1 ocurrencia |
| `specs/active/02-modelo-animal/tasks.md` | 2 ocurrencias + puntero a `0132` en `apply_auto_transition` |
| `specs/active/07-reportes-basicos/design-campanas-congeladas.md` | 1 ocurrencia + **nota de reconciliación** + el hallazgo de la rama muerta `transfer_in` (§9) |
| `specs/active/07-reportes-basicos/tasks-campanas-congeladas.md` | 1 ocurrencia |
| `specs/active/11-transferencia-animal/design.md` | 4 ocurrencias + **nota 3 de reconciliación** en §3.2 |
| `specs/active/11-transferencia-animal/tasks.md` | 2 ocurrencias + puntero a `0132` en T1.12 |
| `docs/rebrand-mitropero-plan.md` | fila 4 de la tabla de estado → ✅ HECHA · bloque de corrección en §4.C (lo que el plan decía mal y lo que decía bien) |
| `docs/marketing/plan-toma-de-marca-mitropero.md` | la línea *"las GUCs `mitropero.*`"* estaba **falsa por partida doble** (se llamaban `rafaq.*` **y** sí se tocaron). Se sacaron de la lista de "no se toca" + nota de corrección al estilo de la del 16/08 |
| `docs/backlog.md` | entrada nueva: la rama muerta `transfer_in` (§9) |

### Lo que NO se tocó, y por qué

- **`specs/active/10-operaciones-rodeo/`** — **no hizo falta**: `grep -rn "rafaq" specs/active/10-operaciones-rodeo/`
  → **cero**. La otra terminal tiene `design.md` y `requirements.md` de esa spec editados; **esta fase no
  los tocó**, así que no hay conflicto que separar.
- **Las 8 migraciones históricas** (`0021`, `0030`, `0031`, `0040`, `0087`, `0088`, `0122`, `0127`, 21
  líneas) — **append-only**. Una migración es el registro de lo que se aplicó ese día, no la verdad del
  estado actual; editarla in-place es exactamente lo que `0088` prohíbe por escrito. La verdad del estado
  actual vive en `0132` + las specs. Consecuencia asumida: `git grep -n "rafaq\.is_"` **no da cero**.
- **`feature_list.json:187`** — el `notes` de la feature 11 dice *"migraciones 0088 (delta trigger
  animal_events GUC rafaq.is_transfer) … APLICADAS"*. Es un **log histórico** de un evento que fue cierto
  cuando se escribió, de la misma clase que `progress/` y que los mensajes de commit. Además es un
  archivo de coordinación compartido con la otra terminal. Se deja.
- **`progress/`** — instrucción explícita del leader (y decisión del plan: es historial).
- **Headers `X-Rafaq-*` / `x-rafaq-*`** (fase 5), **`rafaq-app` / `rafaqsorg` / `scheme: 'rafq'`**
  (fase 6, pospuesta), **`RAFAQ_ENV`** y demás env vars, **`rafaq.db`**, **`@rafaq-test.local`**.
  Verificado que siguen intactos: `audit.resolve_actor` y `audit.resolve_request_id` no las tocó `0132`.

### Dónde queda `rafaq.is_` después de la fase (26 líneas, todas correctas)

| Dónde | Por qué está bien |
|---|---|
| 8 migraciones históricas (21) | append-only |
| `progress/*` (15) | historial, instrucción explícita |
| `docs/rebrand-mitropero-plan.md` (7) | describe el estado previo y la corrección |
| `docs/marketing/plan-toma-de-marca-mitropero.md` (2) | la nota de corrección nombra el nombre viejo |
| `specs/…` (5) | son **las notas de reconciliación**: *"se llamaba `rafaq.is_x`, hoy es `mitropero.is_x`"* |
| `feature_list.json` (1) | log histórico |
| `supabase/migrations/0132…sql` (1, untracked al grep) | la línea 2, que dice qué renombra |

---

## 9. Hallazgo: `reason = 'transfer_in'` es una rama muerta (NO lo causó el rebrand)

Apareció al traer el cuerpo vigente de `transfer_animal` del remoto. En `0122`, el
`set_config('…is_transfer','on',true)` está **después** del `insert into public.animal_profiles` del
perfil destino:

```
  insert into public.animal_profiles (...)          ← acá corre animal_profiles_record_rodeo_change_ins
  ...
  perform set_config('…is_transfer', 'on',  true);  ← la GUC se prende recién acá
  update public.animal_events ...
  perform set_config('…is_transfer', 'off', true);
```

y ese trigger es `AFTER INSERT ... FOR EACH ROW` **no deferrable** (verificado en el catálogo:
`tgdeferrable = false`, `tginitdeferred = false`), así que corre con la GUC apagada → el alta del perfil
destino se registra como `initial`, **nunca** como `transfer_in`.

Corroboración empírica en DEV: `select reason, count(*) from rodeo_membership_history group by reason`
→ `initial 427` · `backfill 6009` · **cero `transfer_in`**, después de todas las corridas de la suite de
transferencia que vio esta base.

Ya estaba señalado como *ausencia de código* en `progress/review_campanas-congeladas.md` (RCC.1.13: la
rama no la ejercita ningún test) — por eso nunca se puso nada rojo.

**Esta fase NO lo arregló, a propósito**: es un rename puro y el fix cambia comportamiento (además
ensancharía la ventana del early-return de `animal_events`, que hay que analizar aparte). Queda anotado
en `docs/backlog.md` con el fix propuesto y la falsificación que ese fix va a necesitar, y en
`specs/active/07-reportes-basicos/design-campanas-congeladas.md` para que la spec no siga prometiendo
un `reason` que no se escribe.

---

## 10. Autorrevisión adversarial

Qué busqué, qué encontré, cómo lo cerré.

| Busqué | Resultado |
|---|---|
| **¿El inventario está completo?** ¿Hay una GUC `rafaq.*` en un lugar que el grep de migraciones no ve? | Barrí el **catálogo** (8 clases de objeto, no sólo `pg_proc`). Todo lo no-función: vacío. Y `0132` lleva un **guard que se escribe sobre la ausencia** y aborta si queda alguna. Falsificado (§7.4). |
| **¿Moldeé sobre la migración vieja en vez del remoto?** | No: `pg_get_functiondef` contra DEV. Y lo verifiqué al revés — el diff antes/después es **exactamente** el rename (§6.3), así que no revertí `0122`, `0040` ni `0127`. |
| **¿`DROP`+`CREATE` en algún lado?** (tiraría ACLs, COMMENTs y los triggers en cascada) | No. Sólo `CREATE OR REPLACE`. ACLs verificadas idénticas antes/después; los 6 triggers siguen ligados. |
| **¿Se me escapó una punta en el cliente / EFs?** | `git grep -nE "set_config\|current_setting" -- app supabase/functions` → 0. Y `git grep -n "is_transfer\|is_auto_transition"` fuera de `supabase/migrations`, `specs`, `docs`, `progress` → **0**. No hay ninguna otra punta. |
| **¿Los tests pasan por la razón equivocada?** | Falsificado: mutante de desalineación → 122/139, dos clusters con el mecanismo exacto en la aserción (§7). Los tests **sí** ejercen el mecanismo. |
| **¿Algún read site queda sin cubrir?** | **Sí, uno**: el `transfer_in` de `0127`. Y no es un agujero de tests solamente — la rama está **muerta** (§9). Documentado, no arreglado (fuera de scope). |
| **¿La migración es idempotente / re-aplicable?** | Sí, probado: se aplicó **dos veces** (deploy + restauración post-mutante), HTTP 201 las dos. |
| **¿Corre en una base desde cero?** | Razonado, **no verificado empíricamente** (no hay base limpia a mano): `apply-all-migrations.mjs` ordena por número, así que `0132` corre última; las 6 funciones existen desde `0127`; el guard converge. |
| **Multi-tenant / fail-closed / `search_path` / `revoke execute`** | Sin cambios: es un rename. `search_path` preservado tal cual (las 4 `SECURITY DEFINER` lo tienen; las 2 trigger functions no-definer nunca lo tuvieron y no referencian objetos calificables → no hay superficie de shadowing). `apply_auto_transition` sigue revocada (`0042`/`0065`), re-emitida en `0132` y verificada en el ACL + por los tests T2.18 / RT2.12.2. |
| **Offline-first / PowerSync** | No aplica: no cambia esquema, ni tablas, ni sync rules. No fuerza re-sync. |
| **Drift DEV↔PROD** | **PROD queda en `rafaq.is_*`** — y eso es **seguro**, porque el rename es atómico *por ambiente*: PROD sigue internamente consistente (las 6 funciones con el nombre viejo). No hay acoplamiento cruzado: una GUC es estado de sesión de una base. `0132` se aplica a PROD cuando se autorice. |
| **Ventana de concurrencia del deploy** | Las 6 en una transacción; el catálogo se lee con catalog snapshot fresco, así que ninguna sesión puede ver "setter nuevo + lector viejo". Además DEV no tiene tráfico. |

### Lo que dejé afuera a propósito

- **Un guard permanente de repo** ("ninguna migración > 0132 puede introducir una GUC `rafaq.*`"). Lo
  pensé y lo descarté por scope: esta fase es un rename mecánico. El guard de `0132` cubre el camino
  desde-cero; el riesgo residual (alguien escribe `0133` con el nombre viejo) es bajo ahora que todo el
  árbol dice `mitropero`. **Recomendado para cuando se cierre la fase 5**, que toca la misma clase de
  identificador.
- **Arreglar `transfer_in`** (§9) — cambia comportamiento.
- **`app/e2e/captures/`** — **N/A**: esta fase es backend puro, no toca ni una pantalla.

### Confound a declarar

`check.mjs` y `typecheck` corrieron sobre un árbol que **también** tiene los cambios sin commitear de la
otra terminal (`app/src/services/ble/*` — 8 archivos, `app/app/baston-test.tsx`, spec 04). Dieron el
número esperado (`3115 / 1`, el rojo conocido), así que no ocultan nada, pero el resultado **no es
atribuible sólo a esta fase**. Las 6 suites de backend sí lo son (no tocan BLE).

