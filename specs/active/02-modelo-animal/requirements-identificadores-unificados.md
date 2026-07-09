# Spec 02 — Delta IDENTIFICADORES UNIFICADOS — Requirements (EARS)

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (feature `deferred`/`done`) + spec 09 (BUSCAR ANIMAL) · **backend (migración + RPC) + PowerSync + frontend** · **Gate 1 APLICA** · **DEPLOY gateado a Raf**.
**Fuente de verdad**: `context-identificadores-unificados.md` (Gate 0 APROBADO por Raf 2026-07-08). **Design**: `design-identificadores-unificados.md`. **Tasks**: `tasks-identificadores-unificados.md`.
**Numeración**: prefijo propio `IDU.<n>` (ID estable — no reordenar tras aprobar).

**Revisa deltas previos** (reconciliación al cerrar, ver IDU.8): `parto-caravana-visual-por-ternero` (el fallback `visual_id_alt` se elimina), `caravana-ficha` (el display "Nombre / seña" se elimina), `nombre-apodo` (el apodo pasa a identificador de primera clase; D3 "conservar display de visual_id_alt" se supera).

---

## 0. Modelo objetivo (contexto §2) — resumen normativo

Tres identificadores de usuario, **TODOS OPCIONALES**; el animal siempre tiene su **PK interna** (`animals.id` / `animal_profiles.id`):

| # | Identificador | Campo (DB) | Formato | Unicidad |
|---|---|---|---|---|
| 1 | Caravana Electrónica | `animals.tag_electronic` | numérica 15 díg (FDX-B) | dura, GLOBAL |
| 2 | Caravana Visual (idv) | `animal_profiles.idv` | alfanumérica ≤15 (CUIG/binomio) | dura, por campo |
| 3 | Nombre/Apodo | custom field `apodo` (`custom_attributes`) | alfanum ≤15 (incl. ñ/tildes) + espacios/guiones | soft-warning, por campo |

El 4to campo histórico `animal_profiles.visual_id_alt` se **elimina del todo** (backend + PowerSync + frontend). Datos existentes: **se descartan** (contexto §7.1).

---

## IDU.1 — Modelo de tres identificadores (formatos, unicidad, opcionalidad)

- **IDU.1.1** El sistema deberá aceptar como Caravana Electrónica (`tag_electronic`) un valor de exactamente 15 dígitos, único a nivel global. *(Sin cambio de formato ni de unicidad — estado vigente; se enuncia para trazar el modelo.)*
- **IDU.1.2** El sistema deberá aceptar como Caravana Visual (`idv`) un valor alfanumérico de hasta 15 caracteres, único por establecimiento. *(Sanitizer alfanumérico + `keyboardType` ya corregidos en commit `53fd77e` — NO se re-especifican; se enuncian para trazar el modelo.)*
- **IDU.1.3** Donde el rodeo tenga habilitado el campo `apodo`, el sistema deberá aceptar como Nombre/Apodo un valor de letras (incl. `ñ`/tildes), dígitos, espacios y guiones, de hasta **15** caracteres. *(Puerta 1: 15, subido de 10 — cortaba nombres de 2 palabras.)*
- **IDU.1.4** El sistema deberá permitir crear y persistir un animal con cero identificadores de usuario (tag, idv y apodo todos ausentes).
- **IDU.1.5** El sistema no deberá rechazar la inserción ni la actualización de un `animal_profile` por la ausencia de tag, idv y `visual_id_alt`. *(Se elimina la regla de completitud "al menos uno" — ver IDU.2.1.)*
- **IDU.1.6** El sistema deberá rechazar con error de unicidad (23505) el intento de asignar a un `idv` un valor ya usado por otro animal activo del mismo establecimiento. *(Estado vigente — índice `animal_profiles_idv_unique`; se enuncia para trazar el modelo de unicidad coherente.)*

## IDU.2 — Eliminación de `visual_id_alt` (backend)

