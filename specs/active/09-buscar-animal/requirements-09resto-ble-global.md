# Spec 09 — chunk "09 resto · BLE global" — Requirements (EARS)

**Status**: Draft (folded del Gate 0 aprobado por Raf — Puerta 1, 2026-06-13). Pendiente de aprobación de spec por Raf (Puerta de spec).
**Fecha**: 2026-06-13 (sesión 24).
**Autor**: spec_author.
**Insumo primario**: `specs/active/09-buscar-animal/context-09resto-ble-global.md` (Gate 0 aprobado: scope §3, arquitectura §4, UX §5, edge cases §6, decisiones DEC-1..DEC-5 §7). Refina la spec base de 2026-05-26 (`requirements.md` R2 + R3.3/R3.4) **sin tocarla** — la reconciliación con la base se hace al cerrar el chunk.

## Naturaleza y alcance

Chunk de implementación del **frontend de la puerta BLE** de spec 09 (mismo patrón que los chunks C4/C6 de spec 02). Cablea la capa BLE buildable de spec 04 (DONE) al motor find-or-create, montando el listener global en la raíz y un overlay (bottom-sheet) que resuelve el EID bastoneado a uno de tres modos: **editar** / **transferir** / **crear**. NO reabre la spec entera; lockea y aterriza las decisiones nuevas validadas en el Gate 0.

## Gate 1 (security spec): N/A

Frontend puro (criterio idéntico a los chunks C4/C6 de spec 02). **No toca schema, RLS ni Edge Functions nuevas.** El lookup corre sobre PowerSync local (SQLite), reusando las queries y la RLS ya gateadas en spec 02/15 (`est_animal_profiles` ya filtra por `has_role_in` al sincronizar). La transferencia usa el RPC `transfer_animal` (spec 11, ya gateado en su Gate 1/2). La única query nueva del chunk (`buildLookupTagAcrossFieldsQuery`) es una lectura local más sobre el set ya sincronizado por RLS — no amplía la superficie de datos. **Gate 2 (security code)**: SÍ aplica (lo corre el implementer; superficie = host BLE global + navegación + camino de transferencia online).

## Divergencias documentadas con la spec base (2026-05-26)

| Spec base | Este chunk | Razón |
|---|---|---|
| **R3.3 (BLE sin-match)** interpone la opción A (`create_via_intermediate` / `AssignTagSearchScreen` "¿es uno de tus animales sin caravana?") antes de CREATE. | BLE sin-match va **directo a CREATE** con TAG precargado. El intermediate de opción A queda DIFERIDO al chunk dedup siguiente. | **DEC-2** (Gate 0): el motor de dedup (`assignTagToAnimal`, `AssignTagSearchScreen`, `BulkTagAssignmentScreen`) no entra en este chunk. Se documenta la divergencia y se difiere R7/R8. |
| **R3.4 (TAG en otro campo)** retorna `mode:'transfer_or_alta'` y ofrece "**dar de alta en este campo**" (crear un `animal_profile` nuevo para el `animal_id` global, sin transferir). | TAG activo en otro campo del usuario → `mode:'transfer'` que ofrece **transferir** el animal al campo activo vía `transferAnimal` de spec 11 (ONLINE-only). | **DEC-3** (Gate 0), refinado por el D2 del Gate 0 retroactivo + spec 11 (re-parenting, DONE): un animal vivo tiene UN solo perfil activo (no dos presencias simultáneas). "Alta en este campo" duplicaría presencia; la transferencia re-parenta correctamente. |
| **R2.4** abre el resultado en modal full-screen o navegación en stack. | El resultado se muestra en un **bottom-sheet** sobre la pantalla activa (preserva el contexto detrás). | **DEC-1** (Gate 0): una decisión por pantalla, EID legible arriba, 1 CTA grande. |
| `useAnimalLookup` (hook con `mode:'create_via_intermediate'`, `mode:'transfer_or_alta'`). | Service puro `lookupByTag(tag, establishmentId)` con modos `edit`/`transfer`/`create`; el host (overlay) lo consume directo (sin hook intermedio). | Aterriza el contrato al as-built real (services delgados sobre `local-reads`, sin la capa de hooks que la base de 2026-05-26 asumía antes de PowerSync). |

