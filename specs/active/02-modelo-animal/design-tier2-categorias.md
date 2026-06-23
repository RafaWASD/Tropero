# Spec 02 — Tier 2/3 backend: modelo de categorías de cría — Design

**Status**: `spec_ready` (pendiente Gate 1 + Puerta 1).
**Fecha**: 2026-06-04 (sesión 22).
**Fuente de verdad**: `context-tier2-categorias.md` (Gate 0). Dominio firme: ADR-008 (§ Enmienda 2026-06-03) + `dominio-categorias-facundo-2026-06-03.md`. Sustrato as-built: spec 02 Tier 1 (`done`, migrations 0013-0049), spec 03 (0050-0058, no se toca).

> **Convención de marcado.** A lo largo de este design:
> - **[FIRME · dominio]** = viene cerrado de ADR-008 enmendado / dominio Facundo. No se re-decide.
> - **[DECISIÓN · design]** = decisión técnica nueva que tomo en este design (las que el context delegó). Marcadas `DD-n`.
>
> Los bloques SQL son **especificación de diseño**: el implementer escribe los `.sql` finales y los tests. No son código a copiar literal (sí su forma y sus invariantes).

> **Numeración de migrations.** El as-built verificado llega a **`0058_delete_account_rpc.sql`** (Glob, 2026-06-04). El próximo número libre real es **`0059`**. Este delta arranca en **`0059`**. El implementer confirma contra el as-built **y** contra lo que cualquier terminal paralela tenga en vuelo antes de crear archivos; ajusta contiguo ≥ 0059 sin reabrir spec.

---

## 0. Decisiones de design resueltas (las que el context delegó)

> Las cuatro decisiones abiertas del context, resueltas con justificación. Gate 1 + Raf miran sobre todo DD-1.

### DD-1 — Transiciones por EDAD (1/2 años) — **on-event (primario) + `pg_cron` nocturno targeted (red de seguridad)**

**[DECISIÓN · design]**

> **Revisada en refinamiento (2026-06-04).** La versión original resolvía los cortes de edad **solo** on-event/on-recompute y aceptaba el trade-off de que una categoría quede "vieja" hasta el próximo evento del animal. **Raf rechazó ese trade-off.** Esta versión mantiene el on-event como camino **primario** (sin cambios) y agrega un **job `pg_cron` nocturno targeted** como red de seguridad que cierra el único hueco (el animal que cruza un umbral de edad y al que nadie toca). El resto del delta (rama macho/hembra, trigger incremental que delega, RT2.10, RT2.7.5, DD-2/3/4) **no cambia** — ya pasó Gate 1.

**El problema.** ADR-008 enmendado usa cortes de edad (`ternero→torito/novillito` al año si no hubo destete; `torito/novillito→toro/novillo` a los 2 años). Un corte de edad **no tiene un evento que lo dispare** (cumplir años no es un INSERT). ¿Cómo se materializa un corte de edad?

**La decisión: DOS caminos complementarios.**

**Camino 1 — on-event (PRIMARIO, sin cambios respecto a lo aprobado).** Los cortes de edad viven **dentro de `compute_category`**, que ya recibe `birth_date` y compara contra `current_date`. `compute_category` se ejecuta:
1. en cada **inserción** de evento que dispara transición (triggers `AFTER INSERT` — vía el camino incremental, que para los casos de edad delega al cálculo por edad);
2. en cada **edición/borrado** de evento (trigger de recálculo `0046`, extendido a `service`/`weaning`/`abortion`);
3. en el **revert de override** (R4.10) y herramientas de mantenimiento.

O sea: cada vez que **cualquier** cosa pasa sobre el perfil (un evento nuevo, una corrección, un revert de override), la edad se reevalúa y el corte se aplica **de inmediato**. Por qué `compute_category` y no solo el trigger incremental: `compute_category` calcula la categoría **completa** a partir de `birth_date` + eventos + `is_castrated`, así que el corte de edad cae "gratis" en cualquier recálculo. El trigger incremental, para los casos que dependen de edad (ej. un destete sobre un macho de >2 años debería ir directo a `toro`/`novillo`, no a `torito`/`novillito`), **delega** a `compute_category` en lugar de hardcodear el target — ver §3.2. Esto garantiza RT2.10 (consistencia incremental↔recompute) por construcción: el incremental usa la misma función.

**Camino 2 — `pg_cron` nocturno targeted (NUEVO, la red de seguridad).** Un job programado (diario 03:00) que hace un **recálculo TARGETED** de los animales cuya categoría guardada **quedó atrás de su edad** — **NO** recalcula todo el padrón. Llama a la función de mantenimiento `public.refresh_age_categories()` (§3.5), que: (a) corre un **filtro indexado barato** que identifica solo los candidatos age-stale; (b) para cada uno, `compute_category` + `apply_auto_transition` **solo si el target difiere**; (c) registra la transición en `animal_category_history` como `auto_transition`, igual que el resto. En estado estable recalcula **0 o muy pocos** perfiles por noche (solo los que justo cruzaron un umbral de edad ese día), no todo el tenant.

**Por qué el cron resuelve el hueco que el on-event deja.** El on-event cubre **todo** lo que se toca: el destete —el disparador biológico real del salto ternero→torito/novillito— **sí** se carga como evento, y los animales se tocan en maniobras (vacunación, pesaje, tacto) con frecuencia. El único caso que el on-event NO cubre es el animal que **cruza un umbral de edad y al que nadie carga/edita un evento** entre el cumpleaños y la consulta. El cron nocturno cierra exactamente ese caso: dentro de 24h, ese animal pasa de categoría solo.

**El trade-off (RT2.8.2, mejorado).** Antes era "queda viejo **indefinidamente** hasta el próximo evento" (rechazado por Raf). Ahora es "**fresco dentro de 24h**" (la ventana del cron). El on-event sigue dando la transición **instantánea** cuando hay evento; el cron es el piso de frescura de 24h para el caso sin eventos. Es estrictamente mejor que el diseño anterior sin costo operativo relevante (el filtro recalcula 0-pocos por noche).

**Viabilidad.** Supabase free **soporta `pg_cron`** (`create extension if not exists pg_cron`). El cómputo es trivial para un beta (padrón chico; filtro indexado). No introduce infra externa (es una extensión de Postgres, no un scheduler aparte).

**Seguridad.** `refresh_age_categories()` cambia `category_id` **cross-tenant por diseño** (es un job de sistema). Si fuera invocable por un cliente sería un IDOR catastrófico (clase SEC-HIGH-01, el mismo vector que `apply_auto_transition`). DEBE estar **revocada** de `public`/`authenticated`/`anon` + smoke-check fail-closed. Detalle en §4 (fila nueva) y §3.5.

