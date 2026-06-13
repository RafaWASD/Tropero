# Spec 09 — chunk "09 resto · BLE global" — Design

**Status**: Draft (pendiente de aprobación de spec por Raf).
**Fecha**: 2026-06-13 (sesión 24).
**Requirements**: `requirements-09resto-ble-global.md` (RB1..RB9). Insumo primario: `context-09resto-ble-global.md` (Gate 0 aprobado).
**Reconciliación**: este design describe el cableado contra el **as-built real** (no contra el `design.md` base de 2026-05-26, que asume `app/src/features/animals/` — estructura que NO existe). Mapa de rutas reales abajo.

## 1. Diferencias con el design base (capa de archivos)

El `design.md` base (2026-05-26) ubica todo en `app/src/features/animals/screens|components|hooks|services|providers`. **Eso no es el as-built.** Estructura real:

- Screens = archivos de Expo Router en `app/app/` (`(tabs)/animales.tsx`, `crear-animal.tsx`, `animal/[id].tsx`, `agregar-evento.tsx`).
- Capa BLE de spec 04 en `app/src/services/ble/` (provider, hooks, adapters, contrato).
- Services de datos en `app/src/services/` (`animals.ts`, `transfer-animal.ts`); queries locales en `app/src/services/powersync/local-reads.ts`.
- Providers globales en `app/app/_layout.tsx` (no hay `RootNavigator.tsx` ni `MainTabs.tsx`).

Este chunk respeta esa estructura: **no crea `app/src/features/animals/`**.

## 2. Montaje del provider y el host (RB1)

### 2.1 Árbol real de `_layout.tsx` (as-built)

```
GestureHandlerRootView > SafeAreaProvider > TamaguiProvider
  > AuthProvider > PowerSyncProvider > ProfileProvider
    > EstablishmentProvider > RodeoProvider > RootGate
```

`RootGate` ya renderiza `<Stack>` con todos los destinos navegables (`crear-animal`, `animal/[id]`, `agregar-evento`, etc.) y el gating por top-segment.

### 2.2 Dónde se monta (sketch §4 del Gate 0, reconciliado)

El `BleStickListenerProvider` se monta **entre `RodeoProvider` y `RootGate`** (envuelve a `RootGate`), para que el host del flujo BLE tenga `Auth/PowerSync/Establishment/Rodeo` en contexto y pueda scopear el lookup + leer `lastRodeoSelected`:

```tsx
// app/app/_layout.tsx (modificación)
<RodeoProvider>
  <BleStickListenerProvider mode="auto">
    <RootGate />
  </BleStickListenerProvider>
</RodeoProvider>
```

El **host** vive dentro de `RootGate`, hermano del `<Stack>`:

```tsx
// dentro de RootGate, return:
return (
  <>
    <Stack screenOptions={{ headerShown: false }}>
      {/* … screens existentes … */}
    </Stack>
    <FindOrCreateOverlay />
  </>
);
```

`FindOrCreateOverlay` usa `useBleStickListener({ enabled, onTagRead })` + `useRouter` para navegar al confirmar. Vive **dentro** de los providers de datos → puede scopear el lookup al establishment activo y leer el rodeo.

**Por qué `mode="auto"`**: `selectTransportAdapter` (`adapter-selection.ts`) elige `web-serial` en web, `manual` en native (spp-android es Fase 4, gated). El `MockAdapter` se fuerza con `mode="mock"` solo en tests (RB1.3 / §7). El provider NO auto-conecta el transporte (RB1.3) — el harness `baston-test.tsx` sigue intacto con su provider self-contained.

## 3. Service `lookupByTag` + query nueva (RB4)

### 3.1 El tipo de resultado (`TagLookupResult`)

El `LookupResult` actual de `animals.ts` es de la **puerta manual** (`edit`/`create` con `prefilled`). La rama BLE necesita un tipo **separado** (no se reusa el manual: distintos modos):

