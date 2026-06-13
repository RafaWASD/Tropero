# Spec 11 — Transferencia de animal entre campos (re-parenting de historia) — Design

**Status**: `spec_ready` (2026-06-12, sesión 23). Pendiente Gate 1 + Puerta 1.
**Fuente de verdad**: `context.md` (Gate 0). Apoyado en `docs/architecture.md`, `docs/conventions.md`, ADR-004 (multi-tenancy), ADR-026 (denormalización PowerSync).
**No reabre**: el modelo de datos de spec 02 (las tablas, RLS, triggers ya están as-built). Este design **agrega** un RPC `SECURITY DEFINER` (`transfer_animal`) + la pieza de cliente en el find-or-create de spec 09.

> El SQL de este documento es **especificación de diseño firme** del RPC. Lo escribe el implementer (archivo `.sql`) + sus tests; el modelado (firma, orden de operaciones, controles de seguridad) queda cerrado acá. El leader aplica la migración por Management API tras gatearla (Gate 1 + Gate 2 + reviewer). NO `supabase db push`.

---

## 1. Resumen de la solución

Una **única RPC atómica** `public.transfer_animal(...)` `SECURITY DEFINER` que, en **una transacción**:
1. re-valida rol activo en **ambos** establecimientos (origen X derivado de la fila real del perfil de origen; destino Y del parámetro);
2. crea el `animal_profile` nuevo en Y (reusando el `animal_id` global);
3. re-apunta TODA la historia del perfil viejo al nuevo (5 tablas tipadas + `animal_events` + `animal_category_history` + `birth_calves` + vínculos `calf_id`/`bull_id`), **actualizando el `establishment_id` denormalizado** de las hijas y **nullando `session_id`**;
4. archiva el perfil viejo (`status='transferred'`, `exit_reason='transfer'`).

La RPC sigue el molde as-built de `import_rodeo_bulk` (`0074`) y `create_animal` (`0083`): atomicidad server-side, `SECURITY DEFINER` + `search_path` fijo, **authz primero**, derivación de tenant de la **fila real** (nunca del payload), idempotencia por id de cliente, `revoke/grant` con firma tipada + `notify pgrst`.

```
┌─────────────── Cliente (RN/Expo, spec 09 find-or-create D2) ──────────────┐
│ find-or-create resuelve un TAG → animal activo en campo X (rol en X y Y)   │
│   → ofrece "Transferir a este campo" (R1.1) → preview (R1.3)               │
│   → genera p_target_profile_id (UUID cliente, idempotencia)               │
│   → services/animals.ts: transferAnimal(input)  [ONLINE-only, R7.1]       │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │ supabase.rpc('transfer_animal', {...})
                                 ▼
┌──────────────── Supabase — RPC transfer_animal (SECURITY DEFINER) ────────┐
│ (a) authz: has_role_in(X) AND has_role_in(Y)   ← X de la fila real        │
│ (b) idempotencia: ¿perfil target ya existe? → no-op + return              │
│ (c) crea animal_profile nuevo en Y  (triggers 0079/0084/0085/0043 fuerzan)│
│ (d) re-apunta historia (UPDATE ... SET animal_profile_id=new,             │
│       establishment_id=Y, session_id=NULL)                                │
│ (e) re-apunta vínculos calf_id/bull_id de OTROS eventos                   │
│ (f) archiva perfil viejo (status='transferred')                           │
│   TODO en UNA transacción → rollback total si algo falla (R4.3)           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Archivos a crear / modificar

| Archivo | Acción | Qué |
|---|---|---|
| `supabase/migrations/00NN_transfer_animal_rpc.sql` | **crear** | RPC `transfer_animal` + `revoke`/`grant` + smoke-check + `notify`. Número `00NN` = siguiente libre (as-built llega a `0086` → `0087`, confirmar al implementar). |
| `supabase/tests/animal/run.cjs` | **modificar** | suite `transfer_animal RPC` (camino feliz + los tests de seguridad/atomicidad de §7). Enganchar en `scripts/run-tests.mjs` si hace falta. |
| `app/src/services/animals.ts` | **modificar** | `transferAnimal(input): Promise<ServiceResult<...>>` → `supabase.rpc('transfer_animal', {...})`. ONLINE-only (no PowerSync upsert/outbox). |
| `app/src/features/animals/` (find-or-create, spec 09) | **modificar (TENTATIVO)** | punto de entrada D2 + preview de confirmación. **Deferred** hasta que el frontend de spec 09 exista; se reconcilia ahí (R1.x tentativas). |

> **No se crean tablas nuevas.** No hay entidad `movements`/historial de transferencias en MVP (fuera de Gate 0). El rastro en X es el perfil archivado (`status='transferred'`).

---

## 3. El RPC `transfer_animal` — contrato firme

### 3.1 Firma + parámetros (con id de cliente para idempotencia)

```sql
-- 00NN_transfer_animal_rpc.sql  (spec 11 — R2..R6, Gate 1)
create or replace function public.transfer_animal (
  p_source_profile_id   uuid,   -- perfil ACTIVO del animal en el campo de ORIGEN X (lo conoce el cliente)
  p_target_establishment_id uuid,   -- campo DESTINO Y (el establishment activo del cliente)
  p_target_rodeo_id     uuid,   -- rodeo destino en Y (mismo sistema; R1.5/R2.2)
  p_target_profile_id   uuid,   -- id del PERFIL NUEVO, generado por el CLIENTE → idempotencia (R6.2)
  p_target_category_id  uuid    -- categoría inicial en Y (cliente la resuelve por el system destino; TODO-D2)
) returns jsonb                 -- { "target_profile_id": uuid, "idv_dropped": bool, "source_profile_id": uuid }
language plpgsql security definer
set search_path = public as $$
declare
  v_source_est    uuid;
  v_animal_id     uuid;
  v_source_idv    text;
  v_source_created_by uuid;  -- HIGH-1 (Gate 1): authz de baja owner-or-creator en X
  v_source_visual_id text;   -- R2.12.a: campos del animal que VIAJAN
  v_source_breed  text;
  v_source_coat   text;
  v_source_rodeo_system uuid;
  v_target_rodeo_system uuid;
  v_idv_to_use    text;
  v_idv_dropped   boolean := false;
  v_now           timestamptz := now();
