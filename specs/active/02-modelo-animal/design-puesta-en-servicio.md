# Spec 02 — Stream A: modelo de puesta en servicio (delta backend) — Design

**Status**: `spec_ready` (pendiente **Gate 1 OBLIGATORIO** + Puerta 1).
**Fecha**: 2026-06-23.
**Fuente de verdad**: `docs/modelo-reproductivo-puesta-en-servicio.md` (Gate 0, §1/§2/§3/§6/§8) + `requirements-puesta-en-servicio.md` (RPS.x).
**Sustrato as-built (spec 02 + 03)**: migraciones `0013`–`0101` (Glob 2026-06-23). Citas inline a la migración real de cada cosa que se toca.

> 🔴 **GATE 1 OBLIGATORIO antes de la Puerta 2.** Este delta es **schema/RLS-sensitive sobre backend DEPLOYADO**: reescribe `public.compute_category` (motor de categorías, `SECURITY DEFINER`, usado por triggers en producción) y altera `public.rodeos` (multi-tenant). Toca además el camino RPC offline (`create_rodeo`/`set_rodeo_config`) y agrega un contrato de derivación cross-tabla. Por ADR-019, Gate 1 (`security_analyzer` modo `spec`) **debe** auditar el delta y emitir PASS antes de implementar.

> **Convención de marcado.** **[FIRME]** = viene cerrado del Gate 0 (no se re-decide). **[DECISIÓN]** = decisión técnica que toma este design (las que el Gate 0 delegó), marcadas `DD-PS-n`. **[VERIFICADO]** = hallazgo del as-built que ya satisface lo pedido (no es cambio).
>
> Los bloques SQL son **especificación de diseño**: el implementer escribe los `.sql` finales + tests, respetando su forma e invariantes. **NO se aplica ninguna migración** (la aplica el leader post-Gate-2). **Numeración ≥ 0102** (as-built llega a `0101`); el implementer ajusta contiguo si una terminal paralela mueve el techo, sin reabrir spec.

---

## 0. Reconciliación con el as-built (qué se toca y qué NO)

| Objeto as-built | Migración | Qué hace hoy | Qué hace este delta |
|---|---|---|---|
| `public.rodeos` | `0017` | tabla rodeo (est/species/system/name), RLS owner-only insert/update | **+columna `service_months`** + CHECK (RPS.1) |
| `public.create_rodeo(...)` | `0081` | RPC alta de rodeo OFFLINE (owner-only, idempotente, seedea config) | **+param `p_service_months`** (RPS.3.1) |
| `public.set_rodeo_config(...)` | `0082` | RPC editar plantilla de datos OFFLINE (owner-only, anti-IDOR por derivación) | **gemelo nuevo** `set_rodeo_service_months` (RPS.3.2) — o se extiende (ver DD-PS-2) |
| `public.compute_category(uuid)` | `0062` | motor de categorías (SECURITY DEFINER STABLE); rama hembra usa `has_service` | **reescritura**: quita `v_has_service` (RPS.4.1) |
| `tg_reproductive_events_apply_transition` | `0063` | trigger incremental que **delega** en `compute_category` | **sin cambio funcional**; nota: el guard `event_type not in (...)` puede dejar `'service'` (inocuo) o quitarlo (ver DD-PS-4) |
| `tg_reproductive_events_recompute_on_change` | `0046`/`0063` | recálculo on-update/delete que delega en `compute_category` | **sin cambio** (hereda la nueva `compute_category`) |
| `refresh_age_categories()` + cron | `0066` | red de seguridad nocturna de cortes de edad (cross-tenant, revocada de clientes) | **sin cambio**; RPS.4.4 lo fija como contrato de la red de seguridad hembra |
| enum `heifer_fitness_result` + `reproductive_events.heifer_fitness` | `0053` | `('apta','no_apta','diferida')` + columna | **sin cambio** (RPS.6 = verificación) **[VERIFICADO]** |
| `reproductive_events` (IA) | `0026`/`0054` | IA = `event_type='service'` + `service_type='ai'` | **no se toca** (IA sigue per-vaca, RPS.4.8/RPS.5.1) |
| **Contrato de derivación servidas/entoradas** | — | **no existe** | **vista(s)/función nueva(s)** tenant-scoped (RPS.5) |

**Lo que NO se toca** (explícito, para Gate 1): las transiciones grandes de `compute_category` (tacto+→preñada, parto→vaca, aborto-revierte RT2.7.5, castración), la rama macho, los gatings de spec 03 (`0054`), la inmutabilidad de identificadores (`0036`), la PII (`0068`), el espejo client-side (es frontend → RPS.7.4).

---

## 1. Decisiones de design (las que el Gate 0 delegó)

### DD-PS-1 — Shape de `service_months`: **`smallint[]` con CHECK**, no bitmask

**[DECISIÓN]** `service_months smallint[]` (array de meses 1–12), NO un bitmask `smallint` de 12 bits.

**Por qué array y no bitmask:**
- **Legibilidad y consultabilidad.** El contrato de derivación (RPS.5) necesita preguntar "¿el mes M está en la ventana?" y "¿cuántos meses tiene el rodeo?" (Gate 0 §4 — el nº de meses define el bucketing CCL en Stream C). Con array: `M = ANY(service_months)` y `array_length(service_months, 1)` — directo, indexable, legible en SQL. Con bitmask: `(mask & (1 << (M-1))) <> 0` y `popcount` — críptico, propenso a errores off-by-one, ilegible en un `psql`.
- **Validación declarativa.** CHECK de rango + unicidad + cardinalidad se expresan limpio sobre un array (ver §2). En un bitmask el "rango 1–12" es "mask < 4096" (12 bits) y la unicidad es gratis pero a costa de perder legibilidad.
- **Default y edición** (RPS.1.6/RPS.1.7) son arrays literales (`'{10,11,12}'`) — el selector de Stream B mapea checkboxes ↔ array de forma trivial.
- **NULL vs vacío** (RPS.1.2): `NULL` (sin configurar) vs `'{}'` (no hace servicio) son naturalmente distintos en un array; en un bitmask `0` colisiona con "vacío" y haría falta un flag aparte para "sin configurar".
- **Offline-sync.** PowerSync materializa arrays de Postgres como texto/JSON; el cliente Stream B (selector) trabaja con un array de números, no con aritmética de bits. Menos superficie de bug en el borde de sync.

**Costo.** Un array ocupa más que 2 bytes de un `smallint` — irrelevante (≤12 smallints por rodeo, y hay pocos rodeos). El trade-off favorece claramente la legibilidad/seguridad sobre 22 bytes.

**Alternativa descartada (bitmask)** — ver §7.

### DD-PS-2 — Camino de escritura de `service_months`: **param en `create_rodeo` + RPC dedicada de edición**

**[DECISIÓN]** Alta: extender `create_rodeo` (`0081`) con `p_service_months` opcional. Edición: **RPC nueva dedicada** `set_rodeo_service_months(p_rodeo_id, p_service_months)`, gemela de `set_rodeo_config` (`0082`), **no** mezclar `service_months` dentro de `set_rodeo_config` (que hoy solo maneja toggles de `rodeo_data_config`).