## Fuera de este chunk (diferido)

- **Opción A** (`AssignTagSearchScreen`, R7 base) y **opción B** (`BulkTagAssignmentScreen`, R8 base) — chunk dedup siguiente.
- **`spp-android` real** (bastón físico nativo) — gated por el dev build Android de Raf (ADR-024 §4). Este chunk valida con mock + web-serial.
- **Pantalla de conexión / pairing pulida** (R9 base) — tentativa, espera el hardware real (DEC-5). Este chunk solo agrega el chip de estado mínimo.

---

## Requirements (EARS)

> Nomenclatura: requirements de este chunk con prefijo **RB** (R-Ble) para no colisionar con la numeración de la spec base; cada uno indica a qué R de la base aterriza.

### RB1. Montaje del listener global en la raíz (aterriza R2.1)

**RB1.1** El sistema deberá montar `BleStickListenerProvider` (de `app/src/services/ble/BleStickListenerProvider.tsx`) con `mode="auto"` en el árbol de providers de la raíz (`app/app/_layout.tsx`), envolviendo a `RootGate` y montado **dentro** de `RodeoProvider`, de modo que el host del flujo BLE tenga disponibles `AuthContext`, `PowerSyncContext`, `EstablishmentContext` y `RodeoContext`.

**RB1.2** El sistema deberá montar un componente `FindOrCreateOverlay` dentro de `RootGate`, hermano del `<Stack>` de navegación (`<><Stack/><FindOrCreateOverlay/></>`), de modo que el overlay se renderice por encima de la pantalla activa sin desmontarla.

**RB1.3** El `BleStickListenerProvider` montado en la raíz **no deberá auto-conectar** el transporte físico: la conexión la dispara un gesto del usuario (web-serial: `requestPort`) o el `MockAdapter` en tests. El montaje en la raíz no debe alterar el comportamiento de `app/app/baston-test.tsx` (que monta su propio provider self-contained).

### RB2. Gating del listener (`enabled`) (aterriza R2.2 / R2.3 / R10.3)

**RB2.1** El sistema deberá derivar el `enabled` del `FindOrCreateOverlay` como `est.status === 'active' && rodeo.status === 'active'` (hay campo activo fijado **y** rodeo existente sobre el cual crear). Mientras el `enabled` sea `false`, el host no deberá disparar ningún flujo find-or-create por bastoneo.

**RB2.2** Mientras un form de carga/edición esté montado, el sistema deberá suspender el listener vía `useBusyWhileMounted()` (de `stick.ts`) en `app/app/crear-animal.tsx`, `app/app/animal/[id].tsx` y `app/app/agregar-evento.tsx`, de modo que un bastoneo **no abra el overlay encima de un form abierto** (anti-stacking).

**RB2.3** El sistema deberá dejar disponible el contrato `useStickListenerControls()` (`{ enableListener, disableListener }`) para que el futuro MODO MANIOBRAS (spec 03, no construido aún) suspenda el listener global en su stack. **Este chunk no implementa MODO MANIOBRAS** — solo verifica que el contrato esté cableado y consumible (no hay caso que suspender por R2.3 todavía).

**RB2.4** Cuando el `establishment_id` activo cambie (vía `EstablishmentContext`) mientras el overlay esté abierto, el sistema deberá cerrar/descartar el overlay en curso (el lookup se scopeó al establishment del momento del disparo; no se re-escopea un resultado viejo).

### RB3. Disparo del overlay y confirmación visual del EID (aterriza R2.4)