- **IDU.2.1** El sistema deberá eliminar el trigger `animal_profiles_identity_check` y su función `tg_animal_profiles_identity_check` (definidos en `0021`/`0039`), de modo que la inserción/actualización de un `animal_profile` no exija ningún identificador de usuario.
- **IDU.2.2** El sistema deberá re-crear la función `register_birth` sin el fallback `visual_id_alt = '<recién nacido — pendiente de caravana>'` y sin escribir la columna `visual_id_alt`, conservando el resto de su comportamiento vigente (idv por cría, herencia de `breed_id`, idempotencia, cota de fecha, cap de tag, rodeo de la cría).
- **IDU.2.3** El sistema deberá eliminar físicamente la columna `animal_profiles.visual_id_alt`, junto con los objetos que dependen de ella: el CHECK `animal_profiles_local_id_check` (`0020`), el CHECK `animal_profiles_visual_id_alt_len_chk` (`0070`) y el índice trigram `animal_profiles_visual_alt_trgm` (`0020`).
- **IDU.2.4** El sistema deberá conservar sin cambios funcionales los triggers de inmutabilidad de `tag_electronic` e `idv` (`0036`); la única referencia a `visual_id_alt` en `0036` es un comentario, sin lógica asociada. *(Se documenta para evitar buscar una referencia de lógica inexistente.)*
- **IDU.2.5** El sistema deberá re-crear las demás funciones que insertan o leen `visual_id_alt` sobre `animal_profiles`, quitando toda referencia a la columna: `create_animal` (`0083`), `import_rodeo` (`0074`), `transfer_animal` (`0087`) y las dos funciones de reportes que la retornan (`0106`).
- **IDU.2.6** El sistema no deberá migrar los datos existentes de `visual_id_alt` a `apodo` ni a ningún otro campo; al eliminar la columna esos valores se descartan (contexto §7.1).
- **IDU.2.7** Si el trigger de identidad se eliminara sin re-crear `register_birth` sin fallback (o viceversa), entonces el sistema quedaría incoherente; por eso el drop del trigger (IDU.2.1), el re-create sin fallback (IDU.2.2) y el drop de la columna (IDU.2.3) deberán aplicarse en una única migración atómica.

## IDU.3 — Eliminación de `visual_id_alt` (PowerSync + frontend)

- **IDU.3.1** El sistema deberá quitar la columna `visual_id_alt` del schema local de PowerSync (`schema.ts`, tablas `animal_profiles` y `pending_animal_profiles`). *(El deploy del schema/sync-rules de PowerSync lo coordina Raf — ver IDU.7 deploy.)*
- **IDU.3.2** El sistema deberá quitar la proyección de `visual_id_alt` de todas las lecturas locales que la seleccionan: la lista de animales, la búsqueda, y la lectura de la madre en el vínculo cría-al-pie (`local-reads.ts`).
- **IDU.3.3** El sistema deberá dejar de mapear `visual_id_alt` / `p_visual_id_alt` en el connector de subida (`upload.ts`).
- **IDU.3.4** El sistema deberá quitar el campo `visualIdAlt` de los tipos y servicios de dominio que lo transportan (`animals.ts`, `events.ts`, `bulk-selection-data.ts`, `import-rodeo.ts`, `reports.ts`, `maniobra-identify.ts`, `selection-display.ts` y demás consumidores).
- **IDU.3.5** El sistema deberá quitar la prop `visualId` del componente `AnimalRow` y toda lógica de "secundario visual" asociada.
- **IDU.3.6** El sistema deberá eliminar de la ficha (`animal/[id].tsx`, sección "Identificación") la fila condicional "Nombre / seña" que muestra `visual_id_alt`.
- **IDU.3.7** El sistema deberá dejar de mapear la columna `visual_id_alt` en el flujo de import (`normalize-row.ts`, `validate-rows.ts`, `import-write.ts`, `column-mapping.ts`, `import-ui.ts`), de modo que ninguna fila importada intente escribir la columna eliminada.

## IDU.4 — Búsqueda unificada (los tres identificadores, en cada buscador)

- **IDU.4.1** El sistema deberá clasificar un término de búsqueda de manera que un texto de exactamente 15 dígitos sea candidato a match exacto de Caravana Electrónica.
- **IDU.4.2** El sistema deberá tratar todo término no vacío (con letras, o de hasta 15 dígitos) como candidato a Caravana Visual (`idv`) y a Nombre/Apodo, probándolos en paralelo con el candidato de electrónica; cuando exista un match exacto, el sistema deberá priorizarlo sobre los matches parciales.
- **IDU.4.3** El sistema deberá encontrar un animal por coincidencia (exacta o parcial) de su `idv` alfanumérico, incluyendo `idv` que contengan letras.
- **IDU.4.4** El sistema deberá encontrar un animal por coincidencia de su Nombre/Apodo, leyendo el valor del `apodo` desde `custom_attributes` (join con `field_definitions` por `data_key='apodo'`) scopeado al establecimiento activo.
- **IDU.4.5** El sistema no deberá usar `visual_id_alt` como canal de búsqueda (se elimina el canal `visual`).
- **IDU.4.6** El sistema deberá aplicar la búsqueda unificada por los tres identificadores en el buscador general de animales.
- **IDU.4.7** El sistema deberá aplicar la búsqueda unificada por los tres identificadores en el buscador de cría al pie (`classifyCalfQuery` / `link-calf-query.ts`), aceptando `idv` alfanumérico y `apodo`.
- **IDU.4.8** El sistema deberá aplicar la búsqueda unificada por los tres identificadores en la entrada manual "sin bastón" de MODO MANIOBRAS (`identificar.tsx`).
- **IDU.4.9** El sistema deberá mantener el flujo "Bastonear" de ficha/alta como duplicate-check exclusivo por Caravana Electrónica (EID), sin agregar los canales `idv`/`apodo`.
- **IDU.4.10** Cuando el operario dé de alta un animal tras un no-match, el sistema deberá precargar el texto tipeado en el campo `idv` (que ahora es alfanumérico), reemplazando el destino histórico `visual_id_alt` del clasificador de precarga (`classifyIdentifier` + su réplica en `maniobra-identify.ts`).
  - *Reconciliación (as-built): con `prefillKind === 'idv'` el texto precargado se muestra en un campo read-only rotulado "Caravana visual (no editable)" (crear-animal.tsx), reemplazando al histórico "Nombre / seña (no editable)" que rotulaba el prefill de `visual_id_alt`. Verificado por E2E en `animals-offline.spec.ts`.*