**Alternativas descartadas:** ver §5 (A5 — `pg_cron` pasó de descartada a **ELEGIDA**; A6 — RPC-on-entry, descartada por preferencia de Raf).

### DD-2 — Ubicación de `is_castrated` — **`animals`** (atributo del animal físico)

**[DECISIÓN · design]**

`is_castrated` va en **`animals`** (tabla global), no en `animal_profiles`. Razones:
- **Es un atributo físico del animal**, no de su presencia en un establecimiento. Igual que `sex` y `birth_date` viven en `animals` (`0019`), la castración es una propiedad del bicho que no cambia al moverse de campo. Un novillo sigue castrado si se transfiere a otro establecimiento.
- **Consistencia con `sex`**: la rama macho de `compute_category` ya lee `a.sex` de `animals` (join `p → a`). Leer `a.is_castrated` del mismo join es natural y barato (el join ya existe).
- **Un solo lugar de verdad**: si viviera en `animal_profiles`, un re-alta del perfil (transferencia) perdería la castración o la duplicaría inconsistentemente.

**RLS/grants (RT2.12.1).** `animals` ya tiene RLS (`0022`) con SELECT/UPDATE para `authenticated` derivado de la presencia de un `animal_profile` activo del usuario (R3.5/R11.3 base). `is_castrated` hereda esa policy sin cambios: agregar la columna **no** abre un camino cross-tenant (la policy de `animals` ya filtra por rol). El `grant update on animals to authenticated` ya existe (`0019`); no se agrega grant nuevo. La inmutabilidad de identificadores (`0036`) **no** aplica a `is_castrated` (no es un identificador) — el toggle castrado/entero debe poder corregirse.

**Trigger de transición por castración.** Como `is_castrated` vive en `animals` pero la **categoría** vive en `animal_profiles`, el trigger que reacciona al cambio de `is_castrated` debe ir sobre `animals` (`AFTER UPDATE OF is_castrated`) y resolver el/los perfil(es) activo(s) de ese animal para aplicar la transición. En MVP un animal tiene **a lo sumo un** `animal_profile` activo (unique parcial `animal_profiles_active_animal_unique`, `0020`), así que el trigger toca un solo perfil. Ver §3.3.

### DD-3 — Cría al pie — **columna `nursing` en `animal_profiles`, mantenida por trigger**

**[DECISIÓN · design]**

Cría al pie (`con`/`sin`) se modela como una **columna booleana `nursing` en `animal_profiles`** (default `false`), mantenida por trigger, **no** como derivado puro on-read. Razones:
- **Es un estado de la madre que se consulta en listas/analytics** (ADR-008: "insumo de analytics"; dominio §2: "cría al pie" es dato de la ficha de vaca). Un derivado on-read exigiría, por cada vaca de una lista de cientos, una subconsulta sobre `reproductive_events` + `birth_calves` para saber si su último parto fue destetado → caro y repetido. Una columna materializada se lee directo (igual criterio que `category_id` se almacena en vez de derivarse).
- **Es consistente con cómo ya se materializa la categoría** (almacenada + trigger), no con un patrón nuevo.
- **Ortogonal a la categoría (RT2.9.2)**: `nursing` es columna aparte; cambiarla no toca `category_id`/`rodeo_id`/`management_group_id`.

**Mantenimiento (trigger).** El estado `nursing` lo setea/limpia el trigger de `reproductive_events`:
- en un `birth` sobre la madre → `nursing = true` (post-parto, con cría al pie);
- en un `weaning` del **ternero** → se resuelve la **madre** de ese ternero (vía `birth_calves.calf_profile_id = <ternero>` → `birth_event_id` → `reproductive_events.animal_profile_id` = madre) y se setea `nursing = false` en la madre **si ese era su último ternero al pie** (no hay otro ternero suyo sin destetar).

**Consistencia bajo edición/borrado (RT2.9.3).** El recálculo de `nursing` también se ata al trigger de recálculo (`0046` extendido): borrar el parto → recomputar `nursing` (sin ese parto, la madre puede dejar de estar con cría); borrar el destete → recomputar (vuelve a estar con cría). Para evitar lógica incremental frágil, se expone una función auxiliar `compute_nursing(profile_id) returns boolean` (`SECURITY DEFINER STABLE`, paralela a `compute_category`) que el trigger usa tanto en el camino incremental como en el recálculo. Igual patrón de consistencia que `compute_category`.

> **Acotación de MVP.** Cría al pie como **booleano** (`con`/`sin`) alcanza para el MVP y para los analytics de §6 del dominio. No se modela "cuántas crías al pie" ni el vínculo fino madre↔cría-actual más allá de `birth_calves` (que ya existe). Si el benchmarking pidiera el conteo, se evoluciona post-MVP sin romper la columna booleana.

### DD-4 — Migración de datos existentes — **no tocar el histórico (aplicar on-event/on-recompute)**

**[DECISIÓN · design]**

La migración **no** recomputa masivamente los `animal_profiles` existentes (RT2.13.1). Razones:
- **Respeta los overrides manuales**: un recompute masivo tendría que distinguir override=true (no tocar) de false (recomputar) perfil por perfil; hacerlo en una migración es riesgoso y no auditado evento-a-evento.
- **Las reglas nuevas no rompen nada existente**: las categorías que un perfil viejo ya tiene (`ternero`, `vaquillona`, etc.) siguen siendo válidas; las categorías nuevas (`novillito`/`novillo`) solo se alcanzan vía `is_castrated=true` + (destete o edad), y `is_castrated` arranca en `false` para todos (default de la columna nueva) → ningún perfil existente cambia por el solo seed (RT2.13.2).
- **Convergencia natural**: cada perfil viejo converge a la categoría correcta en su **próximo** evento (que recomputa) o al revert de override. En cría, todo animal vivo se toca en la próxima maniobra.

**Lo único que la migración escribe en filas existentes** es el **default de las columnas nuevas** (`animals.is_castrated = false`, `animal_profiles.nursing = false`), que es un `ALTER TABLE … ADD COLUMN … DEFAULT false NOT NULL` (Postgres lo aplica sin reescribir la tabla en versiones modernas para defaults constantes). No hay UPDATE de `category_id` en la migración.

---

## 1. Archivos a crear / modificar

> **No se modifican migraciones existentes** (regla dura). Todo va en migraciones nuevas ≥ 0059. El frontend (`animal-category.ts`) **no** se toca en este chunk (RT2.20 es dependencia anotada).

