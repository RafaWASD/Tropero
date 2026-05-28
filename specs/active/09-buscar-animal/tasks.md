# Spec 09 — BUSCAR ANIMAL — Tasks

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-26

## Historial de refinamiento

- **2026-05-26 — Creación inicial.** Tasks redactadas siguiendo el design y las requirements. Estructura de 7 fases (0..6) con punto de pausa explícito post-design-system. Cada R<n> cubierta por ≥1 task; cada task referencia ≥1 R<n>.

## Cabecera de fases — qué se puede correr sin design system

| Fase | Depende de design system | Depende de spec 04 | Comentario |
|---|---|---|---|
| Fase 0 — Setup | No | No | Scaffolding de carpetas + tipos |
| Fase 1 — Hooks y servicios sin UI | No | No | Cubre R3, R6, R10, validaciones |
| Fase 2 — Pantallas core (puerta manual) | **Sí** | No | R1, R3, R4, R5 |
| Fase 3 — Duplicados lógicos (opciones A y B) | **Sí** | Parcial (B usa BLE) | R7, R8 — destrabadas por refinamiento de R4.13 el 2026-05-26 |
| Fase 4 — Listener BLE global | **Sí** | **Sí (BLOQUEANTE)** | R2 |
| Fase 5 — Offline + sync | No | No | R11 (validar offline-first end-to-end) |
| Fase 6 — Tests + QA con scenarios reales | Parcial | Parcial | Cubre lo implementado |

**Fases ejecutables sin design system cerrado**: 0, 1, 5, 6 (parcial, solo lo de Fase 1).

**Fases que requieren design system cerrado**: 2, 3, 4 (UI components, screens, microinteractions). Mismo patrón que spec 01 (Fases 3-8 pausadas) y spec 02 (Fase 3+ pausada).

**Refinamiento R4.13 — RESUELTO 2026-05-26**: el trigger `tg_animals_block_tag_change` ahora permite `NULL → valor` (bloquea `valor → otro valor` y `valor → NULL`). Las opciones A y B quedan habilitadas para implementación end-to-end. Tests dedicados van en T2.x de spec 02 (no acá).

---

## Fase 0 — Setup

### T0.1 Crear estructura de carpetas del feature
- Crear directorios: `app/src/features/animals/{screens,components,hooks,services,providers,__tests__}` (si no existen).
- Crear archivos vacíos con scaffolding mínimo (export default function name() { return null }) para cada pantalla/componente/hook listado en design.md § "Archivos a crear o modificar".
- **Aceptación**: typecheck verde con archivos vacíos; `node scripts/check.mjs` sigue verde.
- **Cubre**: housekeeping.

### T0.2 Tipos compartidos del feature
- Crear `app/src/features/animals/types.ts` con:
  - `LookupIdentifier`, `LookupResult` (R3).
  - `FieldConfig` (motor de form dinámico).
  - `BleStickEvent` (interface para spec 04).
  - Reexportar tipos de spec 02 (`AnimalProfile`, `Animal`, `Rodeo`, `Category`, etc.) si conviene centralizar.
- **Aceptación**: tipos compilan con `strict: true`; consumibles desde el resto del feature.
- **Cubre**: housekeeping, soporte de R3, R4, R6.

### T0.3 Confirmar prerequisitos de spec 02 + spec 01
- Verificar que spec 02 backend está implementado (migrations 0012..0036 aplicadas a remoto + Fase 2 tests verdes). Si no está, **PARAR y reportar al leader**.
- Verificar que spec 01 Fase 3 (frontend AuthContext + EstablishmentContext + RodeoContext) está implementado o, al menos, que los contextos tienen sus interfaces estables. Si no, documentar como bloqueante para Fase 2+.
- **Aceptación**: confirmación documentada en `progress/impl_09-buscar-animal.md`.
- **Cubre**: housekeeping.

---

## Fase 1 — Hooks y servicios sin UI (sin design system)