- **IDU.4.11** El sistema deberá comparar un candidato como "match exacto" contra el término por su `idv`, su `apodo` o su `tag_electronic` (todo case-insensitive, trim), reemplazando la comparación por `visual_id_alt`.

## IDU.5 — Formato y warning-soft del Nombre/Apodo (alta + edición)

- **IDU.5.1** El sistema deberá limitar en vivo el input del campo `apodo` a letras (incl. `ñ`/tildes), dígitos, espacios y guiones, con un tope de **15** caracteres (`sanitizeApodoInput`), descartando cualquier otro carácter.
- **IDU.5.1b** *(M1 de Gate 1, Puerta 1)* El sistema deberá enforçar el formato del apodo (≤15 + charset) **server-side** además del cliente: la migración `0122` re-crea `assert_custom_value_valid` para rechazar (`raise`) un `apodo` que exceda 15 o traiga caracteres fuera del charset. El sanitizer de cliente es solo UX; el server es autoritativo.
- **IDU.5.2** El sistema deberá aplicar `sanitizeApodoInput` al input del `apodo` en el alta de animal (`crear-animal`, formulario de datos personalizados del rodeo).
- **IDU.5.3** El sistema deberá aplicar `sanitizeApodoInput` al input del `apodo` en la edición desde la ficha (`animal/[id].tsx`, datos personalizados).
- **IDU.5.4** Cuando el operario ingrese o edite un `apodo` que ya usa otro animal activo del mismo establecimiento (comparación case-insensitive, trim), el sistema deberá mostrar un aviso "ya hay otro animal con ese nombre en el campo".
- **IDU.5.5** El sistema no deberá bloquear el guardado del `apodo` por estar duplicado en el campo; el aviso de IDU.5.4 es informativo (dos "Manchada" en el mismo campo se permiten).
- **IDU.5.6** El sistema no deberá mostrar el aviso de IDU.5.4 cuando el único match sea el propio animal que se está editando (un animal no se duplica consigo mismo).
- **IDU.5.7** El sistema no deberá mostrar el aviso de IDU.5.4 cuando el mismo apodo exista únicamente en OTRO establecimiento (el warning es por campo).

## IDU.6 — Nombre como identificador hero

- **IDU.6.1** El sistema deberá resolver el identificador hero de un animal (`pickHeroIdentifier`) con la prioridad: `apodo` (solo si el rodeo usa apodo y el animal tiene apodo) → `idv` → `tag_electronic` → fallback "sin caravana".
- **IDU.6.2** Mientras el rodeo use apodo y el animal tenga apodo, el sistema deberá mostrar el `apodo` como campo grande (hero) en la lista de animales y bajar la caravana (idv o electrónica) a la línea secundaria.
- **IDU.6.3** Mientras el rodeo use apodo y el animal tenga apodo, el sistema deberá mostrar el `apodo` como hero en la ficha del animal, con la caravana en la línea secundaria.
- **IDU.6.4** Donde el rodeo no use apodo, o el animal no tenga apodo, el sistema deberá resolver el hero como `idv` → `tag_electronic` → fallback (comportamiento equivalente al vigente, sin `visual_id_alt`).
- **IDU.6.5** El sistema deberá leer, para cada animal de la lista, el valor de su `apodo` y si el rodeo del animal tiene el campo `apodo` habilitado (honrando el overlay de configuración pendiente offline).
- **IDU.6.6** Cuando un animal no tenga ningún identificador de usuario, el sistema deberá mostrar el fallback "sin caravana" (lista) o "Animal" (ficha) como hero.

