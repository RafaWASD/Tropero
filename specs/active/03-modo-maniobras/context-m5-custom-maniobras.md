# Spec 03 — chunk M5 — Datos y maniobras CUSTOM — Refinamiento de contexto (Gate 0)

**Status**: ✅ APROBADO por Raf (Gate 0, 2026-06-13, sesión 26).
**Fecha**: 2026-06-13 (sesión 26).
**Conducido por**: leader + Raf (análisis del modelo as-built + 2 decisiones vía AskUserQuestion).
**Related**: spec 03 (MODO MANIOBRAS), ADR-021 (plantilla de datos), `0018_field_template_and_rodeo_config.sql` (as-built), spec 02 (tablas de evento + gating + RLS), feature 15 (PowerSync, frontera WAL), spec 07 (reportes/seguimiento).

> Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad y lo traduce a requirements/design/tasks (folda en spec 03) — no re-decide. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.

## Contexto validado

Diferenciador: permitir al productor **medir/cargar datos que la app no trae de fábrica** (ej.: ángulo de pezuñas adentro/afuera, scores propios) — cosas que los competidores no permiten. En la lista de maniobras y en la config de datos del rodeo hay un **`+`** para crear datos/maniobras custom **por establecimiento**.

**Hallazgo clave (de-riskea todo)**: el modelo as-built (`field_definitions`, `0018`) **ya tiene** las piezas:
- `data_type` (`maniobra | evento_individual | evento_grupal | propiedad`) → **la distinción "se carga 1 vez (propiedad) vs se mide repetido (maniobra/evento)" YA es una columna.** Resuelve el ruido de "nombre vs ángulo de pezuñas" sin inferir nada.
- `ui_component` (`numeric | numeric_stepped | enum_single | enum_multi | date | text | …`) + `config_schema jsonb` → el tipo de input y las opciones de un enum custom (adentro/afuera/normal) ya tienen dónde vivir.
- `rodeo_data_config` FK-ea por `field_definition_id` (no por `data_key`) → los datos custom se prenden por rodeo y heredan gating/offline/RLS **sin colisión de data_key**.

## Modelo (los dos flujos de Raf convergen en un objeto)

Un **dato custom = una fila de `field_definitions` con `establishment_id` del campo** (las 26 de fábrica tienen `establishment_id NULL` = catálogo global). El usuario setea `label`, `data_type` (propiedad|maniobra), `ui_component` + opciones.

Se **habilita por rodeo** en `rodeo_data_config`. Según `data_type`:
- `maniobra` habilitada → aparece en la **lista de maniobras** de ese rodeo.
- `propiedad` habilitada → aparece en el **form de alta + ficha** del animal de ese rodeo.

**Almacenamiento (tablas genéricas nuevas)**:
- **`custom_measurements`** (append-only, time-series): `(id, animal_profile_id, field_definition_id, value jsonb, session_id, recorded_by, recorded_at, …)`. Para `data_type='maniobra'`/evento. Habilita **seguimiento/gráficos gratis** (spec 07).
- **`custom_attributes`** (current-value, upsert): `(animal_profile_id, field_definition_id, value jsonb, updated_by, updated_at, PK (animal_profile_id, field_definition_id))`. Para `data_type='propiedad'` (ej. nombre). Editable anytime; sin historial (patrón `teeth_state`).

## Decisiones lockeadas por Raf (2026-06-13)

1. **Timing**: custom va **DENTRO del MVP** como **chunk M5**, después del core de 10 maniobras. El modelo se hornea data-driven ahora (M3 renderiza desde `ui_component`); la UI de creación custom es su propio chunk gateado.
2. **Alcance**: MVP custom cubre **mediciones repetibles (`maniobra`) + atributos de una carga (`propiedad`)** — ambos. Por eso van los dos stores genéricos.

## Casos y decisiones

