# Spec 02 — Delta NOMBRE/APODO por rodeo (#2, parte toggle) — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** · **CON BACKEND** (seed `field_definitions`) · **Gate 1 condicional** · **Deploy autorizado** · **Migración `0119`**.
**Requirements**: `requirements-nombre-apodo.md` (RNA.1–RNA.8). **Contexto**: `context-nombre-apodo.md` (Gate 0, opción b).

> Este delta NO reescribe el baseline de spec 02. El índice "Deltas posteriores" del `design.md` baseline se folda al **cerrar** el delta (Puerta 2), con un puntero + nota as-built bajo R6.2 / R13.10.

---

## As-built investigado (crítico — reusamos mecanismo existente)

### Schema de `field_definitions` (0018 + 0093)
- Catálogo GLOBAL (`0018`): `data_key` (único global), `label`, `category`, `data_type` (`maniobra|evento_individual|evento_grupal|propiedad`), `ui_component` (`...|text`), `config_schema jsonb`, `active`. RLS: SELECT a todo authenticated.
- `0093` agregó `establishment_id` (NULL = global de fábrica; no-NULL = custom de un campo) + `deleted_at`; **relajó** la unicidad a dos índices parciales:
  - `field_definitions_data_key_global` — `unique (data_key) where establishment_id is null`.
  - `field_definitions_data_key_per_est` — `unique (establishment_id, data_key) where establishment_id is not null` **⚠ redefinido por `0101` a `where establishment_id is not null AND deleted_at is null`** (as-built vigente en el remoto — es el predicado que el `on conflict` del seed debe reproducir; ver §SQL nota).
- CHECKs de `0093` que la fila del "apodo" (est no-NULL) debe respetar: `data_key` slug `^[a-z0-9_]+$` y ≤64; `label` ≤80; `category` ≤32 (solo custom); `data_type ∈ (maniobra|evento_individual|evento_grupal|propiedad)`; `field_definitions_custom_ui_component_valid` → est no-NULL exige `ui_component` no-null ∈ los 7 (`text` incluido).
- Guard `tg_field_definitions_custom_guard` (before insert/update): **si `auth.uid()` es NULL → `return new`** (backend/seed pasa). Una migración corre sin auth → el INSERT per-est **pasa el guard** sin problema.

### El flujo custom que D4 manda reusar
- **Alta**: `crear-animal.tsx:834` monta `<CustomPropertiesForm rodeoId={selectedRodeo}>`. En submit, `customPropsRef.current.collectValues()` (~L623) recolecta y persiste post-create vía `setCustomAttribute` → `custom_attributes` (patrón soft-fail).
- `CustomPropertiesForm` (`maniobra/_components/CustomPropertiesSection.tsx`) → `fetchEnabledCustomProperties(rodeoId)` → `buildEnabledCustomFieldsQuery(rodeoId, 'propiedad')`.
- **Ficha**: `CustomPropertiesFicha` (misma file) → `fetchEnabledCustomProperties` + `fetchCustomAttributes` → `buildCustomAttributesQuery(profileId)`.
- **Habilitar por rodeo**: `editar-plantilla.tsx` → `fetchFieldCatalog()` (`buildFieldCatalogQuery`, **sin filtro de tenant** → trae globales + custom) + `buildEditToggles` → toggle por field; "Guardar" → `enqueueSetRodeoConfig` → RPC `set_rodeo_config` (0082, owner-only) → `rodeo_data_config`.

### 🔴 El hallazgo que fuerza DP1 (per-est, no global)
`buildEnabledCustomFieldsQuery` y `buildCustomAttributesQuery` (`powersync/local-reads.ts`) **filtran `fd.establishment_id IS NOT NULL`**:

```
-- buildEnabledCustomFieldsQuery(rodeoId,'propiedad')
... WHERE cfg.enabled = 1 AND fd.establishment_id IS NOT NULL AND fd.deleted_at IS NULL
    AND fd.data_type = 'propiedad' AND fd.active = 1
-- buildCustomAttributesQuery(profileId)
... WHERE ca.animal_profile_id = ? AND fd.establishment_id IS NOT NULL AND fd.deleted_at IS NULL
    AND fd.data_type = 'propiedad' AND fd.active = 1
```