**Por qué RPC dedicada para la edición (no extender `set_rodeo_config`):**
- `set_rodeo_config` tiene una semántica precisa (UPSERT idempotente del **diff de toggles** sobre `rodeo_data_config`). Meterle `service_months` (un UPDATE de una columna de `rodeos`) mezcla dos responsabilidades y dos tablas en una RPC, y complica su contrato de idempotencia (hoy "re-aplicar toggles = no-op").
- Una RPC dedicada hereda **el mismo patrón anti-IDOR hermético por construcción** de `set_rodeo_config` (§3.2 de su header): el establishment se **deriva del rodeo** (no es parámetro) → un `p_rodeo_id` de otro tenant da `is_owner_of(est ajeno) = false` → 42501. Es el patrón más seguro y ya validado por Gate 1 en `0082`.
- Idempotencia trivial (RPS.3.6): un UPDATE que setea `service_months = p_service_months` es naturalmente idempotente (re-aplicar el mismo array deja el mismo estado). No necesita `client_op_id`.

**Por qué param en `create_rodeo` (no RPC aparte para el alta):** el alta ya es una RPC atómica que arma el rodeo + su config en una transacción; `service_months` es parte del estado inicial del rodeo (con default si se omite, RPS.1.6) → entra como un parámetro más del INSERT, sin romper la idempotencia natural por `id` de cliente (`ON CONFLICT (id) DO NOTHING`).

> **Nota offline:** `service_months` es una **columna escalar de `rodeos`** (no PK compuesta como `rodeo_data_config`), así que en teoría sería escribible por el camino CRUD-plano de PowerSync (UPDATE plano sobre `rodeos`). Pero la **escritura de rodeos ya va por RPC** (decisión de spec 15: `create_rodeo`/`set_rodeo_config` por la PK compuesta de la config) y mantener `service_months` en el mismo camino es consistente y centraliza el authz owner-only + la re-validación server-side (RPS.3.5). El implementer puede, si prefiere, exponer `service_months` como UPDATE plano gobernado por la RLS `rodeos_update` (owner-only) — **pero entonces** debe garantizar la validación server-side (el CHECK de columna de §2 ya la da) y el camino offline de UPDATE plano. **Default de diseño: RPC dedicada** (más alineado con el as-built de rodeos).

### DD-PS-3 — Backfill: **NULL para rodeos existentes, no default**

**[DECISIÓN]** La migración de la columna **no** backfillea `service_months` con el default de primavera para los rodeos ya creados (RPS.2.1). Quedan `NULL` ("sin configurar").

**Por qué NULL y no default:**
- **No inventar campañas que el productor no declaró.** Asumir "primavera" para un rodeo viejo metería esas vacas en un denominador de servicio que el productor nunca configuró → KPIs falsos (el diferencial del producto, Gate 0 §0). NULL es honesto: "no sé cuándo hace servicio este rodeo".
- **El default es para el ALTA** (RPS.1.6, reduce fricción al crear), no para reescribir historia.
- La UI de reportes (Stream C) **invita a configurar** los rodeos NULL (RPS.2.3, Gate 0 §6/§7 "degradar con gracia"), en vez de mentir con un default.

El `ALTER TABLE ... ADD COLUMN service_months smallint[]` (nullable, sin `DEFAULT`) no reescribe la tabla (columna nullable nueva = metadata-only en Postgres moderno) y deja todas las filas existentes en NULL.

### DD-PS-4 — `compute_category`: reescritura mínima, guard del trigger incremental

**[DECISIÓN]** La reescritura de `compute_category` es **quirúrgica**: solo se elimina el término `v_has_service` (y su `SELECT EXISTS ... 'service'`) de la rama hembra. Todo lo demás de `0062` se preserva **literal** (precedencia de ramas, rama macho, cortes de edad, tacto+ vigente, conteo de partos, propiedades de seguridad).

Sobre el guard del trigger incremental (`0063`, `event_type not in ('tacto','service','weaning','birth','abortion')`): **se puede dejar `'service'` en la lista** (inocuo: un evento `service` que aún se inserte —p.ej. una IA `service`+`ai`— gatilla un recompute que ya **no** depende de `service`, así que recomputa la misma categoría; cuesta una recomputación de más, nada más) **o quitarlo** (un `service` ya no participa de transiciones → no recomputar de gusto). **Default de diseño: quitar `'service'` del guard** del incremental para no recomputar en vano cuando se inserte una IA — pero como la IA `service`+`ai` **sí** debería seguir disparando el recompute por si en el futuro influye, **lo más seguro es DEJARLO** y documentar que es una recomputación idempotente. El implementer elige; ambos son correctos post-RPS.4.1. *(Gate 1 mira que cualquiera de las dos no rompa RT2.10.1 — la consistencia está garantizada porque ambos caminos delegan en la misma `compute_category`.)*

> **Recomendación firme:** DEJAR `'service'` en el guard (no tocar `0063`). Razón: la IA se almacena como `service`+`ai` y un día Stream C podría querer que una IA dispare algo; dejar el recompute es la opción conservadora y la recomputación es idempotente (misma categoría). Así el delta toca **solo** `compute_category`, minimizando la superficie de cambio sobre backend deployado.

### DD-PS-5 — Derivación servidas/entoradas: **funciones SQL `SECURITY DEFINER` tenant-scoped por campaña**, no vista plana

**[DECISIÓN]** El contrato de RPS.5 se entrega como **función(es) SQL** parametrizadas por `(p_rodeo_id, p_year)` con `SECURITY DEFINER` + guard de tenant + revoke/grant controlado, **no** como una vista plana `select ... from ...`.

**Por qué función y no vista:**
- **Parametrización por campaña** (RPS.5.8): el denominador es "de esta campaña" (rodeo + año). Una función `(p_rodeo_id, p_year)` es el contrato natural; una vista plana obligaría a Stream C a filtrar y a re-derivar la ventana en cada query.
- **Tenant-scoping autoritativo** (RPS.5.6): una vista hereda la RLS de las tablas base (`rodeos_select` + `reproductive_events_select`), lo cual es correcto pero deja la lógica de "qué cuenta como servida" repartida; una función `SECURITY DEFINER` con un **guard `has_role_in(est del rodeo)` al entrar** centraliza el authz y permite encapsular la lógica de elegibilidad/aptitud/fallback en un solo lugar auditable (patrón `0066`/`0041`).
- **Read-only garantizado** (RPS.5.9): la función solo hace SELECTs; no muta nada.

**Contrato propuesto (tres funciones, ver §5 para el SQL):**
1. `rodeo_serviced_females(p_rodeo_id uuid, p_year int) returns table(animal_profile_id uuid, source text)` — el conjunto **servidas** (unión distinct natural + IA, RPS.5.1/RPS.5.7), con `source ∈ {'natural','ai'}` para diagnóstico.
2. `rodeo_entoradas_count(p_rodeo_id uuid, p_year int) returns int` — **entoradas = servidas − retiradas** (RPS.5.5), o una función que devuelva `(serviced int, retired int, entoradas int)` para que Stream C muestre el denominador explícito (Gate 0 §7).
3. `rodeo_service_campaign(p_rodeo_id uuid, p_year int) returns table(window_start date, window_end date, is_configured bool, n_months int)` — la **ventana** derivada de `service_months` + año (RPS.5.8), incluido `is_configured` (RPS.2.3) y `n_months` (insumo de bucketing CCL para Stream C).