| Archivo (migration / test) | Qué hace | Cubre |
|---|---|---|
| `supabase/migrations/0059_categories_novillo_seed.sql` | Seed idempotente de `novillito`/`novillo` en `categories_by_system` para `(bovino, cría)` | RT2.1.x, RT2.13.2 |
| `supabase/migrations/0060_is_castrated_column.sql` | `ALTER TABLE animals ADD COLUMN is_castrated boolean NOT NULL DEFAULT false` (DD-2) | RT2.2.1, RT2.12.1, RT2.13.1 |
| `supabase/migrations/0061_nursing_column.sql` | `ALTER TABLE animal_profiles ADD COLUMN nursing boolean NOT NULL DEFAULT false` + función `compute_nursing` (DD-3) | RT2.9.x, RT2.13.1 |
| `supabase/migrations/0062_compute_category_rewrite.sql` | Reescritura completa de `compute_category` (ramas macho/hembra del ADR-008 enmendado, cortes de edad DD-1) | RT2.3.x, RT2.4.x, RT2.8.x, RT2.7.5 |
| `supabase/migrations/0063_category_triggers_align.sql` | Alineación del trigger incremental (`tg_reproductive_events_apply_transition`) y del recálculo (`0046`) con las reglas nuevas: `service`, `weaning`, `abortion`, `birth` desde cualquier categoría; delega a `compute_category` (RT2.10) | RT2.5.x, RT2.6.x, RT2.7.x, RT2.10.x |
| `supabase/migrations/0064_castration_transition.sql` | Trigger `AFTER UPDATE OF is_castrated` sobre `animals` → transición `torito→novillito` / `toro→novillo` del perfil activo (DD-2) + nursing trigger wiring si hace falta | RT2.2.3, RT2.2.4, RT2.2.5, RT2.2.6, RT2.10.4 |
| `supabase/migrations/0065_check_grants.sql` (opcional, patrón `0038`/`0055`) | Re-emisión idempotente de revokes/grants (defensa en profundidad): `apply_auto_transition` revocada, funciones nuevas con EXECUTE correcto, `notify pgrst` | RT2.12.2, RT2.12.4 |
| `supabase/migrations/0066_age_categories_cron.sql` | **Red de seguridad de edad (DD-1, camino 2).** `create extension if not exists pg_cron` + función de mantenimiento `public.refresh_age_categories()` (`SECURITY DEFINER`, sin params, filtro targeted age-stale → `compute_category` + `apply_auto_transition`) + `revoke execute … from public, authenticated, anon` + suma al smoke-check fail-closed + `cron.schedule('refresh_age_categories_nightly', '0 3 * * *', …)` idempotente | RT2.8.2, RT2.8.4, RT2.8.5, RT2.12.6 |
| `supabase/tests/animal/run.cjs` (extensión) | Tests reales de cada transición nueva + consistencia trigger↔recompute + override + no-spoof + **cron targeted/no-spoof/override** | todo el delta |

> **Agrupación:** el implementer puede **fusionar** migraciones contiguas si lo prefiere (p. ej. `compute_category` + triggers en una sola), respetando que `ALTER TYPE`/`ADD COLUMN` y la reescritura de funciones no choquen en transacción. La numeración exacta la cierra contra el as-built. El criterio de separación de arriba es por **responsabilidad** (seed / columna / función / triggers / seguridad), que ayuda al Gate 1 a auditar cada pieza.

---

## 2. Migración 0059 — seed `novillito` / `novillo`

**[FIRME · dominio]** (ADR-008 enmendado). Patrón idéntico al seed de `0015` y al delta de razas de feature 08 / castración de spec 10 (join por `.code`, no por `.name`).

```sql
-- 0059_categories_novillo_seed.sql — categorías de macho castrado (ADR-008 enmendado).
-- Idempotente (on conflict do nothing sobre el unique (system_id, code)). NO toca las existentes.
-- L1 (Gate 1): join por .code ('bovino'/'cria'), NO por .name (lección 0015/spec 10).
with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
insert into public.categories_by_system (system_id, code, name, sort_order, active)
select sys.system_id, c.code, c.name, c.sort, true
from sys, (values
  ('novillito', 'Novillito', 96),   -- entre torito (95) y toro (90); macho castrado <=2 años
  ('novillo',   'Novillo',   97)    -- macho castrado >2 años
) as c(code, name, sort)
on conflict (system_id, code) do nothing;

notify pgrst, 'reload schema';
```

> **Nota sort_order.** `torito` quedó en `95` y `toro` en `90` en `0015` (display no estrictamente monótono respecto a edad). Uso `96`/`97` para agrupar los machos castrados después de `torito`, sin reordenar las existentes (RT2.1.3). El orden de display fino es de frontend; no es load-bearing.

---

## 3. Migración 0062-0064 — `compute_category` + triggers

### 3.1 `compute_category` reescrita (0062)

> **⚠️ ANTI-DRIFT (C6 / RC6.5.2) — nota de mantenimiento, aditiva.** Existe un **espejo client-side** de
> esta función en `app/src/utils/animal-category.ts` (`computeCategoryCode`), display-only y offline (chunk
> C6 de spec 02): permite ver la categoría derivada localmente antes de que este trigger recompute y el
> cambio baje por sync. **Cualquier migración que toque `compute_category`** (ramas, cortes de edad,
> precedencia de la máquina de estados, tacto+ vigente RT2.7.5, conteo de partos) **DEBE actualizar ese
> espejo + sus fixtures** (`app/src/utils/animal-category.test.ts`, suite "FIXTURES ESPEJO RC6.1.6", que
> replica caso por caso la matriz `supabase/tests/animal/run.cjs` T2.21–T2.26/T2.29/T2.30). El peor caso del
> drift es display-only (categoría mostrada vieja hasta el próximo sync; no corrompe datos). Nota gemela en
> el header del módulo TS.

**[FIRME · dominio]** la máquina de estados; **[DECISIÓN · design]** la materialización por edad (DD-1) y la consulta de aborto-revierte-tacto (RT2.7.5).

Conserva la firma y las propiedades del as-built (`SECURITY DEFINER STABLE`, `set search_path = public`, `grant execute … to authenticated`). Lee ahora también `a.is_castrated` (DD-2) y los eventos `service`/`weaning`/`abortion`. **El conteo de partos sigue contando eventos `birth` distintos** (no terneros, RT2.7.2) — se conserva el comentario firme del `0045`.