### T1.1 Servicio `services/last-rodeo.ts`
- Implementar funciones: `readLastRodeo`, `writeLastRodeo`, `queryLastUsedRodeoFromDb`, `getDefaultRodeo`.
- AsyncStorage key pattern: `rafaq:last_rodeo:<establishment_id>`.
- Query DB usa PowerSync local: `select rodeo_id from animal_profiles where establishment_id = ? order by updated_at desc limit 1` (filtrado por usuario actual si el schema permite; sino el más reciente del establishment).
- Fallback final: **primer rodeo activo creado** del establishment (`select id from rodeos where establishment_id = ? and active = true and deleted_at is null order by created_at asc limit 1`). Si no hay ningún rodeo activo, la función retorna `null` para que la UI muestre el bloqueo "Creá un rodeo primero" que lleva al wizard de R2.6 de spec 02. **Refinamiento 2026-05-27 de spec 02**: ya no existe el rodeo autogenerado "Rodeo principal"; el fallback es el primer rodeo creado, o `null` con bloqueo de UI.
- **Aceptación**: tests `last-rodeo.test.ts` verdes (CRUD AsyncStorage + fallback DB + fallback default).
- **Cubre**: R6.3, R6.4.

### T1.2 Hook `useLastRodeoSelected`
- Crear el hook en `hooks/useLastRodeoSelected.ts`.
- Estado: zustand store global indexado por `establishment_id`. Si zustand no está en el stack todavía, fallback a Context + reducer.
- Hidrate inicial desde AsyncStorage al boot del provider.
- `set(rodeo)` actualiza memory + AsyncStorage en una sola operación.
- Cambio de establishment activo dispara re-lectura del valor correspondiente.
- **Aceptación**: tests `useLastRodeoSelected.test.ts` verdes (read memory, read AsyncStorage, fallback DB, change establishment).
- **Cubre**: R6.1, R6.2, R6.5, R6.6.

### T1.3 Servicio `services/animal-lookup.ts`
- Implementar funciones: `lookupByTag`, `lookupByIdv`, `lookupByVisual`, `findCandidatesWithoutTag`.
- Cada función llama a las primitives de `services/animals.ts` de spec 02 (`searchByTag`, `searchByIdv`, `searchByVisualAlt`).
- `findCandidatesWithoutTag(establishmentId, limit)`: query a PowerSync local que retorna `animal_profiles` activos donde el `animals` relacionado tiene `tag_electronic IS NULL`, ordenados por `updated_at desc`, limitados a `limit` (default 50).
- **Aceptación**: tests `animal-lookup.test.ts` verdes; cada función retorna el tipo correcto según `LookupResult`.
- **Cubre**: R3.1, R3.2, R3.4, R7.2.

### T1.4 Hook `useAnimalLookup`
- Crear el hook en `hooks/useAnimalLookup.ts`.
- Función `lookup(id, establishmentId, source)` orquesta los servicios de T1.3.
- Lógica de decisión de `mode` según `source` y resultado:
  - Match → `mode: 'edit'`.
  - No match + `kind: 'tag'` + `source: 'ble'` → `mode: 'create_via_intermediate'` con candidatos de R7.2.
  - No match + otros casos → `mode: 'create'`.
  - Match global pero no local → `mode: 'transfer_or_alta'`.
- Estado: `idle | searching | done | error`.
- **Aceptación**: tests `useAnimalLookup.test.ts` verdes (todos los caminos del switch); offline-first (PowerSync local).
- **Cubre**: R3.1, R3.2, R3.3, R3.4, R3.5.

### T1.5 Hook `useBleStickListener` (stub mientras spec 04 esté pending)
- Crear el hook en `hooks/useBleStickListener.ts` con implementación stub: `{ isConnected: false, isListening: false }`, nunca invoca `onTagRead`.
- Documentar en JSDoc que la implementación real viene de spec 04 (`services/ble/stick.ts`).
- **Aceptación**: hook compila; consumible desde `BleStickListenerProvider` sin romper.
- **Cubre**: interface para R2 (sin implementación BLE real todavía).