```ts
export type TagLookupResult =
  | { mode: 'edit';     profileId: string }
  | { mode: 'transfer'; sourceProfileId: string; otherFieldName: string }
  | { mode: 'create' };
```

> **RECONCILIACIÓN as-built (Run 1, 2026-06-13).** El tipo `TagLookupResult` se DEFINE en un módulo nuevo PURO `app/src/services/tag-lookup.ts` (sin imports de RN/expo/supabase) y se **re-exporta desde `animals.ts`** (`export type { TagLookupResult } from './tag-lookup'`). El contrato público no cambia — el tipo se importa de `animals.ts` igual que antes (mismo patrón as-built que `TransferAnimalInput`/`TransferAnimalResult`, definidos en `transfer-animal.ts` y re-exportados por `animals.ts`). **Por qué el split**: `animals.ts` importa `./supabase` (expo-secure-store) → NO carga bajo `node:test`; la DECISIÓN de las 3 ramas se extrae a `tag-lookup.ts::resolveTagLookup(...)` (puro) para unit-testearla sin SDK ni mocks de módulo (el repo no usa `mock.module`). El wrapper I/O `lookupByTag` (en `animals.ts`) hace las 2 lecturas locales y delega la decisión al puro.

### 3.2 Las 3 ramas de `lookupByTag(tag, establishmentId)`

Todo local (PowerSync SQLite), sin red. El wrapper I/O `lookupByTag` (en `animals.ts`) corre las queries; la DECISIÓN la toma `resolveTagLookup(...)` (puro, en `tag-lookup.ts`):

1. **Match local activo → `edit`** (RB4.3): reusar `buildSearchByTagQuery(establishmentId, tag)` (ya existe; UNION synced+overlay, `status='active'`, `deleted_at IS NULL`, scopeada al campo activo). Si devuelve ≥1 fila → `{ mode:'edit', profileId: rows[0].id }`. La unicidad global de `animals.tag_electronic` (spec 02) garantiza ≤1 perfil activo por campo. **Corto-circuito as-built**: si la rama 1 matchea, `lookupByTag` NO corre la query cross-campo (ahorra una lectura — el resultado es `edit` igual).
2. **Activo en otro campo → `transfer`** (RB4.4): si la rama 1 no matcheó, correr la query nueva `buildLookupTagAcrossFieldsQuery(tag)` (ver 3.3). `resolveTagLookup` toma la PRIMERA fila cuyo `establishment_id !== establishmentId` → `{ mode:'transfer', sourceProfileId, otherFieldName }`. (Defensivo: una fila que SEA del campo activo se IGNORA — ya la habría tomado la rama 1; el `otherFieldName` cae a un genérico `'otro campo'` si el `establishment_name` viniera NULL.)
3. **Sin match → `create`** (RB4.5): si ninguna rama matcheó → `{ mode:'create' }`. DIRECTO a CREATE (sin intermediate de opción A — DEC-2, diferido).

> **Nota as-built (emptyIsSyncing:false en ambas lecturas)**: `lookupByTag` corre ambas queries con `emptyIsSyncing:false` — "no hay match" es un resultado de negocio LEGÍTIMO (= `create`/`transfer` según la 2da query), NO una degradación a "Sincronizando". Un EID nuevo bastoneado no debe quedar trabado pidiendo sync.

### 3.3 Query nueva: `buildLookupTagAcrossFieldsQuery(tag)` en `local-reads.ts`

**Por qué es nueva**: `buildSearchByTagQuery` scopea por `establishment_id` (vía `listDomainFilters(establishmentId)`) → solo ve el campo activo. Para detectar "otro campo" hace falta una query que matchee el TAG **sin** filtrar por establishment, sobre el set sincronizado (que ya incluye todos los campos del usuario por la stream `est_animal_profiles`, scopeada por `has_role_in` server-side).