> **Acotación de MVP / dependencia de Stream C.** RPS.5 entrega el **contrato y la forma** del denominador; la **definición fina de la ventana temporal de "retirada"** (RPS.5.5) y el **mapeo mes→campaña con cruce de fin de año** (RPS.5.8) tienen aristas que Stream C (spec 07) terminará de ejercitar. Este design fija una semántica por default razonable (§5) y marca **[TENTATIVO]** las aristas que Stream C podría refinar, para no bloquear A. Lo **definitivo** de Stream A es: la unión distinct natural∪IA, la regla de elegibilidad aptitud+ventana (no categoría), el fallback por edad, y el tenant-scoping. **[FIRME]**

---

## 2. SQL — columna `service_months` en `rodeos` (RPS.1, RPS.2)

```sql
-- 0102_rodeo_service_months.sql  (Stream A — modelo de puesta en servicio)
-- Config de campaña por rodeo: en qué meses (1-12) ese rodeo hace servicio (Gate 0 §6).
-- Sustrato del denominador reproductivo (servidas/entoradas, 0104) y del bucketing CCL (Stream C).
-- NO existía en el repo (verificado 2026-06-23). Shape = smallint[] (DD-PS-1).
--
-- NULL = "sin configurar" (rodeos existentes; RPS.2.1) — distinto de '{}' = "no hace servicio" (RPS.1.2).
-- Default de primavera {10,11,12} se aplica en el ALTA (create_rodeo, 0103), NO como DEFAULT de columna
-- (un DEFAULT backfillearía los rodeos viejos a primavera → DD-PS-3 lo rechaza). Por eso la columna es
-- nullable SIN default → los rodeos existentes quedan NULL (metadata-only ALTER, no reescribe la tabla).

alter table public.rodeos
  add column service_months smallint[];   -- nullable, sin default (DD-PS-3); 1..12, únicos, ≤12 (CHECK abajo)

-- CHECK autoritativo server-side (RPS.1.3/.4/.5; regla INPUT-1, espejo 0070). El cliente Expo escribe a
-- PostgREST directo → este CHECK es la ÚNICA capa autoritativa. NULL pasa el CHECK (sin configurar).
-- (a) rango 1..12: ningún elemento fuera de [1,12].
-- (b) unicidad: cardinalidad del array = cardinalidad del conjunto distinct (sin duplicados).
-- (c) cardinalidad ≤ 12: no más meses que los del año (cota anti-input-abusivo).
alter table public.rodeos
  add constraint rodeos_service_months_valid check (
    service_months is null
    or (
      -- (a) rango
      (select bool_and(m between 1 and 12) from unnest(service_months) as m)
      -- (b) sin duplicados
      and array_length(service_months, 1) = (select count(distinct m) from unnest(service_months) as m)
      -- (c) cardinalidad ≤ 12
      and array_length(service_months, 1) <= 12
    )
  );

comment on column public.rodeos.service_months is
  'Meses (1-12) en que el rodeo hace servicio (Gate 0 §6, Stream A). NULL = sin configurar; {} = no hace '
  'servicio; {10,11,12} = primavera (default del alta). Sustrato del denominador servidas/entoradas y del '
  'bucketing CCL. CHECK rodeos_service_months_valid: rango 1-12, sin duplicados, ≤12 elementos (INPUT-1).';

notify pgrst, 'reload schema';
```

**Notas de seguridad/RLS (RPS.7.1):** agregar una columna a `rodeos` **no** abre ningún camino cross-tenant: la RLS de `rodeos` (`0017`: `rodeos_select` = `has_role_in(establishment_id)`; `rodeos_update` = `is_owner_of`) ya gobierna la fila. `service_months` hereda esa policy sin cambios. El `grant select, insert, update on public.rodeos to authenticated` ya existe (`0017`) — no se agrega grant nuevo. La escritura efectiva la centraliza la RPC (§3), pero aun por UPDATE plano la RLS owner-only + el CHECK cierran el caso.

**PowerSync:** `rodeos` ya está en un bucket sincronizado (spec 15). El array `smallint[]` se materializa client-side como texto/JSON (PowerSync mapea tipos PG no-escalares a TEXT — patrón `impl_15` para `heifer_fitness`/enums). El cliente (Stream B) parsea el array. **Dependencia anotada:** el implementer verifica que el schema de PowerSync (`AppSchema`) incluya `service_months` como columna TEXT del rodeo para que las lecturas no rompan (mismo cuidado que `impl_15` tuvo con columnas nuevas).

---

## 3. SQL — camino de escritura (RPS.3)

### 3.1 Alta: `create_rodeo` + `p_service_months` (RPS.3.1)

```sql
-- 0103_create_rodeo_service_months.sql  (Stream A) — extiende la RPC de alta offline (0081).
-- Agrega p_service_months opcional. Si se omite/NULL → default primavera {10,11,12} (RPS.1.6). Si viene,
-- se valida server-side (RPS.3.5) ANTES de persistir (además del CHECK de columna). Owner-only + idempotencia
-- natural por id de cliente SE CONSERVAN (header de 0081). CREATE OR REPLACE (misma firma + 1 param nuevo
-- al final con default → backward-compatible para callers que no lo pasen).

create or replace function public.create_rodeo (
  p_id               uuid,
  p_establishment_id uuid,
  p_name             text,
  p_species_id       uuid,
  p_system_id        uuid,
  p_toggles          jsonb default '[]'::jsonb,
  p_service_months   smallint[] default null     -- NUEVO. null → default primavera (RPS.1.6).
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_service_months smallint[];
  v_toggle jsonb; v_field_id uuid; v_enabled boolean;
begin
  -- (a) AUTHZ PRIMERO — owner-only (espeja rodeos_insert, 0017). [SIN CAMBIO vs 0081]
  if not public.is_owner_of(p_establishment_id) then
    raise exception 'not authorized to create a rodeo in this establishment' using errcode = '42501';
  end if;

  -- (b) validaciones de nombre/species/system [SIN CAMBIO vs 0081] ...
  --     (name no vacío, char_length ≤ 120, species activa, system∈species activo)

  -- (b-bis) NUEVO: resolver service_months. Omitido/NULL → default primavera (RPS.1.6). Si viene, validar
  --         server-side (RPS.3.5) — el CHECK de columna re-valida igual, pero damos error claro acá.
  v_service_months := coalesce(p_service_months, array[10,11,12]::smallint[]);
  perform public.assert_service_months_valid(v_service_months);  -- helper §3.3 (rango/únicos/≤12)

  -- (c) INSERT del rodeo con id de cliente + service_months. ON CONFLICT (id) DO NOTHING → idempotencia
  --     natural (replay no crea 2do rodeo ni re-dispara el seed-trigger). [+ service_months vs 0081]
  insert into public.rodeos (id, establishment_id, name, species_id, system_id, service_months)
  values (p_id, p_establishment_id, v_name, p_species_id, p_system_id, v_service_months)
  on conflict (id) do nothing;

  -- (c-bis) GUARD ANTI-IDOR cross-tenant [SIN CAMBIO vs 0081]: el rodeo con p_id debe pertenecer a
  --         p_establishment_id (ya autorizado). Si no (colisión con otro tenant) → 42501.
  if not exists (select 1 from public.rodeos r
                 where r.id = p_id and r.establishment_id = p_establishment_id and r.deleted_at is null) then
    raise exception 'rodeo id does not belong to this establishment' using errcode = '42501';
  end if;

  -- (d) UPSERT del diff de toggles [SIN CAMBIO vs 0081] ...

  return p_id;
end; $$;

-- Re-grant idéntico (la firma cambió → es una sobrecarga nueva; revocar/grant explícito y, si hace falta,
-- DROP de la firma vieja para no dejar dos overloads ambiguas — el implementer decide DROP+CREATE vs overload).
revoke execute on function public.create_rodeo (uuid, uuid, text, uuid, uuid, jsonb, smallint[]) from public, anon;
grant  execute on function public.create_rodeo (uuid, uuid, text, uuid, uuid, jsonb, smallint[]) to authenticated;

notify pgrst, 'reload schema';
```