### T1.6 Hook `useDynamicAnimalForm`
- Crear el hook en `hooks/useDynamicAnimalForm.ts`.
- Lee el `rodeo_id` provisto, deriva `system_id` via PowerSync, carga el `FieldConfig[]` de `services/form-config/bovino-cria.ts` para MVP. **Nota (ADR-021)**: este `FieldConfig[]` describe los **atributos del animal** (columnas de `animal_profiles`), NO los data_keys de eventos (`rodeo_data_config`, que determinan qué eventos se pueden cargar después).
- Estado del form local (no global). `setField(key, value)` actualiza.
- `validate()` corre los validators inline (al menos un identificador no vacío, `sex` requerido, fechas válidas, numéricos positivos).
- `submit()` invoca `useCreateAnimal` de spec 02 con el patrón split insert + select.
- **Aceptación**: tests verdes; en MVP solo `(bovino, cría)` está cubierto, otros sistemas retornan error explícito.
- **Cubre**: R4.5, R4.6, R4.8, R11.4.

### T1.7 Form config para `(bovino, cría)`
- Crear `app/src/features/animals/services/form-config/bovino-cria.ts` con el `FieldConfig[]` de R4.5 (atributos del animal, no data_keys de eventos):
  - identificador precargado (locked)
  - identificador #2 (optional)
  - identificador #3 (optional)
  - `sex` (radio, required)
  - `birth_date` (date, optional)
  - `breed`, `coat_color`, `entry_date`, `entry_weight`, `entry_origin` (optional)
  - `management_group_id` (selector de lote, optional — lee `management_groups` activos del establishment vía `useManagementGroups` de spec 02; opción "sin lote"; ADR-020)
  - `category` (autocalculada read-only con opción de override)
- **Aceptación**: import desde `useDynamicAnimalForm` funciona; campos validan; el selector de lote lista los `management_groups` del establishment o "sin lote".
- **Cubre**: R4.5 (incluye lote opcional).

### T1.8 Validaciones locales offline-first
- Crear `app/src/features/animals/services/validation.ts` con:
  - `validateIdentity({ tag, idv, visual })` — al menos uno no vacío (R4.2 de spec 02).
  - `validateBirthDate(date)` — no futuro.
  - `validateEntryDate(date, birthDate)` — ≥ birthDate si ambos presentes.
  - `validatePositiveNumber(value)` — > 0.
- **Aceptación**: tests unit verdes; cada validator retorna `{ ok: true } | { ok: false, error: string }`.
- **Cubre**: R11.4.

### T1.9 Multi-tenant scoping del estado de cliente
- Asegurar que todos los hooks y servicios reciben `establishment_id` por argumento (no lo leen del context internamente).
- Caller responsabilidad: pasar el valor del `EstablishmentContext` activo al disparar la operación.
- Documentar la regla en `progress/impl_09-buscar-animal.md`.
- **Aceptación**: code review confirma que no hay reads del context dentro de la lógica core.
- **Cubre**: R10.1, R10.3.

---

## Fase 2 — Pantallas core (puerta manual) — **requiere design system cerrado**

> Fase pausada hasta que se cierre el design system canónico (item A.1 del `progress/plan.md`). Documentar el bloqueo en `progress/impl_09-buscar-animal.md` cuando se llegue acá.

### T2.1 `AnimalSearchBar` (componente)
- Campo de búsqueda permanente con debounce 250 ms.
- Estado local: `query: string`.
- Dispara `useAnimalLookup.lookup(...)` con `source: 'manual'`.
- **Aceptación**: component test (RTL) verifica que el debounce funciona y dispara con el último valor.
- **Cubre**: R1.2.

### T2.2 `AnimalListItem` (componente)
- Render reusable para un `animal_profile`: muestra identificador prominente, categoría, sexo, rodeo, último evento si lo hay.
- Tap dispara callback `onPress(profileId)`.
- **Aceptación**: render correcto con casos: animal con TAG, animal con solo IDV, animal con solo `visual_id_alt`.
- **Cubre**: R1, R7 (reusable).