begin
  ...
end; $$;
```

> **Nota de diseño**: el RPC NO recibe `establishment_id` de origen ni `animal_id` como parámetro: ambos se derivan de la **fila real** del perfil de origen (anti-IDOR / anti-cross-tenant — el bug de `apply_auto_transition` SEC-HIGH-01). El cliente solo conoce `p_source_profile_id` (que ya vio vía RLS porque tiene rol en X) y los datos de destino. `p_target_category_id` lo resuelve el cliente con el catálogo del system destino (mismo patrón que el alta CREATE de spec 09); el trigger `tg_animal_profiles_category_check` (`0020`) lo re-valida server-side contra el system del rodeo destino.

### 3.2 Cuerpo — orden de operaciones (load-bearing para los invariantes)

El **orden** es parte del contrato (garantiza R4.2 — nunca cero ni dos perfiles activos — y R4.3 — atomicidad):

> **Reconciliación as-built (implementer, sesión 23 — migraciones `0087` + `0088`):** dos divergencias menores vs el SQL ilustrativo de abajo, sin cambio de comportamiento ni de contrato:
> 1. **`rodeo_id` del origen se lee en el SELECT (a)** (junto a `establishment_id`/`animal_id`/`created_by`/`idv`/descriptivos), no en un SELECT separado en (b) como muestra el pseudocódigo. Es la misma fila real del perfil de origen (active) → idéntica semántica, una query menos. El `v_source_rodeo_system` se resuelve en (b) desde ese `rodeo_id`.
> 2. **El delta del trigger de `animal_events` (§4.3 / DEC-A1) vive en una migración separada `0088`** (`CREATE OR REPLACE` de `tg_animal_events_enforce_edit_window` con el early-return por GUC), no embebido en el `0087` del RPC. Append-only: NO se edita `0034` in-place. El RPC (`0087`) hace `set_config('rafaq.is_transfer','on',true)` antes del UPDATE de `animal_events` y `'off'` después. Reconciliado en `specs/active/02-modelo-animal/design.md` (T5.1).

```sql
-- (0) IDEMPOTENCIA PRIMERO (R6.1/R6.2 — FIX Gate-1 HIGH-2): el corte de replay va ANTES del select de origen
--   con status='active'. Tras la 1ª transferencia el origen queda 'transferred', así que un select active-only
--   dispararía 23503 en el reintento por ACK perdido → devolvería error en vez del resultado ya aplicado. El
--   corte por el p_target_profile_id de cliente (UUID estable entre reintentos) debe ir al inicio. Molde
--   create_animal (0083, a-bis al comienzo). Sin efectos → seguro sin authz previa (el id lo generó el cliente,
--   no se filtra nada). Si el perfil target ya existe en Y → la op ya corrió → no-op + return.
if exists (
  select 1 from public.animal_profiles
  where id = p_target_profile_id and establishment_id = p_target_establishment_id
) then
  return jsonb_build_object('target_profile_id', p_target_profile_id, 'idv_dropped', false,
                            'source_profile_id', p_source_profile_id, 'replay', true);
end if;

