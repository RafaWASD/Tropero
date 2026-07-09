# Spec 09 — BUSCAR ANIMAL — Design

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-26

## Historial de refinamiento

- **2026-05-26 — Creación inicial.** Design redactado siguiendo decisiones de sesiones 9-11 del proyecto. Consume primitives de spec 02 (sin redefinir schema), declara dependencia con spec 04 (BLE bastón) y con ADR-018 (estructura de navegación principal). Documenta TODO de refinamiento de R4.13 de spec 02 para los flujos R7/R8 (opciones A y B de duplicados lógicos).

## Deltas posteriores (ADR-028)

> Índice de delta-specs que extienden la búsqueda. El baseline de abajo **no se reescribe**; cada delta vive en su propio `{context,requirements,design,tasks}-<slug>.md` (en `specs/active/02-modelo-animal/`, donde nació).

| Slug | Qué agrega a la búsqueda | Estado |
|---|---|---|
| `identificadores-unificados` | **búsqueda unificada por los 3 identificadores**: electrónica (15 díg exacto + substring numérico), visual `idv` **alfanumérico** (antes solo se encontraba si era todo-dígitos), y **apodo** (custom_attributes, canal nuevo — `buildApodoSearchQuery`). Aplica al buscador general, cría al pie y la entrada manual "sin bastón" de maniobra. El único camino solo-electrónica sigue siendo el "Bastonear" (duplicate-check del EID). **CON BACKEND** (`0122`). Ver `{context,requirements,design,tasks}-identificadores-unificados.md` | done (Puerta 2, 2026-07-09) |

## Arquitectura general

```
┌────────────────────────────────────────────────────────────────┐
│  React Native (Expo) + TypeScript                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Providers globales (root)                                │  │
│  │   - AuthContext           (spec 01)                       │  │
│  │   - EstablishmentContext  (spec 01)                       │  │
│  │   - RodeoContext          (spec 02)                       │  │
│  │   - BleStickListenerProvider (spec 09, monta en root)    │  │
│  │     · escucha vía useBleStickListener (spec 04 expone)   │  │
│  │     · dispara FindOrCreateOverlay cuando llega TAG       │  │
│  │     · se desmonta en pantallas de MODO MANIOBRAS         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Pantallas spec 09                                        │  │
│  │   - AnimalsTabScreen          (tab Animales, R1)         │  │
│  │   - AnimalSearchResultsPanel  (resultados inline en tab) │  │
│  │   - AnimalCreateScreen        (R4)                       │  │
│  │   - AnimalEditScreen          (R5)                       │  │
│  │   - AssignTagSearchScreen     (R7, opción A)             │  │
│  │   - AssignTagConfirmScreen    (R7.4)                     │  │
│  │   - BulkTagAssignmentScreen   (R8, opción B)             │  │
│  │   - FindOrCreateOverlay       (host del flujo BLE)       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Hooks (orquestación)                                     │  │
│  │   - useAnimalLookup           (R3 — motor find-or-create) │  │
│  │   - useLastRodeoSelected      (R6)                       │  │
│  │   - useBleStickListener       (spec 04 — interface acá)  │  │
│  │   - useDynamicAnimalForm      (motor form dinámico)      │  │
│  │   - useAnimals / useAnimal /                              │  │
│  │     useAnimalTimeline / useCreateAnimal /                 │  │
│  │     useUpdateAnimal / useAnimalObservations               │  │
│  │     (todos definidos en spec 02 — spec 09 los consume)    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Services (boundary I/O)                                  │  │
│  │   - services/animals.ts       (spec 02)                  │  │
│  │   - services/events.ts        (spec 02)                  │  │
│  │   - services/observations.ts  (spec 02)                  │  │
│  │   - services/animal-lookup.ts (spec 09 — wrapper)        │  │
│  │   - services/last-rodeo.ts    (spec 09 — AsyncStorage)   │  │
│  │   - services/ble/stick.ts     (spec 04)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              ↓                                 │
│             supabase-js + PowerSync client                    │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ↓
┌────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  (sin migrations nuevas en spec 09 — solo consumimos spec 02)  │
│  Tablas: animals / animal_profiles / animal_events /            │
│          rodeos / categories_by_system / weight_events /        │
│          reproductive_events / sanitary_events / etc.           │
│  Función: animal_timeline(profile_id)                           │
│  RLS: las policies de spec 02 R11 son la red de seguridad final │
└────────────────────────────────────────────────────────────────┘
```