### T2.3 `AnimalsTabScreen` (R1)
- Layout: header + `AnimalSearchBar` + chips de filtro + lista paginada con `AnimalListItem`.
- Datasource: `useAnimals(filter)` de spec 02.
- Tap → navegar a `AnimalEditScreen` con `animal_profile_id`.
- CTA "Dar de alta este animal" cuando no hay match → navegar a `AnimalCreateScreen` con identificador precargado.
- CTA "Asignar caravanas en masa" cuando filtro "sin caravana electrónica" activo → navegar a `BulkTagAssignmentScreen` (Fase 3, deshabilitado hasta Fase 3 implementada).
- **Aceptación**: render con 0/1/N animales; búsqueda dispara lookup; filtros funcionan.
- **Cubre**: R1.1, R1.2, R1.3, R1.4, R1.5.

### T2.4 `RodeoSelector` (componente)
- Si `rodeos.length === 1`: render read-only con el nombre del rodeo.
- Si `rodeos.length >= 2`: combo/dropdown con default `lastRodeoSelected`.
- onChange invoca `useLastRodeoSelected.set(newRodeo)`.
- **Aceptación**: ambos casos cubiertos por tests.
- **Cubre**: R4.4, R4.9, R6.5.

### T2.5 `DynamicAnimalForm` (componente)
- Render del form según `FieldConfig[]` retornado por `useDynamicAnimalForm`.
- Cada `FieldConfig.type` renderiza el componente apropiado (text, number, date picker, radio, dropdown, identifier locked/optional).
- Identificador precargado se renderiza como locked (read-only).
- Otros identificadores se renderizan como optional con label "Recomendado".
- **Aceptación**: render correcto para `(bovino, cría)`; validation muestra errores inline.
- **Cubre**: R4.2, R4.3, R4.5.

### T2.6 `AnimalCreateScreen` (R4)
- Recibe params: `prefilledIdentifier`, `animalIdGlobal?`, `source`.
- Layout: header + `RodeoSelector` + `DynamicAnimalForm` + botón "Crear animal".
- Submit dispara `useDynamicAnimalForm.submit()` → invoca `useCreateAnimal` de spec 02.
- Éxito → navega a `AnimalEditScreen` con el `animal_profile_id` recién creado.
- Error → mantiene form, muestra mensaje accionable.
- Caso `source: 'transfer'` (R3.4): omite creación de `animals` global, solo crea `animal_profiles`.
- **Aceptación**: 4 casos verdes (entrada manual / BLE / transfer / error).
- **Cubre**: R4.1, R4.6, R4.7, R4.8, R4.10.

### T2.7 `TimelineEventRenderer` (componente polimórfico)
- Recibe una fila de `animal_timeline()` y renderiza el componente específico por `event_kind`.
- 7 sub-componentes: `WeightEventRow`, `ReproductiveEventRow`, `SanitaryEventRow`, `ConditionScoreEventRow`, `LabSampleRow`, `CategoryChangeRow`, `ObservationRow`.
- **Aceptación**: render correcto para cada tipo.
- **Cubre**: R5.3.

### T2.8 `AddEventSheet` (componente)
- Bottom sheet o screen (definir con design system) con paso 1 (seleccionar tipo) + paso 2 (form específico).
- Tipos disponibles (modelo Híbrido de spec 02): **peso / reproductivo / sanitario / condición corporal / muestra de lab** (los 5 tipados de R6.1..R6.5) + **observación libre** (`animal_events`). *(NO los tipos del enum viejo del ADR-017 `salud/reproduccion/traslado/pesaje/identificacion` — el modelo Híbrido los reemplazó.)*
- Submit invoca el service correspondiente (`createWeightEvent | createReproductiveEvent | createSanitaryEvent | createConditionScoreEvent | createLabSample | createObservation`).
- Cuando spec 03 implemente el gating DB, los tipos ofrecidos acá deberán filtrarse por los data_keys habilitados en el `rodeo_data_config` del rodeo del animal (ej. no ofrecer "reproductivo/tacto" si el rodeo no tiene `prenez`). En MVP de spec 09 (sin spec 03) se ofrecen todos.
- **Aceptación**: cada tipo cubierto por un test que verifica que el service correcto se invoca.
- **Cubre**: R5.4.