> ⚠️ **Cambio de firma (Gate 1 mira esto):** agregar `p_service_months` cambia la **signatura** de `create_rodeo`. Dos opciones: (i) **DROP** de la firma vieja `(uuid,uuid,text,uuid,uuid,jsonb)` + CREATE de la nueva (limpia, pero rompe a cualquier caller que no actualice — aceptable porque el cliente se actualiza en el mismo deploy); (ii) **overload** (dejar ambas) — riesgo de ambigüedad de PostgREST. **Default de diseño: DROP + CREATE** (el cliente del repo es el único caller). El implementer revoca/grant sobre la firma resultante y corre el smoke-check de grants (patrón `0081`).

### 3.2 Edición offline: `set_rodeo_service_months` (RPS.3.2–RPS.3.6)

```sql
-- 0103_create_rodeo_service_months.sql (continúa) — RPC gemela de set_rodeo_config (0082) para EDITAR
-- service_months OFFLINE (DD-PS-2). Anti-IDOR HERMÉTICO por construcción: el establishment se DERIVA del
-- rodeo (no es parámetro), igual que set_rodeo_config → un p_rodeo_id de otro tenant da is_owner_of=false.
-- Idempotente: UPDATE que setea service_months = p_service_months (replay = no-op). No necesita client_op_id.

create or replace function public.set_rodeo_service_months (
  p_rodeo_id       uuid,
  p_service_months smallint[]   -- el nuevo conjunto (puede ser '{}' = no hace servicio; NULL = sin configurar)
) returns uuid
language plpgsql security definer
set search_path = public as $$
declare v_est uuid;
begin
  -- (a) DERIVAR el establishment del rodeo (lo que hace la RPC anti-IDOR por construcción). Inexistente/
  --     soft-deleted → P0002 (el cliente lo clasifica como rechazo permanente, rollback del overlay).
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if not found then
    raise exception 'rodeo not found' using errcode = 'P0002';
  end if;

  -- (b) AUTHZ — owner-only (espeja rodeos_update, 0017). v_est se DERIVÓ del rodeo → un owner solo pasa
  --     para rodeos de SUS campos; un p_rodeo_id ajeno → is_owner_of(est ajeno)=false → 42501.
  if not public.is_owner_of(v_est) then
    raise exception 'not authorized to edit this rodeo service window' using errcode = '42501';
  end if;

  -- (c) Validación server-side (RPS.3.5) — NULL permitido (volver a "sin configurar"); si no-NULL, valida.
  if p_service_months is not null then
    perform public.assert_service_months_valid(p_service_months);
  end if;

  -- (d) UPDATE idempotente (RPS.3.6). El CHECK de columna re-valida (defensa en profundidad).
  update public.rodeos set service_months = p_service_months where id = p_rodeo_id;

  return p_rodeo_id;
end; $$;

revoke execute on function public.set_rodeo_service_months (uuid, smallint[]) from public, anon;
grant  execute on function public.set_rodeo_service_months (uuid, smallint[]) to authenticated;

notify pgrst, 'reload schema';
```

### 3.3 Helper de validación reusable `assert_service_months_valid` (RPS.3.5)

```sql
-- 0103 (continúa) — helper INTERNO de validación server-side, reusado por create_rodeo y
-- set_rodeo_service_months. Da un error accionable ANTES de persistir (el CHECK de columna también
-- rechazaría, pero con un mensaje genérico). SECURITY INVOKER (no toca filas; solo valida el array de
-- entrada) — no necesita SECURITY DEFINER ni se expone como RPC (revoke por prolijidad).
create or replace function public.assert_service_months_valid (p_months smallint[])
returns void language plpgsql immutable as $$
begin
  if p_months is null then return; end if;  -- NULL = sin configurar, válido.
  if exists (select 1 from unnest(p_months) m where m < 1 or m > 12) then
    raise exception 'service_months out of range: every month must be between 1 and 12' using errcode = '23514';
  end if;
  if array_length(p_months, 1) > 12 then
    raise exception 'service_months has too many elements (max 12)' using errcode = '23514';
  end if;
  if array_length(p_months, 1) <> (select count(distinct m) from unnest(p_months) m) then
    raise exception 'service_months has duplicate months' using errcode = '23514';
  end if;
end; $$;
revoke execute on function public.assert_service_months_valid (smallint[]) from public, anon, authenticated;
-- Lo invocan las RPC SECURITY DEFINER (corren como owner del schema → conservan EXECUTE pese al revoke,
-- mismo patrón que assert_data_keys_enabled 0054 / apply_auto_transition 0042).
```

**Decisión de offline-sync (RPS.3.2):** la edición de `service_months` es una RPC drenable desde la outbox de PowerSync (mismo patrón que `set_rodeo_config`/`create_rodeo`/`register_birth`): el cliente aplica un **overlay optimista** sobre el rodeo, encola el intent, y `uploadData` invoca la RPC; un rechazo (42501/23514) lo clasifica el cliente (rollback del overlay). La **idempotencia** (RPS.3.6) hace seguro el at-least-once de la outbox. **Multi-tenant:** nunca se hardcodea `establishment_id`; se deriva del rodeo (RPS.3.4).

---

## 4. SQL — reescritura de `compute_category` (RPS.4)

Reescritura **quirúrgica** de `0062`: se elimina **solo** el término `v_has_service` (y su `SELECT EXISTS ... event_type='service'`) de la rama hembra. Todo lo demás es **idéntico a `0062`** (precedencia LOAD-BEARING, rama macho, cortes de edad 1/2 años, tacto+ vigente RT2.7.5, conteo de partos, `SECURITY DEFINER STABLE`, `set search_path = public`, grant a `authenticated`).