**Spec 09 no introduce ninguna migración SQL nueva**. Todo se construye consumiendo primitives de spec 02. Si durante implementación aparece la necesidad de algo nuevo a nivel datos, debe documentarse como "requiere ampliación de spec 02" y reabrir esa spec — no parchear desde acá.

## Archivos a crear o modificar

### Nuevos archivos en `app/src/features/animals/`

```
app/src/features/animals/
├── screens/
│   ├── AnimalsTabScreen.tsx                # R1
│   ├── AnimalSearchResultsPanel.tsx         # Componente render resultados de R1.2
│   ├── AnimalCreateScreen.tsx               # R4
│   ├── AnimalEditScreen.tsx                 # R5
│   ├── AssignTagSearchScreen.tsx            # R7 (opción A)
│   ├── AssignTagConfirmScreen.tsx           # R7.4 (modal de confirmación)
│   ├── BulkTagAssignmentScreen.tsx          # R8 (opción B)
│   └── FindOrCreateOverlay.tsx              # Host del flujo BLE (R2.4)
├── components/
│   ├── AnimalListItem.tsx                   # Reusable en R1 y R7
│   ├── AnimalSearchBar.tsx                  # Campo de búsqueda permanente de R1.2
│   ├── DynamicAnimalForm.tsx                # Motor de form dinámico por rodeo (R4.5)
│   ├── RodeoSelector.tsx                    # Combo / read-only según R4.4
│   ├── TimelineEventRenderer.tsx            # Render polimórfico por tipo (R5.3)
│   └── AddEventSheet.tsx                    # Sub-flujo "+ agregar evento" (R5.4)
├── hooks/
│   ├── useAnimalLookup.ts                   # R3 — motor find-or-create
│   ├── useLastRodeoSelected.ts              # R6
│   ├── useDynamicAnimalForm.ts              # Campos del form de alta (animal_profiles): categories_by_system + hardcode cría (system_field_config post-MVP) + selector de lote
│   └── useBleStickListener.ts               # Interface — implementación en spec 04
├── services/
│   ├── animal-lookup.ts                     # Wrapper sobre searchByTag/IDV/visualAlt de spec 02
│   └── last-rodeo.ts                        # Memory + AsyncStorage + fallback DB
├── providers/
│   └── BleStickListenerProvider.tsx         # Provider global montado en root
└── __tests__/
    ├── useAnimalLookup.test.ts
    ├── useLastRodeoSelected.test.ts
    ├── animal-lookup.test.ts
    └── last-rodeo.test.ts
```

### Modificaciones a archivos existentes

- `app/src/navigation/RootNavigator.tsx` (o equivalente que monte el navegador raíz tras spec 01) — montar `BleStickListenerProvider` envolviendo el navigator. La integración real depende de cómo se estructure la nav cuando se aborde la Fase 3 de spec 01.
- `app/src/navigation/MainTabs.tsx` (o equivalente) — agregar la tab `Animales` apuntando a `AnimalsTabScreen`. Estructura tentativa `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]` sujeta a ADR-018.
- `app/src/navigation/types.ts` — agregar tipos de rutas nuevas (`AnimalCreate`, `AnimalEdit`, `AssignTagSearch`, `BulkTagAssignment`).

Ningún archivo de spec 01, spec 02 o spec 04 se modifica desde spec 09. La spec 09 consume hooks/services exportados por las otras specs.

## Hooks y servicios de cliente

### `useAnimalLookup` — motor find-or-create (R3)

```typescript
type LookupIdentifier =
  | { kind: 'tag', value: string }
  | { kind: 'idv', value: string }
  | { kind: 'visual', value: string };

type LookupResult =
  | { found: true, mode: 'edit', profile: AnimalProfile, animal: Animal }
  | { found: 'global_only', mode: 'transfer_or_alta', animal: Animal }
  | { found: false, mode: 'create', prefilled: { tag?: string, idv?: string, visual?: string } }
  | { found: false, mode: 'create_via_intermediate', prefilled: { tag: string }, candidates: AnimalProfile[] };

useAnimalLookup(): {
  lookup: (id: LookupIdentifier, establishmentId: string, source: 'manual' | 'ble') => Promise<LookupResult>;
  status: 'idle' | 'searching' | 'done' | 'error';
};
```

