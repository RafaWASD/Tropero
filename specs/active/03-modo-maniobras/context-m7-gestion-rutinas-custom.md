# Gate 0 — Contexto: Gestión de rutinas y datos custom (editar + borrar) — spec 03, chunk M7

> Refinamiento de contexto (ADR-022) que **cablea la UI de gestión** que faltaba en US-2 (presets) y **completa R13.19/R13.26** (borrado/edición de datos custom), cuya lógica de datos ya existe pero no tenía acción de usuario.
> Estado: **cerrado, pendiente OK de Raf** (2026-06-19). Al aprobarse → `spec_author` redacta el delta de requirements/design/tasks.

## 1. Origen y problema

Testing en vivo: "si creé mal una rutina o una maniobra personalizada, ¿cómo la borro/corrijo?". Hoy **no se puede desde la app**, aunque el modelo de datos ya lo contempla:

- **Rutinas (presets):** el service `softDeletePreset` (RPC `soft_delete_maneuver_preset` 0057, OUTBOX) y `updatePreset` (renombrar + reconfigurar) **ya existen** — `app/src/services/maneuver-presets.ts`. Falta **solo cablear UI**: ninguna pantalla los invoca.
- **Datos custom (maniobra/propiedad):** R13.19 (soft-delete preservando capturas) y R13.26 (columnas editables = `label`, `config_schema`, `active`, `deleted_at`; el resto inmutable) están en la spec y la DB los soporta (`deleted_at` en `field_definitions` 0093, RLS, guard), **pero no existe el service de borrado/edición** ni la UI.

Es completar UI + un service nuevo, **no rearquitectura**. Reconcilia además la contradicción spec↔código de R13.19 (speceado, UI sin cablear).

## 2. Alcance del chunk

**Rutinas — en `app/app/maniobra.tsx` ("Tus rutinas", cada `PresetRow`):**
- Menú **⋯** por fila → **Editar** y **Eliminar**.
- **Editar** = **Renombrar** (sheet) **+ Reconfigurar maniobras** (reabre el wizard precargado con la config del preset y guarda **sobre el mismo preset** vía `updatePreset`, en vez de crear uno nuevo).
- **Eliminar** = `softDeletePreset` con confirmación.

**Datos custom — en `app/app/editar-plantilla.tsx` ("Editar plantilla del rodeo", owner-only):**
- Menú **⋯** **solo en las filas custom** (`establishment_id` no-NULL) del toggle-list → **Editar** y **Eliminar**. Las filas de fábrica (`establishment_id NULL`) **no** lo muestran.
- **Editar** = `label` + opciones de enum (`config_schema`). **Append-only** en opciones (se agregan/renombran, no se quitan). Re-tipar (`data_type`/`ui_component`/`data_key`) **no** se ofrece — eso es borrar + recrear (R13.26).
- **Eliminar** = **soft-delete** (R13.19) con confirmación **que muestra el impacto** (de cuántos rodeos se saca, cuántas cargas se ven afectadas). _(El "se conservan" original quedó **superado por la Opción B**, Raf 2026-06-20: al borrar, las cargas previas **dejan de verse** en la ficha y la confirmación lo **advierte** — ver §4 abajo + `design.md §13.5`.)_

## 3. Decisiones lockeadas (Gate 0)

1. **Editar rutina = renombrar + reconfigurar** (no solo renombrar). El "la armé mal" se corrige sin borrar/rehacer. _(Raf, 2026-06-19)_
2. **Borrado = confirmar + mostrar impacto, sin "Deshacer".** El snackbar-undo expira sin verse en la manga; el diálogo es más seguro contra borrados accidentales. _(Raf, 2026-06-19)_
3. **Affordance = menú ⋯ por fila** (kebab explícito), **no** swipe ni long-press (invisibles, anti-descubribilidad, anti-manga). _(default leader)_
4. **Permisos:** editar/borrar **rutina = cualquier rol operativo activo** (la RPC 0057 ya lo permite, `has_role_in`, R2.4). Editar/borrar **custom = owner-only** (paridad con crear, R13.2; la RLS UPDATE de `field_definitions` ya exige `is_owner_of`, R13.22/R13.26). _(lockeado spec-03)_
5. **Editar custom = solo `label` + opciones; opciones append-only.** El resto es inmutable (R13.26). _(lockeado spec-03)_