```sql
-- 0104_compute_category_drop_service.sql  (Stream A — RPS.4)
-- Reconciliación del Gate 0 §2.1: el backstop servicio→vaquillona se ELIMINA. El destete (has_weaning)
-- es la vía canónica ternera→vaquillona y el corte de edad (≥365) + el cron nocturno (0066) cubren
-- "se olvidaron de destetar". Las transiciones grandes (tacto+→preñada, parto→vaca, aborto-revierte,
-- castración) NO dependían de service → ripple chico.
--
-- DIFF vs 0062 (ÚNICO cambio): se borra la declaración `v_has_service`, su SELECT EXISTS de event_type
-- 'service', y el término `or v_has_service` de la rama vaquillona (0062 línea 93). NADA MÁS cambia.
-- Conserva: SECURITY DEFINER STABLE, search_path=public, conteo de PARTOS (eventos 'birth', nunca
-- terneros), is_castrated, cortes de edad, tacto+ vigente RT2.7.5, precedencia de ramas, grant a authenticated.
--
-- Eventos `service` históricos (RPS.4.5): NO se borran (siguen en el timeline) pero dejan de influir —
-- esta función ya no los lee. La IA (service+ai, 0054) sigue almacenándose igual; deja de promover a
-- vaquillona por el solo evento (RPS.4.8, intencional: categoría ≠ elegibilidad, Gate 0 §2).

create or replace function public.compute_category (profile_id uuid)
returns uuid language plpgsql security definer stable
set search_path = public as $$
declare
  v_sex text;
  v_birth_date date;
  v_is_castrated boolean;
  v_system_id uuid;
  v_age_days int;
  v_births int;
  v_has_weaning boolean;
  -- v_has_service ELIMINADA (RPS.4.1)
  v_has_pos_tacto boolean;
  v_target_code text;
begin
  select a.sex, a.birth_date, a.is_castrated, r.system_id
    into v_sex, v_birth_date, v_is_castrated, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = profile_id;

  v_age_days := case when v_birth_date is not null then (current_date - v_birth_date) else null end;

  select exists (select 1 from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'weaning' and deleted_at is null)
    into v_has_weaning;
  -- SELECT EXISTS de event_type='service' ELIMINADO (RPS.4.1)

  if v_sex = 'male' then
    -- rama macho IDÉNTICA a 0062 (cortes 2 años / 1 año / <1 año / default; is_castrated). [SIN CAMBIO]
    if v_age_days is not null and v_age_days >= 730 then
      v_target_code := case when v_is_castrated then 'novillo' else 'toro' end;
    elsif v_has_weaning or (v_age_days is not null and v_age_days >= 365) then
      v_target_code := case when v_is_castrated then 'novillito' else 'torito' end;
    elsif v_age_days is not null and v_age_days < 365 then
      v_target_code := 'ternero';
    else
      v_target_code := case when v_is_castrated then 'novillito' else 'torito' end;
    end if;
  else
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'birth' and deleted_at is null;

    -- tacto+ vigente (RT2.7.5) IDÉNTICO a 0062. [SIN CAMBIO]
    select exists (
      select 1 from public.reproductive_events t
      where t.animal_profile_id = profile_id
        and t.event_type = 'tacto'
        and t.pregnancy_status is not null and t.pregnancy_status <> 'empty'
        and t.deleted_at is null
        and not exists (
          select 1 from public.reproductive_events ab
          where ab.animal_profile_id = profile_id
            and ab.event_type = 'abortion'
            and ab.deleted_at is null
            and (ab.event_date, ab.created_at) > (t.event_date, t.created_at)
        )
    ) into v_has_pos_tacto;

    -- Precedencia LOAD-BEARING IDÉNTICA a 0062, salvo que la rama vaquillona YA NO incluye v_has_service:
    --   partos>=2 > partos=1 > tacto+ > vaquillona(destete | >=1año) > ternera(<1año) > default.
    if v_births >= 2 then
      v_target_code := 'multipara';                         -- RT2.4.1
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';             -- RT2.4.2
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';                -- RT2.4.3
    elsif v_has_weaning or (v_age_days is not null and v_age_days >= 365) then
      v_target_code := 'vaquillona';                        -- RT2.4.4 (RPS.4.1: SIN `or v_has_service`)
    elsif v_age_days is not null and v_age_days < 365 then
      v_target_code := 'ternera';                           -- RT2.4.5
    else
      v_target_code := 'vaquillona';                        -- RT2.4.6 (sin birth_date, sin eventos)
    end if;
  end if;

  return (select id from public.categories_by_system
          where system_id = v_system_id and code = v_target_code and active = true
          limit 1);
end; $$;

grant execute on function public.compute_category (uuid) to authenticated;  -- [SIN CAMBIO vs 0062]

notify pgrst, 'reload schema';
```

**Por qué NO hace falta tocar nada más del motor de categorías:**
- El **trigger incremental** (`0063`) **delega** en `compute_category` (no hardcodea targets) → hereda el cambio por construcción (RPS.4.7). Ver DD-PS-4 sobre el guard `event_type not in (...)` (recomendación: dejar `'service'`, recompute idempotente).
- El **recálculo on-change** (`0046`/`0063`) también delega → hereda el cambio. Un perfil con un `service` histórico, al editarse/borrarse cualquier evento, recomputa **sin** `service` (RPS.4.5).
- El **cron** (`0066`) ya llama a `compute_category` y ya cubre el corte de edad hembra `ternera`@365→`vaquillona` (RPS.4.4) — **es exactamente la red de seguridad que el Gate 0 pidió verificar/agregar; ya existe.** [VERIFICADO]
- La rama macho **no** usaba `service` → sin cambio.

**Reconciliación as-built crítica (RPS.4.8) — inseminación artificial.** La IA se almacena como `reproductive_events` con `event_type='service'` + `service_type='ai'` (verificado: `0054` línea 135; `app/src/services/powersync/local-reads.ts` línea 1541 `VALUES (?, ?, 'service', 'ai', ...)`). Antes de este delta, `v_has_service` hacía que una IA promoviera una `ternera` a `vaquillona`. **Después** de RPS.4.1, una IA cargada sobre una `ternera` **deja** de promoverla por el solo evento — lo hará el destete o el corte de edad. **Esto es intencional** (Gate 0 §2: categoría ≠ elegibilidad; la hembra con IA cuenta como **servida** en el denominador de RPS.5, que es independiente de su categoría). Hay que **cubrirlo con un test** (insertar IA sobre ternera → categoría sigue `ternera` hasta destete/edad; pero `rodeo_serviced_females` la incluye por la rama `ai`).

**Espejo client-side (RPS.7.4, dependencia frontend):** `app/src/utils/animal-category.ts` (C6) tiene `const hasService = inputs.events.some(e => e.eventType === 'service')` (línea 261) y lo usa en la rama `vaquillona` (línea 269). Para preservar la invariante anti-drift (RC6.5: el espejo == `compute_category`), ese término **debe** quitarse cuando se aplique este delta. Es **frontend** → lo ejecuta Stream B o un slice de C6, **no** este delta backend. Anotado para que el leader lo encadene (si se aplica el backend sin alinear el espejo, el badge client-side mostraría `vaquillona` para una ternera con solo IA mientras el server muestra `ternera` → drift transitorio hasta el sync; lo corrige el slice frontend).