- Implementación: orquesta `searchByTag`, `searchByIdv`, `searchByVisualAlt` de `services/animals.ts` (definidos en spec 02 design.md como primitives).
- Para `kind: 'tag'` con `source: 'ble'` y sin match local, ejecuta la query adicional de candidatos sin TAG (R7.2) y retorna `mode: 'create_via_intermediate'`.
- Para `kind: 'tag'` con `source: 'manual'` el motor no fuerza pantalla intermedia (R3.3 distingue por puerta).
- Lee/escribe contra PowerSync local; no requiere red (R3.5, R11.1).

### `useLastRodeoSelected` — estado de cliente (R6)

```typescript
useLastRodeoSelected(establishmentId: string): {
  current: Rodeo | null;
  set: (rodeo: Rodeo) => Promise<void>;
};
```

- En memoria: zustand store global indexado por `establishment_id` (zustand recomendado por consistencia con stack ADR-013 si está adoptado; fallback a Context API si zustand no está confirmado todavía).
- Persistencia: `AsyncStorage` con key `rafaq:last_rodeo:<establishment_id>`. Hidratar al mount del provider.
- Fallback DB: cuando el store no tiene valor para el establishment, dispara una query a PowerSync SQLite del último `animal_profiles.rodeo_id` tocado por el usuario en ese establishment (`max(updated_at) where created_by = userId or last_modified_by = userId`). La query es read-local, no red.
- Si la query DB también retorna vacío, fallback al **primer rodeo activo creado** del establishment (`order by created_at asc limit 1`). Si tampoco hay rodeos activos, retorna `null` y la UI debe bloquear el flujo con un CTA al wizard de R2.6 de spec 02 ("Creá tu primer rodeo"). **Refinamiento 2026-05-27 de spec 02**: el trigger que creaba un "Rodeo principal" autogenerado fue eliminado; los establecimientos recién creados arrancan con 0 rodeos.

### `useBleStickListener` — interface (spec 04 expone la implementación)

```typescript
type BleStickEvent =
  | { kind: 'tag_read', tag: string, timestamp: number }
  | { kind: 'connection_changed', connected: boolean };

useBleStickListener(opts: { enabled: boolean, onTagRead: (tag: string) => void }): {
  isConnected: boolean;
  isListening: boolean;
};
```

- Spec 09 declara la interface esperada. La implementación concreta vive en spec 04 (`services/ble/stick.ts`).
- El parámetro `enabled` permite desmontar el listener desde las pantallas de MODO MANIOBRAS (R2.3). Implementación inicial: `enabled = !isInModoManiobrasRoute`.
- Mientras spec 04 esté pending, el hook puede tener una implementación stub que retorna `{ isConnected: false, isListening: false }` y nunca invoca `onTagRead`. Eso permite implementar spec 09 fases 1-3 sin spec 04 bloqueante.

### `useDynamicAnimalForm` — motor de form dinámico por rodeo

```typescript
type FieldConfig = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'radio' | 'dropdown' | 'identifier_locked' | 'identifier_optional';
  required: boolean;
  options?: Array<{ value: string, label: string }>;
  defaultValue?: unknown;
};

useDynamicAnimalForm(rodeoId: string, options: {
  prefilledIdentifier: { kind: 'tag' | 'idv' | 'visual', value: string };
}): {
  fields: FieldConfig[];
  formState: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
  validate: () => { ok: true } | { ok: false, errors: Record<string, string> };
  submit: () => Promise<AnimalProfile>;
};
```