### T2.9 `AnimalEditScreen` (R5)
- Recibe param: `animalProfileId`.
- Layout: header read-only de identificadores + zona de atributos editables + timeline scrollable + botón "+ agregar evento".
- Atributos: `useUpdateAnimal(profileId)` maneja mutaciones inline. Incluye **selector de lote** (`management_group_id`) que invoca `useAssignManagementGroup` de spec 02 (asignar/cambiar/quitar, cualquier rol operativo — ADR-020 / R2.17).
- Timeline: `useAnimalTimeline(profileId)` retorna las filas; render con `TimelineEventRenderer`.
- Botón "+ agregar evento" abre `AddEventSheet`.
- Edit/soft-delete de evento gateado por R5.5 / R5.6 (cliente y server).
- Link a madre si es ternero/ternera (R5.8).
- **Aceptación**: cubre todas las requirements R5.x con tests RTL; asignar/quitar lote persiste.
- **Cubre**: R5.1, R5.2, R5.3, R5.5, R5.6, R5.7, R5.8, R5.9.

### T2.10 Navegación: agregar rutas y tipos
- Agregar `AnimalCreate`, `AnimalEdit` al `MainTabs.Animales` stack.
- Actualizar `navigation/types.ts` con los params correspondientes.
- **Aceptación**: typecheck verde; navegar desde `AnimalsTabScreen` a CREATE/EDIT funciona.
- **Cubre**: housekeeping.

---

## Fase 3 — Duplicados lógicos (opciones A y B) — **DESBLOQUEADA**

> **R4.13 refinada el 2026-05-26**: el trigger acepta `NULL → valor`. Fase 3 queda habilitada para implementación end-to-end (igual que Fases 2 y 4, espera design system cerrado para la UI).

### T3.1 Validar precondición R4.13 a nivel DB
- Confirmar que `node scripts/check.mjs` pasa con los 3 tests dedicados de R4.13 (T2.x de spec 02): `NULL → 'ARG001'` acepta, `'ARG001' → 'ARG002'` rechaza, `'ARG001' → NULL` rechaza.
- Verificar que el trigger `tg_animals_block_tag_change` (migration `0035_immutability_identifiers.sql`) fue actualizado consecuentemente.
- Si no se hizo, **PARAR y reportar al leader**.
- **Aceptación**: confirmación documentada con referencia al cambio en spec 02.
- **Cubre**: prerrequisito de R7, R8.

### T3.2 Servicio `assignTagToAnimal(animalId, tag)`
- Agregar la función al `services/animals.ts` de spec 02 (requiere ampliación de spec 02 — coordinar con el leader).
- Validaciones cliente: el animal no debe tener TAG ya asignado; el TAG no debe existir en otro `animals` del sistema.
- Llama a UPDATE de `animals.tag_electronic`.
- **Aceptación**: tests verdes; rechaza TAG duplicado con mensaje accionable.
- **Cubre**: R7.4, R8.3.

### T3.3 `AssignTagSearchScreen` (R7)
- Modal full-screen con lista de candidatos (`findCandidatesWithoutTag(establishmentId)` de T1.3).
- Layout: cada item con `AnimalListItem` extendido (mostrar `idv | visual_id_alt | category | sex | birth_date | rodeo`).
- Tap → navegar a `AssignTagConfirmScreen` con `candidate` + `tag`.
- CTA "No, es un animal nuevo" → navegar a `AnimalCreateScreen` con TAG precargado.
- **Aceptación**: render con 0/1/N candidatos; CTA funciona.
- **Cubre**: R7.1, R7.2, R7.3, R7.5.

### T3.4 `AssignTagConfirmScreen` (R7.4)
- Pantalla modal corta con resumen del candidato + TAG.
- Confirm dispara `assignTagToAnimal(candidate.animal_id, tag)`.
- Éxito → navega a `AnimalEditScreen` con `animal_profile_id` del candidato.
- **Aceptación**: confirm exitoso navega correctamente; error muestra mensaje.
- **Cubre**: R7.4.