- **Dos entry points, mismo objeto**: `+` en config de datos del rodeo = crea propiedad **o** maniobra (hace la pregunta de clasificación). `+` en la lista de maniobras = crea **solo `data_type='maniobra'`** (+ la habilita en el rodeo de una). Por construcción, desde el `+` de maniobras **"nombre" no puede volverse maniobra** → la ambigüedad desaparece.
- **Pregunta de clasificación al crear** (en el `+` de config de datos): *"¿Es un dato fijo del animal (se carga una vez, tipo nombre) o algo que medís y seguís en el tiempo (tipo ángulo de pezuñas)?"* → setea `data_type`. **No se infiere.** Backstop: si lo crea mal, lo desactiva/soft-deletea (no pierde historia).
- **1 dato = 1 maniobra custom** en MVP. Maniobra custom multi-campo = post-MVP.
- **Tipos de input ofrecidos** (default): `numeric`, `numeric_stepped`, `enum_single` (con opciones), `enum_multi` (con opciones), `text`, `boolean`, `date`. (Confirmable en design.)
- **Quién crea** datos custom: **owner** (consistente con `rodeo_data_config` INSERT owner-only de `0018`). **Capturar** la maniobra/propiedad custom en la manga/ficha = cualquier rol operativo activo (paridad con las maniobras de fábrica).
- **Propiedad custom**: editable en cualquier momento por owner/creador; se muestra en alta + ficha en los rodeos donde está enabled.
- **Borrado**: soft-delete del `field_definitions` custom (preserva las `custom_measurements` ya cargadas); deja de ofrecerse en maniobras/forms nuevos.
- **Gating capa 2 genérico (fail-closed)**: trigger `BEFORE INSERT` en `custom_measurements` y `BEFORE INSERT/UPDATE` en `custom_attributes` que valida que el `field_definition_id` esté `enabled=true` en el `rodeo_data_config` del rodeo **del animal** (mismo patrón data-driven que los 10; rechaza `23514` si no). Reusa la resolución inline de rodeo de spec 03.
- **Validación server-side del `value` por `ui_component`** (numérico es numérico; enum ∈ opciones de `config_schema`; cap de largo de text) — defensa autoritativa (el cliente escribe a PostgREST directo). Caps en la creación: largo de `label`, cantidad/largo de opciones, shape de `config_schema`.
- **Offline**: `field_definitions` custom + `rodeo_data_config` + `custom_measurements` + `custom_attributes` sincronizan **scope establishment** (PowerSync, CRUD-plano de feature 15); las `field_definitions` globales (NULL) siguen read-only para todos. **Frontera WAL**: las filas custom NO deben sincronizar a un device sin rol en ese establishment → la sync rule scopea custom por `establishment_id` (Gate 1).
- **Analytics**: los datos custom son **seguimiento intra-campo**, NO **benchmarking cross-tenant** (no se compara contra otros campos un dato inventado por uno).

## Fuera de alcance (MVP)
- Maniobra custom multi-campo (1 dato = 1 maniobra en MVP).
- Fotos/archivos como valor custom (Storage diferido, ver feature 15).
- Datos custom en la declaración SIGSA (feature 08 no los toca).
- Benchmarking cross-tenant de datos custom.

## Delta backend (reabre schema → Gate 1 OBLIGATORIO)
- `field_definitions`: + `establishment_id uuid null references establishments(id)` (NULL = global de fábrica); abrir RLS (hoy SELECT `using(true)`, sin INSERT cliente) → SELECT `establishment_id is null OR has_role_in(establishment_id)`; INSERT/UPDATE `with check (establishment_id is not null and is_owner_of(establishment_id))` (el owner crea custom SOLO en su campo, **nunca** global); relajar `data_key unique` a `(establishment_id, data_key)` o keyear por `id` (rodeo_data_config ya FK-ea por id). + columnas que falten para custom (`deleted_at` para soft-delete).
- Tabla `custom_measurements` (genérica, append-only) + FK `session_id` + trigger gating genérico + tenant-check + RLS canónico.
- Tabla `custom_attributes` (genérica, current-value) + trigger gating + RLS canónico.
- Delta de sync rules (feature 15): scope establishment de las filas custom.
- Migraciones: próximo número libre (as-built ~0089; **confirmar contra el árbol y las terminales paralelas** antes de crear archivos). Deploy a la DB compartida gateado por el leader.

## Impacto en los otros chunks de spec 03
- **M1** (lista de maniobras): la lista = 10 de fábrica gateadas + las `field_definitions` custom `data_type='maniobra'` enabled en el rodeo. El `+` crea una.
- **M3** (paso de maniobra): renderiza desde `ui_component` (generaliza; de-hardcodea los 10). Las custom escriben a `custom_measurements`; las de fábrica a sus tablas tipadas.
- **M2.0 design spike**: NO bloqueado. Conviene que el paso renderice genérico desde `ui_component` (un `enum_single` "adentro/afuera" = 2-3 bloques full-width = el showcase de los botones gigantes).

## Insumos para spec_author
- ADR-021 + `0018_field_template_and_rodeo_config.sql` (modelo de plantilla as-built).
- spec 02 (tablas de evento, gating capa 2, RLS canónico, `establishment_of_profile`).
- feature 15 (PowerSync CRUD-plano + sync rules + frontera WAL).
- Este context.

## Aprobación
- **✅ APROBADO por Raf el 2026-06-13** (sesión 26). Las 2 decisiones de timing (M5 dentro del MVP) y alcance (mediciones + atributos) quedan lockeadas. `spec_author` folda esto en spec 03 (nuevo chunk M5 + delta backend con Gate 1 obligatorio + tweaks forward-looking de M1/M3). No re-decide nada de acá.