- Lee el `system_id` del rodeo y deriva la lista de campos del **form de alta del animal** (columnas de `animal_profiles`: sexo, raza, pelaje, peso de entrada, lote opcional, etc.). En MVP `(bovino, cría)` el conjunto es hardcoded (ver R4.5).
- **Distinción ADR-021**: este `FieldConfig[]` describe los **atributos del animal** (columnas de `animal_profiles`), NO los data_keys de eventos. Los data_keys que el rodeo tracquea viven en `rodeo_data_config` (+ `field_definitions`) y determinan qué **eventos** se pueden cargar después (al "+ agregar evento" en EDIT, y el gating de maniobras de spec 03), no los campos de este form de alta. Son fuentes distintas: el form de alta = `system_field_config` (futura tabla post-MVP, hoy hardcodeada); los eventos = `rodeo_data_config`.
- Estructura del módulo: `app/src/features/animals/services/form-config/bovino-cria.ts` exporta un array `FieldConfig[]` para ese par. Cuando se habilite un segundo sistema, agregar `bovino-invernada.ts`, etc. Punto de extensión limpio para post-MVP (spec 02 anticipa una tabla `system_field_config` para los campos del form de alta por sistema, distinta de `field_definitions`; no se implementa en MVP).
- **Lote**: el form incluye un selector opcional de `management_group_id` (los `management_groups` activos del establishment, o "sin lote"), consumido vía `useManagementGroups` de spec 02. UI tentativa.
- `prefilledIdentifier`: bloquea el campo correspondiente como `identifier_locked` (no editable durante alta); los otros dos quedan como `identifier_optional` (vacío, opcional).
- `submit()`: delega en `useCreateAnimal` de spec 02 con `patrón split insert + select` (ADR-012).

### `services/animal-lookup.ts`

Wrapper delgado sobre los primitives de búsqueda de `services/animals.ts` de spec 02. Centraliza la lógica de R3 para que `useAnimalLookup` quede tan delgado como sea posible.

```typescript
export async function lookupByTag(tag: string, establishmentId: string): Promise<LookupResult>;
export async function lookupByIdv(idv: string, establishmentId: string): Promise<LookupResult>;
export async function lookupByVisual(visual: string, establishmentId: string): Promise<LookupResult>;
export async function findCandidatesWithoutTag(establishmentId: string, limit: number): Promise<AnimalProfile[]>;
```

### `services/last-rodeo.ts`

Implementación de la lógica de persistencia + fallback de `useLastRodeoSelected`:

```typescript
export async function readLastRodeo(establishmentId: string): Promise<string | null>;  // AsyncStorage
export async function writeLastRodeo(establishmentId: string, rodeoId: string): Promise<void>;
export async function queryLastUsedRodeoFromDb(establishmentId: string, userId: string): Promise<string | null>;
export async function getDefaultRodeo(establishmentId: string): Promise<string | null>; // primer rodeo activo creado (order by created_at asc limit 1); null si no hay ninguno → UI bloquea con CTA wizard R2.6 spec 02
```

## Pantallas

### `AnimalsTabScreen` (R1)

- Tab dedicada en `MainTabs`. Layout: header con título "Animales", search bar permanente (`AnimalSearchBar`), filtros (chips: rodeo, status, "sin caravana electrónica"), lista paginada.
- Datasource: `useAnimals(filter)` de spec 02. PowerSync local — no red.
- Tap en un item de la lista → navega a `AnimalEditScreen` (R1.3).
- Search bar dispara `useAnimalLookup.lookup(...)` con `source: 'manual'`. Resultados se renderizan en `AnimalSearchResultsPanel` overlay sobre la lista (o inline si hay match único — definir con design system).
- CTA "Dar de alta este animal" cuando no hay match → navega a `AnimalCreateScreen` con identificador precargado (R1.4).
- CTA "Asignar caravanas en masa" cuando el filtro "sin caravana electrónica" está activo → navega a `BulkTagAssignmentScreen` (R8.1).

### `AnimalCreateScreen` (R4)

- Recibe `params: { prefilledIdentifier, animalIdGlobal?, source: 'manual' | 'ble' | 'transfer' }`.
- Renderiza `RodeoSelector` (R4.4) + `DynamicAnimalForm` (R4.5) según el rodeo seleccionado.
- Identificador precargado de `prefilledIdentifier` queda read-only durante el alta (R4.2). Otros dos identificadores editables y opcionales (R4.3).
- Botón "Crear animal" dispara `useDynamicAnimalForm.submit()` → invoca `useCreateAnimal` de spec 02.
- Tras éxito, redirige a `AnimalEditScreen` con el `animal_profile_id` recién creado (R4.7).
- En caso de error, mantiene el form cargado y muestra mensaje accionable (R4.8).
- Si `source: 'transfer'` (caso R3.4), omite la creación de `animals` y solo crea `animal_profiles` para el `animalIdGlobal` provisto (R4.10).