-- (a) DERIVAR origen de la FILA REAL (incluye created_by para la authz de baja + los descriptivos que VIAJAN
--   R2.12.a: visual_id_alt/breed/coat_color) — ANTES de cualquier escritura.
select establishment_id, animal_id, created_by, idv, visual_id_alt, breed, coat_color
  into v_source_est, v_animal_id, v_source_created_by, v_source_idv, v_source_visual_id, v_source_breed, v_source_coat
from public.animal_profiles
where id = p_source_profile_id
  and status = 'active'
  and deleted_at is null;
if v_source_est is null then
  raise exception 'source profile not found, not active, or already transferred' using errcode = '23503';  -- R5.6
end if;

-- AUTHZ ASIMÉTRICA (FIX Gate-1 HIGH-1): la transferencia ARCHIVA el perfil de X (status='transferred') = es una
--   BAJA. El lado ORIGEN X se alinea con el gate de baja as-built (exit_animal_profile 0044 / SEC-SPEC-01):
--   OWNER-OR-CREATOR en X (un field_operator no puede sacarle un animal a otro owner). El lado DESTINO Y =
--   cualquier rol activo (es un CREATE, como el alta). [TODO-D7: Raf confirma esta política.]
if not public.has_role_in(p_target_establishment_id) then
  raise exception 'not authorized in target establishment (need active role in Y)' using errcode = '42501';  -- R5.3
end if;
-- PARIDAD EXACTA con el gate de baja exit_animal_profile (0044 / SEC-SPEC-01): has_role_in(X) es OBLIGATORIO
--   ADEMÁS del owner-or-creator. Sin el has_role_in(X), el path created_by=auth.uid() (que NO chequea rol activo)
--   dejaría a un EX-creador revocado de X (active=false) que conserva rol en Y sacar el animal de X = reabre SEC-SPEC-01.
if not (public.has_role_in(v_source_est)
        and (public.is_owner_of(v_source_est) or v_source_created_by = auth.uid())) then
  raise exception 'not authorized to remove the animal from the source field (need active role in X AND owner-or-creator)'
    using errcode = '42501';  -- R5.2
end if;

-- guard: no transferir a sí mismo (origen == destino no tiene sentido).
if v_source_est = p_target_establishment_id then
  raise exception 'source and target establishment are the same' using errcode = '23514';
end if;

-- (b) MISMO SISTEMA (R1.6/R2.2): el rodeo destino debe tener el mismo system_id que el de origen.
select r.system_id into v_source_rodeo_system from public.rodeos r where r.id = (
  select rodeo_id from public.animal_profiles where id = p_source_profile_id);
select r.system_id into v_target_rodeo_system from public.rodeos r
  where r.id = p_target_rodeo_id and r.establishment_id = p_target_establishment_id
    and r.active = true and r.deleted_at is null;
if v_target_rodeo_system is null then
  raise exception 'target rodeo not found / inactive / not in target establishment' using errcode = '23514';
end if;
if v_target_rodeo_system is distinct from v_source_rodeo_system then
  raise exception 'target rodeo belongs to a different productive system (R4.5.1)' using errcode = '23514';  -- R1.6
end if;

-- (c) RESOLVER idv: conservar si no colisiona en Y; si colisiona → NULL + flag (R2.4/R2.5).
v_idv_to_use := nullif(trim(coalesce(v_source_idv, '')), '');
if v_idv_to_use is not null and exists (
  select 1 from public.animal_profiles ap
  where ap.establishment_id = p_target_establishment_id
    and ap.idv = v_idv_to_use
    and ap.deleted_at is null
) then
  v_idv_to_use := null;
  v_idv_dropped := true;
end if;

-- (d) ARCHIVAR EL PERFIL VIEJO PRIMERO (libera el unique parcial de "perfil activo por animal", R4.2).
--   status='transferred' + exit_reason='transfer' + exit_date. NO soft-delete (deleted_at queda NULL → rastro en X, R4.1).
--   Hacerlo ANTES de crear el nuevo evita el choque con animal_profiles_active_animal_unique (dos activos).
update public.animal_profiles
   set status = 'transferred', exit_reason = 'transfer'::public.exit_reason_enum, exit_date = v_now::date
 where id = p_source_profile_id;