```sql
-- buildLookupTagAcrossFieldsQuery(tag)
SELECT ap.id AS profile_id, ap.establishment_id AS establishment_id, e.name AS establishment_name
FROM animal_profiles ap
JOIN establishments e ON e.id = ap.establishment_id
WHERE ap.animal_tag_electronic = ?         -- b1: identidad denormalizada en el perfil
  AND ap.status = 'active'
  AND ap.deleted_at IS NULL
LIMIT 2;                                     -- 2 para distinguir "solo en otro campo" de duplicado raro
```

Notas:
- `animal_tag_electronic` es la columna denormalizada en `animal_profiles` (ADR-026 b1), igual que la usa `buildSearchByTagQuery`.
- `establishments` está sincronizado localmente (las memberships del usuario; usado por `buildEstablishmentDetailQuery`). El JOIN es local.
- NO consulta el overlay `pending_*`: un transfer aplica sobre filas REALES sincronizadas; un alta optimista del campo activo ya la cubre la rama 1.
- Multi-tenancy (RB9.2): la query no debilita la RLS — solo no re-aplica el filtro de campo activo que las queries operativas sí aplican. El server (RLS spec 02/11) es la barrera final.

### 3.4 Resolución de rodeo/categoría destino para el transfer (RB7.2)

`transferAnimal` (spec 11) requiere `targetRodeoId` + `targetCategoryId` del campo activo, **del mismo sistema** que el de origen (R1.5/R2.2 de spec 11). El overlay (modo transfer) resuelve:
- `targetRodeoId`: el rodeo activo del campo activo. Default = `lastRodeoSelected` del establishment activo (`readLastRodeo` / `resolveDefaultRodeoId` de `last-rodeo.ts`) o el único rodeo activo. **Restricción de sistema**: el rodeo destino debe ser del mismo `system_id` que el de origen — si el campo activo no tiene un rodeo de ese sistema, el RPC lo rechaza (23514) y el overlay muestra el copy de `classifyTransferError` (`invalidTarget`). MVP opera un solo sistema (bovino/cría) → el caso feliz es directo; el guard de sistema queda defensivo.
- `targetCategoryId`: categoría inicial en el campo destino, resuelta por el catálogo del sistema destino (`buildCategoryIdByCodeQuery(systemId, code)`), siguiendo el TODO-D2 de spec 11 (la categoría inicial razonable del animal transferido).
- `targetProfileId`: UUID generado en el cliente (`randomUuid`), estable entre reintentos (idempotencia, spec 11 R6.2).

> **Nota de complejidad**: la resolución completa de rodeo+categoría destino para el transfer desde el overlay es la parte más densa de este chunk. Si al implementar resulta que falta un dato (p. ej. el `system_id` del rodeo de origen no es legible desde el set sincronizado del campo destino), ver BLOQUEANTES al final.

> **RECONCILIACIÓN as-built (Run 2, 2026-06-13) — §10.3 NO fue bloqueante.** Cómo quedó la resolución:
> - `targetRodeoId`: `resolveDefaultRodeoId(rodeo.available.map(id), readLastRodeo(user, est), queryLastUsedRodeoFromDb(est))` — el default del campo activo. Si no hay rodeo disponible → error accionable (no se transfiere). El tipo `Rodeo` del `RodeoContext` ya trae `systemId` → el `system_id` DESTINO está a mano sin query extra.
> - `targetCategoryId`: se lee el `categoryCode` del perfil de ORIGEN con `fetchAnimalDetail(sourceProfileId)` (el perfil de origen ESTÁ sincronizado local — es la premisa del modo transfer) y se resuelve por CÓDIGO en el sistema DESTINO con `buildCategoryIdByCodeQuery(targetRodeo.systemId, sourceCategoryCode)`. **Esto cubre AMBOS casos del plan del leader sin exponer el `system_id` de origen**: si los sistemas coinciden (MVP, un solo sistema), el code resuelve a la misma fila; si difieren, mapea por código al sistema destino. Si la categoría NO resuelve en el sistema destino (`catRes.value.length === 0`) → **error accionable, NO se inventa un default** (regla del leader / §10.3). Si `fetchAnimalDetail(sourceProfileId)` falla (perfil de origen no legible local) → se reporta su error y NO se transfiere (no se inventa categoría).
> - `targetProfileId`: `newTransferTargetProfileId()` UNA vez por intent, guardado en un `useRef` → estable entre reintentos del MISMO `TransferBody` (idempotencia, spec 11 R6.2). Cerrar y re-bastonear genera un intent nuevo (nuevo UUID), correcto.