## 4. Edge cases que el diseño debe respetar

- **Borrar una custom la saca de TODOS los rodeos** donde esté habilitada (es objeto de establishment, no de rodeo). La confirmación debe decirlo explícito (≠ "destildar en este rodeo", que es la habilitación per-rodeo de R2.12 y **se conserva** como acción aparte).
- **Lectura histórica — RECONCILIADO a Opción B (MVP, Raf 2026-06-20):** el plan original (la ficha SIGUE mostrando el valor de un dato borrado, JOIN sin filtrar `deleted_at`) NO es viable sin cambiar la sync-stream `est_field_definitions_custom` (que prunea la definición soft-deleteada del device → el INNER JOIN del display no resuelve el `label` → el valor desaparece igual). **Raf eligió Opción B**: en MVP, al borrar un dato custom su histórico **deja de verse** en la ficha; la confirmación de borrado lo **ADVIERTE** (R13.31). La **Opción A** (quitar el filtro de la stream para preservar el histórico → reabre WAL → Gate 1) queda como **fast-follow/backlog**. Los forms/listas **nuevas** siguen filtrando soft-deleted (R13.19). Detalle: `design.md §13.5` + nota R13.30.
- **Borrar una rutina no afecta una jornada ya arrancada:** `loadPreset` copia la config a la sesión al crear; no hay FK viva al preset.
- **Reconfigurar una rutina** reusa el wizard ya construido (jornada.tsx etapas) en modo "editar preset": precarga `loadPreset` y al guardar llama `updatePreset(presetId, …)` en vez de `createSession`/`createPreset`. No arranca jornada.

## 5. Delta backend (lo cierra el design)

- **Rutinas:** sin schema nuevo. Cablear `updatePreset` + `softDeletePreset` ya existentes.
- **Custom:** agregar el **service de soft-delete** (`softDeleteCustomField`) y el de edición (`label`/`config_schema`) — el schema (`deleted_at`, RLS UPDATE, guard de inmutabilidad) **ya está** (0093). **Pregunta para el design:** si el soft-delete custom va por **UPDATE plano** (CRUD outbox) o por **RPC**, según si la SELECT-policy de `field_definitions` filtra `deleted_at` (a diferencia de `maneuver_presets`, cuya policy sí lo filtra → por eso 0057 es RPC para sortear el gotcha RLS-on-RETURNING). Si la policy custom **no** filtra `deleted_at`, alcanza un UPDATE plano por outbox.
- **Caps server-side ya pedidos** (R13.17/R13.27) aplican igual a la edición de `label`/opciones: revalidar en el path de edición, no solo en el alta.
- **Delta backend imprevisto (fix-loop M7, 2026-06-20) — índice UNIQUE custom PARCIAL sobre `deleted_at` (migración `0101`, R13.35).** El reviewer cazó que el índice `field_definitions_data_key_per_est` de `0093` no excluía las filas soft-deleteadas → recrear un dato custom con el mismo slug tras borrarlo colisionaba `23505`, rompiendo el flujo borrar+recrear de R13.26. Es **schema** (drop+recreate del índice) → **reabre el Gate de seguridad de schema**, a diferencia del resto de M7. NO se aplica al remoto en la pasada del implementer (deploy gateado por Raf). Detalle: `design.md §13.3` + R13.35.

## 6. Fuera de alcance

- Re-tipar un dato custom in-place (es borrar + recrear por construcción, R13.26).
- "Recrear con prefill" de la custom borrada (nice-to-have; el `+` actual ya permite recrearla a mano).
- Maniobras custom multi-campo (post-MVP, R13.9).
- Cambios en spec 07 (reportes/gráficos): bajo **Opción B** (Raf 2026-06-20) este chunk NO preserva el histórico de un dato borrado en la ficha (deja de verse; ver §4 + `design.md §13.5`); el resto de reportes es de su propia spec. _(El texto original "garantiza que la lectura histórica no filtre `deleted_at`" era Opción A, **superado**.)_
- Quitar opciones de un enum con capturas (append-only en MVP).