-- (e) CREAR EL PERFIL NUEVO EN Y con el id de CLIENTE (idempotencia). status='active'.
--   created_by lo FUERZA 0043 (auth.uid()); identidad animal_* la FUERZA 0079; is_castrated lo FUERZA 0084
--   (copia de animals → preserva, R2.7); future_bull arranca false por default de columna (0085, R2.8).
--   management_group_id = NULL (R2.3). category_override = false (R2.9 / TODO-D2).
--   Campos descriptivos (R2.12, ver §4.7): VIAJAN los del animal (visual_id_alt/breed/coat_color, leídos
--   del perfil viejo en §3.2(a)); SE RESETEAN los de la relación con el campo (entry_date=hoy, entry_origin
--   marcador-de-transferencia-o-NULL, entry_weight=NULL, notes=NULL — la "entrada" a Y es la transferencia).
insert into public.animal_profiles (
  id, animal_id, establishment_id, rodeo_id, category_id, category_override, status,
  idv, management_group_id,
  visual_id_alt, breed, coat_color,            -- (a) del animal → viajan (R2.12.a)
  entry_date, entry_origin, entry_weight, notes -- (b) de la relación con el campo → reset (R2.12.b)
) values (
  p_target_profile_id, v_animal_id, p_target_establishment_id, p_target_rodeo_id, p_target_category_id,
  false, 'active', v_idv_to_use, null,
  v_source_visual_id, v_source_breed, v_source_coat,
  v_now::date, null /* o 'transfer' si el dominio lo soporta — TODO-D6 */, null, null
);

-- (f) RE-APUNTAR LA HISTORIA del perfil viejo → nuevo, con establishment_id=Y + session_id=NULL (R3.x).
--   Las 5 tablas tipadas: animal_profile_id, establishment_id (denorm 0077) y session_id en un solo UPDATE.
update public.weight_events
   set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
 where animal_profile_id = p_source_profile_id;
update public.reproductive_events
   set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
 where animal_profile_id = p_source_profile_id;
update public.sanitary_events
   set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
 where animal_profile_id = p_source_profile_id;
update public.condition_score_events
   set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
 where animal_profile_id = p_source_profile_id;
update public.lab_samples
   set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id, session_id = null
 where animal_profile_id = p_source_profile_id;

-- animal_events (observaciones): establishment_id PROPIO (0034), sin session_id. Ver §4.3 (trigger inmutabilidad).
update public.animal_events
   set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id
 where animal_profile_id = p_source_profile_id;

-- animal_category_history: animal_profile_id + establishment_id denorm (0077).
update public.animal_category_history
   set animal_profile_id = p_target_profile_id, establishment_id = p_target_establishment_id
 where animal_profile_id = p_source_profile_id;

-- birth_calves del animal transferido como TERNERO (su calf_profile_id apuntaba al perfil viejo): re-apuntar
--   calf_profile_id + establishment_id denorm (0078). [El establishment_id de birth_calves deriva de la MADRE;
--   ver §4.4 — si la madre quedó en X, esta fila puede necesitar conservar el est de la madre, no el del ternero.]
update public.birth_calves
   set calf_profile_id = p_target_profile_id
 where calf_profile_id = p_source_profile_id;

-- (g) VÍNCULOS REPRODUCTIVOS de OTROS animales que referencian al transferido como madre/toro (R3.4):
--   estos eventos NO son del perfil viejo (son de su descendencia, que queda en X) → solo se re-apunta el
--   PUNTERO calf_id/bull_id, NO el animal_profile_id ni el establishment_id del evento (el evento sigue en X).
update public.reproductive_events set bull_id = p_target_profile_id where bull_id = p_source_profile_id;
update public.reproductive_events set calf_id = p_target_profile_id where calf_id = p_source_profile_id;

return jsonb_build_object('target_profile_id', p_target_profile_id, 'idv_dropped', v_idv_dropped,
                          'source_profile_id', p_source_profile_id, 'replay', false);
```

### 3.3 Cierre de la superficie RPC (R5.5)

```sql
revoke execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) from public, anon;
grant  execute on function public.transfer_animal (uuid, uuid, uuid, uuid, uuid) to authenticated;

-- Smoke-check fail-closed (estilo 0074): si quedara EXECUTE-able por anon/public, FALLA.
do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public' and p.proname = 'transfer_animal'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: transfer_animal is EXECUTE-able by %', v_bad.rolname;
  end loop;
end$$;