> ⚠ **SUPERSEDED por Stream A / RPS.4.1 (2026-06-23) — el `service` ya NO es disparador de categoría.**
> El SQL de abajo es el **as-built histórico de `0062`** (RT2.x), donde `v_has_service` promovía
> `ternera → vaquillona`. La migración **`0104`** (Stream A, modelo de puesta en servicio, aplicada al
> remoto) **eliminó `v_has_service`** (decl + `SELECT EXISTS event_type='service'` + el término `or
> v_has_service` de la rama `vaquillona`); **nada más cambió** (rama macho, tacto+ RT2.7.5, conteo de partos,
> SECURITY DEFINER STABLE, search_path, grant: idénticos). La promoción `ternera → vaquillona` queda **solo**
> por **destete** (`v_has_weaning`) o **edad ≥365d**. La forma final deployada está en
> `supabase/migrations/0104_compute_category_drop_service.sql` y reconciliada en
> `design-puesta-en-servicio.md`. **Espejo client-side**: `app/src/utils/animal-category.ts` (y sus fixtures
> "FIXTURES ESPEJO" en `animal-category.test.ts`) **todavía** usan `hasService` a propósito — el slice
> frontend que lo alinea es **Stream B / RPS.7.4**; ese drift transitorio (display-only) es **esperado y
> documentado** (no se toca en el delta backend de Stream A ni en este fix-loop de la suite animal).

```sql
-- 0062_compute_category_rewrite.sql — reescritura completa (ADR-008 enmendado).
-- Conserva: SECURITY DEFINER STABLE, conteo de PARTOS (no terneros), grant a authenticated.
-- Agrega: is_castrated (animals), disparadores weaning/service, aborto-revierte-tacto, cortes de edad.
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
  v_has_service boolean;
  v_has_pos_tacto boolean;   -- tacto+ NO revertido por aborto posterior (RT2.7.5)
  v_target_code text;
begin
  select a.sex, a.birth_date, a.is_castrated, r.system_id
    into v_sex, v_birth_date, v_is_castrated, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = profile_id;

  v_age_days := case when v_birth_date is not null then (current_date - v_birth_date) else null end;

  -- destete y servicio: existencia de evento no borrado
  select exists (select 1 from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'weaning' and deleted_at is null)
    into v_has_weaning;
  select exists (select 1 from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'service' and deleted_at is null)
    into v_has_service;

  if v_sex = 'male' then
    -- corte 2 años: toro/novillo (solo con birth_date conocido) — DD-1
    if v_age_days is not null and v_age_days >= 730 then
      v_target_code := case when v_is_castrated then 'novillo' else 'toro' end;
    -- graduado: destete cargado, O >=1 año por edad — torito/novillito
    elsif v_has_weaning or (v_age_days is not null and v_age_days >= 365) then
      v_target_code := case when v_is_castrated then 'novillito' else 'torito' end;
    -- ternero: <1 año conocido y sin destete
    elsif v_age_days is not null and v_age_days < 365 then
      v_target_code := 'ternero';
    else
      -- birth_date NULL, sin destete: default conservador por sexo (R4.7.1 base; RT2.3.4)
      v_target_code := case when v_is_castrated then 'novillito' else 'torito' end;
    end if;
  else
    -- conteo de PARTOS (eventos birth distintos, NUNCA terneros / birth_calves) — RT2.7.2 / as-built 0045
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id and event_type = 'birth' and deleted_at is null;

    -- tacto+ vigente = existe un tacto positivo SIN un aborto posterior (por event_date, desempate created_at)
    -- y sin un tacto posterior que lo reemplace. RT2.7.5: aborto deja de contar el tacto previo.
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

    if v_births >= 2 then
      v_target_code := 'multipara';                         -- RT2.4.1
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';             -- RT2.4.2 (desde cualquier categoría)
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';                -- RT2.4.3
    elsif v_has_weaning or v_has_service   -- ⚠ `or v_has_service` ELIMINADO por 0104 (RPS.4.1, Stream A)
          or (v_age_days is not null and v_age_days >= 365) then
      v_target_code := 'vaquillona';                        -- RT2.4.4 (deployado: SIN v_has_service)
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

grant execute on function public.compute_category (uuid) to authenticated;
```

**Notas de diseño sobre la rama hembra:**
- El orden de las ramas (`partos>=2` → `partos=1` → `tacto+` → `vaquillona` → `ternera` → default) es **load-bearing**: codifica la precedencia de la máquina de estados (haber parido domina sobre haber sido tactada; haber sido tactada+ domina sobre destete/servicio/edad). RT2.4.x lo fija.
- **RT2.7.5 (aborto revierte el tacto en el recompute)** se implementa con el `NOT EXISTS` de un aborto posterior al tacto. Esto hace que, tras editar/borrar eventos, el recálculo no deje a una abortada como `vaquillona_prenada`. Es la pieza clave de consistencia (RT2.10) para el aborto.

### 3.2 Trigger incremental alineado (0063)

**[DECISIÓN · design]** delegar a `compute_category` en vez de hardcodear targets, para garantizar RT2.10 por construcción.

El trigger incremental as-built (`0031`) hardcodea cada target (`vaquillona→vaquillona_prenada`, etc.). Eso fue manejable con 3 transiciones, pero con servicio/destete/parto-desde-cualquier-categoría/aborto el árbol de `if` se vuelve frágil y propenso a divergir del recompute. **Decisión:** reescribir `tg_reproductive_events_apply_transition` para que, ante cualquier `event_type` que participe de transiciones (`tacto`, `service`, `weaning`, `birth`, `abortion`), **llame a `compute_category`** y aplique el resultado vía `apply_auto_transition` (si `override=false` y el target difiere del actual). Así el camino incremental y el recompute usan **la misma función** → RT2.10.1 es cierto por construcción, no por coincidencia de dos copias de la lógica.

```sql
-- 0063_category_triggers_align.sql — incremental usa compute_category (consistencia RT2.10).
create or replace function public.tg_reproductive_events_apply_transition ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_override boolean;
  v_current uuid;
  v_target uuid;
begin
  -- solo event_type que participan de transiciones (evita recomputar de gusto)
  if new.event_type not in ('tacto','service','weaning','birth','abortion') then
    return new;
  end if;
  select category_override, category_id into v_override, v_current
  from public.animal_profiles where id = new.animal_profile_id;
  if v_override is null or v_override = true then
    return new;  -- override manda (R4.9) — RT2.x.* cláusulas de override
  end if;
  v_target := public.compute_category(new.animal_profile_id);
  if v_target is not null and v_target is distinct from v_current then
    perform public.apply_auto_transition(new.animal_profile_id, v_target);  -- GUC + history auto_transition
  end if;
  return new;
end; $$;
-- (el trigger AFTER INSERT on reproductive_events ya existe de 0031; se conserva su definición)
```