### `AnimalEditScreen` (R5)

- Recibe `params: { animalProfileId }`.
- Layout: cabecera read-only con identificadores (`tag_electronic`, `idv`, `visual_id_alt`), zona de atributos editables (`category`, `breed`, `coat_color`, `status`, `visual_id_alt`), zona de timeline scrollable debajo.
- Atributos editables: cada edición es inline + autosave (o explicit submit, decidir con design system). `useUpdateAnimal(profileId)` de spec 02 maneja la mutación.
- Timeline: `useAnimalTimeline(profileId)` retorna las filas de `animal_timeline()` con los 7 orígenes. Cada fila se renderiza con `TimelineEventRenderer` polimórfico por `event_kind`.
- Botón "+ agregar evento" abre `AddEventSheet` (bottom sheet o screen, definir con design system) con paso 1 = seleccionar tipo, paso 2 = form específico del tipo. Tras confirm, invoca el service correspondiente (`createWeightEvent | createReproductiveEvent | createSanitaryEvent | createConditionScoreEvent | createLabSample | createObservation`).
- Edit/soft-delete de evento gateado por `created_at` dentro de 15min + ser el creador, o ser owner (R5.5, R5.6). El server enforce vía trigger; el cliente respeta el mismo gating en la UI para no mostrar opciones inválidas.

### `AssignTagSearchScreen` (R7)

- Modal full-screen invocado desde `FindOrCreateOverlay` cuando `lookup` retorna `mode: 'create_via_intermediate'`.
- Lista los candidatos retornados por `findCandidatesWithoutTag(establishmentId)` ordenados por `updated_at desc`.
- Cada item muestra `AnimalListItem` con `idv | visual_id_alt | category | sex | birth_date | rodeo`.
- Tap en un candidato → navega a `AssignTagConfirmScreen` con el candidato + TAG bastoneado.
- CTA "No, es un animal nuevo" → navega a `AnimalCreateScreen` con TAG precargado (R7.5).

### `AssignTagConfirmScreen` (R7.4)

- Pantalla modal corta: "Asignar caravana `<TAG>` a este animal: `<datos del candidato>`. ¿Confirmar?".
- Confirm → llama a `services/animals.ts.assignTagToAnimal(animalId, tag)` (a definir en spec 02 o spec 09 dependiendo de cómo se resuelva R12 — TODO bloqueado por refinamiento de R4.13).
- Tras éxito, navega a `AnimalEditScreen` con el `animal_profile_id` del animal recién taggeado.

### `BulkTagAssignmentScreen` (R8)

- Accesible desde tab `Más` o desde `AnimalsTabScreen` con filtro "sin caravana electrónica" (R8.1).
- Mientras está en foreground, registra el listener BLE en modo "asignación" (no dispara `FindOrCreateOverlay`; lo procesa directo).
- Layout: top bar con contador "X caravanas asignadas hoy", lista de candidatos sin TAG (mismo criterio que R7.2), indicador del último TAG bastoneado pendiente de asignar.
- Tap en un candidato con TAG pendiente → asigna directo (consume el TAG de la cola).
- CTA "Bastoneé un animal nuevo, no estaba en la lista" → navega a `AnimalCreateScreen` con TAG precargado (R8.6).

### `FindOrCreateOverlay` (host del flujo BLE)

- Componente que el `BleStickListenerProvider` monta cuando llega un TAG (R2.4).
- Renderizado en un modal/stack screen encima de la pantalla activa para preservar el contexto del usuario.
- Internamente decide qué subpantalla mostrar según el resultado de `useAnimalLookup.lookup(...)`:
  - `mode: 'edit'` → renderiza `AnimalEditScreen` inline o navega.
  - `mode: 'transfer_or_alta'` → renderiza diálogo "este animal existe en otro campo; ¿darle de alta acá?".
  - `mode: 'create_via_intermediate'` → renderiza `AssignTagSearchScreen`.
  - `mode: 'create'` → renderiza `AnimalCreateScreen`.

## Comportamiento del listener BLE global