Un "apodo" **global** (`establishment_id NULL`): **sincroniza** (`catalog_field_definitions`: `WHERE establishment_id IS NULL`), **se puede habilitar** (`editar-plantilla` lee el catálogo entero), el **gating server acepta** su carga (`assert_custom_field_enabled` 0096 es data-driven por `field_definition_id`, sin check de tenant) — **pero el cliente NUNCA lo renderiza en el alta ni lo muestra en la ficha** (las dos queries de arriba lo excluyen). Feature muerta. → El seed **debe ser per-est** para fluir por el mecanismo vigente **sin tocar queries** (D4). Corrobora: el helper e2e `seedCustomField` (admin.ts) inserta `propiedad` con `establishment_id`.

### Sync + gating verificados para la fila per-est
- `est_field_definitions_custom` (rafaq.yaml): `SELECT * FROM field_definitions WHERE establishment_id IN org_scope AND deleted_at IS NULL` → la fila per-est baja a los devices con rol en ese est (RNA.6.1, sin fuga cross-tenant).
- `assert_custom_field_enabled` (0096): fail-closed; solo acepta si el "apodo" está `enabled` en el `rodeo_data_config` del rodeo del animal (RNA.6.3).
- `assert_custom_value_valid` (0096): `ui_component='text'` → value debe ser string JSON (RNA.6.3).

---

## Archivos a crear / modificar

### Backend
- **CREAR** `supabase/migrations/0119_seed_apodo_field_definition.sql` — **backfill-only** per-est del "apodo" en `field_definitions` para los ests **existentes** (RNA.1). Idempotente. **Sin trigger** sobre `establishments` (DP2 diferida — no toca el path de onboarding). No toca RLS/policies/streams/gating ni `system_default_fields`/`rodeo_data_config` (los reusa). Lo aplica el leader por MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5.

### Frontend
- **MODIFICAR** `app/app/crear-animal.tsx`:
  - Remover el `FormField` editable "Nombre / seña (opcional)" (~L1287-1296) y su prop/handler asociados si quedan sin uso (RNA.2.1). **Conservar** el display read-only `prefillKind === 'visual'` (~L1267-1274) (RNA.2.3).
  - Mantener `visual`/`visualIdAlt`/`hasAtLeastOneIdentifier`: siguen usados por el camino `prefillKind==='visual'`. El handler `onVisual`/`sanitizeVisualInput` del input editable queda sin uso al removerlo → el implementer poda el wiring muerto (o deja `visual` read-only). Sin cambio de contrato público.
  - Ajustar el mensaje de identificador mínimo (~L539): de `'Cargá al menos un identificador: caravana electrónica, caravana visual o nombre/seña.'` a `'Cargá al menos un identificador: caravana electrónica o caravana visual.'` (RNA.3.1). No relajar `hasAtLeastOneIdentifier` (RNA.3.2).
- **NO tocar**: `animal/[id].tsx` (RNA.4 es "conservar/verificar"), `CustomPropertiesSection.tsx`, `custom-fields.ts`, `rodeo-config.ts`, `editar-plantilla.tsx`, `powersync/local-reads.ts` (RNA.5.2).

### Tests / capture
- **CREAR** `app/e2e/captures/nombre-apodo.capture.ts` (RNA.7) — molde: `cria-al-pie-alta.capture.ts` (mismos helpers `helpers/fixtures` + `helpers/admin` + `helpers/ui`, viewport 412×915, `--config playwright.capture.config.ts`). 4 shots: `01-alta-paso4-sin-nombre-sena`, `02-mensaje-identificador-minimo`, `03-apodo-en-datos-personalizados`, `04-ficha-apodo-datos-personalizados`.
- **EXTENDER** `app/e2e/animals.spec.ts` con un bloque `delta #2 nombre/apodo` (RNA.8.1/8.2) reusando `seedCustomField` (habilita el "apodo" en el rodeo) + `waitForServerCustomAttribute` (oráculo server de la carga).
- Unit: el copy del mensaje y el enumerado quedan **inline** en el screen (`crear-animal.tsx`) → se cubren por E2E (RNA.8.1), no por unit puro. `hasAtLeastOneIdentifier` no cambia → sus tests unit siguen verdes.