**Consideración de deploy — regresión de datos (RPS.4.5, hallazgo del veto del leader 2026-06-23):** al aplicar `0104`, las categorías **guardadas** de los animales existentes NO se recalculan automáticamente (el cron `0066` solo recomputa hembras `ternera` age-stale; no barre todo). El único caso real de reversión es una **hembra < 365 días con un evento `service`/IA, sin destete, sin tacto+** → hoy está `vaquillona` por `service`, tras `0104` recomputaría `ternera`. (Una hembra sin `birth_date` cae en el default `vaquillona` RT2.4.6 → no cambia; una servida ≥365 días o destetada sigue `vaquillona` por edad/destete → no cambia.) **Acción para el implementer/deploy:** (a) ANTES de aplicar, consultar el remoto si existe alguna fila así (probablemente conjunto vacío en datos reales — no se sirve una hembra de <1 año); (b) si existen, decidir entre un **recompute targeted one-time** de esos perfiles al deploy (estilo `refresh_age_categories` acotado) o dejar que recompute lazily en el próximo evento/cron. Documentarlo en el ledger del implementer. Gate 1 lo verifica.

---

## 5. SQL — contrato de derivación servidas/entoradas (RPS.5)

> **[FIRME]** la forma (función SECURITY DEFINER tenant-scoped, unión distinct natural∪IA, elegibilidad = aptitud+ventana no categoría, fallback por edad, read-only). **[TENTATIVO]** las aristas finas de ventana temporal de "retirada" y cruce de fin de año — Stream C (spec 07) las ejercita; este design fija defaults razonables.

### 5.1 Ventana de campaña — `rodeo_service_campaign` (RPS.5.8)

```sql
-- 0105_repro_denominator.sql  (Stream A — RPS.5). Contrato de derivación del denominador reproductivo
-- que consume Stream C (spec 07). Read-only (RPS.5.9). Tenant-scoped (RPS.5.6). SECURITY DEFINER + guard
-- has_role_in(est del rodeo) al entrar (patrón 0066/0041) + revoke/grant controlado.

-- (1) Ventana de la campaña de un rodeo en un año. Deriva de service_months + p_year (RPS.5.8).
--     window_start = primer día del menor mes de servicio del año; window_end = último día del mayor mes.
--     [TENTATIVO] Cruce de fin de año (ej. service_months={12,1,2}): el MVP trata la campaña como el
--     CONJUNTO de meses {12,1,2} del año p_year (no un rango contiguo) → la pertenencia se evalúa por
--     "mes del evento/membresía ∈ service_months", NO por un BETWEEN de fechas. Así Dic+Ene+Feb cuentan
--     sin lógica de wrap. window_start/window_end se exponen como ayuda de display; la pertenencia REAL
--     usa el conjunto de meses (ver 5.2). Stream C confirma si necesita el rango contiguo con wrap.
create or replace function public.rodeo_service_campaign (p_rodeo_id uuid, p_year int)
returns table (is_configured boolean, n_months int, months smallint[], window_start date, window_end date)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid; v_months smallint[];
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then
    raise exception 'rodeo not found' using errcode = 'P0002';
  end if;
  -- GUARD tenant (RPS.5.6): cualquier rol del establecimiento puede LEER el denominador (reportes).
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s campaign' using errcode = '42501';
  end if;
  -- Cota de p_year (RPS.5.10, Gate 1 MEDIUM-1) — DESPUÉS del guard de tenant. Las OTRAS DOS funciones
  -- de derivación (rodeo_serviced_females, rodeo_repro_denominator) replican este mismo check tras su guard.
  if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'p_year out of range (1900..current+1)' using errcode = '22023';
  end if;

  is_configured := v_months is not null;            -- RPS.2.3
  n_months      := coalesce(array_length(v_months, 1), 0);
  months        := v_months;
  if v_months is null or array_length(v_months,1) is null then
    window_start := null; window_end := null;       -- sin configurar / sin meses → sin ventana
  else
    window_start := make_date(p_year, (select min(m) from unnest(v_months) m), 1);
    window_end   := (make_date(p_year, (select max(m) from unnest(v_months) m), 1)
                     + interval '1 month - 1 day')::date;
  end if;
  return next;
end; $$;
```

### 5.2 Servidas — `rodeo_serviced_females` (RPS.5.1, RPS.5.2, RPS.5.3, RPS.5.4, RPS.5.7)