> **Importante (orden de visibilidad del evento).** `compute_category` cuenta los eventos `deleted_at IS NULL` del perfil. En un `AFTER INSERT`, la fila `new` **ya está visible** dentro de la transacción → el conteo de partos / la existencia de destete/servicio/tacto ya incluye el evento recién insertado. Esto es lo que hace correcto delegar al recompute desde el incremental (a diferencia del as-built `0031`, que decidía por `v_current_code` + el `new` sin contar). El implementer verifica que el trigger es `AFTER INSERT` (lo es, `0031` l.130).

**Extensión del trigger de recálculo (0046) — RT2.10.3.** El trigger de recálculo as-built escucha `AFTER UPDATE OF event_type, pregnancy_status, deleted_at` + `AFTER DELETE`. Como ahora `service`/`weaning`/`abortion` participan de transiciones, **editar/borrar uno de esos eventos debe recomputar**. El `AFTER UPDATE OF deleted_at` ya cubre el soft-delete de cualquier `reproductive_events` (incluidos los nuevos tipos) → el recálculo ya se dispara al borrar un `service`/`weaning`/`abortion`. Para edición de `event_type`/`event_date` que cambie el resultado, el `OF` se amplía a incluir `event_date` (un aborto cuya fecha se mueve antes/después de un tacto cambia RT2.7.5). La función `tg_reproductive_events_recompute_on_change` no cambia (ya llama `compute_category`); solo se re-crea el **trigger** con el `OF` ampliado:

```sql
-- 0063 (cont.) — ampliar el OF del trigger de recálculo a event_date (aborto/tacto por fecha).
drop trigger if exists reproductive_events_recompute_on_update on public.reproductive_events;
create trigger reproductive_events_recompute_on_update
  after update of event_type, pregnancy_status, event_date, deleted_at on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_on_change();
-- el trigger AFTER DELETE (0046) se conserva.
notify pgrst, 'reload schema';
```

> **Nota:** recrear el trigger no es "modificar una migración existente" — es un `drop trigger if exists` + `create trigger` en una migración **nueva** (0063). No se edita el archivo `0046`. La función `tg_reproductive_events_recompute_on_change` se reusa tal cual.

### 3.3 Trigger de castración (0064)

**[FIRME · dominio]** el efecto; **[DECISIÓN · design]** que viva en `animals` (DD-2).

`is_castrated` vive en `animals`; la categoría en `animal_profiles`. El trigger reacciona al cambio de `is_castrated` sobre `animals` y aplica la transición sobre el **perfil activo** de ese animal. Para `ternero`/`ternera` no hace nada (RT2.2.2: el efecto se difiere al destete, que ya lo maneja `compute_category` leyendo `is_castrated`). Para `false→true` sobre `torito`/`toro` aplica `novillito`/`novillo`. Para `true→false` no revierte (RT2.2.6).

> ⚠ **SUPERSEDED por spec 10 (aplicado 2026-06-11, migración `0086_castration_recompute_symmetric.sql`)**: el cuerpo de `tg_animals_apply_castration` se reemplazó por un guard **dirección-agnóstico** (`IS NOT DISTINCT FROM` → return), de modo que el revert `true → false` AHORA recompute simétricamente (`novillito → torito`, `novillo → toro`). El bloque SQL de abajo es el diseño ORIGINAL de `0064` (asimétrico) — vigente hasta el reemplazo de spec 10. La cláusula "true→false no revierte (RT2.2.6)" queda HISTÓRICA. Ver `specs/active/10-operaciones-rodeo/design.md` §4.3 + `progress/impl_10-backend-delta.md`.

```sql
-- 0064_castration_transition.sql — efecto de categoría de is_castrated (DD-2).
create or replace function public.tg_animals_apply_castration ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_profile_id uuid;
  v_override boolean;
  v_current uuid;
  v_target uuid;
begin
  -- solo nos interesa el cambio false -> true (RT2.2.3/2.2.4); true->false no revierte (RT2.2.6)
  if not (old.is_castrated = false and new.is_castrated = true) then
    return new;
  end if;
  -- perfil ACTIVO de este animal (a lo sumo uno, unique parcial 0020). DD-2.
  select id, category_override, category_id
    into v_profile_id, v_override, v_current
  from public.animal_profiles
  where animal_id = new.id and status = 'active' and deleted_at is null
  limit 1;
  if v_profile_id is null then return new; end if;
  if v_override is null or v_override = true then return new; end if;  -- R4.9 / RT2.2.5

  -- compute_category ya lee is_castrated; delegar garantiza consistencia (RT2.10.1).
  -- Para torito/toro pasará a novillito/novillo; para ternero/ternera quedará igual (RT2.2.2).
  v_target := public.compute_category(v_profile_id);
  if v_target is not null and v_target is distinct from v_current then
    perform public.apply_auto_transition(v_profile_id, v_target);  -- history auto_transition (RT2.10.4)
  end if;
  return new;
end; $$;

create trigger animals_apply_castration
  after update of is_castrated on public.animals
  for each row execute function public.tg_animals_apply_castration();

notify pgrst, 'reload schema';
```

> **Por qué delegar a `compute_category` también acá.** Si hardcodeáramos `torito→novillito`, un `toro` de >2 años recién castrado iría mal a `novillito` en vez de `novillo`. `compute_category` ya resuelve el corte de 2 años + `is_castrated`, así que delegar da el target correcto en una sola línea y mantiene la consistencia (RT2.10).

> **Atomicidad del trigger sobre `animals`.** El `AFTER UPDATE OF is_castrated` corre **después** de que `new.is_castrated` quedó persistido en la transacción, así que `compute_category` (que lee `a.is_castrated`) ya ve el valor nuevo. Correcto.

### 3.4 `compute_nursing` + wiring de cría al pie (0061)

**[DECISIÓN · design]** DD-3. Función auxiliar + trigger sobre `reproductive_events` (birth/weaning) y recálculo.