**As-built (reconciliación implementer):**
- **Backend (T2/RNA.8.3):** el test vive en `supabase/tests/custom/run.cjs` subtest `(p)`. Como el seed es **backfill-only** (sin trigger) y la suite usa fixtures **frescas** (un establishment nuevo NO queda auto-seedeado), el test **replica el INSERT del seed** (service_role) sobre su `estA` y verifica shape + no-auto-enable + colisión del índice parcial (base de idempotencia) + enable-por-owner + gating string/número. Es **determinista** y NO depende de `0119` aplicado (evita depender de estado compartido flakeable); el backfill de los establecimientos **pre-existentes** lo verifica el leader por MCP tras aplicar `0119`.
- **E2E (consecuencia obligatoria de RNA.2.1):** remover el built-in editable rompía **todos** los tests que rellenaban "Nombre / seña (opcional)" como identificador. Se migraron ~17 fills en `animals.spec.ts` + los de `sigsa-breed-renspa.spec.ts`, `maniobra-identify.spec.ts` (helper `walkCrearAnimalWizard`: `opts.visual`→`opts.idv`) y `maniobra-custom-render.spec.ts` (PART B, apodo) a la **caravana visual (idv)** como identificador, con los oráculos server pasados de `{ visualAlt }` a `{ idv }`. Los `seedAnimal({ visualAlt })` por service_role se conservan (testean el display legacy de `visual_id_alt` en la ficha, RNA.4.1). El delta #2 (c) queda además cubierto por `maniobra-custom-render.spec.ts` PART B (apodo custom end-to-end).

---

## SQL del seed (0119) — draft (backfill-only, DP2 diferida)

Una sola parte: **backfill** per-est de los establecimientos **existentes**. **Sin trigger** (DP2 diferida — ver `requirements §DP2` + el porqué abajo). Los ests futuros crean el "apodo" on-demand por el flujo custom vigente.

```sql
-- 0119_seed_apodo_field_definition.sql  (spec 02 delta NOMBRE/APODO #2 — RNA.1)
-- Seed PER-ESTABLISHMENT del dato custom "apodo" (data_type propiedad, ui_component text), deshabilitado
-- por default (no toca system_default_fields → ningún rodeo lo tiene enabled sin opt-in del owner).
-- BACKFILL-ONLY: solo los establecimientos EXISTENTES. Sin trigger sobre establishments (DP2 diferida).
--
-- POR QUÉ PER-EST Y NO GLOBAL (DP1 / design §hallazgo): buildEnabledCustomFieldsQuery + buildCustomAttributesQuery
-- filtran fd.establishment_id IS NOT NULL → un fd global de 'propiedad' NO se renderiza en el alta ni en la ficha.
-- Una fila per-est es indistinguible de un dato custom del owner → fluye por CustomPropertiesForm/Ficha sin cambios.
--
-- El guard tg_field_definitions_custom_guard (0093) deja pasar el INSERT: en migración auth.uid() IS NULL → return new.
-- CHECKs 0093 satisfechos: data_key slug 'apodo', label ≤80, category 'identificacion' (≤32), data_type 'propiedad',
-- ui_component 'text' ∈ los 7. Idempotente sobre el índice parcial field_definitions_data_key_per_est.
--
-- NO aplicar desde acá: lo aplica el LEADER por MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5. Deploy autorizado.

begin;

insert into public.field_definitions
  (establishment_id, data_key, label, description, category, data_type, ui_component, active)
select
  e.id,
  'apodo',
  'Nombre / apodo',
  'Nombre o apodo del animal (texto libre). Por rodeo, opt-in del owner.',
  'identificacion',
  'propiedad',
  'text',
  true
from public.establishments e
on conflict (establishment_id, data_key) where establishment_id is not null and deleted_at is null
do nothing;

notify pgrst, 'reload schema';

commit;
```

Notas:
- `on conflict ... where establishment_id is not null and deleted_at is null` debe reproducir EXACTO el predicado del índice **parcial** `field_definitions_data_key_per_est` para que Postgres infiera el árbitro. ⚠ **Fix Gate 1 (as-built vs. spec):** ese índice lo **redefinió `0101_field_definitions_data_key_partial.sql`** (DROP+RECREATE) con `where establishment_id is not null AND deleted_at is null` — NO el `0093` original (que era solo `establishment_id is not null`). Verificado contra el remoto (`pg_indexes`). Como `establishment_id is not null` NO implica `... and deleted_at is null`, sin el `and deleted_at is null` Postgres no infiere el índice y aborta con `42P10`. Todas las filas insertadas tienen `establishment_id` no-NULL y `deleted_at` NULL (fila nueva) → matchea.
- No se setea `config_schema` (NULL, `text` no usa options), ni `schema_version`/`created_at`/`updated_at` (defaults del server).

## §DP2 diferida — por qué NO un trigger de auto-seed (y qué queda en backlog)