```sql
-- (2) Conjunto SERVIDAS de un rodeo en una campaña = UNIÓN DISTINCT (RPS.5.7) de:
--     (a) NATURAL: vientres del rodeo elegibles + rodeo con ventana activa ese año (service_months no
--         vacío). Elegibilidad (RPS.5.2, Gate 0 §2/§3 — aptitud+ventana, NO categoría sola):
--           - PROBADAMENTE SERVIDAS → elegibles SIN gate de aptitud (su categoría prueba el servicio):
--             vaquillona_prenada (concibió en 1er servicio), vaca_segundo_servicio, multipara, vaca_cabana.
--             [FIX veto leader 2026-06-23: vaquillona_prenada estaba OMITIDA → una vaquillona de 1er
--              servicio que concebía SALÍA del denominador al diagnosticarse preñada → inflaba %preñez.]
--           - vaquillonas APTAS aún no diagnosticadas (último heifer_fitness='apta', RPS.5.3) → con gate;
--           - FALLBACK por edad (RPS.5.4): vaquillona de edad de servicio SIN veredicto de aptitud
--             registrado → elegible (para no dejar fuera al campo que no tactea aptitud).
--           - NO_APTA / DIFERIDA vigente → NO elegible por aptitud (RPS.6.2), y NO cae al fallback
--             (tiene veredicto registrado, distinto de "sin chequeo").
--     (b) AI: hembras del rodeo con un evento de inseminación (event_type='service' AND service_type='ai',
--         no borrado) cuyo event_date cae en un mes de la campaña (RPS.5.1). La IA NO se toca (per-vaca).
--     DISTINCT por animal_profile_id → una hembra en ambas ramas cuenta UNA vez (RPS.5.7).
--
-- [TENTATIVO] "presente durante la ventana": el MVP toma la MEMBRESÍA ACTUAL del rodeo (animal_profiles.
-- rodeo_id = p_rodeo_id, status='active', deleted_at IS NULL). El historial de membresía por fecha (estaba
-- en el rodeo DURANTE la ventana aunque hoy esté en otro) NO se modela en MVP (no hay tabla de historia de
-- rodeo_id; transferencia = UPDATE in-place, spec 11). Stream C confirma si el primer año necesita más.
-- La "edad de servicio" para el fallback (RPS.5.4) se parametriza como umbral en días [TENTATIVO: 365,
-- = corte de edad de categoría; Stream C/Facundo puede afinarlo] — definido como constante en la función.
-- [TENTATIVO] CUT (vaca de último ternero): si está preñada de su última cría fue servida → contaría en la
-- campaña que la preñó; pero una CUT post-parto en el rodeo NO se re-sirve. Como el MVP usa membresía+ventana
-- ACTUAL (no "servida en ESTA campaña"), se DEJA FUERA del set incondicional por ahora (evita contarla en
-- campañas donde no se la sirvió). Stream C/Facundo afinan si hace falta incluirla.
create or replace function public.rodeo_serviced_females (p_rodeo_id uuid, p_year int)
returns table (animal_profile_id uuid, source text)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid; v_months smallint[]; v_age_threshold_days int := 365;
begin
  select establishment_id, service_months into v_est, v_months
  from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized to read this rodeo''s serviced females' using errcode = '42501';
  end if;

  return query
  with eligible_natural as (
    -- (a) servicio natural: solo si el rodeo tiene ventana ese año (months no vacío). Rodeo NULL/{} → vacío.
    select distinct p.id as animal_profile_id, 'natural'::text as source
    from public.animal_profiles p
    join public.animals a on a.id = p.animal_id
    join public.categories_by_system c on c.id = p.category_id
    where p.rodeo_id = p_rodeo_id
      and p.establishment_id = v_est          -- tenant (defensa; ya derivado)
      and p.status = 'active'
      and p.deleted_at is null
      and a.sex = 'female'
      and v_months is not null and array_length(v_months,1) >= 1   -- ventana activa (RPS.2.2)
      and (
        c.code in ('vaquillona_prenada','vaca_segundo_servicio','multipara','vaca_cabana')  -- probadamente servidas: elegibles SIN gate (vaquillona_prenada incluida — fix veto leader 2026-06-23)
        or (
          c.code = 'vaquillona'
          and (
            -- APTA: último veredicto = 'apta' (RPS.5.3)
            (select rv.heifer_fitness from public.reproductive_events rv
               where rv.animal_profile_id = p.id and rv.event_type = 'tacto_vaquillona'
                 and rv.deleted_at is null
               order by rv.event_date desc, rv.created_at desc limit 1) = 'apta'
            -- FALLBACK por edad (RPS.5.4): SIN veredicto registrado + edad de servicio
            or (
              not exists (select 1 from public.reproductive_events rv
                          where rv.animal_profile_id = p.id and rv.event_type = 'tacto_vaquillona'
                            and rv.deleted_at is null)
              and a.birth_date is not null and (current_date - a.birth_date) >= v_age_threshold_days
            )
          )
        )
      )
  ),
  ai_females as (
    -- (b) IA per-vaca (no se toca): event_type='service' AND service_type='ai', event_date en mes de campaña.
    select distinct p.id as animal_profile_id, 'ai'::text as source
    from public.animal_profiles p
    join public.reproductive_events rv on rv.animal_profile_id = p.id
    where p.rodeo_id = p_rodeo_id
      and p.establishment_id = v_est
      and p.deleted_at is null
      and rv.event_type = 'service' and rv.service_type = 'ai'
      and rv.deleted_at is null
      and extract(year from rv.event_date)::int = p_year
      and (v_months is null or extract(month from rv.event_date)::int = any(v_months))
      -- nota: si el rodeo no declara meses, la IA igual cuenta (es un dato real per-vaca de esa campaña-año)
  )
  -- UNIÓN DISTINCT por animal_profile_id (RPS.5.7): si está en ambas, gana 'natural' (orden estable).
  select distinct on (u.animal_profile_id) u.animal_profile_id, u.source
  from (select * from eligible_natural union all select * from ai_females) u
  order by u.animal_profile_id, (u.source = 'natural') desc;
end; $$;
```

### 5.3 Entoradas — `rodeo_repro_denominator` (RPS.5.5)

```sql
-- (3) Denominador explícito (Gate 0 §7, convención Bavera). Entoradas = servidas − retiradas (RPS.5.5).
--     "Retiradas": hembras que ENTRARON a servicio (están en el conjunto servidas) pero salieron del padrón
--     (status <> 'active' o baja con exit_reason) — [TENTATIVO] el MVP cuenta como retirada a la que YA NO
--     está activa hoy; el recorte fino por "salió DURANTE la ventana" lo afina Stream C con exit_date vs la
--     ventana de campaña. Devuelve los 3 números para que la UI muestre el denominador explícito con toggle
--     (entoradas / preñadas / paridas — Gate 0 §7, lo arma Stream C sobre estos).
create or replace function public.rodeo_repro_denominator (p_rodeo_id uuid, p_year int)
returns table (serviced int, retired int, entoradas int)
language plpgsql security definer stable
set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then raise exception 'rodeo not found' using errcode = 'P0002'; end if;
  if not public.has_role_in(v_est) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  serviced := (select count(*) from public.rodeo_serviced_females(p_rodeo_id, p_year));
  retired  := (select count(*)
               from public.rodeo_serviced_females(p_rodeo_id, p_year) s
               join public.animal_profiles p on p.id = s.animal_profile_id
               where p.status <> 'active' or p.deleted_at is not null);  -- [TENTATIVO] ver nota
  entoradas := serviced - retired;
  return next;
end; $$;
```

### 5.4 Grants/revokes del contrato de derivación (RPS.5.6)

```sql
-- 0105 (continúa) — superficie RPC del denominador. Es READ-ONLY y tenant-scoped por el guard
-- has_role_in al entrar (cualquier rol del establecimiento LEE reportes). SECURITY DEFINER → la RLS no
-- las protege; el guard interno SÍ. Se exponen como RPC a authenticated (Stream C las llama desde el
-- cliente o desde una vista de reportes); anon/public revocados. Smoke-check fail-closed (patrón 0066).
revoke execute on function public.rodeo_service_campaign (uuid, int)  from public, anon;
revoke execute on function public.rodeo_serviced_females (uuid, int)  from public, anon;
revoke execute on function public.rodeo_repro_denominator (uuid, int) from public, anon;
grant  execute on function public.rodeo_service_campaign (uuid, int)  to authenticated;
grant  execute on function public.rodeo_serviced_females (uuid, int)  to authenticated;
grant  execute on function public.rodeo_repro_denominator (uuid, int) to authenticated;
-- (el implementer agrega el smoke-check `do $$ ... has_function_privilege(...) ... $$` estilo 0066/0074
--  para anon/public, y test de IDOR cross-tenant: un caller de otro tenant → 42501.)
notify pgrst, 'reload schema';
```

**Seguridad del contrato de derivación (Gate 1 lo audita a fondo):**
- **Tenant-scoping (RPS.5.6):** cada función deriva `establishment_id` del rodeo y exige `has_role_in(v_est)` al entrar → un caller de otro tenant que conozca un `p_rodeo_id` ajeno recibe 42501 (sin IDOR, patrón `0066`/`0082`). SECURITY DEFINER se usa para encapsular la lógica de elegibilidad, **no** para saltarse el authz (el guard rige primero).
- **Input cota server-side:** `p_rodeo_id` (uuid, validado por la existencia del rodeo) y `p_year` (int; cota `1900 ≤ p_year ≤ año_actual+1` **en el SQL de las 3 funciones, tras el guard de tenant** — RPS.5.10, Gate 1 MEDIUM-1; es contrato, no decisión suelta del implementer, ver §5.1).
- **Read-only (RPS.5.9):** solo SELECTs; ninguna función muta filas. STABLE.
- **No materializa nada nuevo sobre animales (RPS.5.9):** todo se deriva on-read de `service_months` + membresía + eventos; no hay columna "servida" en `animal_profiles`.

---

## 6. `heifer_fitness` — verificación de contrato (RPS.6) [VERIFICADO]