notify pgrst, 'reload schema';
```

---

## 4. Puntos de diseño que el as-built obliga (RECON + descubrimientos)

### 4.1 `establishment_id` denormalizado en las 7 tablas hijas (RECON-1, R3.6) — load-bearing para Gate 1

Las streams de PowerSync filtran `WHERE establishment_id IN org_scope` **sin JOINs** (ADR-026). Si el re-parenting deja el `establishment_id` denormalizado viejo (X) en una fila re-apuntada, esa fila **sigue en el sync set de X** aunque su perfil ya esté en Y → **fuga cross-tenant por el WAL**. Por eso cada UPDATE de re-parenting en §3.2(f) setea `establishment_id = p_target_establishment_id` explícito.

**Interacción con los triggers force (0077/0078):** las 5 tablas tipadas y `animal_category_history` tienen `tg_force_establishment_id_from_profile` en **BEFORE INSERT OR UPDATE**, que **re-deriva `establishment_id` desde `animal_profiles.establishment_id` del `NEW.animal_profile_id`**. Como el UPDATE de §3.2(f) setea `animal_profile_id = p_target_profile_id` (que ya está en Y) **en el mismo UPDATE**, el trigger force re-deriva el establishment **correcto (Y)** automáticamente — el `set establishment_id = ...` explícito y el trigger **convergen al mismo valor** (Y). El valor explícito es defensivo/documental; el trigger garantiza fidelidad pase lo que pase. **Verificación para el implementer**: el orden de operaciones importa — el perfil nuevo (en Y) debe existir **antes** de re-apuntar las hijas (§3.2(e) antes de (f)), o el trigger force fallaría al resolver `animal_profiles WHERE id = p_target_profile_id`.

`birth_calves` (0078) tiene el force **solo en BEFORE INSERT** (su establishment deriva de la cadena parto→madre, no del `calf_profile_id`). Ver §4.4.

### 4.2 Identidad denormalizada (RECON-2, R2.6) — se hereda sola

`0079` fuerza `animal_tag_electronic`/`animal_sex`/`animal_birth_date` en el INSERT del perfil nuevo desde `animals WHERE id = animal_id`. Como el perfil nuevo reusa el `animal_id` global, queda **idéntica** a X. El RPC **no setea** estas columnas (§3.2(e) no las incluye) — el trigger las pisa igual. Cero riesgo de inconsistencia.

### 4.3 `animal_events` tiene `establishment_id` propio + triggers de inmutabilidad — DESCUBRIMIENTO crítico (R3.7)

`animal_events` (`0034`) **no** está en la denormalización de 0077 (ya tenía `establishment_id` propio). Tiene dos triggers que afectan el re-parenting:
- `tg_animal_events_validate_est` (**BEFORE INSERT only**): valida `establishment_id == animal_profiles.establishment_id`. No corre en UPDATE → no estorba.
- `tg_animal_events_enforce_edit_window` (**BEFORE UPDATE**): **declara `animal_profile_id` y `establishment_id` INMUTABLES** y hace `raise exception` si cualquiera cambia en un UPDATE.

⚠️ **Esto BLOQUEA el re-apuntado de `animal_events` por un UPDATE normal.** El UPDATE de §3.2(f) que cambia `animal_profile_id` **y** `establishment_id` dispararía `'immutable column changed on animal_event'`.

**Resolución (a decidir con el implementer + Gate 1 — DEC-A1):** la opción recomendada es que el trigger `tg_animal_events_enforce_edit_window` **tolere el contexto de transferencia**: el RPC `transfer_animal` (SECURITY DEFINER) setea una GUC local `set_config('rafaq.is_transfer','on',true)` antes de los UPDATE de re-parenting, y el trigger hace `return new` temprano cuando esa GUC está `'on'` (mismo patrón que `rafaq.is_auto_transition` de `0020`). Así el re-apuntado del RPC pasa, pero un UPDATE de cliente directo a PostgREST **sigue** rechazado (la GUC solo la setea el definer). **Alternativa descartada** (§6): dejar `establishment_id`/`animal_profile_id` mutables en el trigger — abre el vector de spoofeo que ese trigger justamente cierra.

> Esto es un **delta pequeño sobre la migración `0034` de spec 02** (extender el trigger con el early-return por GUC). Se reconcilia en el `design.md` de spec 02 al cerrar la feature 11 (regla de reconciliación de specs). Marcado para Gate 1.

### 4.4 `birth_calves` — el animal transferido como TERNERO vs como MADRE (R3.5)

`birth_calves(birth_event_id, calf_profile_id)` con `establishment_id` denormalizado que **deriva de la madre** (cadena `birth_event → reproductive_events.animal_profile_id → animal_profiles.establishment_id`), forzado **solo en INSERT** (0078). Dos casos al transferir el animal A:

1. **A es el TERNERO de un parto** (su `calf_profile_id` apunta al perfil viejo de A): se re-apunta `calf_profile_id = p_target_profile_id` (§3.2(f)). El `establishment_id` denormalizado de esta fila deriva de la **madre**:
   - Si la **madre también está en X** (no se transfiere): el `establishment_id` de la fila `birth_calves` **debe seguir siendo el de la madre (X)** — es la fila del parto de la madre, que vive en X. Como el force es solo-INSERT, el UPDATE de `calf_profile_id` **no** toca `establishment_id` → queda en X. **Correcto** (la relación parto-madre sigue en X; el ternero ahora vive en Y pero su registro de nacimiento pertenece al parto de la madre en X).
   - **DEC-A2 (Gate 1)**: confirmar que dejar `birth_calves.establishment_id` en X (el de la madre) es lo deseado, o si esa fila debe entrar al sync set de Y. Recomendación: **dejarla en X** (es dato del parto de la madre); el ternero en Y la referencia vía su `animal_id` global cuando se navega "ternero → su parto", mismo patrón que el linaje cruzado (R8.1).

2. **A es la MADRE de un parto** (un `reproductive_events` de A con `event_type='birth'`, y filas `birth_calves` de ese evento): el evento de parto es del perfil viejo de A → se re-apunta en §3.2(f) (las 5 tipadas, `reproductive_events` incluida) con `establishment_id = Y`. Las filas `birth_calves` de ese parto tienen `birth_event_id` apuntando a ese evento (ahora en Y) pero su `establishment_id` denormalizado quedó en X. **DEC-A3 (Gate 1)**: el RPC **debe** actualizar `birth_calves.establishment_id = Y` para las filas cuyo `birth_event_id` pertenece a los eventos re-apuntados de A (la madre se fue a Y → su parto y los terneros de ese parto, como registro, lo siguen). Los terneros mismos (sus perfiles) **quedan en X** (linaje cruzado, R8.1) — se re-apunta el `establishment_id` de la **fila puente** (que sigue a la madre), no el perfil del ternero. Esto **no** está en el §3.2(f) de arriba todavía — agregar:

```sql
-- birth_calves de partos DONDE A ES LA MADRE (el evento de parto se re-apuntó a Y): seguir el establishment a Y.
update public.birth_calves bc
   set establishment_id = p_target_establishment_id
 where bc.birth_event_id in (
   select id from public.reproductive_events
   where animal_profile_id = p_target_profile_id and event_type = 'birth'
 );