```
RootNavigator
└── BleStickListenerProvider (monta a nivel root, encima del navigator)
    ├── Listener BLE activo cuando: route.name NOT IN ManiobrasStack.*
    └── Cuando recibe TAG:
        - Dispara findOrCreateAnimal({ kind: 'tag', value: tag }, establishmentId, 'ble')
        - Renderiza <FindOrCreateOverlay> encima de la pantalla activa
        - Al cerrar el overlay, vuelve a la pantalla original sin perder contexto
```

Detalle de cómo detectar "estoy en MODO MANIOBRAS":

- Cuando se monte la stack de MODO MANIOBRAS (spec 03), llamar a `BleStickListenerProvider.disable()`. Al desmontar, `BleStickListenerProvider.enable()`.
- Implementación: el provider expone via context `{ disableListener, enableListener }` y la stack de MODO MANIOBRAS lo usa en `useEffect` con cleanup.

Mientras spec 04 esté pending, el provider monta el hook stub (no hace nada). La integración real se activa cuando spec 04 entregue la implementación de `useBleStickListener`.

## Manejo de estado

- **`lastRodeoSelected`**: zustand store global indexado por `establishment_id`, hidratado desde AsyncStorage al boot del app (ver `useLastRodeoSelected`). Si el stack ADR-013 todavía no confirmó zustand, fallback a Context API + reducer (`LastRodeoContext`).
- **Form state del flujo CREATE / EDIT**: local al screen, gestionado por `useDynamicAnimalForm` (CREATE) o `react-hook-form` o equivalente para EDIT (depende del stack de form library que se cierre con design system).
- **Búsqueda activa en `AnimalsTabScreen`**: local al screen (string `query` + debounce). No es global.
- **TAG pendiente de asignar en `BulkTagAssignmentScreen`**: local al screen, no global (cada sesión de asignación es independiente).
- **Estado del bastón BLE**: provisto por `useBleStickListener` (spec 04). Spec 09 no almacena estado BLE propio.

## Validaciones locales offline-first

Capa `services/animals.ts` (spec 02) + form-level validators en `useDynamicAnimalForm`:

- **R4.2 de spec 02** (al menos un identificador no vacío): el form valida que el identificador precargado no quede vacío + chequea los otros dos por si el usuario los completa. Server enforce vía CHECK + trigger.
- **R4.13 de spec 02** (inmutabilidad de `tag_electronic` / `idv`): el form CREATE marca el identificador precargado como read-only; el form EDIT no expone esos campos para edición. Server enforce vía trigger `0035_immutability_identifiers.sql`.
- **`sex` obligatorio**: validator local antes de submit.
- **`birth_date`**: si está presente, debe ser fecha pasada o presente (no futuro).
- **`entry_date`**: si está presente, debe ser ≥ `birth_date`.
- **`entry_weight`, `birth_weight`**: numéricos > 0 si presentes.

Todas las validaciones corren contra el form state local — no requieren red. Si pasan, el submit encola la mutación en PowerSync. Si la mutación falla en el servidor (race condition, constraint violado, etc.), se captura el error y se muestra una alerta accionable (R11.5).

## Edge Functions

**Ninguna nueva**. Spec 09 opera contra Supabase via supabase-js y PowerSync directamente, apoyándose en RLS de spec 02 R11. La única excepción potencial es el flujo R7/R8 de asignación de TAG (UPDATE `animals.tag_electronic` de NULL a valor) que **hoy está bloqueado por R4.13 de spec 02** (ver R12 de requirements). Cuando se resuelva el TODO de refinamiento, evaluar si la asignación de TAG necesita una Edge Function dedicada (probablemente sí, para enforce que el caller esté en el contexto del flujo de asignación legitimado).

## PowerSync

Spec 09 **consume** los buckets de spec 02 sin agregar buckets nuevos:

- `est_animal_profiles`, `est_animals_local`: para R3 (lookup) y R1 (lista).
- `est_rodeos`: para `RodeoSelector` (R4.4).
- `est_management_groups`: para el selector de lote en CREATE/EDIT (ADR-020).
- `est_weight_events`, `est_reproductive_events`, `est_sanitary_events`, `est_condition_score_events`, `est_lab_samples`, `est_animal_events`, `est_animal_category_history`: para el timeline (R5.3).
- `config_global`: para `useDynamicAnimalForm` (categorías por sistema + catálogo `field_definitions`/`system_default_fields` para el wizard de rodeo, aunque el form de alta del animal en MVP es hardcoded para cría).

