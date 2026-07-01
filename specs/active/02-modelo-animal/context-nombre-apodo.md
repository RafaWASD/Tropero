# Spec 02 — Delta NOMBRE/APODO por rodeo (#2, parte toggle) — Contexto (Gate 0)

**Status**: `context_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (`done`) · **CON BACKEND** (seed de un `field_definition` global) · Gate 1 condicional.
**Fecha**: 2026-07-01.
**Origen**: corrección **#2** del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`). Parte 1 (relabel 3→2 caravanas) **ya cerrada** (commit `a25e21f`). Esta es la **parte 2 pendiente**: el toggle por rodeo del "Nombre/apodo".
**Deploy**: **Raf autorizó el deploy en sesión**. La migración (seed) la aplica el leader por MCP tras Gate 1 + reviewer + Gate 2 + Gate 2.5.
**Gate 0**: aprobado por el leader (modo autónomo). **Raf eligió la opción (b)** (2026-07-01): reusar el mecanismo de campos custom existente (ADR-021), NO un toggle built-in nuevo.

---

## Problema

`visual_id_alt` (texto libre, relabelado a **"Nombre / seña"** en `a25e21f`) **se muestra por default** en el alta ("Nombre / seña (opcional)"). Decisión de Raf (#2): NO debe mostrarse por default — "pocos campos le ponen nombre, y aun 'opcional' molesta a quien nunca lo usa". Debe estar **atado a un opt-in por rodeo**: solo los rodeos que lo quieran ven el campo.

## Estado as-built (el mecanismo YA existe)

- El alta **ya renderiza los campos custom habilitados del rodeo**: `<CustomPropertiesForm rodeoId={selectedRodeo}>` (`crear-animal.tsx:834`) → recolecta valores → `custom_attributes`. La ficha muestra los `custom_attributes` presentes.
- Hay flujo de config: `editar-plantilla.tsx` + `custom-fields.ts` + `rodeo-config.ts` (RPC `set_rodeo_config`) + `CustomFieldSheet` → un rodeo habilita/deshabilita `field_definitions` vía `rodeo_data_config` (0018/0081/0082/0093).
- **PERO**: "apodo" **NO está seedeado** como `field_definition` global (era solo test data) → hoy un rodeo tendría que **crear** el campo custom "apodo" desde cero (fricción).
- El `visual_id_alt` (built-in) sigue mostrándose **por default** en el alta → duplica y contradice el intent de #2.

## Decisión (Gate 0, opción b de Raf)

**D1 — Seedear un `field_definition` GLOBAL "apodo"**, deshabilitado por default: `data_key='apodo'`, `label='Nombre / apodo'`, `ui_component='text'`, `category` apropiada (general/identificación), `establishment_id = NULL` (global, patrón de los seeds de `0018`). Así cualquier rodeo lo habilita **en un tap** desde `editar-plantilla` (vía el mecanismo existente), sin crearlo de cero. *(Decisión de criterio propio del leader: seed global vs. dejar que cada rodeo lo cree — se elige el seed por UX "un tap"; a confirmar en Puerta 1.)*

**D2 — Sacar el "Nombre / seña" built-in (`visual_id_alt`) del ALTA.** Deja de mostrarse por default (honra el intent de #2: no molestar a quien no lo usa). El "apodo" pasa a ser **exclusivamente** el campo custom por-rodeo (habilitado vía D1). *(El input built-in de `visual_id_alt` en `crear-animal.tsx` — la fila "Nombre / seña (opcional)" — se remueve.)*

**D3 — Ficha: conservar el display condicional de `visual_id_alt`** (solo-si-tiene-valor, de `a25e21f`) para no perder datos legacy; el nuevo "apodo" se muestra vía el display de `custom_attributes` existente. *(Beta sin datos reales → sin migración de datos; es defensivo.)*

**D4 — Sin mecanismo nuevo.** Todo el enable/mostrar/guardar lo hace el flujo de campos custom vigente (`CustomPropertiesForm`, `editar-plantilla`, `custom_attributes`, `rodeo_data_config`). Este delta solo (a) seedea el fd global y (b) saca el built-in del alta.

## Alcance

- **Backend (deploy)**: migración `0119` — `insert into field_definitions (data_key, label, ..., establishment_id=null)` del "apodo" global (idempotente / `on conflict do nothing`), respetando el índice único global de `0093` (`data_key where establishment_id is null`). NO nuevas tablas/RLS/triggers. Gate 1 confirma que el seed no rompe RLS/gating de `field_definitions`/`rodeo_data_config`.
- **Frontend**: sacar el input de `visual_id_alt` ("Nombre / seña") del alta (`crear-animal.tsx`); confirmar que la ficha conserva el display condicional. Ajustar la validación "cargá al menos un identificador" si mencionaba nombre/seña.
- **Gate 2.5**: capture file mostrando (a) alta SIN "Nombre/seña" built-in por default; (b) un rodeo con "apodo" habilitado → el campo aparece en el alta; (c) la ficha con el apodo cargado.

## No-alcance

- Relabel del **flujo de import** (feature 12) — anotado como backlog en `a25e21f`, aparte.
- Migrar datos existentes de `visual_id_alt` a `apodo` (beta sin datos; defensivo — se conserva el display en ficha).
- Un editor de "apodo" fuera del mecanismo custom.

## Tareas para la spec

El spec_author redacta `{requirements,design,tasks}-nombre-apodo.md` (numeración `RNA.<n>`), con: el seed `0119` (idempotente, índice único global de `0093`), la remoción del built-in del alta, el capture del Gate 2.5, y verificación de que el flujo custom existente muestra/guarda el "apodo" habilitado. Gate 1 sobre el seed. Marcá decisiones de criterio propio (seed global, category del fd, remoción del built-in) para Puerta 1.