```

> Como el force de `birth_calves` es solo-INSERT, este UPDATE explícito es la **única** vía de mantener fiel su `establishment_id` tras re-parentear el parto de la madre. **Gate 1 debe verificar** que ninguna fila `birth_calves` queda con `establishment_id` apuntando a un campo que ya no corresponde (ni X huérfano ni Y indebido).

### 4.5 `session_id` → NULL (R3.8)

Las 5 tablas tipadas tienen `session_id` (FK lógica a `sessions` de spec 03, MODO MANIOBRAS del campo X). Conservarlo deja un puntero a una sesión cross-tenant inaccesible por RLS. El RPC lo nulea en el mismo UPDATE (§3.2(f)). `animal_events` y `animal_category_history` y `birth_calves` **no** tienen `session_id` → no aplica.

### 4.6 `category_id` / `category_override` del perfil nuevo (R2.9, TODO-D2)

El cliente provee `p_target_category_id` resuelto contra el catálogo del system destino (igual que el alta CREATE de spec 09). El trigger `tg_animal_profiles_category_check` (`0020`) lo re-valida server-side (debe pertenecer al system del rodeo destino) → un valor inválido aborta el RPC (rollback total, R4.3). `category_override = false`: el recompute on-event/cron (Tier 2, `0059+`) ajusta la categoría según los hechos biológicos re-apuntados (partos, servicio, castración) que ahora cuelgan del perfil nuevo. **DEC para Raf (TODO-D2)**: confirmar default = misma categoría que en X (mismo sistema → siempre válida) vs recompute explícito en el RPC.

---

### 4.7 Campos descriptivos del perfil — qué viaja y qué se resetea (R2.12, gap del Gate 0 — DEC-A4/TODO-D6)

El `context.md` (Gate 0) solo decidió `idv` (conservar-o-NULL, §3.2(c)) y `management_group_id` (→NULL). Pero `animal_profiles` tiene **7 campos descriptivos más** que el re-parenting silenciosamente dropearía si no se tratan: `visual_id_alt`, `breed`, `coat_color`, `notes`, `entry_origin`, `entry_date`, `entry_weight`. El leader cazó este gap en el review pre-Gate-1. **Partición (default propuesto):**

| Campo | Clase | Acción al transferir | Por qué |
|---|---|---|---|
| `visual_id_alt` | del animal | **viaja** | identificador visual del animal (caravana visual), no de la relación con el campo |
| `breed` | del animal | **viaja** | la raza es del animal (hoy texto en el perfil; spec 08 la mueve a catálogo) |
| `coat_color` | del animal | **viaja** | pelaje del animal |
| `entry_date` | relación con el campo | **reset** → fecha de la transferencia | la "entrada" del animal a Y **es** la transferencia |
| `entry_origin` | relación con el campo | **reset** → marcador de transferencia (o NULL) | el animal no "entró comprado/nacido" a Y, entró por transferencia |
| `entry_weight` | relación con el campo | **reset** → NULL | peso de entrada a X, no aplica a Y (el último peso real vive en `weight_events`, que viajan) |
| `notes` | relación con el campo | **reset** → NULL | notas operativas de X; la historia real viaja en los eventos |

`visual_id_alt` **no** tiene unique por establecimiento hoy (solo `idv` lo tiene, R4.3 spec 02) → viaja tal cual sin chequeo de colisión; si en el futuro se le agrega unicidad, aplicaría la misma resolución que `idv` (R2.4). **DEC-A4/TODO-D6 (Puerta 1)**: confirmar la partición — en particular si `notes` debería viajar y si `entry_weight` debería tomar el último peso conocido del animal en vez de NULL.

---

## 5. RLS / multi-tenancy (explícito — feature toca multi-tenancy)

> **Multi-tenancy desde día 1** (CLAUDE.md principio 6). Esta feature hace **write cross-tenant** → la frontera de RLS es central.

- **El RPC es `SECURITY DEFINER`** → bypassa RLS por dentro. La barrera de autorización **no** es la RLS sino el `has_role_in(X) AND (is_owner_of(X) OR created_by=auth.uid()) AND has_role_in(Y)` de §3.2(a), derivando X (y `created_by`) de la fila real (R5.1–R5.4). Asimétrico a propósito (HIGH-1): el lado X es una **baja** (rol activo + owner-or-creator, **paridad exacta** con `exit_animal_profile`), el lado Y es un **alta** (rol activo, como `create_animal`). Mismo molde de definer que `register_birth`/`exit_animal_profile`/`import_rodeo_bulk`.
- **Ninguna policy/grant/trigger existente se modifica** (salvo el delta del trigger de `animal_events` de §4.3, que es un early-return por GUC, no relaja la RLS para clientes). Las RLS as-built de las 7 tablas hijas siguen derivando el tenant por FK/cadena — la columna `establishment_id` denormalizada que el RPC actualiza es **solo para el wire de sync** (ADR-026), no para la RLS de Postgres.
- **Aislamiento del wire de sync (la pieza nueva de riesgo):** tras la transferencia, cada fila re-apuntada debe tener su `establishment_id` denormalizado en **Y** (R3.6) para salir del sync set de X y entrar al de Y. Gate 1 verifica que **ninguna** fila quede con el `establishment_id` viejo (fuga) ni con uno indebido.
- **Lectura del perfil de origen por el cliente**: el cliente solo puede pasar un `p_source_profile_id` que **ya vio** vía RLS (tiene rol en X). Un caller sin rol en X ni siquiera ve el perfil → no puede iniciar (R1.2/R5.2). El RPC re-valida igual (defensa en profundidad: el client-side gating no es la barrera).

---

## 6. Alternativa descartada (mínimo una, con su porqué)

**Alternativa: transferencia "mínima" (perfil nuevo limpio + perfil viejo huérfano, sin re-parenting).**
Crear el `animal_profile` nuevo en Y vacío y dejar la historia colgando del perfil viejo archivado en X, sin re-apuntar nada. Mucho más simple (un INSERT + un UPDATE de status, sin RPC masivo ni el delta de `animal_events`).
**Descartada** (decisión Raf, Gate 0): deja al animal **sin historial visible en Y**, lo que es inaceptable con **analytics como pilar** (CLAUDE.md). El productor de Y vería un animal "recién nacido" sin pesadas, sanidad ni reproducción — pierde todo el valor de traer un animal con trazabilidad. El re-parenting es el costo de cumplir el pilar.

**Alternativa secundaria descartada: Edge Function (Deno) en vez de RPC Postgres.**
Una Edge Function con `service_role` podría orquestar la transferencia. **Descartada**: la operación es **puro SQL transaccional** (sin I/O externo, sin lógica que no se exprese en plpgsql), y el patrón as-built de RAFAQ para escrituras atómicas multi-tabla con re-validación de rol es la **RPC `SECURITY DEFINER`** (`0074`/`0083`/`register_birth`/`exit_animal_profile`). Una Edge Function agregaría una superficie (`service_role` que bypassa TODA la RLS, deploy aparte, latencia HTTP extra) sin ganar atomicidad (la RPC ya la da nativa). Las Edge Functions de RAFAQ se reservan para lo que **no** se expresa limpio en RLS/SQL (invitaciones por email, integraciones externas — `architecture.md`).

---

## 7. Superficie de seguridad para Gate 1 (write cross-tenant — checklist)

| Vector | Control en el design | R |
|---|---|---|
| **Baja no autorizada del animal de X** (FIX HIGH-1) | `has_role_in(v_source_est) AND (is_owner_of(v_source_est) OR v_source_created_by = auth.uid())` — **paridad EXACTA** con `exit_animal_profile` (0044/SEC-SPEC-01): el `has_role_in(X)` filtra al ex-creador revocado (`active=false`); el owner-or-creator filtra al operario ajeno | R5.1/R5.2/R5.4 |
| **Write en destino Y sin rol en Y** | `has_role_in(p_target_establishment_id)` obligatorio (CREATE = cualquier rol activo) | R5.3 |
| **IDOR: pasar `p_source_profile_id` ajeno** | el cliente solo ve perfiles vía RLS; el RPC re-valida owner-or-creator en X derivado de la fila → un perfil ajeno (o de un campo donde no es owner/creador) cae en `42501` | R5.1 |
| **Spoofeo de tenant por payload** | el RPC **no acepta** `establishment_id` de origen ni `animal_id` de parámetro; los deriva de la fila real | R5.4 |
| **Fuga de aislamiento del sync (WAL)** | `establishment_id` denormalizado de TODAS las hijas re-apuntadas → Y (R3.6); `birth_calves` de la madre → Y (§4.4 DEC-A3); verificar 0 filas huérfanas en X | R3.6 |
| **`session_id` cross-tenant colgando** | nuleado en el re-parenting | R3.8 |
| **Doble perfil activo (rompe R4.11)** | archivar viejo ANTES de crear nuevo, en la misma transacción | R4.2 |
| **Replay / at-least-once** | idempotencia por `p_target_profile_id` de cliente (no-op si ya existe) | R6.1/R6.2 |
| **Definer expuesto a anon/public** | `revoke from public, anon` + smoke-check fail-closed | R5.5 |
| **Bypass del trigger de inmutabilidad de `animal_events`** | el early-return por GUC solo lo activa el definer; el UPDATE de cliente sigue bloqueado (§4.3 DEC-A1) | R3.7 |
| **Performance: animal con mucha historia** | ver §8 | — |

### Decisiones que el Gate 1 debe confirmar (etiquetadas DEC-A*)
- **DEC-A1** — trigger de `animal_events`: early-return por GUC `rafaq.is_transfer` (recomendado) vs alternativa. Es un delta sobre `0034` de spec 02.
- **DEC-A2** — `birth_calves` del animal-como-ternero con madre en X: dejar `establishment_id` en X (recomendado) vs moverlo a Y.
- **DEC-A3** — `birth_calves` del animal-como-madre: mover `establishment_id` a Y (recomendado, incluido en §4.4).
- **DEC-A4** — campos descriptivos del perfil (§4.7, R2.12): partición viaja (visual_id_alt/breed/coat_color) vs reset (entry_*/notes). Gap del Gate 0 cazado por el leader; defaults propuestos, confirmar en Puerta 1 (TODO-D6).

---

## 8. Performance del re-parenting (context.md §Pendientes — performance)

Un animal con mucha historia = muchos UPDATEs en una transacción. Mitigaciones:
- Cada UPDATE de §3.2(f) es un **único statement por tabla** (`WHERE animal_profile_id = p_source_profile_id`), no fila-a-fila. Los indexes as-built `(animal_profile_id, <date> desc) where deleted_at is null` (0024-0029) y `birth_calves_by_calf` / `reproductive_events` indexes los cubren.
- Los UPDATE de vínculos (`bull_id`/`calf_id`) recorren `reproductive_events` por columnas **sin index dedicado** hoy. **Para el implementer**: evaluar `EXPLAIN ANALYZE`; si el plan es seq-scan costoso sobre un `reproductive_events` grande, proponer un index parcial `(bull_id)` / `(calf_id)` en la misma migración (decisión menor, anotar en backlog si se difiere). En el beta (un campo, miles de animales) el costo es acotado; la transferencia es online y de a un animal (R7.2).
- La transacción es **corta y server-side** (sin round-trips); el riesgo de lock contention es bajo (toca solo las filas de UN animal + el perfil). Aceptable para MVP.

---

## 9. Trazabilidad design → R<n>

| Sección design | R cubiertos |
|---|---|
| §3.2(a) authz | R5.1–R5.4, R5.6 |
| §3.2(a-bis) idempotencia | R6.1, R6.2, R6.3 |
| §3.2(b) mismo sistema | R1.6, R2.2 |
| §3.2(c) idv | R2.4, R2.5 |
| §3.2(d) archivar viejo | R4.1, R4.2 |
| §3.2(e) perfil nuevo | R2.1, R2.3, R2.6–R2.12 |
| §4.7 campos descriptivos (viaja/reset) | R2.12 |
| §3.2(f)(g) re-parenting | R3.1–R3.9 |
| §3.3 grants | R5.5 |
| §4.1 establishment_id denorm | R3.6 |
| §4.3 animal_events trigger | R3.7 |
| §4.4 birth_calves | R3.5 |
| §4.5 session_id | R3.8 |
| §5 RLS/sync | R3.6, R5.x |
| §3.1 firma + R7.1 online (cliente) | R7.1, R7.2, R7.3 (cliente) |

> R1.x (punto de entrada) y R8.2 (copy linaje) son **tentativas-UI** → se diseñan/reconcilian con el frontend del find-or-create de spec 09 (deferred). R8.1 (datos del linaje) se cumple por la semántica del re-parenting (los vínculos no se rompen, §3.2(g)).