```sql
-- 0061_nursing_column.sql — cría al pie (DD-3): columna + función + wiring.
alter table public.animal_profiles add column if not exists nursing boolean not null default false;

-- compute_nursing(profile_id): true si la madre tiene >=1 ternero parido y NO destetado.
-- Resuelve los terneros de la madre vía birth_calves (parto) y mira si tienen weaning.
create or replace function public.compute_nursing (profile_id uuid)
returns boolean language plpgsql security definer stable
set search_path = public as $$
declare v_nursing boolean;
begin
  select exists (
    select 1
    from public.reproductive_events be                      -- partos de la madre
    join public.birth_calves bc on bc.birth_event_id = be.id
    where be.animal_profile_id = profile_id
      and be.event_type = 'birth'
      and be.deleted_at is null
      and not exists (                                       -- ese ternero NO fue destetado
        select 1 from public.reproductive_events we
        where we.animal_profile_id = bc.calf_profile_id
          and we.event_type = 'weaning'
          and we.deleted_at is null
      )
  ) into v_nursing;
  return v_nursing;
end; $$;
grant execute on function public.compute_nursing (uuid) to authenticated;

-- Trigger: recomputar nursing de la MADRE afectada en birth/weaning (insert/update/delete).
-- En birth: la madre es new.animal_profile_id. En weaning: la madre se resuelve desde el ternero
-- (new.animal_profile_id = ternero) vía birth_calves -> birth_event -> madre.
-- Se usa SECURITY DEFINER + apply via update directo de nursing (NO toca category_id: ortogonal RT2.9.2).
-- [el implementer escribe la función tg_reproductive_events_recompute_nursing siguiendo este contrato]
```

> El detalle del trigger de nursing (resolver la madre en `weaning`, recomputar en insert/update/delete) lo escribe el implementer siguiendo el contrato de DD-3. **Invariante crítica:** el UPDATE de `nursing` **no** debe disparar el trigger de override de categoría (`0021`/`0040` escuchan `OF category_id`, no `nursing`, así que no se gatilla — verificado contra as-built). El UPDATE de `nursing` tampoco debe gatear el path de dientes/CUT de spec 03 (`0054` escucha `OF teeth_state, is_cut, category_id`, no `nursing`). Sin colisión.

### 3.5 `refresh_age_categories()` + `pg_cron` nocturno (0066) — red de seguridad de edad

**[DECISIÓN · design]** DD-1, camino 2. Función de mantenimiento de sistema + extensión + schedule. **Cross-tenant por diseño** (job de sistema) → revocada de todo rol cliente.

**El filtro targeted (la pieza clave).** El job NO recalcula todo el padrón: corre un `SELECT` indexado barato que caza **solo** los perfiles cuya categoría guardada quedó **atrás de su edad**. Para cría bovina los únicos cortes por edad son:
- **Corte de 1 año** (`ternero`/`ternera` → siguiente): perfil en `ternero`/`ternera` con `edad ≥ 365`.
- **Corte de 2 años** (`torito`/`novillito` → `toro`/`novillo`): perfil en `torito`/`novillito` con `edad ≥ 730`.
- Las **hembras no tienen corte de 2 años**: `vaquillona → vaca…` ocurre **solo por parto**, nunca por edad. Por eso `vaquillona`/`vaquillona_prenada`/`vaca_*`/`multipara` **no** entran al filtro. Tampoco entran `toro`/`novillo` (ya son la categoría terminal por edad) ni las hembras `vaquillona+`.

Eso hace que el filtro cace **exactamente** los cruces de edad, ni uno más. En estado estable recalcula 0 perfiles (o los pocos que justo cumplieron el umbral ese día). El `compute_category` por candidato es solo la confirmación + el `apply_auto_transition` solo si el target difiere; el filtro es lo que evita recomputar a todos.

```sql
-- 0066_age_categories_cron.sql — red de seguridad de edad (DD-1, camino 2).
-- refresh_age_categories(): job de sistema, CROSS-TENANT POR DISEÑO. Revocada de todo rol cliente.
-- Recalcula SOLO los perfiles age-stale (filtro targeted), no el padrón entero.

create extension if not exists pg_cron;

create or replace function public.refresh_age_categories ()
returns void language plpgsql security definer
set search_path = public as $$
declare
  r record;
  v_target uuid;
begin
  -- FILTRO TARGETED: solo perfiles cuya categoría guardada quedó atrás de su edad.
  -- Cría bovina: corte 1 año (ternero/ternera) y corte 2 años (torito/novillito).
  -- Hembras NO tienen corte de 2 años (vaquillona->vaca es por PARTO). Por eso solo
  -- ternero/ternera @365 y torito/novillito @730 entran. Override y soft-delete excluidos.
  for r in
    select p.id as profile_id, p.category_id as current_cat
    from public.animal_profiles p
    join public.categories_by_system c on c.id = p.category_id
    join public.animals a on a.id = p.animal_id
    where p.category_override = false
      and p.deleted_at is null
      and a.birth_date is not null
      and (
        (c.code in ('ternero','ternera')   and (current_date - a.birth_date) >= 365)
        or
        (c.code in ('torito','novillito')  and (current_date - a.birth_date) >= 730)
      )
  loop
    -- compute_category hace el trabajo real (misma fuente de verdad que el on-event).
    v_target := public.compute_category(r.profile_id);
    -- Aplica SOLO si difiere → no escribe de gusto, no genera history espurio.
    if v_target is not null and v_target is distinct from r.current_cat then
      perform public.apply_auto_transition(r.profile_id, v_target);  -- history auto_transition (RT2.8.4b)
    end if;
  end loop;
end; $$;

-- SEGURIDAD (CRÍTICO — clase SEC-HIGH-01): cross-tenant by-design → NO invocable por clientes.
-- Solo la invoca el scheduler de pg_cron. Mismo revoke que apply_auto_transition (0042).
revoke execute on function public.refresh_age_categories () from public, authenticated, anon;

-- Schedule idempotente: si el job ya existe, re-schedule reemplaza (no acumula).
-- Patrón Supabase: cron.schedule por nombre estable es idempotente (upsert por jobname).
select cron.schedule('refresh_age_categories_nightly', '0 3 * * *',
                     $cron$ select public.refresh_age_categories(); $cron$);

notify pgrst, 'reload schema';
```

> **Por qué `apply_auto_transition` y no `UPDATE category_id` directo.** El cron cambia categoría **solo** vía `apply_auto_transition` (que setea el GUC `rafaq.is_auto_transition` y registra el history como `auto_transition`, `0031`/`0030`). Reusar el camino confiable da: (a) el registro en `animal_category_history` gratis (RT2.8.4b / RT2.10.3); (b) coherencia con todas las demás transiciones automáticas; (c) un solo lugar que escribe `category_id` automáticamente. `apply_auto_transition` está revocada de clientes (`0042`) pero el cron, al ser `SECURITY DEFINER`, corre como owner y puede invocarla.