### T3.5 `BulkTagAssignmentScreen` (R8)
- Layout: top bar con contador + lista de candidatos sin TAG + indicador de TAG bastoneado pendiente.
- Mientras está en foreground, registra el listener BLE en modo "asignación" (NO dispara `FindOrCreateOverlay`).
- Tap en candidato → `assignTagToAnimal(candidate.animal_id, pendingTag)` → remueve candidato de la lista.
- CTA "Bastoneé un animal nuevo, no estaba en la lista" → navega a `AnimalCreateScreen` con TAG precargado.
- TAG duplicado → mensaje accionable, mantener progreso.
- **Aceptación**: end-to-end test con bastón mockeado: 3 bastoneos consecutivos asignan 3 caravanas; el contador actualiza.
- **Cubre**: R8.1, R8.2, R8.3, R8.4, R8.5, R8.6.

### T3.6 Confirmar R9.1 — opción C diferida
- Verificar que `CONTEXT/07-pendientes.md` mantiene la opción C como post-MVP (ya está, ver "Funcionalidades a priorizar después del MVP").
- No implementar ninguna detección automática.
- **Aceptación**: documentado.
- **Cubre**: R9.1, R9.2.

---

## Fase 4 — Listener BLE global — **requiere spec 04**

> Fase pausada hasta que spec 04 esté implementada. La interface `useBleStickListener` ya está declarada en T1.5 con stub.

### T4.1 Confirmar implementación de spec 04
- Verificar que `services/ble/stick.ts` (spec 04) expone `useBleStickListener` con la interface definida en T1.5 / design.md.
- Si no está, **PARAR y reportar al leader**.
- **Aceptación**: hook real importable y consumible.
- **Cubre**: prerrequisito de R2.

### T4.2 `BleStickListenerProvider` (provider global)
- Crear el provider en `providers/BleStickListenerProvider.tsx`.
- Monta el hook real de spec 04 con `enabled` controlado por contexto.
- Cuando recibe `tag_read`, dispara `useAnimalLookup.lookup(...)` con `source: 'ble'` y renderiza `FindOrCreateOverlay`.
- Expone API `{ disableListener, enableListener }` para que MODO MANIOBRAS la use.
- Estado de conexión visible vía hook `useBleConnectionStatus()` (a definir).
- **Aceptación**: en tests con bastón mockeado, un evento `tag_read` dispara el overlay; en MODO MANIOBRAS desactivado, no dispara.
- **Cubre**: R2.1, R2.2, R2.3, R2.5.

### T4.3 `FindOrCreateOverlay` (host del flujo BLE)
- Componente modal/stack screen que renderiza encima de la pantalla activa cuando se invoca.
- Decide qué subpantalla mostrar según el `LookupResult.mode`:
  - `'edit'` → renderiza `AnimalEditScreen`.
  - `'transfer_or_alta'` → renderiza diálogo con CTA.
  - `'create_via_intermediate'` → renderiza `AssignTagSearchScreen`.
  - `'create'` → renderiza `AnimalCreateScreen`.
- Al cerrar el overlay, vuelve a la pantalla original.
- **Aceptación**: cada `mode` cubierto por test; cerrar el overlay preserva el contexto anterior.
- **Cubre**: R2.4.

### T4.4 Integración con stack MODO MANIOBRAS (spec 03 — coordinar)
- Documentar el contrato: cuando se monte la stack de MODO MANIOBRAS, llamar a `disableListener()` en `useEffect` con cleanup que llame a `enableListener()`.
- Coordinar con quien implemente spec 03 que aplique el contrato.
- **Aceptación**: en tests E2E con stack de MODO MANIOBRAS montada (mock), el listener no dispara.
- **Cubre**: R2.3.

### T4.5 Listener "ocupado" durante CREATE/EDIT (riesgo documentado en design)
- Implementar `useBusyMode()` que las pantallas CREATE/EDIT activan en mount + desactivan en unmount.
- Mientras `useBusyMode` esté activo, el `BleStickListenerProvider` deshabilita el listener para no pisar el form en curso.
- **Aceptación**: en CREATE/EDIT, un bastoneo no dispara nuevo overlay encima del form.
- **Cubre**: mitigación de riesgo documentado en design.md.

---

## Fase 5 — Offline + sync

### T5.1 Validar offline-first del flujo manual
- Test E2E manual: airplane mode → tipear identificador inexistente → CREATE → submit → verificar que aparece en la lista al refresh.
- Volver red → verificar que PowerSync sincronizó al server.
- **Aceptación**: end-to-end sin errores.
- **Cubre**: R11.1, R11.2.