**RB3.1** El `FindOrCreateOverlay` deberá consumir `useBleStickListener({ enabled, onTagRead })` (firma exacta de `stick.ts`). Cuando `onTagRead(eid)` entrega un EID (ya validado + des-duplicado por el provider) y `enabled` es `true`, el sistema deberá ejecutar `lookupByTag(eid, establishmentId)` y abrir el overlay con el resultado.

**RB3.2** El overlay deberá mostrar como encabezado el **EID leído formateado legible**, como confirmación visual pre-commit (integridad de la declaración SENASA): el operario verifica de un vistazo que leyó la caravana correcta antes de cualquier acción.

**RB3.3** El overlay deberá presentar el cuerpo según una **decisión por pantalla** con un único CTA primario grande (touch ≥56px), según el modo del resultado (RB5/RB6/RB7).

**RB3.4** Cuando el usuario cierra el overlay (tap afuera / botón "Cerrar"), el sistema deberá limpiar el estado del overlay y volver a la pantalla original; el listener queda reanudado (sigue escuchando el próximo bastoneo).

**RB3.5 (live-rescan, DEC-4)** Mientras el overlay está abierto, cuando `onTagRead` entrega un EID **distinto** del actual, el sistema deberá **actualizar** el overlay con el nuevo lookup (sin cerrarlo): escanear-escanear-escanear sin cerrar es el ritmo de la manga. El mismo EID dentro de la ventana de dedup ya lo ignora el provider (no llega al host).

### RB4. Service `lookupByTag` — rama BLE del find-or-create (aterriza R3.1 / R3.2 / R3.3 / R3.4 / R3.5)

**RB4.1** El sistema deberá exponer en `app/src/services/animals.ts` una función `lookupByTag(tag: string, establishmentId: string): Promise<ServiceResult<TagLookupResult>>` que resuelva el EID íntegramente sobre PowerSync local (SQLite), **sin requerir red** (offline-first; el set sincronizado ya incluye todos los campos del usuario por spec 15).

**RB4.2** El tipo de resultado deberá ser:
```
type TagLookupResult =
  | { mode: 'edit';     profileId: string }                                  // match activo en el campo activo
  | { mode: 'transfer'; sourceProfileId: string; otherFieldName: string }    // activo en OTRO campo del usuario
  | { mode: 'create' }                                                        // sin match en ningún campo
```

**RB4.3 (rama edit, R3.2)** Cuando exista un `animal_profile` **activo** con ese `tag_electronic` en el **establishment activo**, `lookupByTag` deberá retornar `{ mode: 'edit', profileId }`. La detección reusa la query exacta por TAG ya scopeada al campo activo (`buildSearchByTagQuery`), tomando el primer match (la unicidad global de `animals.tag_electronic` garantiza ≤1 perfil activo por campo).

**RB4.4 (rama transfer, R3.4 refinado por DEC-3)** Cuando NO exista match en el campo activo pero SÍ exista un `animal_profile` **activo** con ese `tag_electronic` en **otro establishment del usuario** (presente en el set sincronizado local), `lookupByTag` deberá retornar `{ mode: 'transfer', sourceProfileId, otherFieldName }`, donde `sourceProfileId` es el perfil activo en el otro campo y `otherFieldName` es el nombre legible de ese establishment.

**RB4.5 (rama create, R3.3 BLE — DEC-2)** Cuando NO exista ningún `animal_profile` activo con ese `tag_electronic` en ningún campo del usuario, `lookupByTag` deberá retornar `{ mode: 'create' }` (DIRECTO a CREATE; **sin** el intermediate de opción A — diferido). El overlay invocará la pantalla CREATE con el TAG precargado.