**No hay cambio de schema.** El as-built (`0053`) ya define:

```sql
-- 0053_tacto_vaquillona.sql (as-built, NO se toca)
create type public.heifer_fitness_result as enum ('apta', 'no_apta', 'diferida');
alter table public.reproductive_events add column if not exists heifer_fitness public.heifer_fitness_result;
```

Los 3 estados que el Gate 0 §3 pidió (**APTA / NO_APTA / DIFERIDA**) **ya existen** y los tests as-built ya ejercen APTA y NO_APTA (`supabase/tests/maneuvers/run.cjs` líneas 465/468). Stream A:
- **Fija el contrato** (RPS.6.1/RPS.6.4): el enum es cerrado; un 4º valor → error de enum (test).
- **Documenta la semántica de DIFERIDA** (RPS.6.2): "no apta todavía, no se descarta, se re-evalúa" — no marca CUT ni saca del padrón. Como `heifer_fitness` **no** alimenta `compute_category` (RPS.6.3), un veredicto no dispara transición — esto **ya** es cierto en el as-built (la rama `tacto_vaquillona` no aparece en `compute_category` `0062`; el gating `0054` solo valida el data_key, no transiciona). Test: insertar `tacto_vaquillona` con cada veredicto → categoría del perfil no cambia.
- **Conecta DIFERIDA/NO_APTA con el denominador** (RPS.5.3): una vaquillona con último veredicto NO_APTA/DIFERIDA **no** cuenta como apta en `rodeo_serviced_females` (§5.2).

> Si Stream B agrega captura de **peso** en la maniobra de aptitud (Gate 0 §3, mencionado para Stream B), eso es **otro delta** (spec 03), no Stream A.

---

## 7. Alternativas descartadas

- **`service_months` como bitmask `smallint` de 12 bits** (DD-PS-1). Descartada: críptico de consultar (`mask & (1<<(m-1))`) justo donde la derivación (§5) y el bucketing CCL (Stream C) necesitan "¿está el mes M?" y "¿cuántos meses?"; el "rango 1-12" se vuelve `mask < 4096` y la unicidad se pierde como propiedad legible; **NULL vs vacío** colisionan (ambos serían `0`/`NULL` ambiguos) → haría falta un flag extra para "sin configurar". El array `smallint[]` con CHECK es declarativo, indexable y legible, a costa de ~22 bytes/rodeo (irrelevante). Bitmask solo ganaría si hubiera millones de rodeos y la compacidad importara — no es el caso.
- **Backfillear los rodeos existentes con el default de primavera** (DD-PS-3). Descartada: inventaría campañas de servicio que el productor no declaró → denominadores y KPIs falsos (rompe el diferencial del producto). NULL ("sin configurar") es honesto y la UI invita a configurarlo (RPS.2.3).
- **Mezclar `service_months` dentro de `set_rodeo_config`** (DD-PS-2). Descartada: mezcla dos responsabilidades (UPSERT de toggles de `rodeo_data_config` vs UPDATE de una columna de `rodeos`) y dos tablas en una RPC, complicando su contrato de idempotencia ya validado por Gate 1. Una RPC dedicada hereda el patrón anti-IDOR hermético de `set_rodeo_config` sin contaminarlo.
- **Contrato de derivación como VISTA plana** (DD-PS-5). Descartada: el denominador es "por campaña" (rodeo+año) → necesita parametrización; una vista obligaría a re-derivar la ventana en cada query de Stream C y dejaría la lógica de elegibilidad repartida. Funciones `SECURITY DEFINER` con guard de tenant centralizan authz + lógica en un lugar auditable. (La vista heredaría la RLS correctamente, pero pierde la parametrización y la encapsulación.)
- **Eliminar los eventos `service` históricos** de la base (RPS.4.5). Descartada: borrar datos del timeline rompe el historial visible (el operario cargó esos servicios); el Gate 0 no pide borrarlos, solo que dejen de influir en la categoría — lo cual se logra quitándolos de `compute_category` (siguen en `animal_timeline`, que no filtra por tipo).
- **Materializar una columna `is_serviced`/`serviced_campaign` en `animal_profiles`** (en vez de derivar on-read). Descartada (RPS.5.9): el denominador cambia con `service_months`, con la membresía del rodeo, con el último veredicto de aptitud y con bajas → una columna materializada exigiría triggers sobre 4 fuentes (rodeo, profile, repro_events, status) para mantenerse, multiplicando la superficie de bug; on-read es barato (padrón chico) y siempre consistente.

---

## 8. Resumen de migraciones del delta (≥ 0102, NO aplicar)

| Migración (orientativa) | Contenido | RPS |
|---|---|---|
| `0102_rodeo_service_months.sql` | `+columna service_months smallint[]` en `rodeos` + CHECK (rango/únicos/≤12) + comment; nullable sin default (backfill NULL) | RPS.1, RPS.2 |
| `0103_create_rodeo_service_months.sql` | `+param p_service_months` en `create_rodeo` (default primavera) + RPC nueva `set_rodeo_service_months` (edición offline owner-only anti-IDOR) + helper `assert_service_months_valid` | RPS.3 |
| `0104_compute_category_drop_service.sql` | reescritura quirúrgica de `compute_category`: quita `v_has_service` (resto idéntico a `0062`) | RPS.4 |
| `0105_repro_denominator.sql` | funciones `rodeo_service_campaign` / `rodeo_serviced_females` / `rodeo_repro_denominator` + grants/revokes + smoke-check | RPS.5 |

> Numeración orientativa contigua; el implementer ajusta ≥ 0102 contra el as-built real **y** lo que una terminal paralela tenga en vuelo, respetando dependencias (`0102` antes de `0103`/`0105`; `0104` independiente). **`heifer_fitness` (RPS.6) NO genera migración** (es verificación del as-built `0053`). **Ninguna se aplica en este chunk** (deploy gateado por el leader post-Gate-2).

## 9. Qué necesita verificar el leader / Gate 1

- **Gate 1 OBLIGATORIO** (backend deployado): auditar (a) owner-only + anti-IDOR de la escritura de `service_months` (`create_rodeo`/`set_rodeo_service_months`); (b) las 3 funciones de derivación SECURITY DEFINER (guard de tenant al entrar, revoke/grant, IDOR cross-tenant, cota de `p_year`, read-only); (c) que la reescritura de `compute_category` preserve `SECURITY DEFINER STABLE` + `search_path=public` + el grant a `authenticated` y **no** introduzca lectura cross-tenant; (d) el cambio de firma de `create_rodeo` (DROP+CREATE vs overload) y su smoke-check de grants.
- **Encadenar el slice frontend del espejo** (RPS.7.4): al aplicar el backend, quitar `hasService` de `app/src/utils/animal-category.ts` (C6) para no dejar drift transitorio. No es de este delta backend.
- **Confirmar con Stream C / spec 07** las aristas **[TENTATIVO]** de §5 (ventana temporal de "retirada", cruce de fin de año, umbral de "edad de servicio" del fallback, membresía histórica) antes de que C las consuma — Stream A entrega la forma firme; C puede pedir refinar esos defaults (entraría como reconciliación de esta spec, preservando los IDs `RPS.x`).
