# Spec 02 — Delta NOMBRE/APODO por rodeo (#2, parte toggle) — Requirements (EARS)

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (baseline `done`) · **CON BACKEND** (seed de `field_definitions`) · **Gate 1 condicional** (toca `field_definitions` — el `security_analyzer` decide) · **Deploy autorizado** (lo aplica el leader por MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5) · **Migración `0119`**.
**Fecha**: 2026-07-01.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-nombre-apodo.md` (Gate 0 aprobado, opción **(b)**). Decisiones D1–D4 traducidas a EARS; ver override de criterio propio abajo.
**Numeración**: `RNA.<n>` ("Nombre/Apodo"). No colisiona con `R<n>` / `RAF.<n>` / `RAR.<n>` / `RCAP.<n>` / `R13.<n>` del baseline y otros deltas de spec 02.

---

## ⚠️ Decisiones de criterio propio para Puerta 1

Tres decisiones que el `spec_author` cerró por criterio propio (el leader las marcó como flags de Puerta 1). Raf las ratifica o corrige al aprobar la spec.

### DP1 — Seed **por establecimiento**, NO global (OVERRIDE de la letra de D1)

**Contexto D1 pedía `establishment_id = NULL` (global).** La investigación del as-built lo **descarta**: el flujo custom que D4 manda reusar (`CustomPropertiesForm` en el alta + `CustomPropertiesFicha` en la ficha) lee por dos queries locales que **filtran `fd.establishment_id IS NOT NULL`**:

- `buildEnabledCustomFieldsQuery(rodeoId, 'propiedad')` (usada por `fetchEnabledCustomProperties`) → alimenta el input del alta y la sección editable de la ficha.
- `buildCustomAttributesQuery(profileId)` → alimenta los current-values de la ficha.

Un `field_definition` **global** de `data_type='propiedad'` **sincronizaría** (stream `catalog_field_definitions`, `establishment_id IS NULL`) y **se podría habilitar** en un rodeo desde `editar-plantilla` (que lee el catálogo entero sin filtro de tenant), **pero NUNCA se renderizaría en el alta ni se mostraría en la ficha** — la feature quedaría muerta. El concepto `propiedad` es establishment-scoped por diseño (0093 introdujo `propiedad` solo para datos custom del owner; ningún seed global de `0018` es `propiedad`; hasta el helper e2e `seedCustomField` inserta con `establishment_id`).

**Resolución (DP1):** seedear el "apodo" **por establecimiento existente** (`establishment_id = <cada est>`, `data_type='propiedad'`). Es la **única** opción compatible con D4 (cero cambios de query/cliente): una fila per-est es indistinguible de un dato custom creado por el owner → fluye por el mecanismo vigente de punta a punta (habilitar → renderizar en alta → guardar en `custom_attributes` → mostrar en ficha), **sin tocar RLS ni queries ni gating**.

**Alternativa descartada (para Puerta 1):** seed global + **relajar** las dos queries a `(fd.establishment_id IS NOT NULL OR fd.data_type = 'propiedad')`. Descartada porque contradice D4 ("sin mecanismo nuevo"), toca queries compartidas por el gating/dedup y sumaría superficie a Gate 1. Documentada en `design-nombre-apodo.md` §Alternativa descartada.

### DP2 — Cobertura de establecimientos **futuros** — ⏸ DIFERIDA (Puerta 1): backfill-only, auto-seed a backlog

**Resolución de Puerta 1 (leader, 2026-07-01):** **backfill-only** — el delta seedea el "apodo" **solo para los establecimientos existentes** (RNA.1.1). Los establecimientos **futuros** NO quedan auto-seedeados: su owner crea el "apodo" on-demand con el flujo custom existente (el `+` "Crear dato personalizado" en `editar-plantilla`) — poca fricción, cero riesgo.

**Por qué NO el trigger** (que este `spec_author` había especificado en la pasada anterior): instalar un `AFTER INSERT ON establishments` que inserta en `field_definitions` dispara el guard `tg_field_definitions_custom_guard` (0093), que con `auth.uid()` no-null (onboarding autenticado) exige `is_owner_of(new.id)`; ese rol lo crea el otro trigger `on_establishment_created` (0011), y Postgres dispara los AFTER ROW triggers en **orden alfabético de nombre** → el trigger del apodo dependería de sortear **después** de `on_establishment_created`. Un mis-ordering **rompe el alta de establecimientos** (spec 01, onboarding). Ese riesgo es **inmediato** (el trigger corre en cada alta de establecimiento) para un valor **diferido** (solo aplica al 2º+ establecimiento). Un onboarding roto es mucho peor que "crear el apodo a mano" → no va.

**Backlog (fast-follow, `docs/backlog.md`):** auto-seed **seguro** del "apodo" para ests futuros — foldeado dentro de `handle_new_establishment` (0011) con secuencia explícita (insertar el fd DESPUÉS del `INSERT` del rol owner en la misma función), sin depender del orden alfabético de triggers.

### DP3 — `category='identificacion'` para el fd

D1 dijo "category apropiada (general/identificación)". Elijo **`identificacion`**: (a) semánticamente el apodo es un nombre/identificador; (b) es una categoría documentada en `0018` (comment de la tabla) con label es-AR mapeado ("Identificación") en `rodeo-template.ts:categoryLabel`; (c) lo agrupa en una sección "Identificación" en `editar-plantilla`, distinguiéndolo de los datos ad-hoc que caen en "Personalizado" (`CUSTOM_FIELD_CATEGORY`). Alternativa: `personalizado` (consistencia con los custom del `+`). Puerta 1 decide.

### DP4 — Remoción del built-in del alta (alcance exacto)

Se remueve **solo** el input **editable** "Nombre / seña (opcional)" (el que se muestra por default, `crear-animal.tsx` ~L1287-1296). Se **conserva** el display read-only `prefillKind === 'visual'` (~L1267-1274): es el camino find-or-create-por-texto (spec 09 R1.4) donde el operario ya tipeó ese identificador en el buscador — no es un "campo default que molesta a quien no lo usa", es un identificador ya comprometido. Puerta 1 decide si también se quiere tocar ese camino (fuera de alcance de este delta; sería spec 09).

---

## Requirements

### RNA.1 — Seed del `field_definition` "apodo" (D1, per-est por DP1)

**RNA.1.1** — La migración `0119` deberá insertar, por cada establecimiento existente en `public.establishments`, una fila en `public.field_definitions` con `data_key = 'apodo'`, `label = 'Nombre / apodo'`, `ui_component = 'text'`, `data_type = 'propiedad'`, `category = 'identificacion'`, `active = true` y `establishment_id` igual al `id` de ese establecimiento.

**RNA.1.2** — La migración `0119` no deberá crear una fila "apodo" duplicada para un establecimiento que ya la tenga (idempotencia: `on conflict (establishment_id, data_key) where establishment_id is not null and deleted_at is null do nothing`, reproduciendo EXACTO el predicado del índice único parcial `field_definitions_data_key_per_est` **vigente en el remoto**, que `0101_field_definitions_data_key_partial.sql` redefinió con `... and deleted_at is null` — NO el `0093` original. Sin ese predicado exacto Postgres no infiere el árbitro y aborta con `42P10` — fix del Gate 1).

**RNA.1.3** — La migración `0119` no deberá habilitar el "apodo" en ningún rodeo: no deberá escribir en `rodeo_data_config` ni en `system_default_fields` (el "apodo" arranca deshabilitado hasta que el owner lo habilite por rodeo desde `editar-plantilla`).

**RNA.1.4** — La migración `0119` no deberá insertar el "apodo" con `establishment_id = NULL` (una fila global no se renderizaría en el alta ni en la ficha — ver DP1).

**RNA.1.5** — La migración `0119` no deberá instalar triggers ni funciones sobre `public.establishments` (backfill-only por DP2): el alcance backend es el `INSERT` de backfill de RNA.1.1. Los establecimientos creados después de la migración crean el "apodo" on-demand por el flujo custom existente (fuera de alcance de este delta; auto-seed seguro → backlog).

### RNA.2 — Remoción del built-in "Nombre / seña" del alta (D2)

**RNA.2.1** — El alta (`crear-animal.tsx`, paso 4) no deberá mostrar el input editable "Nombre / seña (opcional)" por default.

**RNA.2.2** — Donde el alta habilita el "apodo" por rodeo, el sistema deberá recolectar y persistir su valor exclusivamente por el flujo de propiedades custom vigente (`CustomPropertiesForm` → `custom_attributes`), sin un input built-in dedicado.

**RNA.2.3** — El alta deberá conservar el display **read-only** del identificador precargado cuando `prefillKind === 'visual'` (camino find-or-create-por-texto de spec 09 R1.4); ese display no cuenta como "campo default que se muestra por default" (DP4).

### RNA.3 — Ajuste de la validación de identificador mínimo (D2)

**RNA.3.1** — Cuando el alta se envía sin ningún identificador (caravana electrónica, caravana visual e identificador precargado todos vacíos), el sistema deberá mostrar un mensaje que enumere solo los identificadores vigentes del alta (caravana electrónica y caravana visual) y no deberá mencionar "nombre/seña".

**RNA.3.2** — El sistema deberá seguir exigiendo al menos un identificador antes de encolar el alta (invariante `hasAtLeastOneIdentifier`, sin regresión sobre R6.2 / `animal_profiles_identity_check`).

### RNA.4 — Ficha: display legacy conservado + apodo por custom_attributes (D3)

**RNA.4.1** — La ficha (`animal/[id].tsx`) deberá seguir mostrando la fila "Nombre / seña" (`visual_id_alt`) solo cuando el animal tiene un `visual_id_alt` no nulo (display condicional de `a25e21f`, sin cambios) — para no perder datos legacy.
> **SUPERADA por `identificadores-unificados` (2026-07-09)**: `visual_id_alt` fue **eliminado** (columna dropeada en `0122`, datos descartados — beta sin data real). La ficha ya **no** muestra "Nombre / seña"; el "apodo" (custom_attributes) es el único nombre. **RNA.4.2 sigue vigente** (apodo por "Datos personalizados"). Ver IDU.1.4.

**RNA.4.2** — Donde el rodeo del animal tiene el "apodo" habilitado, la ficha deberá mostrar su valor por la sección "Datos personalizados" existente (`CustomPropertiesFicha`), sin una fila dedicada nueva.

### RNA.5 — Sin mecanismo nuevo (D4)

**RNA.5.1** — El delta no deberá agregar un mecanismo nuevo de enable/mostrar/guardar del "apodo": deberá reusar `CustomPropertiesForm`, `CustomPropertiesFicha`, `editar-plantilla`, `custom_attributes` y `rodeo_data_config` tal como están (cambios acotados al seed `0119` y a la remoción del built-in del alta).

**RNA.5.2** — El delta no deberá modificar `buildEnabledCustomFieldsQuery`, `buildCustomAttributesQuery`, `custom-fields.ts`, `rodeo-config.ts` ni las policies/streams de `field_definitions`/`rodeo_data_config` (el seed per-est de RNA.1 los satisface sin cambios).

### RNA.6 — Seguridad / no-regresión del seed (Gate 1)

**RNA.6.1** — El seed no deberá romper la RLS de `field_definitions` (0093): una fila per-est sincroniza solo a los devices con rol en ese establecimiento (stream `est_field_definitions_custom`, `establishment_id IN org_scope`) y no fuga a otros tenants.

**RNA.6.2** — El seed no deberá quedar habilitado por default en ningún sistema: no toca `system_default_fields`, por lo que el trigger `tg_rodeos_seed_data_config` no lo pre-puebla en rodeos nuevos (nadie lo tiene enabled sin opt-in del owner).

**RNA.6.3** — Una carga de `custom_attributes` del "apodo" deberá seguir gateada por `assert_custom_field_enabled` (0096): solo se acepta si el "apodo" está `enabled=true` en el `rodeo_data_config` del rodeo del animal (fail-closed), y su value deberá validar como string por `assert_custom_value_valid` (`ui_component='text'`).

**RNA.6.4** — El seed no deberá romper el resto del alta ni de la ficha (sin regresión sobre R4.*, R6.2, R13.10/R13.12, RAF/RAR/RCAP de spec 02).

**RNA.6.5** — La migración `0119` no deberá tocar el path de creación de establecimientos (onboarding, spec 01): al ser backfill-only (sin trigger sobre `establishments`), no deberá introducir riesgo de regresión sobre el alta de establecimientos.

### RNA.7 — Capture del Gate 2.5

**RNA.7.1** — El delta deberá incluir un capture file `app/e2e/captures/nombre-apodo.capture.ts` (no-regresión: `.capture.ts`, no corre en `pnpm e2e`) que capture: (a) el alta SIN el input built-in "Nombre / seña" por default; (b) un rodeo con el "apodo" habilitado → el campo aparece en el alta (sección "Datos personalizados"); (c) la ficha de un animal con el "apodo" cargado mostrándolo por "Datos personalizados".

### RNA.8 — Tests

**RNA.8.1** — El delta deberá cubrir con test la remoción del built-in: el alta no renderiza "Nombre / seña" por default (E2E en `app/e2e/animals.spec.ts` o capture) y el mensaje de identificador mínimo ya no menciona "nombre/seña" (unit sobre la lógica pura si el copy se centraliza, o assertion E2E).

**RNA.8.2** — El delta deberá cubrir con test el flujo custom del "apodo": con el fd seedeado y habilitado en un rodeo, el campo aparece en el alta y su valor persiste en `custom_attributes` y se muestra en la ficha (E2E reusando `seedCustomField`/`seedCustomAttribute`, o el capture de RNA.7).

**RNA.8.3** — El delta debería cubrir con test backend que la fila "apodo" existe per-est tras el seed, que no está en `system_default_fields`, y que un rodeo la puede habilitar (assertion sobre `field_definitions` + `rodeo_data_config`), integrado a la suite backend pertinente si aplica.

> **Reconciliación (implementer):** el test vive en `supabase/tests/custom/run.cjs` `(p)`. Como el seed es **backfill-only** (sin trigger) y la suite crea fixtures frescas (un establishment nuevo no queda auto-seedeado), el test **replica el INSERT del seed** (service_role) sobre su propio establishment y verifica la fila per-est + no-en-`system_default_fields` + no-auto-enabled + colisión del índice parcial (idempotencia) + enable-por-owner + gating de value string/número. Es determinista y no depende de `0119` aplicado; el backfill de los establecimientos **pre-existentes** lo verifica el leader por MCP. Ver `design §Tests / As-built`.

---

## Trazabilidad: context.md → requirements

| Caso/decisión de `context-nombre-apodo.md` | Requirement(s) |
|---|---|
| D1 — seedear fd "apodo" deshabilitado por default | RNA.1 (per-est por DP1; backfill-only de ests existentes por DP2) |
| D2 — sacar el built-in `visual_id_alt` del alta | RNA.2, RNA.3 |
| D3 — ficha conserva display condicional legacy; apodo vía custom_attributes | RNA.4 |
| D4 — sin mecanismo nuevo (reusa el flujo custom) | RNA.5 |
| Alcance backend / Gate 1 (no rompe RLS/gating) | RNA.6 |
| Alcance Gate 2.5 (capture) | RNA.7 |
| Tests | RNA.8 |

## Trazabilidad: requirement → test (a completar por el implementer en `progress/impl_*`)

Cada `RNA.<n>` mapea a ≥1 test. El implementer documenta el mapa `RNA.<n> → archivo:test` en su `progress/impl_<slug>.md`; el reviewer lo verifica.

---

## Historial de refinamiento

- **2026-07-01 — Puerta 1 (leader).** Aprobadas DP1 (seed per-est), DP3 (`category='identificacion'`), DP4 (remover solo el editable, conservar el read-only de `prefillKind==='visual'`).
- **2026-07-01 — Puerta 1 (leader), 1ª pasada DP2.** Se pidió **incluir un trigger** `AFTER INSERT ON establishments` para auto-seedear ests futuros. El `spec_author` lo especificó y, al investigar el as-built del onboarding, encontró que el INSERT del trigger a `field_definitions` dispara el guard `tg_field_definitions_custom_guard` (exige `is_owner_of` con `auth.uid()` no-null) → el trigger dependería del **orden alfabético de disparo** para correr después de `on_establishment_created` (0011); un mis-ordering **rompe el onboarding** (spec 01).
- **2026-07-01 — Puerta 1 (leader), decisión final DP2 = ⏸ DIFERIDA.** Por ese hallazgo, se **retira el trigger** → **backfill-only** (solo ests existentes). Riesgo inmediato de onboarding vs. valor diferido (2º+ est) → no se justifica. Retirados RNA.1.5/1.6/6.5/6.6 de la versión-trigger; **RNA.1.5** reformulado a "no instala triggers/funciones sobre `establishments`" y **RNA.6.5** a "no toca el path de onboarding". Auto-seed **seguro** de ests futuros (foldeado en `handle_new_establishment` 0011, secuencia explícita, sin depender de orden de nombres) → **backlog** (`docs/backlog.md`).