**RB4.6** La detección de "otro campo" (RB4.4) deberá apoyarse en una query local **nueva** del chunk (`buildLookupTagAcrossFieldsQuery`) que matchee `animal_profiles.animal_tag_electronic = ?` con `status='active'` y `deleted_at IS NULL` **sin** filtrar por `establishment_id`, devolviendo `establishment_id` + el `name` del establishment (JOIN local a `establishments`). El scoping multi-tenant lo garantiza la stream (solo sincroniza campos donde el usuario tiene rol) — la query NO debilita la RLS, solo no re-aplica el filtro de campo activo que las queries operativas sí aplican.

### RB5. Modo `edit` en el overlay (aterriza R2.4 + R5)

**RB5.1** Cuando `lookupByTag` retorna `mode:'edit'`, el overlay deberá mostrar una card del animal (identidad visible: visual/IDV + categoría + sexo + rodeo) leída con `fetchAnimalDetail(profileId)` y un CTA primario **"Ver ficha"**.

**RB5.2** Cuando el usuario toca "Ver ficha", el sistema deberá cerrar el overlay y navegar a `/animal/[id]` con `id = profileId` (la ficha es destino navegable ya registrado en `_layout.tsx`).

### RB6. Modo `create` en el overlay (aterriza R3.3 BLE + R4)

**RB6.1** Cuando `lookupByTag` retorna `mode:'create'`, el overlay deberá mostrar "Animal nuevo" + el EID y un CTA primario **"Dar de alta"**.

**RB6.2** Cuando el usuario toca "Dar de alta", el sistema deberá cerrar el overlay y navegar a `/crear-animal` con el **TAG bastoneado precargado** (`params: { tag }`).

**RB6.3** El sistema deberá modificar `app/app/crear-animal.tsx` para aceptar un param `tag` y, cuando viene, **precargarlo en el campo `tag_electronic` read-only durante el alta** (rama BLE de R4.2): igual tratamiento que `idv`/`visual` precargados de la puerta manual. El header del wizard deberá mostrar "Creando: [TAG]". Cuando no viene `tag`, el comportamiento actual (campo TAG vacío y editable) se conserva.

### RB7. Modo `transfer` en el overlay (aterriza R3.4 refinado — DEC-3, online-only)

**RB7.1** Cuando `lookupByTag` retorna `mode:'transfer'`, el overlay deberá mostrar "Está en **[nombre del otro campo]**" + el EID, un CTA primario **"Transferir a [campo activo]"** y un secundario "Cancelar".

**RB7.2** Cuando el usuario confirma la transferencia, el sistema deberá invocar `transferAnimal(...)` de spec 11 (`app/src/services/transfer-animal.ts` + `animals.ts`), resolviendo: `sourceProfileId` (de `lookupByTag`), `targetEstablishmentId` (campo activo), `targetRodeoId` (rodeo destino del campo activo — `lastRodeoSelected` o el único activo; debe ser del **mismo sistema** que el de origen, R1.5/R2.2 de spec 11), `targetProfileId` (UUID generado en el cliente, estable entre reintentos), `targetCategoryId` (categoría inicial resuelta por el catálogo del sistema destino).

**RB7.3 (online-only, DEC-3 + spec 11 R7.1)** La transferencia es **ONLINE-only** (no se encola offline). Cuando no hay red, el CTA "Transferir" deberá quedar **deshabilitado** con copy accionable "necesita conexión" (consistente con el `assertOnline` / `TRANSFER_OFFLINE_MESSAGE` de spec 11). El overlay igual muestra la situación ("está en otro campo") en modo read-only.

**RB7.4** Cuando `transferAnimal` retorna éxito, el sistema deberá cerrar el overlay y navegar a la ficha del perfil nuevo en el campo activo (`/animal/[id]` con `id = targetProfileId`). Si el resultado trae `idvDropped === true`, la UI deberá avisar que el IDV quedó vacío y conviene completarlo (R2.4/R2.5 de spec 11). Cuando `transferAnimal` falla, el sistema deberá mostrar el copy accionable que `classifyTransferError` devuelve (nunca el `sqlerrm` crudo) y mantener el overlay abierto para reintentar/cancelar.