### T5.2 Validar offline-first del flujo BLE (cuando Fase 4 esté implementada)
- Test E2E manual: airplane mode + bastón conectado → bastonear → motor find-or-create funciona contra PowerSync local → EDIT o CREATE encolan mutaciones.
- Volver red → PowerSync sincroniza.
- **Aceptación**: end-to-end sin errores; bastoneo no requiere internet.
- **Cubre**: R11.3.

### T5.3 Manejo de errores de sync (race conditions)
- Implementar captura de errores de sync en PowerSync (TAG duplicado, IDV duplicado, animal eliminado por otro device).
- Mostrar alerta accionable al usuario con opciones para corregir.
- **Aceptación**: 3 escenarios de race condition cubiertos por tests (mock de PowerSync que rechaza la mutación).
- **Cubre**: R11.5.

### T5.4 Validar scoping multi-tenant al cambio de establishment
- Test: cambiar establishment activo durante un flujo find-or-create abierto → el flujo se cancela o reescopa.
- Test: `lastRodeoSelected` es independiente por establishment (ya cubierto en T1.2 pero validar end-to-end).
- **Aceptación**: tests verdes.
- **Cubre**: R10.1, R10.3.

---

## Fase 6 — Tests + QA con scenarios reales

### T6.1 Suite de tests unitarios + component (RTL)
- Asegurar que todos los tests planeados en design.md § "Tests planeados" están implementados y verdes.
- Listado: `useAnimalLookup`, `useLastRodeoSelected`, `animal-lookup`, `last-rodeo`, `useDynamicAnimalForm`, `AnimalsTabScreen`, `AnimalCreateScreen`, `AnimalEditScreen`.
- **Aceptación**: `jest` corre todos los tests y queda verde; coverage > 80% sobre los archivos del feature.

### T6.2 Suite Detox / Maestro (heredada de ADR-013)
- Flujos E2E:
  - Crear animal nuevo desde puerta manual.
  - Buscar animal existente desde puerta manual y editar atributo.
  - Agregar observación al timeline.
  - Bastonear animal nuevo (con bastón mockeado en CI) → CREATE.
  - Bastonear animal existente → EDIT.
  - Cambiar de establishment durante un flujo → flujo se cancela.
- **Aceptación**: 6 flujos pasan en CI.

### T6.3 QA manual con scenarios de campo
- Sesión con el cliente beta (campo en Chascomús) o simulada por Raf:
  - Cargar 20 animales en sesión mixta (puerta manual + bastón).
  - Verificar `lastRodeoSelected` se respeta entre altas.
  - Verificar offline → online sync end-to-end.
- **Aceptación**: feedback documentado en `progress/impl_09-buscar-animal.md`.

### T6.4 Documentación de cierre
- Actualizar `CONTEXT/07-pendientes.md` con preguntas/edge cases descubiertos.
- Si hubo decisiones nuevas → ADRs (mínimo el de R12 si se refinó spec 02 en el medio).
- Mover spec a `specs/completed/` si se cierra completa, o mantener en `specs/active/` si solo se cierra Fase 1 + Fase 2.
- Actualizar `feature_list.json` con status final.
- **Aceptación**: docs reflejan estado real al cierre.

---

## Resumen de dependencias críticas

```
Fase 0 (setup)
   ↓
Fase 1 (hooks + services sin UI)          ← se puede correr ya, sin design system
   ↓
⏸ PUERTA: design system canónico (item A.1 del plan)
   ↓
Fase 2 (pantallas core puerta manual)     ← R1, R3, R4, R5
   ↓
Fase 3 (duplicados lógicos A + B)         ← R7, R8 — destrabada 2026-05-26 (R4.13 refinada)
   ↓
⏸ PUERTA: spec 04 implementada (BLE bastón)
   ↓
Fase 4 (listener BLE global)              ← R2
   ↓
Fase 5 (offline + sync end-to-end)        ← R11 — se puede correr parcialmente desde Fase 2
   ↓
Fase 6 (tests + QA)
```

## Trazabilidad R<n> → tasks