> **Reconciliación (fix-loop, 2026-07)**: el chip user-facing que señala la ausencia de caravana ELECTRÓNICA en la lista (gancho `tag_electronic == null` — badge por fila + chip de FILTRO + a11y) se relabeló **"Sin caravana" → "Sin electrónica"**. Motivo: con `idv`/`apodo` como hero, "Sin caravana" en un animal que SÍ tiene caravana visual se leía contradictorio. No cambia el *qué* de IDU.6.1/IDU.6.6 (el hero fallback es "—" y el chip comunica la señal de estado); solo el copy del chip y sus a11y labels. Ver `design §306`.

## IDU.7 — Rename del concepto Nombre

- **IDU.7.1** El sistema deberá presentar el concepto de nombre del animal bajo la etiqueta "Nombre/Apodo": actualizando el `label` del `field_definition` `apodo` a "Nombre/Apodo" y eliminando la etiqueta histórica "Nombre / seña" (que rotulaba `visual_id_alt`).

## IDU.8 — Reconciliación de deltas previos (al cerrar, Puerta 2)

- **IDU.8.1** El sistema deberá marcar como SUPERADAS por este delta las partes del delta `parto-caravana-visual-por-ternero` que dependían del fallback `visual_id_alt` como load-bearing: `PCV.2.4` y las referencias de diseño §2c/§5 al fallback (el fallback deja de ser necesario porque se elimina el trigger de identidad que lo hacía load-bearing).
- **IDU.8.2** El sistema deberá marcar como SUPERADA por este delta la parte del delta `caravana-ficha` que preserva el display "Nombre / seña" de `visual_id_alt` en la ficha (`RCF.1.6` / la fila condicional).
- **IDU.8.3** El sistema deberá marcar como SUPERADA por este delta la decisión `D3` del delta `nombre-apodo` (conservar el display condicional de `visual_id_alt` en la ficha para no perder datos legacy) y reflejar que `apodo` pasa a ser el único concepto de nombre.
- **IDU.8.4** El sistema deberá reconciliar el `design.md` baseline de spec 02 y el `design.md` de spec 09 con un puntero a este delta bajo los `R<n>` afectados (identificadores R4.2/R4.13, búsqueda R5), sin reescribir los EARS existentes.

## Notas de reconciliación (dirección código → spec)

- **[IDU.1.4/IDU.1.5 — guard de cliente eliminado (Fase B as-built)]** El alta (`crear-animal.tsx`) tenía un guard `hasAtLeastOneIdentifier(tag, idv, visual)` que BLOQUEABA el alta en blanco — existía SOLO porque el trigger server-side `animal_profiles_identity_check` rechazaba con 23514 y el alta se perdía en silencio. Como este delta dropea ese trigger (IDU.2.1, Fase A), el guard es obsoleto: se **eliminó** del alta y de `animal-form.ts` (`hasAtLeastOneIdentifier` + su test). El alta en blanco (0 identificadores) ahora persiste, cumpliendo IDU.1.4. *(La persistencia server-side sin 23514 la valida la suite backend de Fase A + el e2e E2.)*
- **[IDU.4.10 — precarga colapsa a `idv`, path `visual` eliminado (Fase B as-built)]** El destino de precarga `visual` (que apuntaba a `visual_id_alt`) se eliminó del todo: `animales.tsx`/`identificar.tsx`/`findOrCreateLookup`/`resolvePrefilledCreateParams` precargan SIEMPRE en `idv` (la caravana visual es alfanumérica → absorbe el texto tecleado). `crear-animal.tsx` perdió el `PrefillKind` `'visual'` + el campo read-only "Nombre / seña (no editable)". `classifyIdentifier`/`IdentifierKind` se **eliminaron** (ya no hay ramificación idv-vs-visual).

## Notas de reconciliación (dirección código → spec, originales)

- **[IDU.5.1 — charset del apodo]** El contexto §7.2 fija "alfanumérico + espacio + guion". Decisión de criterio del leader a confirmar en Puerta 1 (design §5): incluir letras acentuadas y `ñ` (`áéíóúüñ` + mayúsculas) además del ASCII, porque el apodo es un nombre en español y un charset ASCII estricto comería la `ñ`/tildes de nombres como "Toño" o "Ñata". Si se aprueba, el test de IDU.5.1 asegura además que las tildes/`ñ` se conservan.
- **[IDU.2.5 — footprint mayor al enumerado en el contexto]** El contexto §5 enumeró `create_animal` e `import_rodeo` como "posibles". La verificación (design §2) confirmó que además `transfer_animal` (`0087`) y las dos funciones de reportes (`0106`) referencian la columna. Se incluyen en IDU.2.5 como consecuencia mecánica de "eliminar la columna del todo" (contexto §3.1: "Limpiar TODOS sus usos") — no es una decisión de producto nueva, es alcance de limpieza. Se destaca para revisión en Puerta 1.