## 4. `FindOrCreateOverlay` (RB3/RB5/RB6/RB7)

Componente nuevo. Ubicación propuesta: `app/app/_components/FindOrCreateOverlay.tsx` (o `app/src/components/`, a decidir por el implementer según dónde viven hoy los componentes compartidos; NO en `features/animals/`).

> **RECONCILIACIÓN as-built (Run 2, 2026-06-13).** Decisiones tomadas al implementar:
> - **Ubicación del host**: `app/app/_components/FindOrCreateOverlay.tsx`. La carpeta `_components/` (prefijo `_`) NO la enruta Expo Router, así que es un host-level component que SÍ puede tocar `services` (lookupByTag/fetchAnimalDetail/transferAnimal) sin violar la regla de `architecture.md` (los componentes de `app/src/components/` no importan `services`). El `BleConnectionChip` (presentacional puro, solo `useBleConnectionStatus`) sí vive en `app/src/components/`.
> - **EID legible (RB3.2)**: `app/src/utils/eid-format.ts::formatEidReadable` (PURO, con test) agrupa los 15 díg como `PPP NNNN NNNN NNNN` (prefijo + 3 grupos de 4) para lectura de manga. El header del sheet usa el formateado; el param `tag` a crear-animal y el RPC usan el EID crudo.
> - **Bottom-sheet (DEC-1)**: se reusó el patrón de `BulkConfirmSheet` (scrim `$scrim` + `position:absolute` + sheet anclado abajo + grip + `Pressable` backdrop que cierra) — no se inventó un primitivo nuevo.
> - **Estado de red (RB7.3)**: `useStatus().connected` de `@powersync/react` (mismo predicado que `assertOnline`; el overlay vive bajo `PowerSyncContext`).
> - **Resolución de `targetCategoryId` (RB7.2 / §3.4)**: ver §3.4 reconciliado abajo.
> - **`idvDropped` (RB7.4)**: se avisa DENTRO del sheet (estado de éxito-con-aviso + CTA "Ver ficha"), NO vía param a `/animal/[id]` — la ficha de spec 02/11 no lee un param de aviso, así que se da acá sin tocar scope ajeno.
> - **Lag de sync post-transfer (RB7.4)**: tras el RPC OK se espera (`waitForProfileLocally`, polling de `fetchAnimalDetail`) a que el perfil NUEVO baje al SQLite local ANTES de navegar. La ficha lee LOCAL (`emptyIsSyncing:false`) → sin esta espera mostraba "No se encontró el animal" hasta el sync (cazado en E2E (d)). El transfer es online-only → el sync está activo, el perfil baja en segundos.

### 4.1 Estado y ciclo

```ts
type OverlayState =
  | null                                        // cerrado
  | { eid: string; status: 'loading' }          // lookup en curso
  | { eid: string; status: 'ready'; result: TagLookupResult }
  | { eid: string; status: 'error'; message: string };
```

- `useBleStickListener({ enabled, onTagRead })` con `enabled` = RB2.1.
- `onTagRead(eid)`: setea `{ eid, status:'loading' }` → corre `lookupByTag(eid, establishmentId)` → setea `ready`/`error`. **Guard de secuencia** (ref): un EID nuevo (live-rescan, RB3.5) descarta el lookup viejo en vuelo y abre el nuevo.
- Cierre (RB3.4): `setState(null)`; el listener sigue activo (el provider nunca se desmonta).

### 4.2 Render por modo (bottom-sheet, DEC-1)

Bottom-sheet (reusar el patrón de sheet ya usado en la app — `AddEventSheet`/equivalente; el implementer elige el primitivo de sheet del DS). Encabezado SIEMPRE = EID formateado legible (RB3.2). Cuerpo:

| `result.mode` | Cuerpo | CTA primario (≥56px) | Acción |
|---|---|---|---|
| `edit` | card del animal (`fetchAnimalDetail(profileId)`: visual/IDV + categoría + sexo + rodeo) | **"Ver ficha"** | cerrar + `router.push('/animal/[id]', { id: profileId })` |
| `create` | "Animal nuevo" + EID | **"Dar de alta"** | cerrar + `router.push('/crear-animal', { tag: eid })` |
| `transfer` | "Está en **[otherFieldName]**" + EID | **"Transferir a [campo activo]"** (disabled sin red) + secundario "Cancelar" | `transferAnimal(...)` → cerrar + `router.push('/animal/[id]', { id: targetProfileId })` |

- **Online check (RB7.3)**: el CTA transfer se deshabilita cuando no hay red. Reusar el mismo predicado que `assertOnline` (online-guard de PowerSync) o `useStatus().connected` de PowerSync para el estado de red; copy = `TRANSFER_OFFLINE_MESSAGE` de spec 11.
- **Resultado del transfer (RB7.4)**: si `idvDropped`, toast/línea "Completá el IDV en el campo nuevo".

### 4.3 Navegación y busyMode

Al navegar a `/crear-animal` o `/animal/[id]`, esos screens montan `useBusyWhileMounted()` (RB2.2) → el listener se suspende mientras el form está abierto, y se reanuda al volver (cerrar el screen). El overlay ya estará cerrado (se cierra antes de navegar).

## 5. Gating del listener y forms (RB2)

- `enabled` (RB2.1): `est.status === 'active' && rodeo.status === 'active'`, leído de `useEstablishment()` + `useRodeo()` dentro del overlay.
- `useBusyWhileMounted()` (RB2.2) agregado en: `crear-animal.tsx`, `animal/[id].tsx`, `agregar-evento.tsx` (top del componente). Hoy NINGUNO lo tiene (verificado en el as-built) → es trabajo del chunk.
- `useStickListenerControls()` (RB2.3): cableado pero sin consumidor en este chunk (MODO MANIOBRAS no existe). Se verifica que el provider lo expone (ya lo hace `stick.ts`).
- Cambio de establishment con overlay abierto (RB2.4): un `useEffect` que observa `establishmentId` y cierra el overlay si cambia (descarta el lookup viejo).

## 6. Chip de conexión (RB8)

- Componente `BleConnectionChip` (nuevo) que consume `useBleConnectionStatus()` (`connection-status.ts`, ya existe). Mapea cada `ConnectionStatus` a copy es-AR + ícono (reusar el `statusView` del harness `baston-test.tsx` como referencia de copy/iconos — extraer a un módulo compartido si conviene, sin duplicar).
- Ubicación: header de la tab Animales (`(tabs)/animales.tsx`) — punto consistente y manga-relevante. Nunca bloquea la puerta manual (RB8.2; `blocksManualEntry` invariante `false`).
- Connect web-serial (RB8.3): el chip (o un control al lado) dispara `transport.connect()` con gesto de usuario (web-serial: `requestPort`). Reusar el patrón `onConnect` del harness. **Sin pantalla de pairing pulida** (diferida, DEC-5).

> **RECONCILIACIÓN as-built (Run 2).** El copy/iconos se extrajeron a `app/src/components/ble-connection-view.ts::bleConnectionView` (módulo compartido nuevo, versión de PRODUCCIÓN del `statusView` del harness — el harness `baston-test.tsx` es self-contained y NO se toca, así que mantiene su copia; no es duplicación introducida por el chunk). El `BleConnectionChip` consume `useBleProviderApi()` (ya exportado por spec 04) para el `transport.connect()` del tap. En la fila del título "Animales" (`XStack` con `justifyContent:"space-between"`). En native (manual-first) el transporte conectable es `null` → el tap es no-op (el chip queda informativo).

## 7. Tests / E2E (RB criterios + §9 Gate 0)