### RB8. Chip de estado de conexión (aterriza R2.5 — DEC-5)

**RB8.1** El sistema deberá exponer un **chip de estado de conexión del bastón** mínimo y consistente, alimentado por `useBleConnectionStatus()` (de `connection-status.ts`), visible en un punto fijo de la UI (p. ej. el header de la tab Animales).

**RB8.2** El chip deberá reflejar los estados del transporte (`off | connecting | connected | scanning | disconnected | permission_denied`) con copy es-AR e ícono, y **nunca bloquear** la puerta manual ni el resto de la app (manual-first; `blocksManualEntry` es invariante `false`). Cuando el bastón se desconecta, la app sigue operativa.

**RB8.3 (DEC-5)** El chip deberá reusar el connect de web-serial (gesto de usuario → `requestPort`) para conectar desde un punto accesible; la **pantalla de pairing pulida (R9 base) queda diferida** al chunk de hardware. No se construye un flujo de pairing nativo en este chunk.

### RB9. Offline-first y multi-tenancy (aterriza R10 / R11)

**RB9.1** El motor `lookupByTag` (RB4) deberá operar 100% sobre PowerSync local, sin red, incluida la detección de "otro campo" (el set sincronizado ya incluye todos los campos del usuario, spec 15). Solo la **transferencia** (RB7) requiere red (online-only por diseño de spec 11).

**RB9.2** Todas las queries del chunk deberán operar sobre el scope multi-tenant ya garantizado por la stream (`has_role_in`); la query `buildLookupTagAcrossFieldsQuery` no re-aplica el filtro de campo activo a propósito (RB4.6), pero no accede a datos fuera del set sincronizado por RLS. La RLS de spec 02/11 es la red de seguridad final del server.

---

## Criterios de aceptación del chunk

El chunk se considera implementado cuando:

- Con un campo activo + rodeo existente, un bastonazo (mock o web-serial) desde cualquier pantalla operativa abre el bottom-sheet con el EID legible arriba (RB1, RB3).
- Bastonazo a un animal del campo activo → overlay modo `edit` → "Ver ficha" → `/animal/[id]` correcto (RB4.3, RB5).
- Bastonazo a un EID nuevo → overlay modo `create` → "Dar de alta" → `/crear-animal` con el TAG precargado read-only (RB4.5, RB6).
- Bastonazo a un animal activo en otro campo del usuario → overlay modo `transfer` → "Transferir a [campo activo]" (deshabilitado sin red) → online transfiere y aterriza en la ficha nueva (RB4.4, RB7).
- Bastonazo con un form CREATE/EDIT abierto → NO abre overlay (busyMode, RB2.2).
- Bastonazo sin rodeo / sin campo activo → listener `enabled=false`, no dispara (RB2.1).
- Un EID nuevo mientras el overlay está abierto lo actualiza sin cerrar (RB3.5 live-rescan).
- El chip de conexión refleja el estado del bastón y nunca bloquea la puerta manual (RB8).
- Todo el lookup es offline; solo el transfer es online (RB9).
- E2E Playwright con `MockAdapter` cubre los 4 escenarios del §9 del Gate 0; `node scripts/check.mjs` verde end-to-end.

## Historial de refinamiento

- **2026-06-13 — Creación.** Folded de `context-09resto-ble-global.md` (Gate 0 aprobado por Raf, Puerta 1) tras mapear el as-built real (capa BLE de spec 04 DONE, `_layout.tsx`, `animals.ts`, `transfer-animal.ts` de spec 11 DONE). Decisiones DEC-1..DEC-5 tomadas como decididas. Divergencias con la spec base (R3.3 directo-a-create, R3.4 transfer en vez de alta-en-campo) documentadas arriba. Gate 1 N/A (frontend puro). Numeración RB para no colisionar con la base; la reconciliación con `requirements.md` se hace al cerrar el chunk.