No requiere ajustes a las sync rules de spec 02.

## Tests planeados

### Unit tests

- `useAnimalLookup.test.ts`: lookup por TAG / IDV / visual; caso match único; caso múltiples matches por visual; caso no match; caso BLE retorna `mode: 'create_via_intermediate'` con candidatos.
- `useLastRodeoSelected.test.ts`: read de memory; read de AsyncStorage; fallback DB; cambio de establishment; persistencia tras set.
- `animal-lookup.test.ts`: orquestación de los servicios de spec 02.
- `last-rodeo.test.ts`: AsyncStorage CRUD + fallback DB.
- `useDynamicAnimalForm.test.ts`: render de fields para `(bovino, cría)`; bloqueo del campo precargado; submit invoca `useCreateAnimal`.

### Component tests (RTL)

- `AnimalsTabScreen.test.tsx`: render con 0/1/N animales; búsqueda dispara lookup; filtros funcionan; CTA "Dar de alta" cuando no hay match.
- `AnimalCreateScreen.test.tsx`: identificador precargado read-only; combo de rodeo con 1 / ≥2 rodeos; submit válido invoca `useCreateAnimal`.
- `AnimalEditScreen.test.tsx`: render del timeline polimórfico; botón "+ agregar evento" abre el sheet; edición de atributo dispara update.

### Integration tests (offline-first)

- Flujo end-to-end con red apagada: tipear identificador inexistente en tab → CREATE → submit → ver el animal en la lista al volver al tab. PowerSync local debe reflejar la mutación.
- Flujo end-to-end con bastón mockeado: simular evento `tag_read` desde el provider → `FindOrCreateOverlay` aparece encima de la pantalla activa → CREATE → confirm → volver a la pantalla activa.

### Tests bloqueados por R12

- Tests del flujo R7 (asignación con búsqueda intermedia) y R8 (asignación masiva): bloqueados hasta resolver R12 (refinamiento de R4.13 de spec 02). Documentados en `tasks.md` Fase 3 como pendientes con TODO explícito.

## Alternativa descartada

### Una sola pantalla unificada CREATE/EDIT en lugar de dos screens separados

**Pros**:
- Menos código: una sola pantalla que detecta si el animal existe y conmuta entre modos read-only y edit.
- Patrón "create=edit" usado en Auravant (research curado, ver `design/research-findings.md` sección Auravant) — alineado con el molde funcional para MODO MANIOBRAS.

**Contras**:
- El flujo CREATE tiene 4 elementos que EDIT no necesita y al revés:
  - **CREATE**: selección de rodeo (R4.4), identificador precargado read-only (R4.2), otros identificadores recomendados (R4.3), form dinámico por sistema (R4.5).
  - **EDIT**: timeline append-only (R5.3), botón "+ agregar evento" (R5.4), zona de atributos editables sin selección de rodeo (el rodeo del perfil no se cambia desde acá).
- Mezclar ambas en una sola pantalla requiere render condicional masivo que vuelve la pantalla difícil de testear y de evolucionar.
- El operador en campo tiene **intenciones diferentes** según el caso: "estoy dando de alta un animal nuevo" vs "estoy revisando/agregando algo a un animal que ya existe". Forzar la misma pantalla diluye esa diferencia conceptual.
- La velocidad operativa (CLAUDE.md principio 4) está mejor servida por dos pantallas chicas y especializadas que por una sola grande y ambigua.