### 7.1 Unit (node:test)
- **Decisión de las 3 ramas (as-built Run 1)**: las 3 ramas (`edit` con match en campo activo; `transfer` con match en otro campo; `create` sin match) se testean sobre la función PURA `resolveTagLookup(...)` de `tag-lookup.ts` (`tag-lookup.test.ts`), alimentándola con las filas que cada query produciría. NO se mockea `runLocalQuery` ni se importa `animals.ts` (no carga bajo `node:test`: importa `./supabase`). Esto cubre el "unit de las 3 ramas de `lookupByTag`" (que es un orquestador delgado sobre `resolveTagLookup`). Cubre además los edge cases: ignorar defensivamente una fila cross-campo del campo activo, `establishment_name` NULL → fallback, edit-gana-sobre-transfer.
- `buildLookupTagAcrossFieldsQuery`: test del builder (SQL + args **e integración SQLite real**: matchea el activo en otro campo, ignora deleted/no-activo, JOINea el name del campo, LIMIT 2), como los demás builders de `local-reads.test`.

### 7.2 E2E Playwright con `MockAdapter` (los 4 escenarios del §9 Gate 0)

**Wiring necesario (no existe hoy)**: el `MockAdapter` (`adapter-mock.ts`) ya tiene `mockTagRead(eid)` / `mockConnectionChange`, pero **no hay forma de que Playwright lo invoque** (el provider de la raíz instancia el adapter internamente). El chunk debe exponer un **hook de test** controlado por flag (p. ej. `mode="mock"` activado por una env/flag de E2E + un handle en `window` como `window.__rafaqBle.tagRead(eid)`) que enchufe al `MockAdapter` montado. Patrón: igual espíritu que el harness, pero sobre el provider de la raíz. Documentar el flag para no dejar superficie en prod.

Escenarios (sobre PowerSync local, con seed de animals.spec.ts):
- (a) `tagRead(eid de un animal existente del campo)` → overlay `edit` → "Ver ficha" → ficha correcta.
- (b) `tagRead(eid nuevo)` → overlay `create` → "Dar de alta" → `/crear-animal` con el TAG precargado read-only.
- (c) `tagRead(eid)` con un form CREATE/EDIT abierto → NO abre overlay (busyMode).
- (d) `tagRead(eid de un animal en otro campo)` → overlay `transfer` → transferir online → ficha nueva en el campo activo. (Requiere seed con un 2º campo del mismo usuario + el animal activo allí.)

Archivo: extender `app/e2e/` con un `baston.spec.ts` nuevo (patrón de `animals.spec.ts`).

### 7.3 `node scripts/check.mjs` verde end-to-end (lint anti-hardcode, unit, builders, suites).

## 8. Archivos a crear / modificar (rutas REALES)