> **Idempotencia del schedule.** `cron.schedule(jobname, schedule, command)` con un `jobname` estable hace **upsert** por nombre (la columna `jobname` de `cron.job` es única en Supabase). Re-correr la migración no duplica el job. El implementer confirma el patrón exacto contra la versión de `pg_cron` del proyecto; si la versión no soporta upsert por nombre, hacer `cron.unschedule('refresh_age_categories_nightly')` (ignorando el error de "no existe") antes del `cron.schedule` para garantizar idempotencia.

> **Nota de orden / dependencias.** `0066` depende de que `compute_category` (0062) y `apply_auto_transition` (as-built `0031`, revocada `0042`) existan — se cumple porque `0066` es la última migración del delta. El filtro lee `categories_by_system.code`, que ya tiene `novillito`/`novillo` por el seed `0059`. No toca ninguna migración existente.

---

## 4. Seguridad (ADR-019) — explícito para Gate 1

| Vector | Mitigación | Req |
|---|---|---|
| `apply_auto_transition` reintroducida como RPC | **No se toca su grant**; sigue `revoke execute … from public, authenticated, anon` (`0042`). Los triggers nuevos (incremental, castración, nursing) la invocan como `SECURITY DEFINER` (corren como owner). Re-emisión idempotente del revoke en `0065` (patrón `0055`). | RT2.12.2 |
| `compute_category` cross-tenant | `SECURITY DEFINER STABLE`, deriva todo del `profile_id` recibido (joins a `animal_profiles`/`animals`/`rodeos`); no recibe ni usa `establishment_id` del cliente; EXECUTE a `authenticated` igual que as-built (es lectura pura, no escribe). | RT2.12.3 |
| `is_castrated` cross-tenant | Vive en `animals`, gobernada por la RLS existente de `animals` (`0022`, SELECT/UPDATE derivados de presencia de perfil con `has_role_in`). La columna nueva **no** agrega policy → hereda el aislamiento. No hay grant nuevo. | RT2.12.1, RT2.12.5 |
| Trigger de castración escribe categoría de otro tenant | El trigger resuelve el `animal_profile` **activo del propio animal** (`where animal_id = new.id`), cuyo establishment es el del usuario que pudo actualizar `is_castrated` (la RLS de `animals` ya lo filtró antes de que el UPDATE llegue al trigger). No recibe `profile_id` del cliente. | RT2.12.4, RT2.12.5 |
| `compute_nursing` cross-tenant | `SECURITY DEFINER STABLE`, deriva del `profile_id`; `nursing` UPDATE solo sobre el perfil de la madre resuelto vía `birth_calves` (filtrado por la presencia del evento, mismo tenant). | RT2.12.1 |
| Spoofing de transición vía evento ajeno | Las transiciones se disparan por triggers sobre `reproductive_events`/`animals`, cuyas policies de INSERT/UPDATE (`0026`/`0022`) ya exigen `has_role_in`. Un usuario no puede insertar un `weaning`/`service`/`birth`/`abortion` sobre un perfil de otro tenant ni togglear `is_castrated` de un animal ajeno. | RT2.12.5 |
| **`refresh_age_categories()` invocada como RPC cross-tenant (IDOR catastrófico)** | **Cross-tenant POR DISEÑO** (job de sistema de mantenimiento de categorías por edad): cambia `category_id` de perfiles de **cualquier** establecimiento. Si fuera invocable por un cliente sería un IDOR de la misma clase que `apply_auto_transition` (SEC-HIGH-01). **Mitigación:** (a) `revoke execute … from public, authenticated, anon` (`0066`) + sumada al **smoke-check fail-closed** (paridad `0055`/M01); solo la invoca el rol del scheduler `pg_cron`. (b) **sin params del cliente** (no recibe `profile_id`/`establishment_id`). (c) cambia categoría **solo** vía `apply_auto_transition` (ya revocada, RT2.12.2), no hace `UPDATE category_id` directo. (d) **no devuelve datos** a ningún caller (`returns void`, job de efecto). | RT2.8.4d, RT2.12.6 |

**SEC-SPEC-M01 (Gate 1, defensa en profundidad).** Además del revoke de `apply_auto_transition`, `0065`
revoca **nominalmente** las 3 funciones-trigger nuevas (`tg_reproductive_events_apply_transition`,
`tg_animals_apply_castration`, `tg_reproductive_events_recompute_nursing`) de `public/authenticated/anon`
y las suma al smoke-check fail-closed (paridad con `0055`). No es un hueco explotable (las funciones que
retornan `trigger` no se exponen por PostgREST), pero el revoke nominal + smoke-check cierran el patrón y
previenen una regresión futura. Ver `tasks-tier2-categorias.md` T7.

**SEC-SPEC-M02 (Gate 1, CRÍTICO — `refresh_age_categories`).** A diferencia de las funciones-trigger
(que retornan `trigger` y NO se exponen por PostgREST), `refresh_age_categories()` retorna `void` y, sin
revoke, **SÍ quedaría expuesta como RPC de PostgREST** (`POST /rest/v1/rpc/refresh_age_categories`). Como
es `SECURITY DEFINER` y cambia `category_id` **cross-tenant por diseño**, una invocación cliente sería un
IDOR catastrófico de clase SEC-HIGH-01 (idéntico al de `apply_auto_transition` que el `0042` cerró). Por eso
el `revoke execute … from public, authenticated, anon` de `0066` **no es defensa en profundidad sino el
control de seguridad principal** de esta función, y `0066` la **suma al smoke-check fail-closed** (la
migración FALLA si quedó EXECUTE-able por una rol cliente). El test T8.n verifica explícitamente que
`authenticated` no puede invocarla. Ver `tasks-tier2-categorias.md` T7bis/T8.n.

**Multi-tenancy**: este delta toca `animals` + `animal_profiles` (ambas con `establishment_id` directo/transitivo y RLS as-built). **No** agrega tablas. Hereda el aislamiento existente; no introduce ninguna policy nueva ni función `SECURITY DEFINER` invocable como RPC pública: las nuevas son `compute_nursing` (lectura, EXECUTE a authenticated, paralela a `compute_category`), los triggers internos, y `refresh_age_categories()` —que **sí** es `SECURITY DEFINER` y cross-tenant, pero está **revocada de todo rol cliente** (`0066`) y solo la invoca `pg_cron`, ver SEC-SPEC-M02; no es una superficie cliente—. **Offline-first**: este delta es backend puro de transiciones; los eventos que las disparan (`weaning`/`service`/`birth`/`abortion`) ya sincronizan vía PowerSync (spec 02 R13.1). `is_castrated` (en `animals`) y `nursing` (en `animal_profiles`) viajan con tablas ya sincronizadas; el cliente preview-ea la transición con `transitions.ts` (R13.4) — la alineación del espejo cliente es RT2.20 (frontend posterior). No hay nada nuevo que agregar a las sync rules (las columnas viajan con sus tablas). El cron nocturno corre **server-side** y su efecto (un `category_id` actualizado) **sincroniza al cliente** por la misma sync rule de `animal_profiles` en la próxima conexión — coherente con offline-first: el cliente no necesita estar online en el momento del cron, recibe el cambio cuando vuelve a sincronizar.