Se **evaluó y descartó** (Puerta 1, decisión final) un trigger `AFTER INSERT ON establishments` que auto-seedee el "apodo" a los ests futuros. El motivo es un hallazgo del as-built del onboarding: un espejo trivial de `tg_rodeos_seed_data_config` (0018) **no** aplica, porque `rodeo_data_config` no tiene guard mientras que `field_definitions` **sí** (`tg_field_definitions_custom_guard`, 0093, before insert — **fira igual** dentro de `SECURITY DEFINER`). En onboarding autenticado (`auth.uid()` no-null) el guard exige `is_owner_of(new.id)`; ese rol lo crea el otro trigger `on_establishment_created` (0011), y Postgres dispara los AFTER ROW triggers en **orden alfabético de nombre** → el trigger del apodo quedaría atado a sortear **después** de `on_establishment_created`. Un mis-ordering **rompe el alta de establecimientos** (spec 01).

**Decisión**: riesgo **inmediato** de onboarding (el trigger corre en cada alta de establecimiento) por un valor **diferido** (solo el 2º+ est) → no se justifica. **Backfill-only**; ests futuros crean el "apodo" on-demand (el `+` de `editar-plantilla`, poca fricción).

**Backlog / fast-follow (`docs/backlog.md`):** auto-seed **seguro** — foldeado dentro de `handle_new_establishment` (0011) vía `CREATE OR REPLACE`, insertando el fd **después** del `INSERT` del rol owner en la **misma función** (secuencia explícita intra-función: el 2º statement ve el 1º, sin depender del orden alfabético de triggers). Es la forma robusta; se pospone porque cruza el baseline de spec 01 y su valor es diferido.

## Multi-tenancy (RLS) — mención explícita

Toca `field_definitions`, tabla con eje de tenant (`establishment_id`). El seed per-est **reusa** la RLS y las streams vigentes (0093 + rafaq.yaml): SELECT global para `establishment_id IS NULL`, custom solo con rol; la fila per-est del "apodo" sincroniza solo dentro de su establecimiento (`est_field_definitions_custom`) → sin fuga cross-tenant (RNA.6.1). El backfill corre por migración (service-role, `auth.uid()` NULL → el guard `tg_field_definitions_custom_guard` hace early-return, sin forzar owner). **Sin trigger** sobre `establishments` → el path de onboarding (spec 01) no se toca (RNA.6.5). Gate 1 (condicional) audita que el seed no reabre ni relaja ninguna policy/stream/gating.

## Offline-first — mención explícita

El "apodo" se carga en el campo (alta en la manga). No hay camino nuevo: el valor se recolecta local (`CustomPropertiesForm`, estado local) y se persiste post-create con el mismo patrón soft-fail que condición/preñez (el animal ya existe; si la escritura de `custom_attributes` falla, se avisa y se sigue). La habilitación por rodeo (`editar-plantilla`) es un write local (`enqueueSetRodeoConfig` + overlay optimista) que dren­a cuando hay red. Sin dependencia de conexión para el alta.

## Alternativa descartada

**Seed global (`establishment_id NULL`) + relajar las dos queries de render** a `(fd.establishment_id IS NOT NULL OR fd.data_type = 'propiedad')`:
- *Pros*: una sola fila para todos los ests (presentes y futuros); no hay backfill ni gap de ests futuros (DP2).
- *Contras*: contradice D4 ("sin mecanismo nuevo"); `buildEnabledCustomFieldsQuery` es compartida por el path `'maniobra'` (relajar con cuidado de scope por `data_type`); toca `local-reads.ts` (queries que alimentan gating/dedup/ficha) → mayor superficie de Gate 1 + regresión; expone cualquier `propiedad` global futura como "custom" en el alta/ficha de todos los tenants.
- *Razón de descarte*: el objetivo es reusar el mecanismo vigente **sin** tocarlo (D4). Per-est lo logra con cero cambios de query. Se deja documentada para que Puerta 1 pueda re-optar si prioriza "una sola fila global" sobre "cero cambios de cliente".

**Trigger `AFTER INSERT ON establishments` para auto-seedear ests futuros** (evaluado y descartado en Puerta 1): rompería el patrón seguro por la interacción con el guard de `field_definitions` + la dependencia del orden alfabético de disparo (riesgo de onboarding). Ver `§DP2 diferida`. El auto-seed **seguro** (fold en `handle_new_establishment` 0011) queda en `docs/backlog.md`.