| Archivo | Acción | Cubre |
|---|---|---|
| `app/src/services/powersync/local-reads.ts` | **+** `buildLookupTagAcrossFieldsQuery(tag)` | RB4.6 |
| `app/src/services/powersync/local-reads.test.ts` | **+** test del builder (SQL/args + integración SQLite) | RB4.6 |
| `app/src/services/tag-lookup.ts` | **+** (as-built Run 1) tipo `TagLookupResult` + `resolveTagLookup(...)` (decisión PURA de las 3 ramas) | RB4 |
| `app/src/services/tag-lookup.test.ts` | **+** (as-built Run 1) unit de las 3 ramas + edge cases sobre `resolveTagLookup` | RB4 |
| `app/src/services/animals.ts` | **+** `lookupByTag(tag, establishmentId)` (I/O: 2 lecturas locales + delega a `resolveTagLookup`) + re-export de `TagLookupResult` | RB4 |
| `scripts/run-tests.mjs` | **mod** enganchar `tag-lookup.test.ts` a la lista de unit tests del cliente | RB4 |
| `app/app/_layout.tsx` | **mod** [Run 2] montar `BleStickListenerProvider mode={isBleE2E()?'mock':'auto'}` entre `RodeoProvider` y `BleHost`; `BleHost` = `<RootGate/>` + `<FindOrCreateOverlay/>` (+ `<BleE2EBridge/>` bajo flag) | RB1 |
| `app/app/_components/FindOrCreateOverlay.tsx` | **+** [Run 2] host del flujo BLE (estado, render por modo, navegación, live-rescan, transfer + `waitForProfileLocally`) | RB3, RB5, RB6, RB7 |
| `app/src/utils/eid-format.ts` (+ `.test.ts`) | **+** [Run 2] `formatEidReadable` (PURO, RB3.2: `PPP NNNN NNNN NNNN`) + test | RB3.2 |
| `app/src/components/BleConnectionChip.tsx` | **+** [Run 2] chip de estado + connect web-serial (consume `useBleProviderApi`) | RB8 |
| `app/src/components/ble-connection-view.ts` | **+** [Run 2] `bleConnectionView` (copy es-AR + íconos, módulo compartido del chip) | RB8.2 |
| `app/src/components/index.ts` | **mod** [Run 2] exportar `BleConnectionChip` + `bleConnectionView` | RB8 |
| `app/app/(tabs)/animales.tsx` | **mod** [Run 2] montar el `BleConnectionChip` en la fila del título | RB8.1 |
| `app/app/_components/ble-e2e-flag.ts` | **+** [Run 2] `isBleE2E()` (marca `window.__RAFAQ_BLE_E2E__`, fuera de prod) | §7.2 |
| `app/app/_components/BleE2EBridge.tsx` | **+** [Run 2] publica `window.__rafaqBle.{tagRead,connectMock,…}` (solo bajo el flag) | §7.2 |
| `scripts/run-tests.mjs` | **mod** [Run 2] enganchar `eid-format.test.ts` a los unit del cliente | RB3.2 |
| `app/app/crear-animal.tsx` | **mod** [Run 1] aceptar param `tag`, precargarlo read-only, header "Creando: [TAG]"; `useBusyWhileMounted()` | RB6.3, RB2.2 |
| `app/app/animal/[id].tsx` | **mod** [Run 1] `useBusyWhileMounted()` | RB2.2 |
| `app/app/agregar-evento.tsx` | **mod** [Run 1] `useBusyWhileMounted()` | RB2.2 |
| `app/e2e/baston.spec.ts` | **+** [Run 2] E2E mock (4 escenarios §9), 4/4 verdes | §7.2 / criterios |

**No se toca**: `app/src/services/ble/*` (firma de spec 04 — se consume tal cual; el flag E2E y el bridge viven en `app/app/_components/`, NO en `ble/`), `app/src/services/transfer-animal.ts` (spec 11 — se consume tal cual), `app/app/baston-test.tsx` (harness self-contained intacto). NINGUNA migración SQL, RLS ni Edge nueva.

## 9. Alternativa descartada

### Hook intermedio `useAnimalLookup` (como en el design base) en vez de service `lookupByTag` + overlay directo

**Pros**: el design base de 2026-05-26 lo propone; encapsula el estado de lookup en un hook reusable.

**Contras**: el as-built de `animals.ts` ya resuelve el find-or-create manual con un **service puro** (`findOrCreateLookup`) sin hook intermedio, leído directo por la pantalla. Agregar un hook `useAnimalLookup` solo para el overlay duplicaría el patrón sin reuso real (la puerta manual no lo usaría) e introduciría una capa de estado React extra que el overlay ya maneja con su `OverlayState`. El service puro es más testeable (node:test sin RTL) y consistente con el resto de `animals.ts`.

**Razón**: service puro `lookupByTag` + estado local en `FindOrCreateOverlay`. Alineado con el as-built (services delgados sobre `local-reads`), testeable sin DOM, sin capa redundante. Esta es la dirección elegida.

## 10. BLOQUEANTES detectados para el leader

> Cosas que NO existen en el as-built y que el chunk necesita. NO las inventé como contratos de otra spec; las listo para que el leader decida antes de mandar al implementer.