| Requirement | Tasks | Estado de bloqueo |
|---|---|---|
| R1.1, R1.2, R1.3, R1.4, R1.5 | T2.1, T2.2, T2.3 | Bloqueada por design system |
| R2.1, R2.2, R2.3, R2.5 | T4.2 | Bloqueada por design system + spec 04 |
| R2.4 | T4.3 | Bloqueada por design system + spec 04 |
| R3.1, R3.2 | T1.3, T1.4 | OK (no bloqueada) |
| R3.3 | T1.4 | OK |
| R3.4 | T1.3, T1.4, T2.6 (caso transfer) | Parcial (T2.6 bloqueada por design system) |
| R3.5 | T1.3, T1.4 | OK |
| R4.1 | T2.6 | Bloqueada por design system |
| R4.2, R4.3 | T2.5, T2.6 | Bloqueada por design system |
| R4.4 | T2.4, T2.6 | Bloqueada por design system |
| R4.5 | T1.7, T2.5 | Parcial (T1.7 OK; T2.5 bloqueada) |
| R4.6, R4.7, R4.8 | T2.6 | Bloqueada por design system |
| R4.9 | T2.4, T2.6 | Bloqueada |
| R4.10 | T2.6 (caso transfer) | Bloqueada |
| R5.1, R5.2 | T2.9 | Bloqueada |
| R5.3 | T2.7, T2.9 | Bloqueada |
| R5.4 | T2.8, T2.9 | Bloqueada |
| R5.5, R5.6 | T2.9 | Bloqueada |
| R5.7, R5.8, R5.9 | T2.9 | Bloqueada |
| R6.1 | T1.2 | OK |
| R6.2 | T1.2 | OK |
| R6.3, R6.4 | T1.1, T1.2 | OK |
| R6.5 | T1.2 | OK |
| R6.6 | T1.2 | OK |
| R7.1, R7.2, R7.3, R7.5 | T3.3 | Bloqueada por design system |
| R7.4 | T3.2, T3.4 | OK (R12 resuelta 2026-05-26) |
| R8.1, R8.2, R8.3, R8.4, R8.5, R8.6 | T3.5 | Bloqueada por design system + spec 04 |
| R9.1, R9.2 | T3.6 (declarativo) | OK |
| R10.1, R10.3 | T1.9, T5.4 | OK |
| R10.2 | (consume RLS de spec 02; nada que implementar) | OK |
| R11.1 | T1.3, T1.4, T2.3, T2.6, T2.9, T5.1 | Parcial |
| R11.2 | T5.1 | OK |
| R11.3 | T5.2 | Bloqueada por spec 04 |
| R11.4 | T1.6, T1.8 | OK |
| R11.5 | T5.3 | OK |
| R12.1, R12.2, R12.3, R12.4 | (declarativo — documentado en `progress/impl_09-buscar-animal.md` al iniciar Fase 3) | OK (declarativo) |

## Notas de ejecución

- Cada task termina con commit en español, presente, descriptivo (`agrega useAnimalLookup`, `crea pantalla AnimalCreateScreen`, etc.).
- Si una tarea descubre algo que requiere ampliar spec 02 (schema, función SQL, hook, service), **PARAR** — no parchear desde spec 09. Reportar al leader para que decida si refinar spec 02.
- Si una tarea descubre algo que requiere ampliar spec 04, mismo protocolo.
- Patrón **split insert + select** (ADR-012) es la norma para creaciones que disparan triggers (alta de animal, agregar evento). Heredado de spec 02.
- Tests integración offline-first: airplane mode + PowerSync local. Patrón ya validado en spec 01.
- Las tareas Fase 2, 3, 4 quedan **listas para diferirse** hasta que se cierre design system + spec 04 (R12 ya resuelta 2026-05-26). Cerrar Fase 0+1+5(parcial)+6(parcial) alcanza para declarar el backend logic del feature operativo aun sin UI.
- R4.13 refinada en sesión 11 (2026-05-26) — ver `progress/current.md` para el análisis de las 3 opciones. La decisión vale como precedente documentado dentro del spec 02 mismo; no se crea ADR separado (es refinamiento de spec, no decisión arquitectónica transversal).