---

## 5. Alternativas descartadas

**A1 — Mantener el trigger incremental con targets hardcodeados (como `0031`), en paralelo a `compute_category`.**
Descartada. Con 3 transiciones era manejable; con servicio + destete (lee `is_castrated`) + parto-desde-cualquier-categoría + aborto + cortes de edad, dos copias de la lógica (incremental + recompute) **divergen** garantizadamente — y la divergencia es exactamente el bug que el context marca como la lección dura ("si una regla vive solo en el trigger, editar/borrar el evento la revierte por edad"). **Elegido:** el incremental **delega a `compute_category`** (§3.2). Una sola fuente de verdad de la lógica. Trade-off: un `compute_category` por evento (un par de `count`/`exists` sobre `reproductive_events` del perfil, indexado por `reproductive_events_by_profile_date` `0026`) — barato, O(log n), y solo corre para los 5 `event_type` que participan.

**A2 — `is_castrated` en `animal_profiles`.**
Descartada (ver DD-2): la castración es física, no de la presencia en un campo; viajaría inconsistente en transferencias y duplicaría la verdad. `animals` es el lugar natural (junto a `sex`/`birth_date`).

**A3 — Cría al pie 100% derivado on-read (función/vista, sin columna).**
Descartada (ver DD-3): se consulta en listas de cientos de vacas + analytics → una subconsulta por fila es cara. Se materializa en `animal_profiles.nursing` (igual que la categoría se almacena). El derivado `compute_nursing` existe igual, pero como **fuente del trigger** y para recálculo, no como la lectura caliente.

**A4 — Recompute masivo de todos los perfiles en la migración.**
Descartada (ver DD-4): riesgoso con overrides, no auditado evento-a-evento, y las reglas nuevas no rompen las categorías existentes (las nuevas solo se alcanzan con `is_castrated=true`, que arranca en `false`). Convergencia on-event.

**A5 — Cron / `pg_cron` nocturno para cortes de edad. → ELEGIDA (revisión 2026-06-04).**
*Razonamiento original (descartada):* "infra nueva, on-recompute alcanza, el queda-viejo-hasta-el-próximo-evento es aceptable". **Invertido:** Raf rechazó ese trade-off — un `ternero` que cumple el año y al que nadie toca queda mal categorizado indefinidamente, y eso degrada las listas/analytics (uno de los tres pilares del producto). El `pg_cron` nocturno **targeted** (no full-padrón) cierra ese hueco con costo operativo despreciable: Supabase free soporta `pg_cron` (es una extensión de Postgres, no un scheduler externo), el filtro indexado recalcula 0-pocos perfiles por noche, y el cómputo es trivial para un beta. La "infra nueva" que el razonamiento original temía es una `create extension` + un `cron.schedule`, no un servicio aparte. **Elegido:** dos caminos complementarios (on-event primario instantáneo + cron nocturno como red de seguridad de 24h) — DD-1, §3.5. El "no hay cron" de R7.8 base se reinterpreta: ese requisito apuntaba a no tener un job que recompute **todo el padrón por reloj**; el cron targeted **no** hace eso (caza solo los cruces de edad), así que respeta el espíritu de R7.8 (no recálculo masivo continuo) mientras cierra el staleness.

**A6 — RPC `compute_category`-on-entry / recompute al abrir la ficha (lógica de cliente).**
Descartada (por preferencia de Raf en la revisión). Alternativa: que el cliente llame `compute_category` y proponga el cambio al abrir la ficha de un perfil sin override. Problemas: (a) solo refresca lo que el usuario **abre** — un animal que nadie consulta sigue viejo (el mismo hueco que se quería cerrar); (b) mezcla lógica de transición en el cliente, contra el principio de mantener `compute_category` como única fuente de verdad server-side; (c) requiere alinear el espejo cliente más agresivamente. El cron server-side targeted es más simple, completo (cubre todo el padrón age-stale, no solo lo abierto) y mantiene toda la lógica en la DB. Se mantiene como **opción de cliente NO requerida** (el cliente puede previsualizar la categoría, pero la verdad la materializa el backend).

---

## 6. Cobertura design → requirements

| Sección design | Requirements |
|---|---|
| DD-1 (edad: on-event primario) + §3.1 cortes de edad | RT2.3.x, RT2.8.1, RT2.8.3 |
| DD-1 (cron nocturno targeted) + §3.5 `refresh_age_categories` + cron | RT2.8.2, RT2.8.4, RT2.8.5, RT2.12.6 |
| DD-2 (`is_castrated` en `animals`) + §3.3 trigger castración | RT2.2.1–RT2.2.6, RT2.12.1, RT2.12.4 |
| DD-3 (`nursing` columna + `compute_nursing`) + §3.4 | RT2.9.1, RT2.9.2, RT2.9.3 |
| DD-4 (no tocar histórico) | RT2.13.1, RT2.13.2 |
| §2 seed novillito/novillo | RT2.1.1, RT2.1.2, RT2.1.3 |
| §3.1 `compute_category` rama macho | RT2.3.1–RT2.3.5 |
| §3.1 `compute_category` rama hembra (+ aborto-revierte-tacto) | RT2.4.1–RT2.4.6, RT2.7.5 |
| §3.2 incremental delega a compute_category | RT2.5.x, RT2.6.x, RT2.7.1, RT2.7.3, RT2.7.4, RT2.10.1 |
| §3.2 recálculo (0046 ampliado) cubre service/weaning/abortion | RT2.10.2, RT2.10.3 |
| §3.3 trigger castración registra history | RT2.10.4, RT2.2.3, RT2.2.4 |
| §4 seguridad | RT2.12.1–RT2.12.6 |
| §5 alternativas | A1 (consistencia), A2 (ubicación), A3 (nursing), A4 (migración), A5 (cron ELEGIDO), A6 (RPC-on-entry descartada) |