1. **Query local cross-campo (`buildLookupTagAcrossFieldsQuery`)**: NO existe. La diseñé arriba (§3.3) como query NUEVA del propio chunk (no es contrato de spec 02/11) sobre tablas ya sincronizadas (`animal_profiles` + `establishments`). **Verificar que `establishments` está en el set sincronizado local con su `name`** (lo usa `buildEstablishmentDetailQuery`, así que debería estarlo) — si no lo estuviera, haría falta confirmar la sync rule. No es bloqueante duro, pero conviene que el implementer lo verifique en el primer paso.
2. **Param `tag` en `crear-animal.tsx`**: hoy el screen lee SOLO `idv`/`visual` y comenta explícitamente "la puerta manual nunca trae 'tag'". El chunk lo modifica para aceptar `tag` read-only (RB6.3). Es modificación legítima del chunk (no de otra spec), pero **toca un screen de spec 02 frontend** — al cerrar el chunk hay que reconciliar la nota del header de `crear-animal.tsx` y, si corresponde, la spec 02 (el alta acepta TAG precargado por BLE). Lo señalo para la reconciliación, no es bloqueo.
3. **Resolución de `targetCategoryId`/`targetRodeoId` del transfer desde el overlay (RB7.2 / §3.4)**: spec 11 dejó `targetCategoryId` como "lo resuelve el cliente con el catálogo del system destino (R2.9 / TODO-D2)". El overlay debe materializar esa resolución. **Si al implementar el `system_id` del rodeo de origen NO es legible desde el set sincronizado del campo destino** (caso raro: el rodeo de origen es de otro campo), el implementer debe PARAR y reportar — no inventar una categoría por default. En MVP (un solo sistema bovino/cría) el caso feliz es directo; el riesgo es teórico pero conviene marcarlo.
4. **Wiring de test del `MockAdapter` al provider de la raíz (E2E)**: NO existe (el `MockAdapter` tiene la API de inyección, pero no hay handle desde Playwright sobre el provider montado en la raíz). El chunk lo crea (§7.2) con un flag de E2E + handle en `window`. Mantenerlo fuera de la superficie de producción (solo bajo el flag). No es bloqueante, es trabajo del chunk; lo anoto por la superficie de seguridad (que Gate 2 revisará).

> **CIERRE de BLOQUEANTES (Run 1 + Run 2, 2026-06-13).** Ninguno fue bloqueante:
> 1. **`buildLookupTagAcrossFieldsQuery`** (Run 1): `establishments(name)` verificado sincronizado (lo usan `buildMembershipsQuery`/`buildEstablishmentDetailQuery`). Query nueva del chunk, builder + test SQLite verdes.
> 2. **Param `tag` en `crear-animal.tsx`** (Run 1): implementado read-only (prioridad tag>idv>visual); comentarios stale actualizados. La nota de spec 02 (el alta acepta TAG precargado por BLE) se reconcilia al cerrar el chunk con `requirements.md`/`design.md` base.
> 3. **`targetCategoryId`/`targetRodeoId` del transfer** (Run 2): NO fue bloqueante — se resolvió por CÓDIGO sobre el sistema DESTINO (que viene del `Rodeo.systemId` del rodeo destino), leyendo el `categoryCode` del perfil de origen (`fetchAnimalDetail`, sincronizado local). No hizo falta exponer el `system_id` de origen. Si la categoría no resuelve en el sistema destino → error accionable, NO se inventa default (regla del leader respetada). Ver §3.4 reconciliado. E2E (d) verde.
> 4. **Wiring E2E del `MockAdapter`** (Run 2): creado con la marca DELIBERADA `window.__RAFAQ_BLE_E2E__` (`isBleE2E()`) → `mode='mock'` + `BleE2EBridge` que publica `window.__rafaqBle`. FUERA de prod (sin la marca, ni mock ni handle; doble guard en el bridge; vive en `_components/`, no en `services/ble/`). Gate 2 revisará la superficie. E2E (a)/(b)/(c)/(d) verdes.