**Razón**: separar CREATE y EDIT como dos screens distintos protege la velocidad operativa, la claridad mental del operador y la testeabilidad. La duplicación de código es marginal (el form se comparte vía `DynamicAnimalForm`; los componentes de identificador se reusan). Esta es la dirección elegida.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El motor `findOrCreateAnimal` colisiona con cambios de establishment en mitad de flujo (race condition) | El motor recibe `establishment_id` por argumento (no lo lee del context en mitad de la operación). El caller pasa el valor del context al momento del disparo y se respeta hasta el final del flujo. R10.3 lo cubre. |
| Listener BLE captura un TAG mientras el usuario está en un form CREATE/EDIT y abre otro flujo encima, perdiendo el form en curso | El `BleStickListenerProvider` debe respetar un modo "ocupado" cuando hay un form CREATE/EDIT activo (configurable vía hook `useBusyMode()`). Decisión de detalle: cuando se entra a `AnimalCreateScreen`, deshabilitar el listener hasta que se cierre. Documentado como TODO de detalle. |
| `lastRodeoSelected` queda stale si el usuario borra el rodeo desde otra pantalla (RodeoScreen de spec 02) | El hook valida que el rodeo siga activo antes de usarlo como default. Si fue soft-deleted o inactivo, fallback a R6.3 (query DB del último usado) y refresca el storage. |
| Búsqueda fuzzy de `visual_id_alt` lenta con muchos animales | Spec 02 ya tiene índice GIN trigram + límite a 20. Cliente debouncea la búsqueda 250 ms y muestra spinner. |
| Tests del flujo BLE difíciles sin device real | Mock del provider en tests: el `BleStickListenerProvider` acepta un `mode='mock'` que expone una API para disparar eventos manualmente desde el test (`mockTagRead(tag)`). |
| Tensión R4.13 con opciones A/B (asignar TAG NULL→valor) | **RESUELTA** (2026-05-26): R4.13 de spec 02 permite explícitamente `NULL → valor` (R4.13.a). Ver R12 de requirements (RESUELTO). No es un bloqueo activo. |

## Dependencias del spec

- **Spec 02** (modelo animal): aprobada (refundida 2026-05-28) y backend implementable. Spec 09 consume `animals`, `animal_profiles`, `animal_events`, `rodeos`, `categories_by_system`, `field_definitions` + `system_default_fields` + `rodeo_data_config` (plantilla de datos, ADR-021), `management_groups` (lote, ADR-020), función `animal_timeline()`, RLS de R11, motor de form dinámico documentado en design.md § "Motor de form dinámico por rodeo". **No** redefine.
- **ADR-020** (lote): ✅ accepted. Spec 09 consume `management_groups` para el selector de lote en CREATE/EDIT (UI tentativa).
- **ADR-021** (plantilla de datos): ✅ accepted. Spec 09 distingue el form de alta del animal (columnas `animal_profiles`, hardcode cría) de los data_keys de eventos (`rodeo_data_config`).
- **Spec 04** (BLE bastón): pending. Spec 09 declara la interface `useBleStickListener` y monta un stub mientras spec 04 no esté. La puerta BLE (R2) se activa solo cuando spec 04 esté implementada.
- **Spec 01** (identity multi-tenancy): backend done (Fase 1+2), frontend pendiente. Spec 09 consume `AuthContext`, `EstablishmentContext`. La implementación de spec 09 depende de que Fase 3+ de spec 01 esté implementada (puerta común para todo el frontend post-design-system).
- **ADR-016** (terminología rodeo/sistema): ✅ done. Spec 09 usa "rodeo" y "sistema" consistentemente.
- **ADR-017** (timeline append-only): ✅ done + matizado por spec 02 (modelo Híbrido). Spec 09 consume el timeline vía `animal_timeline()`.
- **ADR-018** (estructura de navegación principal): pending. Spec 09 asume estructura tentativa `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]` sujeta a ADR-018.
- **Design system canónico** (item A.1 del plan): in_progress. Las requirements UI de spec 09 son tentativas hasta que se cierre el design system y se hagan los refinamientos incrementales.

## Notas para el implementer

- Cuando se aborde la implementación, leer `progress/current.md` sesiones 9-11 + ADRs 016/017 + spec 02 completa antes de empezar. Es **mandatorio** entender el modelo de datos subyacente.
- **Patrón split insert + select** (ADR-012) sigue siendo la norma para creaciones que disparan triggers (alta de animal, agregar evento).
- Validaciones de cliente deben ser **espejo** del enforce del server (CHECK + trigger). Nunca relajar la validación cliente "porque el server lo enforce" — el operador necesita feedback inmediato sin esperar roundtrip.
- Commits en español, presente, descriptivo.
- Si durante implementación aparece la necesidad de algo nuevo en spec 02 (schema, función SQL, RLS), **parar y reportar al leader** — no parchear desde spec 09.

Ver `tasks.md` para el plan de ejecución paso a paso.
